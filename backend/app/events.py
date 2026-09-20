"""The one write path. Every observation in the system becomes an event here.

TECHNICAL_PRD §3: there are no other tables of truth. The VLM, the voice agent,
the band and the baseline learner are all producers of Event.
"""

import inspect
from datetime import datetime, timezone

from ulid import ULID

from .db import db

# Full taxonomy, TECHNICAL_PRD §3.2. Producers must use one of these.
EVENT_TYPES = {
    # band
    "fall_suspected", "fall_confirmed", "fall_cancelled", "band_motion_high",
    "band_still", "prolonged_inactivity", "band_offline", "band_low_battery",
    "button_pressed", "gait_summary",
    # camera + vlm
    "person_present", "meal_observed", "meal_skipped", "walk_started",
    "walk_completed", "bed_exit", "room_exit", "room_entry", "night_activity",
    "unsteady_gait", "visitor_present", "medication_taken", "assistance_given",
    # location (RF)
    "zone_entered", "zone_exited", "zone_dwell", "left_home", "returned_home",
    "location_unknown", "beacon_offline", "bathroom_prolonged",
    # voice
    "call_placed", "call_answered", "call_no_answer", "voice_response_classified",
    "escalation_started", "escalation_acknowledged", "escalation_exhausted",
    # camera presence lane (VLM_PLAN §6.3)
    "activity_observed", "camera_online", "camera_offline", "camera_paused",
    # derived / manual
    # fall_autocancelled: the camera guard's audit row (app/fallcheck.py) — the
    # FSM's fall_cancelled records the transition; this records the evidence.
    "fall_autocancelled",
    "baseline_deviation", "daily_summary", "baseline_updated", "staff_note",
    "family_note", "feedback_given", "profile_updated", "memory_deleted",
}

SOURCES = {"band", "camera", "voice", "manual", "derived"}

# ponytail: in-process fanout. One FastAPI worker, so a list of callbacks is the
# whole bus. Becomes Redis pub/sub the day there are two workers.
_subscribers: list = []


def subscribe(fn):
    """fn(event: dict) -> awaitable. Called after every emit."""
    _subscribers.append(fn)
    return fn


def unsubscribe(fn) -> None:
    """Remove a subscriber added with subscribe(). Unknown fn is a no-op."""
    try:
        _subscribers.remove(fn)
    except ValueError:
        pass


async def emit(
    *,
    resident_id: str,
    source: str,
    type: str,
    embedding_text: str,
    ts: datetime | None = None,
    payload: dict | None = None,
    source_id: str | None = None,
    confidence: float = 1.0,
    zone: str | None = None,
    ts_end: datetime | None = None,
    derived_from: list[str] | None = None,
    supersedes: str | None = None,
) -> dict:
    if type not in EVENT_TYPES:
        raise ValueError(f"unknown event type {type!r}")
    if source not in SOURCES:
        raise ValueError(f"unknown source {source!r}")
    if not embedding_text or len(embedding_text) > 400:
        raise ValueError("embedding_text is mandatory and must be <= 400 chars")

    ts = ts or datetime.now(timezone.utc)
    doc = {
        "_id": f"evt_{ULID()}",
        "schema_version": 1,
        "resident_id": resident_id,
        "source": source,
        "source_id": source_id,
        "type": type,
        "ts": ts.isoformat(),
        "ts_end": ts_end.isoformat() if ts_end else None,
        "ts_epoch": int(ts.timestamp()),
        "confidence": confidence,
        "zone": zone,
        "payload": payload or {},
        "embedding_text": embedding_text,
        "derived_from": derived_from or [],
        "supersedes": supersedes,
        "review_state": "unreviewed",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db().events.insert_one(doc)

    # A slow or broken subscriber must never fail the write that already landed.
    for fn in _subscribers:
        try:
            r = fn(doc)
            # isawaitable, not iscoroutine: Motor returns asyncio.Future, which
            # iscoroutine misses — the write would be dropped ~30% of the time.
            if inspect.isawaitable(r):
                await r
        except Exception as e:  # noqa: BLE001
            print(f"[events] subscriber {getattr(fn, '__name__', fn)} failed: {e}")
    return doc


async def recent(resident_id: str, limit: int = 50, types: list[str] | None = None,
                 since_epoch: int | None = None) -> list[dict]:
    q: dict = {"resident_id": resident_id}
    if types:
        q["type"] = {"$in": types}
    if since_epoch is not None:
        q["ts_epoch"] = {"$gte": since_epoch}
    cur = db().events.find(q).sort("ts_epoch", -1).limit(limit)
    return await cur.to_list(length=limit)
