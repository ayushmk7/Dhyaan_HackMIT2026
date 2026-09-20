"""Camera observations -> deduped episodes -> events, plus the family's
presence sentence. VLM_PLAN §3.6 and §6.

The worker sends an observation roughly once a minute while she is in view. The
same lunch must not become six `meal_observed` events, so observations fold into
one open interval per (resident, episode kind) and a 30 s sweeper closes an
interval when the observations stop — nobody sends one when she simply stops.

Two privacy invariants live here and are not negotiable:

* Nothing this module writes into `embedding_text` or a family sentence names a
  room (D-001, PRODUCT_SPEC §8.2). `zone` rides on the event doc for staff and
  the baseline learner; it never reaches a family surface. Spots (table,
  armchair, sofa) are furniture, not rooms, and are allowed.
* `evidence`, `posture` and `movement` stay on the `observations` row. They are
  never copied into an event the family can read.
"""

import asyncio
import contextlib
import logging
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from ulid import ULID

from .db import db
from .events import emit

log = logging.getLogger("dhyaan.presence")

# (event_type, gap_s, min_obs, min_dur_s) per VLM_PLAN §3.6. `None` means the
# activity updates presence but never becomes an event — drinking alone is too
# noisy to call a meal, and "unclear" is the model admitting it does not know.
RULES: dict[str, tuple[str, int, int, int] | None] = {
    "eating": ("meal_observed", 600, 2, 120),
    "sitting": ("activity_observed", 900, 3, 600),
    "reading": ("activity_observed", 900, 3, 600),
    "watching_tv": ("activity_observed", 900, 3, 600),
    "using_phone": ("activity_observed", 900, 3, 600),
    "standing": ("activity_observed", 900, 3, 600),
    "walking": ("activity_observed", 120, 2, 0),
    "exercising": ("activity_observed", 120, 2, 0),
    "lying_down": ("activity_observed", 900, 2, 300),
    "on_floor": ("activity_observed", 900, 2, 0),
    "with_visitor": ("visitor_present", 900, 2, 0),
    "entering": ("room_entry", 60, 1, 0),
    "leaving": ("room_exit", 60, 1, 0),
    "absent": ("room_exit", 60, 1, 0),
    "drinking": None,
    "unclear": None,
}

IN_VIEW_STALE_S = 150  # no observation for this long -> presence is not "now"


def scale() -> float:
    """DEMO_FAST=1 shrinks every gap and duration threshold to a tenth, so a
    30-second stage lunch becomes one `meal_observed` instead of nothing. Read
    from the environment per call rather than at import so a test (and the demo
    operator) can flip it without reimporting the module."""
    return 0.1 if os.getenv("DEMO_FAST", "") not in ("", "0", "false", "False") else 1.0


# ponytail: in-process dict of open intervals, exactly the shortcut location.py
# takes for `_STATE`. Ceiling: a restart drops every open episode, so a lunch
# spanning a reload emits twice. Upgrade: persist onto the `cameras` doc, which
# already exists and is already written on every observation.
_OPEN: dict[tuple[str, str], dict] = {}


def reset() -> None:
    """Drop all open intervals. Tests call this so one test's lunch cannot
    extend into the next test's."""
    _OPEN.clear()


def _episode_key(resident_id: str, event_type: str, activity: str) -> tuple[str, str]:
    # activity_observed covers reading and walking alike; keying on event_type
    # alone (as the plan's prose does) would fold an afternoon of reading and a
    # five-minute walk into one episode. Split on the activity too.
    return (resident_id, f"{event_type}:{activity}" if event_type == "activity_observed" else event_type)


# --- family-safe wording -----------------------------------------------------

_SPOT_IN = {"armchair": "in the armchair", "sofa": "on the sofa", "table": "at the table",
            "counter": "at the counter", "window": "by the window", "doorway": "by the door",
            "floor": "on the floor"}
_ACTIVITY_WORD = {"reading": "reading", "watching_tv": "watching television",
                  "using_phone": "on the phone", "sitting": "sitting", "standing": "standing up"}


def _spot_phrase(spot: str | None) -> str:
    return _SPOT_IN.get(spot or "", "")


def _meal_for_hour(hour: int) -> str:
    if hour < 11:
        return "breakfast"
    if hour < 15:
        return "lunch"
    if hour >= 17:
        return "dinner"
    return "a snack"


def _hhmm(ts: datetime, tz: ZoneInfo) -> str:
    return ts.astimezone(tz).strftime("%-I:%M %p").lower()


