"""Client-facing REST API for the React Native app. One consumer, so one shape
per screen — see TECHNICAL_PRD §10.1 (screens) and §10.5 (API contract).

# ponytail: §10.5 in the PRD describes a JWT (`role`, `resident_ids` claims) and
# a few different paths/names (`/events` not `/timeline`, `/summary` not `/day`,
# no `timeout`/`confirmed` in its enums, alerts identified only by a websocket
# under `/ws` not `/live`). This file follows the assignment brief given for
# this task instead, since that's what `app/deps.py` and `app/events.py` (the
# code that actually exists) were built against. Noted here so nobody "fixes"
# this file back to a contract the rest of the backend doesn't implement.
"""

from datetime import datetime, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from . import live
from ..baseline import COUNT, FEATURE_META
from .. import config as cfg
from ..db import db
from ..deps import require_app_key
from ..events import EVENT_TYPES, emit, recent

router = APIRouter(prefix="/v1", tags=["app"], dependencies=[Depends(require_app_key)])

_SEVERITY_RANK = {"critical": 3, "urgent": 2, "warn": 1, "info": 0}

# app/alerts.py owns the FSM's TERMINAL_STATES; MANUALLY_RESOLVED is ours (the
# staff "resolve" button, which isn't a transition its table models — see
# resolve_alert below). Falls back to a hardcoded copy if alerts.py isn't
# importable yet (it's owned by another agent).
_FALLBACK_TERMINAL_STATES = {"RESOLVED_OK", "CANCELLED", "ACKNOWLEDGED", "EXHAUSTED"}


def _terminal_states() -> set[str]:
    try:
        from ..alerts import TERMINAL_STATES
    except ImportError:
        return _FALLBACK_TERMINAL_STATES | {"MANUALLY_RESOLVED"}
    return TERMINAL_STATES | {"MANUALLY_RESOLVED"}


def _ser(doc: dict) -> dict:
    """Mongo doc -> JSON-safe dict. `_id` (always our own string ULID, never a
    real ObjectId) becomes `id`. RN gets JSON, not BSON."""
    out = dict(doc)
    out["id"] = out.pop("_id")
    return out


# ---------------------------------------------------------------------------
# Home screen
# ---------------------------------------------------------------------------


@router.get("/residents")
async def list_residents():
    """The app's home screen. One request: residents + their current status
    (location, open alert, battery, last-seen) via a handful of bulk queries,
    never one query per resident."""
    d = db()
    residents = await d.residents.find().to_list(None)
    if not residents:
        return []
    ids = [r["_id"] for r in residents]

    bands = await d.bands.find({"resident_id": {"$in": ids}}).to_list(None)
    battery_by_resident = {b["resident_id"]: b.get("battery_pct") for b in bands}

    open_alerts = await d.alerts.find(
        {"resident_id": {"$in": ids}, "state": {"$nin": list(_terminal_states())}}
    ).sort("opened_at", -1).to_list(None)
    alert_by_resident: dict[str, dict] = {}
    for a in open_alerts:
        alert_by_resident.setdefault(a["resident_id"], a)  # most-recently-opened wins

    # Latest event and latest zone-bearing event per resident, each in a single
    # aggregation over all residents at once — this is the "not N+1" part.
    last_seen_by_resident = {
        doc["_id"]: doc["ts"]
        async for doc in d.events.aggregate([
            {"$match": {"resident_id": {"$in": ids}}},
            {"$sort": {"ts_epoch": -1}},
            {"$group": {"_id": "$resident_id", "ts": {"$first": "$ts"}}},
        ])
    }
    zone_by_resident = {
        doc["_id"]: doc
        async for doc in d.events.aggregate([
            {"$match": {"resident_id": {"$in": ids}, "zone": {"$ne": None}}},
            {"$sort": {"ts_epoch": -1}},
            {"$group": {
                "_id": "$resident_id",
                "zone": {"$first": "$zone"},
                "since": {"$first": "$ts"},
                "confidence": {"$first": "$confidence"},
                "method": {"$first": "$payload.method"},
            }},
        ])
    }

    out = []
    for r in residents:
        rid = r["_id"]
        alert = alert_by_resident.get(rid)
        zone = zone_by_resident.get(rid)
        out.append({
            "id": rid,
            "display_name": r.get("display_name"),
            # Her own line. The ladder in `contacts` is who Dhyaan rings ON her
            # behalf; this is how the family rings HER, and the app had no way
            # to get it — every "Call Eleanor" button was a hardcoded number.
            "phone_e164": r.get("phone_e164"),
            "room": r.get("room"),
            "state": "alerting" if alert else "ok",
            "battery_pct": battery_by_resident.get(rid),
            "last_seen": last_seen_by_resident.get(rid),
            "location": {
                "zone": zone["zone"],
                "since": zone["since"],
                "confidence": zone.get("confidence"),
                "method": zone.get("method"),
            } if zone else None,
            "open_alert": _ser(alert) if alert else None,
        })
    return out


