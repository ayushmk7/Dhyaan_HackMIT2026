"""The camera lane's whole HTTP surface. API_CONTRACT_V3.md is frozen; this
file implements exactly that.

Three routers because three trust levels: the worker on the hub (`X-Band-Key`),
the family app (`Bearer API_KEY`), and the login, which is the one route a
person reaches before they hold a credential.

The two things that must never be relaxed here:

* `POST /ingest/camera` fails closed. No camera doc, consent off, or paused and
  nothing is written at all — a rogue or stale worker cannot create an
  observation (§5.6).
* No family response carries a `zone`, an `evidence` sentence, a posture or a
  movement quality. That filter is applied server-side, in `_family_item` and
  in `rag.search(family=True)`. A client-side filter is not a privacy control.
"""

import os
from datetime import datetime, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, field_validator

from .. import auth, memory, presence, rag
from ..config import API_KEY
from ..db import db
from ..deps import require_app_key, require_band_key
from ..events import emit

device = APIRouter(prefix="/v1", tags=["camera"], dependencies=[Depends(require_band_key)])
family = APIRouter(prefix="/v1", tags=["camera"], dependencies=[Depends(require_app_key)])
public = APIRouter(prefix="/v1", tags=["camera"])

ACTIVITIES = (
    "eating", "drinking", "sitting", "reading", "watching_tv", "using_phone",
    "standing", "walking", "exercising", "lying_down", "on_floor", "entering",
    "leaving", "with_visitor", "unclear", "absent",
)


def _aware(ts: datetime) -> datetime:
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


async def _push_presence(resident_id: str) -> dict:
    p = await presence.family_presence(resident_id)
    from .live import broadcast  # lazy: live.py imports events, events imports db

    await broadcast({"t": "presence.update", "resident_id": resident_id, "presence": p},
                    resident_id)
    return p


# ---------------------------------------------------------------------------
# Device routes
# ---------------------------------------------------------------------------

class ObservationIn(BaseModel):
    camera_id: str = Field(min_length=1)
    resident_id: str = Field(min_length=1)
    ts: datetime
    span_s: float = Field(ge=0, le=600)
    n_frames: int = Field(ge=0, le=16)
    person_count: int = Field(ge=0, le=6)
    activity: Literal[ACTIVITIES]
    posture: Literal["upright", "seated", "reclined", "on_floor", "unclear"] = "unclear"
    movement: Literal["stationary", "slow", "normal", "unsteady", "unclear"] = "unclear"
    spot: Literal["table", "armchair", "sofa", "doorway", "counter", "window",
                  "floor", "other", "unclear"] = "unclear"
    assistive_device: Literal["none", "cane", "walker", "wheelchair", "unclear"] = "unclear"
    plate_or_cup_present: bool = False
    # Broader than plate_or_cup: food held in a hand, a wrapper, a snack. The
    # vision lane started reporting this and it was silently dropped here,
    # because an unknown field on a Pydantic model just vanishes.
    food_visible: bool = False
    hand_to_mouth_observed: bool = False
    confidence: float = Field(ge=0, le=1)
    evidence: str = Field(default="", max_length=180)
    model: str = ""
    latency_ms: int | None = Field(default=None, ge=0)
    simulated: bool = False


def _is_paused(camera: dict) -> bool:
    pu = camera.get("paused_until")
    return bool(pu) and _aware(datetime.fromisoformat(pu)) > datetime.now(timezone.utc)


async def _live_camera(camera_id: str, resident_id: str | None = None) -> tuple[dict, dict]:
    """The fail-closed check, shared by every device route that writes anything.

    §5.6, belt and braces: the worker already gates on consent and the pause,
    and so do we. A rogue or stale worker cannot create an observation — or a
    console tick, which is the same promise one layer thinner.
    """
    d = db()
    camera = await d.cameras.find_one({"_id": camera_id})
    if not camera:
        raise HTTPException(404, f"unknown camera_id {camera_id!r}")
    if resident_id and camera["resident_id"] != resident_id:
        raise HTTPException(404, "camera is not registered to that resident")
    resident = await d.residents.find_one({"_id": camera["resident_id"]})
    if not resident:
        raise HTTPException(404, "resident not found")
    if not resident.get("consent_camera"):
        raise HTTPException(403, "camera consent is off for this resident")
    if _is_paused(camera):
        raise HTTPException(403, "the camera is paused")
    return camera, resident