def _episode_text(name: str, iv: dict, tz: ZoneInfo) -> str:
    """The event's embedding_text. Retrieved by the chatbot, shown to family —
    so no room, no posture, no evidence, no movement quality."""
    a, spot = iv["activity"], iv.get("spot")
    start, end = _hhmm(iv["first_ts"], tz), _hhmm(iv["last_ts"], tz)
    where = _spot_phrase(spot)
    if a == "eating":
        meal = _meal_for_hour(iv["first_ts"].astimezone(tz).hour)
        return f"{name} ate {meal}{' ' + where if where else ''}, {start}–{end}."
    if a in ("walking", "exercising"):
        return f"{name} was up and moving about, {start}–{end}."
    if a == "lying_down":
        return f"{name} was resting{' ' + where if where else ''}, {start}–{end}."
    if a == "on_floor":
        return f"{name} appeared to be on the floor at {start}."
    if a == "with_visitor":
        return f"{name} had a visitor, {start}–{end}."
    if a == "entering":
        return f"{name} came into view at {start}."
    if a in ("leaving", "absent"):
        return f"{name} went out of view at {start}."
    word = _ACTIVITY_WORD.get(a, a.replace("_", " "))
    return f"{name} was settled{' ' + where if where else ''}, {word}, {start}–{end}."


def presence_sentence(name: str, presence: dict, tz: ZoneInfo, spot_is_usual: bool) -> str:
    """The one line on the family's home screen. Never a room, ever."""
    status = presence.get("status")
    if status == "paused":
        return f"{name} paused the camera."
    if status == "camera_off":
        return "The camera is off."
    if status == "no_camera":
        return "No camera is set up yet."
    since = presence.get("since")
    since_s = ""
    if since:
        with contextlib.suppress(Exception):
            since_s = f" since {_hhmm(datetime.fromisoformat(since), tz)}"
    if status == "out_of_view":
        return f"{name} has been out of view{since_s}."
    a, spot = presence.get("activity"), presence.get("spot")
    where = _spot_phrase(spot)
    if spot_is_usual and where:
        where = "in her usual spot"
    if a == "eating":
        return f"{name} is having something to eat{' ' + where if where else ''}."
    if a in ("walking", "exercising"):
        return f"{name} is up and moving about."
    if a == "with_visitor":
        return f"{name} has someone visiting."
    if a == "lying_down":
        return f"{name} has been resting{' ' + where if where else ''}{since_s}."
    if a in ("sitting", "reading", "watching_tv", "using_phone"):
        word = _ACTIVITY_WORD.get(a, a)
        # No em dash: this is the one sentence a family reads on the home
        # screen, and DESIGN.md bans them in user-facing prose.
        return f"{name} has been settled{' ' + where if where else ''}{since_s}. {word.capitalize()}, by the look of it."
    return f"{name} is at home{since_s}."


# --- usual spots -------------------------------------------------------------

async def bump_usual_spot(resident_id: str, ts: datetime, tz: ZoneInfo, spot: str) -> None:
    """`residents.usual_spots = {hour_bucket: {spot: count}}`. The whole "where
    she usually sits" model. Ceiling: no decay, no day-of-week."""
    if spot in (None, "", "unclear", "other"):
        return
    bucket = f"{ts.astimezone(tz).hour // 2 * 2:02d}"
    await db().residents.update_one(
        {"_id": resident_id}, {"$inc": {f"usual_spots.{bucket}.{spot}": 1}}
    )


def usual_spot_for(resident: dict, ts: datetime, tz: ZoneInfo) -> str | None:
    """Top spot for this 2-hour bucket, once there are at least 5 sightings."""
    bucket = f"{ts.astimezone(tz).hour // 2 * 2:02d}"
    counts = ((resident.get("usual_spots") or {}).get(bucket)) or {}
    if not counts:
        return None
    spot, n = max(counts.items(), key=lambda kv: kv[1])
    return spot if n >= 5 else None


def spots_line(resident: dict) -> str:
    """The `{spots_line}` the VLM prompt is conditioned with (§4.4)."""
    parts = []
    for bucket, counts in sorted((resident.get("usual_spots") or {}).items()):
        if not counts:
            continue
        spot, n = max(counts.items(), key=lambda kv: kv[1])
        if n >= 5:
            parts.append(f"around {int(bucket):02d}:00 the {spot}")
    return "; ".join(parts)


# --- the dedup ---------------------------------------------------------------