@router.get("/residents/{resident_id}")
async def get_resident(resident_id: str):
    d = db()
    r = await d.residents.find_one({"_id": resident_id})
    if not r:
        raise HTTPException(404, "resident not found")
    contacts = await d.contacts.find({"resident_id": resident_id}).sort("ladder_order", 1).to_list(None)
    out = _ser(r)
    out["consent"] = {
        "camera": bool(r.get("consent_camera")),
        "voice": bool(r.get("consent_voice")),
    }
    out["contacts"] = [_ser(c) for c in contacts]
    return out


@router.get("/residents/{resident_id}/timeline")
async def timeline(
    resident_id: str,
    since: int | None = Query(None, description="unix epoch seconds"),
    limit: int = Query(50, ge=1, le=200),
    types: str | None = Query(None, description="comma-separated event types"),
):
    type_list = [t.strip() for t in types.split(",") if t.strip()] if types else None
    if type_list:
        bad = sorted(set(type_list) - EVENT_TYPES)
        if bad:
            raise HTTPException(422, f"unknown event type(s): {bad}")
    events = await recent(resident_id, limit=limit, types=type_list, since_epoch=since)
    return [_ser(e) for e in events]  # `recent()` already sorts newest-first


@router.get("/residents/{resident_id}/location")
async def location(resident_id: str):
    d = db()
    ev = await d.events.find_one(
        {"resident_id": resident_id, "zone": {"$ne": None}},
        sort=[("ts_epoch", -1)],
    )
    if not ev:
        return {"zone": None, "since": None, "confidence": None, "method": None}
    return {
        "zone": ev["zone"],
        "since": ev["ts"],
        "confidence": ev.get("confidence"),
        "method": (ev.get("payload") or {}).get("method"),
    }


@router.get("/residents/{resident_id}/day")
async def day_rollup(resident_id: str, date: str | None = Query(None, description="YYYY-MM-DD, resident-local")):
    d = db()
    r = await d.residents.find_one({"_id": resident_id}, {"timezone": 1})
    if not r:
        raise HTTPException(404, "resident not found")
    tz = ZoneInfo(r.get("timezone") or "UTC")

    if date is not None:
        try:
            day = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(422, "date must be YYYY-MM-DD")
    else:
        day = datetime.now(tz).date()

    start = datetime(day.year, day.month, day.day, tzinfo=tz)
    end = start + timedelta(days=1)
    start_epoch, end_epoch = int(start.timestamp()), int(end.timestamp())

    day_events = await d.events.find({
        "resident_id": resident_id,
        "ts_epoch": {"$gte": start_epoch, "$lt": end_epoch},
    }).sort("ts_epoch", 1).to_list(None)

    meal_count = sum(1 for e in day_events if e["type"] == "meal_observed")
    walk_count = sum(1 for e in day_events if e["type"] == "walk_completed")
    night_bed_exits = sum(
        1 for e in day_events
        if e["type"] == "bed_exit"
        and (lambda h: h >= 22 or h < 6)(datetime.fromisoformat(e["ts"]).astimezone(tz).hour)
    )

    # ponytail: room-time = "time until this resident's next zone-bearing event",
    # a single forward pass over the day. Ceiling: a sensor gap gets attributed
    # to whatever zone was last seen, and back-to-back same-zone events just
    # extend that bucket. Upgrade to a real interval/occupancy model (or trust
    # `zone_dwell` event durations directly) once that matters more than "does
    # the stacked bar look right in the demo".
    room_time_s: dict[str, float] = {}
    zone_events = [e for e in day_events if e.get("zone")]
    for i, e in enumerate(zone_events):
        nxt = zone_events[i + 1]["ts_epoch"] if i + 1 < len(zone_events) else end_epoch
        room_time_s[e["zone"]] = room_time_s.get(e["zone"], 0) + max(0, nxt - e["ts_epoch"])

    return {
        "date": day.isoformat(),
        "meal_count": meal_count,
        "walk_count": walk_count,
        "night_bed_exits": night_bed_exits,
        "room_time_s": room_time_s,
    }