@device.post("/ingest/camera", status_code=201)
async def ingest_camera(body: ObservationIn):
    d = db()
    camera, resident = await _live_camera(body.camera_id, body.resident_id)

    ts = _aware(body.ts)
    obs = presence.new_observation_doc(body.model_dump(), body.resident_id, ts)
    row = {k: v for k, v in obs.items() if k != "_ts"}
    await d.observations.insert_one(row)

    event_ids = await presence.record(obs, resident, camera)
    camera = await d.cameras.find_one({"_id": body.camera_id})
    await presence.apply_presence(camera, obs)
    await d.cameras.update_one({"_id": body.camera_id}, {"$set": {
        "last_heartbeat_at": datetime.now(timezone.utc).isoformat(), "state": "watching"}})

    p = await _push_presence(body.resident_id)
    return {"observation_id": obs["_id"], "presence": p, "event_ids": event_ids}


# ---------------------------------------------------------------------------
# The monitor channel: a live console for the hub, in RAM, never in Mongo.
#
# Family-visible, decided deliberately: a tick carries counts, normalised box
# geometry and the same activity/spot sentence `GET /presence` already returns.
# It carries no zone, no evidence, no posture, no movement quality and no pixel,
# and `MonitorIn` is what enforces that — a Pydantic model IS an allowlist,
# because a field it does not declare simply vanishes. A worker that starts
# sending `evidence` therefore cannot leak it by accident; someone would have to
# add the field here, next to this paragraph.
#
# `sentence` still goes through `rag.scrub_rooms`, the same filter `_family_item`
# uses, because it is prose and prose is where a room name gets in.
#
# Not in MongoDB on purpose: this is telemetry at 1 Hz with a useful life of one
# second. ponytail: a module-level dict, the same shortcut `location.py` and
# `setup.py` take. Ceiling: it resets on restart and is per-worker. Upgrade: the
# day there is more than one API worker this becomes the same Redis the
# websocket fan-out would need.
# ---------------------------------------------------------------------------

_MONITOR: dict[str, dict] = {}

# A tick older than this is not a live console, it is a photograph of one.
MONITOR_STALE_S = 15


class MonitorIn(BaseModel):
    camera_id: str = Field(min_length=1)
    ts: datetime
    fps: float = Field(default=0.0, ge=0, le=120)
    person_count: int = Field(default=0, ge=0, le=6)
    # Normalised 0..1, never pixels — the app must not be able to reconstruct a
    # frame geometry from this, and a box in a 448x252 buffer is one step closer
    # to that than a fraction is.
    boxes: list[list[float]] = Field(default_factory=list, max_length=6)
    gate: Literal["idle", "motion", "person", "thinking"] = "idle"
    model: str = ""
    latency_ms: int = Field(default=0, ge=0)
    batch_frames: int = Field(default=0, ge=0, le=16)
    activity: Literal[ACTIVITIES] | None = None
    # None is a worker that has nothing to say yet, not a validation error —
    # a blank console beats a 422 nobody reads.
    sentence: str | None = Field(default="", max_length=180)
    confidence: float | None = Field(default=None, ge=0, le=1)
    simulated: bool = False

    @field_validator("boxes")
    @classmethod
    def _normalised(cls, v):
        for b in v:
            if len(b) != 4 or not all(0.0 <= c <= 1.0 for c in b):
                raise ValueError("each box is four normalised 0..1 numbers, x0,y0,x1,y1")
        return v


@device.post("/ingest/camera/monitor", status_code=204)
async def ingest_camera_monitor(body: MonitorIn):
    """Fails closed exactly as `/ingest/camera` does. A paused camera that kept
    streaming its console would be the pause not meaning anything."""
    camera, _ = await _live_camera(body.camera_id)
    tick = body.model_dump()
    tick["ts"] = _aware(body.ts).isoformat()
    tick["sentence"] = rag.scrub_rooms(body.sentence or "")
    
    tick["resident_id"] = camera["resident_id"]
    _MONITOR[body.camera_id] = tick

    from .live import broadcast  # lazy: live.py imports events, events imports db

    await broadcast({"t": "camera.monitor", **tick}, camera["resident_id"])
    return Response(status_code=204)


