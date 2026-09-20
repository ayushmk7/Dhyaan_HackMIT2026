"""Camera fall-confirmation guard: auto-cancel a fall alert the camera refutes.

Safety contract (fixed, reviewed — do not relax):

* The alert ALWAYS opens. This module runs strictly AFTER `open_alert`, off the
  event bus, and the only thing it is allowed to do is call `alerts.cancel`
  while the alert is in its LOCAL_CANCEL window — the same, and only, window in
  which the band button may cancel. It can never suppress an alert from
  opening, never touch any later state, and never blocks the ladder: if the
  camera is absent, silent, stale or uncertain, every check below fails closed
  toward "do nothing" and the escalation proceeds exactly as if this module did
  not exist.

* Evidence must be camera-sourced, upright-and-moving, high-confidence, and
  strictly AFTER the trigger. The concrete signal is what presence.py actually
  emits on the bus (source="camera"):

    - `activity_observed` with payload.activity in {walking, exercising}
      (RULES: 2 corroborating observations, so it is already debounced), and
    - `room_entry` with payload.activity "entering" (she walked into view).
    - `walk_started` / `walk_completed` (taxonomy-legal camera events; today
      emitted by the seeder and POST /admin/simulate {"kind": "walk"} — the
      no-camera rehearsal path).

  For the first two, the proof is the raw `observations` rows behind the event
  (`derived_from`): posture == "upright", confidence >= MIN_CONF and an
  observation timestamp > alert.opened_at + GUARD_S. Posture and the
  undiscounted worker confidence live only on the observation row (presence.py
  keeps them off events on purpose), so that row is the honest place to check.
  walk_* events carry no observation rows, so they qualify on their own
  event-level confidence and timestamp.

* Audit: a successful auto-cancel produces exactly two events — the FSM's own
  `fall_cancelled` transition row (detail.by == "camera", written by
  alerts.cancel) and ONE `fall_autocancelled` audit event from here naming the
  evidence: the bus event, the observation ids, the confidence and how many
  seconds after the trigger the camera saw her up. `fall_cancelled` itself is
  not reused for the audit because the FSM already emits it for the transition;
  a second one would read as two cancellations on replay.
"""

import logging
import os
from datetime import datetime, timedelta, timezone

from . import alerts
from .db import db
from .events import emit, subscribe, unsubscribe

log = logging.getLogger("dhyaan.fallcheck")

# Bus events that can carry "upright and moving". Everything else is ignored
# before a single database read.
WATCHED_TYPES = {"activity_observed", "room_entry", "walk_started", "walk_completed"}
# Activities that mean upright AND moving. Deliberately not "standing",
# "sitting" or anything ambiguous — on_floor/lying_down are activity_observed
# too, and an allowlist is the only shape that cannot cancel on those.
UPRIGHT_ACTIVITIES = {"walking", "exercising", "entering"}
# walk_* events carry no payload.activity; the type itself is the claim.
_EVENT_LEVEL_TYPES = {"walk_started", "walk_completed"}

CANCELLABLE_KINDS = ["fall", "button"]

# Venue knobs. MIN_CONF is the per-observation floor (the worker's YOLO-only
# fast path posts 0.75 and is excluded by design — only a real VLM read, or a
# deliberate simulate, clears 0.8). GUARD_S keeps an observation from the same
# instant as the impact from counting as "after" it.
MIN_CONF = float(os.getenv("FALLCHECK_MIN_CONF", "0.8"))
GUARD_S = float(os.getenv("FALLCHECK_GUARD_S", "2"))


def _parse(s: str) -> datetime:
    d = datetime.fromisoformat(s)
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