# ---------------------------------------------------------------------------
# Baselines / summaries / location history / raw event lookup
# ---------------------------------------------------------------------------

# ponytail: app/baseline.py's FEATURE_META has no unit column, but every
# feature name it defines already carries its own unit as a suffix (_min,
# _s/_h for duration, _frac for a fraction) and every COUNT-kind feature is a
# plain "count" per day — that's the existing convention, not a second table
# to keep in sync. Upgrade: a real `unit` field on FEATURE_META the day a
# feature ever breaks this naming pattern.
def _unit_for(feature: str, kind: str | None) -> str:
    if kind == COUNT:
        return "count"
    if feature.endswith("_min"):
        return "min"
    if feature.endswith("_h"):
        return "h"
    if feature.endswith("_frac"):
        return "fraction"
    if feature.endswith("_s"):
        return "s"
    return "value"


@router.get("/residents/{resident_id}/baselines")
async def resident_baselines(resident_id: str):
    d = db()
    if not await d.residents.find_one({"_id": resident_id}, {"_id": 1}):
        raise HTTPException(404, "resident not found")

    rows = await d.baselines.find({"resident_id": resident_id}).sort("feature", 1).to_list(None)
    out = []
    for r in rows:
        meta = FEATURE_META.get(r["feature"])
        kind, direction = (meta[0], meta[1]) if meta else (None, None)
        out.append({
            "feature": r["feature"],
            "mu": r.get("mu"),
            "mad": r.get("mad"),
            "lam": r.get("lam"),
            "n_obs": r.get("n_obs"),
            # Cold-start rows are flagged, never hidden — a family screen that
            # silently drops them looks like "no data" instead of "not enough
            # history yet".
            "cold_start": bool(r.get("cold_start")),
            "last_value": r.get("last_value"),
            "updated_at": r.get("updated_at"),
            "unit": _unit_for(r["feature"], kind),
            "direction": direction,
        })
    return out


@router.get("/residents/{resident_id}/summaries")
async def resident_summaries(resident_id: str, days: int = Query(7, ge=1, le=90)):
    d = db()
    if not await d.residents.find_one({"_id": resident_id}, {"_id": 1}):
        raise HTTPException(404, "resident not found")

    # A day has ONE story, and it is the most recently written one.
    #
    # The rollup appends a `daily_summary` event every time it runs rather than
    # superseding, and it stamps each with the moment it ran — so `sort(ts_epoch)`
    # ordered by rollup time, not by the day being described. With a seed that
    # writes fifteen days in one pass, every story shares a timestamp and the
    # `days` window was decided by tie order: asking for 7 days returned an
    # arbitrary 7 of 15, usually not including today. Re-running the rollup then
    # left two contradictory stories for the same date ("ate breakfast, dinner"
    # and "not seen eating at all"), and both were shown.
    #
    # Fixed on read rather than by rewriting history: group by the day each
    # story is ABOUT, keep the newest row per day, then take the most recent
    # `days` of those. Superseding on write is the better fix and belongs in
    # rag.daily_narrative; this makes the read correct either way.
    rows = await d.events.find(
        {"resident_id": resident_id, "type": "daily_summary"}
    ).sort("ts_epoch", 1).to_list(None)

    by_day: dict[str, dict] = {}
    for row in rows:
        payload = row.get("payload") or {}
        date_local = payload.get("date_local") or row["ts"][:10]
        by_day[date_local] = row          # ascending scan, so last write wins

    out = []
    for date_local in sorted(by_day, reverse=True)[:days]:
        row = by_day[date_local]
        payload = row.get("payload") or {}
        deviations = await d.events.find({
            "resident_id": resident_id, "type": "baseline_deviation",
            "payload.date_local": date_local,
        }).sort("ts_epoch", 1).to_list(None)
        # Same story for deviations: a re-run re-appends every one of them with a
        # shifted baseline, so the family saw "about 4.2" and "about 3.6" for the
        # same feature on the same day. One row per feature, newest kept.
        latest_by_feature = {
            (dv.get("payload") or {}).get("feature"): dv for dv in deviations
        }
        out.append({
            "date": date_local,
            "narrative": payload.get("narrative") or row.get("embedding_text"),
            "deviations": [
                {
                    "feature": (dv.get("payload") or {}).get("feature"),
                    "severity": (dv.get("payload") or {}).get("severity"),
                    # `payload.narrative` is the sentence written for a family;
                    # `embedding_text` keeps the raw value, the baseline and the
                    # z-score for retrieval and for staff. Prefer the readable
                    # one, same precedence `_family_item` uses on /activity.
                    "text": ((dv.get("payload") or {}).get("narrative")
                             or dv.get("embedding_text")),
                }
                for dv in latest_by_feature.values()
            ],
        })
    return out