class HeartbeatIn(BaseModel):
    camera_id: str = Field(min_length=1)
    state: Literal["watching", "paused", "offline", "no_consent"]
    paused_until: datetime | None = None
    fps: float = Field(default=0.0, ge=0, le=120)
    dropped_batches: int = Field(default=0, ge=0)


@device.post("/ingest/camera/heartbeat", status_code=204)
async def ingest_camera_heartbeat(body: HeartbeatIn):
    d = db()
    camera = await d.cameras.find_one({"_id": body.camera_id})
    if not camera:
        raise HTTPException(404, f"unknown camera_id {body.camera_id!r}")

    was = camera.get("state")
    sets = {
        "state": body.state, "fps": body.fps, "dropped_batches": body.dropped_batches,
        "last_heartbeat_at": datetime.now(timezone.utc).isoformat(),
        "paused_until": _aware(body.paused_until).isoformat() if body.paused_until else None,
    }
    if body.state == "paused":
        # Pausing is her control, on her hub. Record who did it so no family
        # surface can pretend it was theirs to undo (PRODUCT_SPEC §8.3).
        sets["paused_by"] = "resident"
    await d.cameras.update_one({"_id": body.camera_id}, {"$set": sets})

    if body.state != was:
        etype = {"watching": "camera_online", "paused": "camera_paused"}.get(
            body.state, "camera_offline")
        await emit(resident_id=camera["resident_id"], source="camera", type=etype,
                   embedding_text=f"The camera is {body.state}.",
                   payload={"state": body.state, "fps": body.fps},
                   source_id=body.camera_id)
        await _push_presence(camera["resident_id"])
    return Response(status_code=204)


@device.get("/camera/config")
async def camera_config(camera_id: str = Query(..., min_length=1)):
    """What the worker polls every 10 s. Fail closed is the worker's job on a
    fetch failure; ours is to never report consent we do not have."""
    camera = await db().cameras.find_one({"_id": camera_id})
    if not camera:
        raise HTTPException(404, f"unknown camera_id {camera_id!r}")
    r = await db().residents.find_one({"_id": camera["resident_id"]}) or {}
    return {
        "resident_id": camera["resident_id"],
        "name": r.get("display_name"),
        "consent_camera": bool(r.get("consent_camera")),
        "paused_until": camera.get("paused_until"),
        "zone": camera.get("zone"),
        "zone_label": memory.zone_label(camera.get("zone")),
        "zone_hint": camera.get("zone_hint"),
        # Only the layout hint, the appearance hint and the learned spots go to
        # the VLM. Facts never do — "she eats at 8" must not turn an empty table
        # into breakfast (§4.4).
        "appearance": r.get("appearance") if r.get("consent_memory") else None,
        "spots_line": presence.spots_line(r) if r.get("consent_memory") else "",
        "demo_fast": os.getenv("DEMO_FAST", "") not in ("", "0", "false", "False"),
    }


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------

class LoginIn(BaseModel):
    # Still called `email` on the wire so no client changes shape. It is a
    # username now: the seeded demo account is `user`, which is not an email.
    email: str
    password: str


# One sentence for every failure. Saying "no such user" would confirm which
# usernames exist; saying "wrong password" would confirm the username.
_BAD_LOGIN = "check your username and password"