async def record(obs: dict, resident: dict, camera: dict) -> list[str]:
    """Fold one observation into its episode. Returns the event ids this
    observation caused to exist (never more than one)."""
    resident_id = resident["_id"]
    tz = ZoneInfo(resident.get("timezone") or "UTC")
    ts = obs["_ts"]
    activity = obs["activity"]
    s = scale()

    if obs.get("person_count", 0) == 1 and obs.get("confidence", 0) >= 0.5:
        await bump_usual_spot(resident_id, ts, tz, obs.get("spot"))

    rule = RULES.get(activity)
    if rule is None:
        return []
    event_type, gap_s, min_obs, min_dur_s = rule
    gap_s, min_dur_s = gap_s * s, min_dur_s * s
    key = _episode_key(resident_id, event_type, activity)

    iv = _OPEN.get(key)
    if iv and (ts - iv["last_ts"]).total_seconds() > gap_s:
        iv = None  # stale; the sweeper will close the old one (or already has)
        _OPEN.pop(key, None)
    if iv is None:
        iv = _OPEN[key] = {
            "resident_id": resident_id, "event_type": event_type, "activity": activity,
            "spot": obs.get("spot"), "first_ts": ts, "last_ts": ts, "n": 0,
            "conf_sum": 0.0, "obs_ids": [], "event_id": None, "zone": camera.get("zone"),
        }
    iv["last_ts"] = max(iv["last_ts"], ts)
    iv["n"] += 1
    iv["conf_sum"] += float(obs.get("confidence") or 0.0)
    iv["obs_ids"].append(obs["_id"])
    if obs.get("spot") not in (None, "unclear", "other"):
        iv["spot"] = obs["spot"]

    return await _flush(iv, resident, tz, min_obs, min_dur_s)


async def _flush(iv: dict, resident: dict, tz: ZoneInfo, min_obs: int, min_dur_s: float) -> list[str]:
    """Emit the episode's one event once it clears its thresholds; afterwards
    just extend that same event. One lunch, one row."""
    dur = (iv["last_ts"] - iv["first_ts"]).total_seconds()
    name = resident.get("display_name") or "She"
    text = _episode_text(name, iv, tz)
    # PRD §6.5: more corroborating observations -> more confidence, capped.
    conf = min(max((iv["conf_sum"] / max(iv["n"], 1)) * (1 - 0.5 ** iv["n"]), 0.05), 0.95)

    if iv["event_id"]:
        await db().events.update_one({"_id": iv["event_id"]}, {"$set": {
            "ts_end": iv["last_ts"].isoformat(), "confidence": conf,
            "embedding_text": text, "derived_from": iv["obs_ids"],
            "payload.n_observations": iv["n"],
        }})
        return []
    if iv["n"] < min_obs or dur < min_dur_s:
        return []

    payload = {"activity": iv["activity"], "spot": iv["spot"], "n_observations": iv["n"]}
    if iv["activity"] == "eating":
        payload["meal"] = _meal_for_hour(iv["first_ts"].astimezone(tz).hour)
    if iv["activity"] == "on_floor":
        payload["flag"] = "on_floor"
    if iv["event_type"] == "visitor_present":
        payload = {"n_people": 2, "n_observations": iv["n"]}

    doc = await emit(
        resident_id=iv["resident_id"], source="camera", type=iv["event_type"],
        embedding_text=text, ts=iv["first_ts"],
        ts_end=iv["last_ts"] if iv["last_ts"] > iv["first_ts"] else None,
        # zone is for staff and the baseline learner. It is stripped from every
        # family surface server-side (routers/camera.py, rag.py) — not here.
        zone=iv.get("zone"), confidence=conf, payload=payload,
        derived_from=iv["obs_ids"],
    )
    iv["event_id"] = doc["_id"]
    return [doc["_id"]]


async def close_stale(now: datetime | None = None) -> None:
    """Close intervals nobody has fed for longer than their gap. Runs from the
    sweeper, and directly from tests."""
    now = now or datetime.now(timezone.utc)
    s = scale()
    for key, iv in list(_OPEN.items()):
        rule = RULES.get(iv["activity"])
        if rule is None:
            _OPEN.pop(key, None)
            continue
        _, gap_s, min_obs, min_dur_s = rule
        if (now - iv["last_ts"]).total_seconds() <= gap_s * s:
            continue
        _OPEN.pop(key, None)
        if iv["event_id"]:
            continue
        resident = await db().residents.find_one({"_id": iv["resident_id"]}) or {}
        tz = ZoneInfo(resident.get("timezone") or "UTC")
        await _flush(iv, resident, tz, min_obs, min_dur_s * s)


_sweeper: asyncio.Task | None = None
SWEEP_INTERVAL_S = 30