@router.get("/residents/{resident_id}/location/history")
async def location_history(resident_id: str, date: str = Query(..., description="YYYY-MM-DD")):
    d = db()
    r = await d.residents.find_one({"_id": resident_id}, {"timezone": 1})
    if not r:
        raise HTTPException(404, "resident not found")
    tz = ZoneInfo(r.get("timezone") or "UTC")

    try:
        day = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(422, "date must be YYYY-MM-DD")

    start = datetime(day.year, day.month, day.day, tzinfo=tz)
    end = start + timedelta(days=1)
    start_epoch, end_epoch = int(start.timestamp()), int(end.timestamp())

    zevents = await d.events.find({
        "resident_id": resident_id,
        "type": {"$in": ["zone_entered", "zone_exited"]},
        "ts_epoch": {"$gte": start_epoch, "$lt": end_epoch},
    }).sort("ts_epoch", 1).to_list(None)

    # ponytail: segments come only from zone_entered/zone_exited transition
    # boundaries. zone_dwell is a same-zone "still here" ping with no boundary
    # of its own, so it's not queried at all here. A day that starts mid-visit
    # (the resident was already in a zone before local midnight) has no
    # zone_entered inside the window, so that first stretch is silently
    # dropped rather than back-filled from the prior day's last event —
    # that's the gap-attribution rule this endpoint picks. Upgrade: look back
    # across midnight for the nearest zone_entered before `start_epoch`.
    segments = []
    cur = None
    for e in zevents:
        if e["type"] == "zone_entered":
            if cur:
                cur["to_epoch"] = e["ts_epoch"]
                segments.append(cur)
            cur = {
                "zone": e["zone"],
                "from_epoch": e["ts_epoch"],
                "method": (e.get("payload") or {}).get("method"),
                "confidence": e.get("confidence"),
            }
        elif e["type"] == "zone_exited" and cur and cur["zone"] == e["zone"]:
            cur["to_epoch"] = e["ts_epoch"]
            segments.append(cur)
            cur = None

    if cur:
        # An open final segment (resident still there, no exit recorded yet)
        # runs to now — capped at the end of the requested day so a past date
        # doesn't report a multi-day-long "open" segment.
        now_epoch = int(datetime.now(timezone.utc).timestamp())
        cur["to_epoch"] = min(now_epoch, end_epoch)
        segments.append(cur)

    def _iso(epoch: int) -> str:
        return datetime.fromtimestamp(epoch, tz=timezone.utc).astimezone(tz).isoformat()

    return [
        {
            "zone": s["zone"],
            "from": _iso(s["from_epoch"]),
            "to": _iso(s["to_epoch"]),
            "seconds": max(0, s["to_epoch"] - s["from_epoch"]),
            "method": s["method"],
            "confidence": s["confidence"],
        }
        for s in segments
    ]


@router.get("/events/{event_id}")
async def get_event(event_id: str):
    """Trivial single-event lookup — saves the app a full-timeline scan for a
    detail it already knows the id of (e.g. a notification deep link)."""
    ev = await db().events.find_one({"_id": event_id})
    if not ev:
        raise HTTPException(404, "event not found")
    return _ser(ev)