@public.post("/auth/login")
async def login(body: LoginIn):
    """A real password check, then the shared key.

    The username is looked up in `users` (trimmed, case-insensitive) and the
    password is verified against its scrypt hash in constant time. That is real
    authentication. What follows is not a session: the token handed back is the
    one static `API_KEY` every family route accepts, so every person who signs
    in holds the same credential afterwards, and nothing here can be revoked
    per person. There is no longer an email-shaped bypass: with an account on
    file, "any email and any password gets in" would make the check a lie.

    # ponytail: ceiling is the shared key. Upgrade path, in order: mint a random
    # session token per login and store it on the user doc; have
    # `require_app_key` accept either that or API_KEY; then take `resident_id`
    # from the session instead of trusting the client's URL. See app/auth.py.
    """
    if not (body.email or "").strip() or not (body.password or "").strip():
        raise HTTPException(401, _BAD_LOGIN)
    user = await auth.authenticate(body.email, body.password)
    if user is None:
        raise HTTPException(401, _BAD_LOGIN)
    return {"ok": True, "token": API_KEY,
            # `email` keeps the field name the app already stores; the value is
            # the username, which is the only identifier this account has.
            "user": {"name": user["display_name"], "email": user["username"]},
            "resident_id": user["resident_id"]}


# ---------------------------------------------------------------------------
# Family routes
# ---------------------------------------------------------------------------

@family.get("/residents/{resident_id}/presence")
async def get_presence(resident_id: str):
    await memory.require_resident(resident_id)
    return await presence.family_presence(resident_id)


_TILE_TYPES = ["meal_observed", "walk_completed", "walk_started", "left_home",
               "returned_home", "bed_exit", "night_activity", "room_entry",
               "room_exit", "visitor_present", "activity_observed",
               "fall_suspected", "fall_confirmed", "daily_summary",
               "baseline_deviation"]


def _family_item(ev: dict) -> dict:
    """One timeline row. Everything the family must not see is dropped here,
    on the server, rather than sent and hidden: no zone, no evidence, no
    posture, no movement quality."""
    return {
        "id": ev["_id"], "ts": ev["ts"], "ts_end": ev.get("ts_end"),
        "type": ev["type"],
        "sentence": rag.scrub_rooms((ev.get("payload") or {}).get("narrative")
                                    or ev.get("embedding_text", "")),
        "kind": "pattern" if ev["type"] in rag.PATTERN_TYPES else "observed",
        "confidence": ev.get("confidence"),
    }


