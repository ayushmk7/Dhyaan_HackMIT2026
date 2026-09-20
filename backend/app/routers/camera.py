"""The camera lane's whole HTTP surface. API_CONTRACT_V3.md is frozen; this
file implements exactly that.

Three routers because three trust levels: the worker on the hub (`X-Band-Key`),
the family app (`Bearer API_KEY`), and the faux login, which by definition has
no credential yet.

The two things that must never be relaxed here:

* `POST /ingest/camera` fails closed. No camera doc, consent off, or paused and
  nothing is written at all — a rogue or stale worker cannot create an
  observation (§5.6).
* No family response carries a `zone`, an `evidence` sentence, a posture or a
  movement quality. That filter is applied server-side, in `_family_item` and
  in `rag.search(family=True)`. A client-side filter is not a privacy control.
"""

import os
import re
from datetime import datetime, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from .. import memory, presence, rag
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
    hand_to_mouth_observed: bool = False
    confidence: float = Field(ge=0, le=1)
    evidence: str = Field(default="", max_length=180)
    model: str = ""
    latency_ms: int | None = Field(default=None, ge=0)
    simulated: bool = False


@device.post("/ingest/camera", status_code=201)
async def ingest_camera(body: ObservationIn):
    d = db()
    camera = await d.cameras.find_one({"_id": body.camera_id})
    if not camera:
        raise HTTPException(404, f"unknown camera_id {body.camera_id!r}")
    if camera["resident_id"] != body.resident_id:
        raise HTTPException(404, "camera is not registered to that resident")

    resident = await d.residents.find_one({"_id": body.resident_id})
    if not resident:
        raise HTTPException(404, "resident not found")

    # §5.6, belt and braces: the worker already gates on this, and so do we.
    if not resident.get("consent_camera"):
        raise HTTPException(403, "camera consent is off for this resident")
    paused_until = camera.get("paused_until")
    if paused_until and _aware(datetime.fromisoformat(paused_until)) > datetime.now(timezone.utc):
        raise HTTPException(403, "the camera is paused")

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
# Faux login
# ---------------------------------------------------------------------------

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class LoginIn(BaseModel):
    email: str
    password: str


@public.post("/auth/login")
async def login(body: LoginIn):
    # ponytail: no user table, no hashing. This validates the shape of what was
    # typed and hands back the one static app key. Upgrade: a users collection
    # and a real session token the day there is a second family.
    if not _EMAIL.match(body.email or "") or not (body.password or "").strip():
        raise HTTPException(401, "check your email and password")
    r = await db().residents.find_one({}, {"_id": 1, "display_name": 1})
    name = (body.email.split("@")[0] or "there").replace(".", " ").title()
    return {"ok": True, "token": API_KEY, "user": {"name": name, "email": body.email},
            "resident_id": r["_id"] if r else None}


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

    rows = await db().events.find({
        "resident_id": resident_id, "ts_epoch": {"$gte": start, "$lt": end},
        "type": {"$in": _TILE_TYPES, "$nin": sorted(rag.FAMILY_EXCLUDED_TYPES)},
    }).sort("ts_epoch", 1).to_list(length=1000)

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