# ---------------------------------------------------------------------------
# Alerts / triage
# ---------------------------------------------------------------------------


@router.get("/alerts")
async def list_alerts(state: str = "open"):
    """The staff triage list. `state=open` (the default, and the one the app
    calls on every foreground) means "not closed"; any other value is matched
    against `alerts.state` exactly."""
    d = db()
    q = {"state": {"$nin": list(_terminal_states())}} if state == "open" else {"state": state}
    alerts = await d.alerts.find(q).to_list(None)
    if not alerts:
        return []

    ids = list({a["resident_id"] for a in alerts})
    residents = await d.residents.find({"_id": {"$in": ids}}, {"display_name": 1, "room": 1}).to_list(None)
    rmap = {r["_id"]: r for r in residents}

    alerts.sort(key=lambda a: (-_SEVERITY_RANK.get(a.get("severity"), 0), a.get("opened_at") or ""))

    out = []
    for a in alerts:
        item = _ser(a)
        res = rmap.get(a["resident_id"], {})
        item["resident_name"] = res.get("display_name")
        item["room"] = res.get("room")
        item["closed_at"] = _closed_at(a)
        out.append(item)
    return out


# The FSM has more states than the takeover screen has phases, deliberately:
# the family does not need to know the difference between RETRY_RESIDENT and
# VOICEMAIL — both mean "she hasn't picked up". This is that projection, and it
# is the app's vocabulary (frontend/src/lib/types.ts::LadderStep), not ours.
_LADDER_STEP = {
    "SUSPECTED": "suspected",
    "LOCAL_CANCEL": "cancel_window",
    "CALLING_RESIDENT": "calling_resident",
    "CLASSIFYING": "calling_resident",     # she picked up; still on the phone
    "RETRY_RESIDENT": "no_answer",
    "VOICEMAIL": "no_answer",              # "a voicemail is not an answer" (PRD §5.6)
    "CALLING_CONTACT_1": "calling_contact_1",
    "CALLING_CONTACT_2": "calling_contact_2",
    "ESCALATED_FINAL": "escalated_final",
    "ACKNOWLEDGED": "acknowledged",
    "CANCELLED": "cancelled",
    "EXHAUSTED": "exhausted",
    "RESOLVED_OK": "resolved",
    "FELL_BUT_FINE": "resolved",
    "MANUALLY_RESOLVED": "resolved",
}

_LADDER_LINE = {
    "suspected": "A fall was suspected.",
    "cancel_window": "Waiting half a minute, in case it was nothing.",
    "calling_resident": "Calling her now.",
    "no_answer": "She didn't answer.",
    "calling_contact_1": "Calling her family next.",
    "calling_contact_2": "Still no answer. Calling the next person.",
    "escalated_final": "Nobody has picked up. Escalated.",
    "exhausted": "The ladder ran out of people to call.",
    "resolved": "Closed.",
}


def _ladder_step(e: dict) -> dict:
    """One `events` row -> one LadderStep the takeover screen can render.

    TECHNICAL_PRD §4.3: the ladder is replayable from `events` alone, and
    `alerts.py::_apply` already writes one event per transition. So nothing is
    stored for this — it is a projection, computed on read, and the REST body
    and the websocket push both come from here.

    `detail` is the line the screen prints, so it is a sentence, not the FSM's
    internal dict. The raw states ride along beside it for staff and for
    debugging a demo that went sideways.
    """
    pay = e.get("payload") or {}
    # The alert-open event carries an alert_id but no transition — it is the
    # "suspected" row, not a blank one.
    step = _LADDER_STEP.get(pay.get("to_state") or "SUSPECTED", "suspected")
    detail = pay.get("detail")
    by = detail.get("by") if isinstance(detail, dict) else None
    if step == "acknowledged":
        line = f"{by} is on it. The ladder has stopped." if by else \
            "Someone is on it. The ladder has stopped."
    elif step == "cancelled":
        line = f"Cancelled by {by}." if by else "Cancelled — a false alarm."
    else:
        line = _LADDER_LINE.get(step, step.replace("_", " "))
    return {"step": step, "at": e["ts"], "detail": line,
            "outcome": pay.get("trigger"),
            "from_state": pay.get("from_state"), "state": pay.get("to_state")}