async def _sweep_loop():
    while True:
        await asyncio.sleep(SWEEP_INTERVAL_S)
        try:
            await close_stale()
        except Exception as e:  # noqa: BLE001
            log.warning("sweeper pass failed: %s", e)


def start_sweeper() -> None:
    global _sweeper
    if _sweeper is None or _sweeper.done():
        _sweeper = asyncio.create_task(_sweep_loop())


def stop_sweeper() -> None:
    global _sweeper
    if _sweeper:
        _sweeper.cancel()
    _sweeper = None


# --- presence state ----------------------------------------------------------

async def apply_presence(camera: dict, obs: dict) -> dict:
    """Update `cameras.presence` from one observation and return it."""
    in_view = obs.get("person_count", 0) > 0 and obs["activity"] != "absent"
    prev = camera.get("presence") or {}
    status = "in_view" if in_view else "out_of_view"
    # A run only continues if it was not interrupted by silence — otherwise
    # "settled since 12:41" survives a whole afternoon with the camera off.
    last = prev.get("last_observation_at")
    continuous = (prev.get("status") == status and last
                  and (obs["_ts"] - _parse(last)).total_seconds() <= IN_VIEW_STALE_S)
    since = prev.get("since") if continuous else obs["_ts"].isoformat()
    presence = {
        "status": status,
        "activity": obs["activity"] if in_view else None,
        "posture": obs.get("posture") if in_view else None,
        "spot": obs.get("spot") if in_view else None,
        "since": since or obs["_ts"].isoformat(),
        "last_observation_at": obs["_ts"].isoformat(),
    }
    await db().cameras.update_one({"_id": camera["_id"]}, {"$set": {"presence": presence}})
    return presence


async def family_presence(resident_id: str) -> dict:
    """The `GET /presence` body. No zone, no evidence, no posture detail —
    the family gets a status, an activity and a sentence."""
    resident = await db().residents.find_one({"_id": resident_id}) or {}
    tz = ZoneInfo(resident.get("timezone") or "UTC")
    name = resident.get("display_name") or "She"
    camera = await db().cameras.find_one({"resident_id": resident_id})

    if not camera:
        p = {"status": "no_camera", "activity": None, "since": None, "last_observation_at": None}
        cam_block = {"online": False, "consent": bool(resident.get("consent_camera")),
                     "paused_until": None, "paused_by": None}
        return {**p, "spot_is_usual": False,
                "sentence": presence_sentence(name, p, tz, False), "camera": cam_block}

    paused_until = camera.get("paused_until")
    now = datetime.now(timezone.utc)
    paused = bool(paused_until) and _parse(paused_until) > now
    p = dict(camera.get("presence") or {})
    p.setdefault("status", "out_of_view")
    p.setdefault("activity", None)
    p.setdefault("since", None)
    p.setdefault("last_observation_at", None)

    if not resident.get("consent_camera"):
        p["status"], p["activity"] = "camera_off", None
    elif paused:
        p["status"], p["activity"] = "paused", None
    elif camera.get("state") == "offline":
        p["status"], p["activity"] = "camera_off", None
    elif p.get("last_observation_at") and (
        now - _parse(p["last_observation_at"])
    ).total_seconds() > IN_VIEW_STALE_S and p["status"] == "in_view":
        p["status"], p["activity"] = "out_of_view", None

    spot = p.get("spot")
    ts = _parse(p["last_observation_at"]) if p.get("last_observation_at") else now
    spot_is_usual = bool(spot) and usual_spot_for(resident, ts, tz) == spot

    return {
        "status": p["status"], "activity": p["activity"], "spot_is_usual": spot_is_usual,
        "since": p.get("since"), "last_observation_at": p.get("last_observation_at"),
        "sentence": presence_sentence(name, p, tz, spot_is_usual),
        "camera": {
            "online": camera.get("state") == "watching",
            "consent": bool(resident.get("consent_camera")),
            "paused_until": paused_until if paused else None,
            "paused_by": camera.get("paused_by") if paused else None,
        },
    }


def _parse(s: str) -> datetime:
    d = datetime.fromisoformat(s)
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def new_observation_doc(body: dict, resident_id: str, ts: datetime) -> dict:
    doc = dict(body)
    doc["_id"] = f"obs_{ULID()}"
    doc["resident_id"] = resident_id
    doc["ts"] = ts.isoformat()
    doc["ts_epoch"] = int(ts.timestamp())
    # A real BSON date: the TTL monitor ignores ISO strings (VLM_PLAN §4.5).
    doc["expires_at"] = datetime.now(timezone.utc) + timedelta(days=7)
    doc["_ts"] = ts
    return doc