@family.get("/residents/{resident_id}/activity")
async def get_activity(resident_id: str, date: str | None = Query(None)):
    r = await memory.require_resident(resident_id)
    tz = ZoneInfo(r.get("timezone") or "UTC")
    date = date or datetime.now(tz).strftime("%Y-%m-%d")
    try:
        start, end = rag._day_range_utc(tz, date)
    except ValueError:
        raise HTTPException(422, "date must be YYYY-MM-DD") from None

    # Two kinds of row, and they belong to a day in two different ways.
    #
    # An observation happened AT a moment, so it belongs to the day its
    # `ts_epoch` falls in. A `daily_summary` or a `baseline_deviation` is ABOUT
    # a day and is written whenever the rollup happened to run — which for the
    # seed is all fifteen of them inside one second. Selecting those by
    # `ts_epoch` put every story Eleanor has ever had onto today's feed ("2026
    # -09-13 — Eleanor had 14 recorded events…" as something noticed today) and
    # counted them in the day's totals. They are selected by the day they
    # describe instead.
    day_scoped = sorted(rag.PATTERN_TYPES)
    observed_types = [t for t in _TILE_TYPES if t not in rag.PATTERN_TYPES]
    excluded = sorted(rag.FAMILY_EXCLUDED_TYPES)
    rows = await db().events.find({
        "resident_id": resident_id,
        "type": {"$nin": excluded},
        "$or": [
            {"type": {"$in": observed_types}, "ts_epoch": {"$gte": start, "$lt": end}},
            {"type": {"$in": day_scoped}, "payload.date_local": date},
            # A pattern row written without `date_local` (an older row, or a
            # writer that forgot) falls back to when it was written, so it is
            # still reachable rather than silently invisible.
            {"type": {"$in": day_scoped}, "payload.date_local": {"$exists": False},
             "ts_epoch": {"$gte": start, "$lt": end}},
        ],
    }).sort("ts_epoch", 1).to_list(length=1000)

    # Every rollup run appends rather than supersedes, so a day that has been
    # rolled up twice carries two stories and two copies of each deviation —
    # and because the wording of a deviation has changed over time, the family
    # saw the same fact stated two different ways in a row ("Eleanor's longest
    # inactivity s was 14340 (baseline 8040.0, z=3.50)" directly above "Eleanor
    # went about 4 hours without moving"). Collapse pattern rows to the newest
    # per subject: one story per day, one line per feature.
    #
    # Superseding on write would be the better fix and belongs in the rollup;
    # this keeps the read correct in the meantime, and stays correct after.
    latest_pattern: dict[tuple, dict] = {}
    kept: list[dict] = []
    for ev in rows:
        if ev["type"] in rag.PATTERN_TYPES:
            subject = (ev["type"], (ev.get("payload") or {}).get("feature"))
            latest_pattern[subject] = ev       # rows arrive ascending: last wins
        else:
            kept.append(ev)
    rows = sorted(kept + list(latest_pattern.values()), key=lambda e: e["ts_epoch"])

    by_type: dict[str, list[dict]] = {}
    for ev in rows:
        by_type.setdefault(ev["type"], []).append(ev)

    in_view_s = 0
    for ev in by_type.get("activity_observed", []) + by_type.get("meal_observed", []):
        if ev.get("ts_end"):
            in_view_s += max(0, (datetime.fromisoformat(ev["ts_end"])
                                 - datetime.fromisoformat(ev["ts"])).total_seconds())

    tiles = {
        "meals": len(by_type.get("meal_observed", [])),
        "walks": len(by_type.get("walk_completed", [])),
        "out_of_house": len(by_type.get("left_home", [])),
        "night_ups": sum(1 for ev in by_type.get("bed_exit", []) + by_type.get("night_activity", [])
                         if 0 <= datetime.fromtimestamp(ev["ts_epoch"], tz).hour < 5),
        "in_view_minutes": int(in_view_s // 60),
    }
    return {"date": date, "tiles": tiles, "items": [_family_item(e) for e in rows]}


@family.get("/residents/{resident_id}/profile")
async def get_profile(resident_id: str):
    return await memory.get_profile(resident_id)


class ConsentIn(BaseModel):
    falls: bool | None = None
    camera: bool | None = None
    memory: bool | None = None
    signed_by: str | None = None
    relationship: str | None = None


class ProfileIn(BaseModel):
    name: str | None = None
    appearance: str | None = None
    consent: ConsentIn | None = None
    camera: dict | None = None


@family.put("/residents/{resident_id}/profile")
async def put_profile(resident_id: str, body: ProfileIn):
    payload = body.model_dump(exclude_none=True)
    if body.consent is not None:
        payload["consent"] = body.consent.model_dump(exclude_none=True)
    return await memory.update_profile(resident_id, payload)


class FactIn(BaseModel):
    key: str = Field(min_length=1, max_length=40)
    text: str = Field(min_length=1, max_length=memory.MAX_FACT_TEXT)


@family.post("/residents/{resident_id}/profile/facts")
async def post_facts(resident_id: str, body: list[FactIn],
                     author: str = Query("the family")):
    r = await memory.require_resident(resident_id)
    if not 1 <= len(body) <= 40:
        raise HTTPException(422, "send between 1 and 40 facts")
    if not r.get("consent_memory"):
        raise HTTPException(403, "consent to keep a memory of her has not been given")
    docs = await memory.add_facts(resident_id, [f.model_dump() for f in body],
                                  r.get("consent_signed_by") or author)
    return {"facts": [memory.ser_fact(d) for d in docs]}


class FactEditIn(BaseModel):
    text: str = Field(min_length=1, max_length=memory.MAX_FACT_TEXT)


@family.put("/residents/{resident_id}/profile/facts/{fact_id}")
async def put_fact(resident_id: str, fact_id: str, body: FactEditIn):
    r = await memory.require_resident(resident_id)
    new = await memory.supersede_fact(resident_id, fact_id, body.text,
                                      r.get("consent_signed_by") or "the family")
    return {"fact": memory.ser_fact(new)}


@family.delete("/residents/{resident_id}/profile/facts/{fact_id}")
async def delete_fact(resident_id: str, fact_id: str):
    await memory.require_resident(resident_id)
    await memory.deactivate_fact(resident_id, fact_id)
    return {"ok": True}


class MemoryDeleteIn(BaseModel):
    scope: Literal["profile", "camera", "all"] = "all"
    confirm: str = ""


@family.delete("/residents/{resident_id}/memory")
async def delete_memory(resident_id: str, body: MemoryDeleteIn):
    deleted = await memory.delete_memory(resident_id, body.scope, body.confirm)
    await _push_presence(resident_id)
    return {"deleted": deleted}


# ---------------------------------------------------------------------------
# Cameras: the console's own surface
# ---------------------------------------------------------------------------

def _camera_row(camera: dict, resident: dict) -> dict:
    """Installer config and liveness. The camera's own room is the one place a
    room name is allowed on a family surface (§5.2) — it is where the family
    pointed the camera, not where she is — and even that is not returned here,
    because nothing on this screen needs it. `GET /profile` has it."""
    hb = camera.get("last_heartbeat_at")
    fresh = bool(hb) and (datetime.now(timezone.utc) - _aware(datetime.fromisoformat(hb))
                          ).total_seconds() < HEARTBEAT_STALE_S
    return {
        "id": camera["_id"], "resident_id": camera["resident_id"],
        "state": camera.get("state") or "offline",
        "consent": bool(resident.get("consent_camera")),
        "paused_until": camera.get("paused_until") if _is_paused(camera) else None,
        "last_heartbeat_at": hb,
        "online": fresh and camera.get("state") == "watching",
    }


# The worker heartbeats every 30 s (vision/__init__.py TUNING), so two missed
# beats is dead. A worker killed with -9 never sends `offline`; without this the
# console would show "watching" forever.
HEARTBEAT_STALE_S = 75


@family.get("/cameras")
async def list_cameras(resident_id: str | None = Query(None)):
    """ponytail: `resident_id` is optional because this demo has one home. Left
    off it lists every camera, which is what the debug panel wants. Upgrade: a
    required scope the day a login maps to more than one resident."""
    q = {"resident_id": resident_id} if resident_id else {}
    cameras = await db().cameras.find(q).to_list(length=50)
    residents = {r["_id"]: r for r in await db().residents.find(
        {"_id": {"$in": [c["resident_id"] for c in cameras]}}).to_list(length=50)}
    return [_camera_row(c, residents.get(c["resident_id"], {})) for c in cameras]


@family.get("/cameras/{camera_id}/monitor")
async def get_camera_monitor(camera_id: str):
    """The latest tick, or an honest empty shape. Never a fabricated tick: a
    console that invents a frame count is worse than a console that says it has
    not heard anything, because only one of the two can be trusted at 3 am."""
    camera = await db().cameras.find_one({"_id": camera_id})
    if not camera:
        raise HTTPException(404, f"unknown camera_id {camera_id!r}")
    resident = await db().residents.find_one({"_id": camera["resident_id"]}) or {}
    row = _camera_row(camera, resident)
    tick = _MONITOR.get(camera_id)
    if tick:
        age = (datetime.now(timezone.utc) - _aware(datetime.fromisoformat(tick["ts"]))
               ).total_seconds()
        if age > MONITOR_STALE_S:
            tick = None
    # `online` here means "the console is live", which a fresh tick proves better
    # than the heartbeat does: ticks arrive at 1 Hz, heartbeats every 30 s. The
    # camera row's own `online` stays heartbeat-based — it answers a different
    # question ("is the worker running at all").
    return {"camera": row, "online": tick is not None, "tick": tick}


class PauseIn(BaseModel):
    hours: float = Field(default=2.0, gt=0, le=24)


@family.post("/cameras/{camera_id}/pause")
async def pause_camera(camera_id: str, body: PauseIn):
    """Pausing from the app, recorded as the app.

    PRODUCT_SPEC §8.3 rule 1 is that the family cannot undo HER pause, not that
    the camera can only be stopped from the hub — so `paused_by` is the whole
    control here: this writes "family", and `resume` below refuses to lift a
    pause it did not set. Her `p` on the hub preview still wins.
    """
    camera = await db().cameras.find_one({"_id": camera_id})
    if not camera:
        raise HTTPException(404, f"unknown camera_id {camera_id!r}")
    until = (datetime.now(timezone.utc) + timedelta(hours=body.hours)).isoformat()
    await db().cameras.update_one({"_id": camera_id}, {"$set": {
        "paused_until": until, "paused_by": "family", "state": "paused"}})
    await emit(resident_id=camera["resident_id"], source="camera", type="camera_paused",
               embedding_text="The camera is paused.",
               payload={"state": "paused", "paused_by": "family"}, source_id=camera_id)
    _MONITOR.pop(camera_id, None)      # a paused camera has no live console
    p = await _push_presence(camera["resident_id"])
    return {"paused_until": until, "paused_by": "family", "presence": p}


@family.post("/cameras/{camera_id}/resume")
async def resume_camera(camera_id: str):
    camera = await db().cameras.find_one({"_id": camera_id})
    if not camera:
        raise HTTPException(404, f"unknown camera_id {camera_id!r}")
    if _is_paused(camera) and camera.get("paused_by") == "resident":
        raise HTTPException(403, "she paused this camera — only she can start it again")
    await db().cameras.update_one({"_id": camera_id}, {"$set": {
        "paused_until": None, "paused_by": None}})
    p = await _push_presence(camera["resident_id"])
    return {"paused_until": None, "presence": p}


# ---------------------------------------------------------------------------
# The on-stage fallback: canned observations through the real ingest path.
# ---------------------------------------------------------------------------

SIMULATED: dict[str, list[dict]] = {
    "meal": [
        {"activity": "eating", "spot": "table", "posture": "seated", "person_count": 1,
         "plate_or_cup_present": True, "hand_to_mouth_observed": True, "confidence": 0.81,
         "evidence": "A person is seated at the table with a plate and a fork."},
        {"activity": "eating", "spot": "table", "posture": "seated", "person_count": 1,
         "plate_or_cup_present": True, "hand_to_mouth_observed": True, "confidence": 0.86,
         "evidence": "The fork moves toward the mouth and the plate is emptier."},
        {"activity": "eating", "spot": "table", "posture": "seated", "person_count": 1,
         "plate_or_cup_present": True, "hand_to_mouth_observed": True, "confidence": 0.84,
         "evidence": "Still seated at the table, plate in front of them."},
    ],
    "visitor": [
        {"activity": "with_visitor", "spot": "sofa", "posture": "seated", "person_count": 2,
         "confidence": 0.78, "evidence": "Two people are seated in the room."},
        {"activity": "with_visitor", "spot": "sofa", "posture": "seated", "person_count": 2,
         "confidence": 0.8, "evidence": "Two people are still seated in the room."},
    ],
    # One observation, not two: `leaving` and `absent` are both room_exit, and
    # two of them a step apart is two events by the debounce rule. The family
    # needs one "went out of view", and presence flips either way.
    "out_of_view": [
        {"activity": "absent", "spot": "unclear", "posture": "unclear", "person_count": 0,
         "confidence": 0.9, "evidence": "No person is visible in the frames."},
    ],
}

# Spaced so the dedup's MIN_DUR_S is actually satisfied (meals need 120 s of
# span) while staying inside its GAP_S. Scaled by DEMO_FAST for the same reason
# the rules are, or a 70 s step would exceed the shrunken 60 s gap and every
# canned step would start its own episode. Backdated, not scheduled — the demo
# cannot wait four minutes for a tile to move.
SIM_STEP_S = 70


async def simulate_camera(resident_id: str, kind: str) -> dict:
    steps = SIMULATED[kind]
    camera = await db().cameras.find_one({"resident_id": resident_id})
    if not camera:
        raise HTTPException(422, "resident has no camera — PUT /profile {camera} first")
    now = datetime.now(timezone.utc)
    out = []
    for i, step in enumerate(steps):
        step_s = SIM_STEP_S * presence.scale()
        ts = now - timedelta(seconds=step_s * (len(steps) - 1 - i))
        out.append(await ingest_camera(ObservationIn(
            camera_id=camera["_id"], resident_id=resident_id, ts=ts, span_s=21.0,
            n_frames=3, movement="slow", assistive_device="none", model="simulated",
            latency_ms=0, simulated=True, **step)))
    return {"observation_ids": [o["observation_id"] for o in out],
            "event_ids": [e for o in out for e in o["event_ids"]],
            "presence": out[-1]["presence"]}