def _closed_at(a: dict) -> str | None:
    """When the takeover screen should stop taking over, as an ISO string.

    The app reads exactly this field to dismiss the full-screen alert. It used
    to be computed client-side from `state`, on the REST path only, so an alert
    resolved while the phone was watching the websocket never closed. Deriving
    it here is the fix: one definition, both paths.
    """
    if a.get("state") not in _terminal_states():
        return None
    return a.get("resolved_at") or a.get("updated_at")


async def alert_response(a: dict) -> dict:
    """The one alert shape. REST and the websocket both go through here, so
    they cannot drift again."""
    d = db()
    alert_id = a["_id"]
    trigger = await d.events.find_one({"_id": a["trigger_event_id"]}) if a.get("trigger_event_id") else None

    # `db().calls` is now populated by app/voice.py's stub and by the Twilio
    # adapter, and carries what the alert screen actually renders: who was dialled,
    # in what role, the transcript and whether the call was simulated. Fall back to
    # reconstructing from voice events for alerts raised before that existed.
    call_rows = await d.calls.find({"alert_id": alert_id}).sort("started_at", 1).to_list(None)
    if not call_rows:
        call_rows = await d.events.find({
            "resident_id": a["resident_id"], "source": "voice",
            "payload.alert_id": alert_id,
        }).sort("ts_epoch", 1).to_list(None)
    call_events = call_rows

    # The alert takeover screen replays the escalation as it happened. Every FSM
    # transition already writes an event (app/alerts.py::_apply), so the ladder is
    # reconstructable rather than needing its own table.
    ladder_events = await d.events.find({
        "source": "derived", "payload.alert_id": alert_id,
    }).sort("ts_epoch", 1).to_list(None)
    ladder = [_ladder_step(e) for e in ladder_events]

    out = _ser(a)
    out["closed_at"] = _closed_at(a)
    # How long she has to cancel from the band before the ladder starts. The
    # takeover draws a countdown ring against this, and it was hardcoded to 30
    # in the app while the server reads it from CANCEL_WINDOW_S — a stage run
    # with a shortened window had the ring counting down to a call that had
    # already been placed.
    out["cancel_window_s"] = cfg.CANCEL_WINDOW_S
    out["trigger_event"] = _ser(trigger) if trigger else None
    out["calls"] = [_ser(c) for c in call_events]
    out["ladder"] = ladder
    return out


@router.get("/alerts/{alert_id}")
async def get_alert(alert_id: str):
    a = await db().alerts.find_one({"_id": alert_id})
    if not a:
        raise HTTPException(404, "alert not found")
    return await alert_response(a)


class AckBody(BaseModel):
    by: str = Field(min_length=1)
    channel: str = Field(min_length=1)


@router.post("/alerts/{alert_id}/ack")
async def ack_alert(alert_id: str, body: AckBody):
    """The "I've got it" button. Halts the escalation ladder. Delegates to
    `app.alerts.ack`, which owns idempotency — acking twice must be a no-op,
    not a second phone call."""
    d = db()
    if not await d.alerts.find_one({"_id": alert_id}, {"_id": 1}):
        raise HTTPException(404, "alert not found")

    try:
        from ..alerts import ack  # ponytail: lazy import — alerts.py may still be mid-write
    except ImportError as e:
        raise HTTPException(503, f"alerts module not ready: {e}")
    try:
        await ack(alert_id, body.by, body.channel)
    except ValueError:
        # alerts.ack raises when there's no (state, "ack") transition — i.e. the
        # alert is already terminal (already acked, resolved, cancelled...).
        # That's exactly the idempotent case this button needs: a second tap
        # is a no-op, not an error.
        pass

    a = await d.alerts.find_one({"_id": alert_id})
    await live.broadcast_alert(a)
    return await alert_response(a)


class ResolveBody(BaseModel):
    resolution: Literal["ok", "fell_ok", "ems", "false_positive", "timeout"]