async def _evidence_after(ev: dict, alert: dict) -> dict | None:
    """The explicit high-confidence condition. Returns the evidence found, or
    None — and None ALWAYS means "change nothing"."""
    try:
        earliest = _parse(alert["opened_at"]) + timedelta(seconds=GUARD_S)
    except (KeyError, TypeError, ValueError):
        return None  # an alert we cannot time-order against cannot be cancelled

    obs_ids = ev.get("derived_from") or []
    if obs_ids:
        rows = await db().observations.find({"_id": {"$in": obs_ids}}).to_list(length=50)
        best = None
        for row in rows:
            try:
                ts = _parse(row["ts"])
            except (KeyError, TypeError, ValueError):
                continue
            conf = float(row.get("confidence") or 0.0)
            if ts > earliest and row.get("posture") == "upright" and conf >= MIN_CONF:
                if best is None or conf > best[0]:
                    best = (conf, ts, row)
        if best is None:
            return None
        conf, ts, row = best
        return {
            "confidence": conf,
            "observation_ids": [row["_id"]],
            "seconds_after_trigger": round((ts - _parse(alert["opened_at"])).total_seconds(), 1),
            "simulated": bool(row.get("simulated")),
        }

    if ev["type"] not in _EVENT_LEVEL_TYPES:
        return None  # an episode event with no observations behind it proves nothing
    try:
        ts = _parse(ev["ts"])
    except (KeyError, TypeError, ValueError):
        return None
    conf = float(ev.get("confidence") or 0.0)
    if conf < MIN_CONF or ts <= earliest:
        return None
    return {
        "confidence": conf,
        "observation_ids": [],
        "seconds_after_trigger": round((ts - _parse(alert["opened_at"])).total_seconds(), 1),
        "simulated": bool((ev.get("payload") or {}).get("simulated")),
    }


async def _autocancel(alert: dict, ev: dict, evidence: dict) -> None:
    alert_id = alert["_id"]
    try:
        await alerts.cancel(alert_id, by="camera")
    except ValueError as e:
        # The window closed, or a human got there first, between our read and
        # the cancel. The ladder's state wins; the camera never forces anything.
        log.info("auto-cancel skipped for %s: %s", alert_id, e)
        return

    # One audit event. embedding_text is family-safe (no posture, no evidence
    # sentence — those stay on the observation rows, referenced by id).
    await emit(
        resident_id=alert["resident_id"],
        source="derived",
        type="fall_autocancelled",
        embedding_text=(
            f"Alert {alert_id} cancelled automatically: the camera saw the resident "
            f"up and moving {evidence['seconds_after_trigger']}s after the trigger."
        )[:400],
        confidence=evidence["confidence"],
        derived_from=[ev["_id"], *evidence["observation_ids"]],
        payload={
            "alert_id": alert_id,
            "by": "camera",
            "evidence_event_id": ev["_id"],
            "evidence_event_type": ev["type"],
            "activity": (ev.get("payload") or {}).get("activity"),
            "observation_ids": evidence["observation_ids"],
            "confidence": evidence["confidence"],
            "seconds_after_trigger": evidence["seconds_after_trigger"],
            "simulated": evidence["simulated"],
        },
    )
    log.info("auto-cancelled %s on %s (%s, conf=%.2f, +%ss)", alert_id, ev["_id"],
             ev["type"], evidence["confidence"], evidence["seconds_after_trigger"])


async def _on_event(ev: dict) -> None:
    """Bus subscriber. Called after every emit; must stay cheap on the miss
    path and must never raise into the write that fanned out to it (events.emit
    swallows subscriber errors, but a guard that only works by being caught is
    not a guard)."""
    try:
        if ev.get("source") != "camera" or ev.get("type") not in WATCHED_TYPES:
            return
        if ev["type"] not in _EVENT_LEVEL_TYPES and \
                (ev.get("payload") or {}).get("activity") not in UPRIGHT_ACTIVITIES:
            return
        open_alerts = await db().alerts.find({
            "resident_id": ev["resident_id"],
            "state": "LOCAL_CANCEL",
            "kind": {"$in": CANCELLABLE_KINDS},
        }).to_list(length=20)
        for alert in open_alerts:
            evidence = await _evidence_after(ev, alert)
            if evidence is not None:
                await _autocancel(alert, ev, evidence)
    except Exception as e:  # noqa: BLE001 — failing open here means the ladder proceeds
        log.warning("fallcheck pass failed (alert untouched): %s", e)


# --- lifespan hooks, same shape as presence.start_sweeper -------------------

_active = None


def start_fallcheck() -> None:
    global _active
    if _active is None:
        _active = _on_event
        subscribe(_active)


def stop_fallcheck() -> None:
    global _active
    if _active is not None:
        unsubscribe(_active)
        _active = None