@router.post("/alerts/{alert_id}/resolve")
async def resolve_alert(alert_id: str, body: ResolveBody):
    """A human closing the alert out of band (staff "Resolved — checked" /
    "False alarm"). `app.alerts` only exposes FSM-shaped transitions
    (ack/cancel/classify) that don't cover every `resolution` this endpoint's
    contract promises (e.g. `ems`, `timeout`), so this writes the terminal
    state directly instead of going through `_apply`.

    # ponytail: `MANUALLY_RESOLVED` is not a state in alerts.TABLE. If a timer
    # was still pending for this alert it will fire once, find no matching
    # transition, and log-and-drop — same failure mode alerts.py already
    # accepts for any bad trigger. Upgrade: give alerts.py a real `resolve()`
    # that also cancels the pending timer, once every resolution it needs to
    # support is nailed down.
    """
    d = db()
    now = datetime.now(ZoneInfo("UTC")).isoformat()
    a = await d.alerts.find_one_and_update(
        {"_id": alert_id},
        {"$set": {"state": "MANUALLY_RESOLVED", "resolution": body.resolution, "updated_at": now, "resolved_at": now}},
        return_document=ReturnDocument.AFTER,
    )
    if not a:
        raise HTTPException(404, "alert not found")
    await live.broadcast_alert(a)
    return await alert_response(a)


class FeedbackBody(BaseModel):
    verdict: Literal["expected", "false_positive", "confirmed"]
    reason: str | None = None
    scope: Literal["day", "feature"] = "day"


@router.post("/alerts/{alert_id}/feedback")
async def alert_feedback(alert_id: str, body: FeedbackBody):
    """Writes a `feedback_given` event and marks the triggering event's
    `review_state`. The baseline learner (owned elsewhere) consumes the event;
    this endpoint's whole job is to record the verdict honestly."""
    d = db()
    a = await d.alerts.find_one({"_id": alert_id})
    if not a:
        # The family gives feedback from the TIMELINE, where the thing on screen
        # is an event, not an alert ("that was fine, she was at her sister's").
        # Accept either id: look for an alert triggered by this event, and if the
        # event stands alone (a baseline deviation has no alert) still record the
        # verdict against the event, because that is what the learner consumes.
        a = await d.alerts.find_one({"trigger_event_id": alert_id})
        if not a:
            ev = await d.events.find_one({"_id": alert_id})
            if not ev:
                raise HTTPException(404, "no alert or event with that id")
            fb = await emit(
                resident_id=ev["resident_id"], source="manual", type="feedback_given",
                embedding_text=f"Feedback on {ev['type']}: {body.verdict}"[:400],
                payload={"event_id": alert_id, "verdict": body.verdict,
                         "reason": body.reason, "scope": body.scope},
            )
            await d.events.update_one({"_id": alert_id},
                                      {"$set": {"review_state": body.verdict}})
            return {"ok": True, "feedback_event_id": fb["_id"]}
        alert_id = a["_id"]

    trigger_id = a.get("trigger_event_id")
    text = f"Feedback on alert {alert_id}: {body.verdict}"
    if body.reason:
        text += f" — {body.reason}"

    fb_event = await emit(
        resident_id=a["resident_id"],
        source="manual",
        type="feedback_given",
        embedding_text=text[:400],
        payload={
            "alert_id": alert_id,
            "verdict": body.verdict,
            "reason": body.reason,
            "scope": body.scope,
            "trigger_event_id": trigger_id,
        },
    )

    if trigger_id:
        await d.events.update_one({"_id": trigger_id}, {"$set": {"review_state": body.verdict}})

    return {"ok": True, "feedback_event_id": fb_event["_id"]}


class NoteBody(BaseModel):
    text: str = Field(min_length=1, max_length=400)
    author: str = Field(min_length=1)
    role: Literal["family", "staff"] = "family"


@router.post("/residents/{resident_id}/notes")
async def add_note(resident_id: str, body: NoteBody):
    d = db()
    if not await d.residents.find_one({"_id": resident_id}, {"_id": 1}):
        raise HTTPException(404, "resident not found")
    event_type = "staff_note" if body.role == "staff" else "family_note"
    doc = await emit(
        resident_id=resident_id,
        source="manual",
        type=event_type,
        embedding_text=body.text,
        payload={"author": body.author, "role": body.role},
    )
    return _ser(doc)
