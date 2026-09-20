"""Fall-alert state machine and escalation ladder. TECHNICAL_PRD §4.

Table-driven FSM: TABLE maps (state, trigger) -> (next_state, action_name). An
asyncio timer per alert fires the timeout triggers (cancel window, retry wait,
per-contact wait, exhaustion). Every transition writes one `events` row, so the
whole ladder is replayable from `events` alone (PRD §4.3).

Resolution naming: the PRD's HTTP API reports `resolution: "fell_ok"` for an
alert that passed through the `FELL_BUT_FINE` *state*. We store the same
string, `"fell_ok"`, in `alerts.resolution` when that state is entered — the
state name and the resolution string are deliberately different spellings of
the same thing (see RESOLUTION_FOR_STATE below).
"""

import asyncio
import logging
from datetime import datetime, timezone

from ulid import ULID

from . import config as cfg
from . import voice
from .db import db
from .events import emit

# All states in the PRD §4.3 diagram. IDLE is the implicit "no alert row exists
# yet" state and never appears in a stored document.
STATES = frozenset({
    "IDLE", "SUSPECTED", "LOCAL_CANCEL", "CALLING_RESIDENT", "RETRY_RESIDENT",
    "VOICEMAIL", "CLASSIFYING", "RESOLVED_OK", "FELL_BUT_FINE",
    "SCHEDULED_CALLBACK", "CALLING_CONTACT_1", "CALLING_CONTACT_2",
    "ESCALATED_FINAL", "ACKNOWLEDGED", "CANCELLED", "EXHAUSTED",
})
TERMINAL_STATES = {"RESOLVED_OK", "CANCELLED", "ACKNOWLEDGED", "EXHAUSTED"}

CLASSIFICATIONS = {"okay", "fell_but_fine", "no_answer", "distress", "incoherent"}

# PRD §4.2 pins defaults (retry 15 s; silence window is ours until real AMD).
# Env/config overrides keep demo snappy; tests still monkeypatch these names.
RETRY_WAIT_S = cfg.RETRY_WAIT_S
# ponytail: stands in for "the voice agent got no tool call" (PRD §4.4 "silence
# escalates"). Real telephony will replace this with the actual no-answer /
# AMD / 20s-silence signals from the bridge; until then, if nobody calls
# classify() before this fires, we escalate exactly like a bad answer.
RESIDENT_RESPONSE_TIMEOUT_S = cfg.RESIDENT_RESPONSE_TIMEOUT_S

log = logging.getLogger("dhyaan.alerts")


async def _get(alert_id: str) -> dict | None:
    return await db().alerts.find_one({"_id": alert_id})


# ---------------------------------------------------------------------------
# Actions. Each is `async def fn(alert: dict, detail=None) -> None`.
# ---------------------------------------------------------------------------

async def _noop(alert, detail=None):
    pass


async def _start_cancel_timer(alert, detail=None):
    _schedule(alert["_id"], cfg.CANCEL_WINDOW_S, "cancel_timeout")


async def _call_resident(alert, detail=None):
    await db().alerts.update_one({"_id": alert["_id"]}, {"$inc": {"resident_call_attempts": 1}})
    resident = await db().residents.find_one({"_id": alert["resident_id"]})
    if resident and resident.get("phone_e164"):
        await voice.place_call(resident["phone_e164"], "resident", alert["_id"])
    _schedule(alert["_id"], RESIDENT_RESPONSE_TIMEOUT_S, "silence")


async def _schedule_retry(alert, detail=None):
    _schedule(alert["_id"], RETRY_WAIT_S, "retry_timeout")


async def _leave_voicemail(alert, detail=None):
    # ponytail: no real AMD yet (voice.py is a stub), so there is nothing to wait
    # on — chain straight through. Real bridge sets this off the AMD callback.
    await _apply(alert["_id"], "voicemail_done")


async def _notify_family_warn(alert, detail=None):
    await db().alerts.update_one({"_id": alert["_id"]}, {"$set": {"severity": "warn"}})
    alert["severity"] = "warn"
    await _apply(alert["_id"], "notified", detail=detail)


async def _call_contact(alert, ladder_order: int, next_trigger_delay: int):
    if alert.get("severity") != "warn":
        await db().alerts.update_one({"_id": alert["_id"]}, {"$set": {"severity": "critical"}})
    contact = await db().contacts.find_one(
        {"resident_id": alert["resident_id"], "ladder_order": ladder_order}
    )
    if contact:
        await voice.place_call(contact["phone_e164"], "contact", alert["_id"])
    _schedule(alert["_id"], next_trigger_delay, "contact_timeout")


async def _call_contact1(alert, detail=None):
    await _call_contact(alert, 1, cfg.CONTACT_WAIT_S)


async def _call_contact2(alert, detail=None):
    await _call_contact(alert, 2, cfg.CONTACT_WAIT_S)


async def _final_escalation(alert, detail=None):
    resident = await db().residents.find_one({"_id": alert["resident_id"]}) or {}
    contacts = await db().contacts.find({"resident_id": alert["resident_id"]}).to_list(length=None)
    name = resident.get("display_name", "")
    address = resident.get("address", "")
    for contact in contacts:
        sid = await voice.place_call(contact["phone_e164"], "contact_final", alert["_id"])
        await voice.speak_final_escalation(sid, name, address)
    _schedule(alert["_id"], cfg.EXHAUSTED_AFTER_S, "exhausted_timeout")


ACTIONS = {
    "noop": _noop,
    "start_cancel_timer": _start_cancel_timer,
    "call_resident": _call_resident,
    "schedule_retry": _schedule_retry,
    "leave_voicemail": _leave_voicemail,
    "notify_family_warn": _notify_family_warn,
    "call_contact1": _call_contact1,
    "call_contact2": _call_contact2,
    "final_escalation": _final_escalation,
}

# Best-fit EVENT_TYPES (app/events.py) tag for the transition event, keyed by
# trigger. Falls back to "escalation_started" for generic ladder progression.
_EVENT_TYPE_FOR_TRIGGER = {
    "cancel": "fall_cancelled",
    "no_answer": "call_no_answer",
    "connected": "call_answered",
    "voicemail": "call_no_answer",  # PRD §5.6: "a voicemail is not an answer"
    "okay": "voice_response_classified",
    "fell_but_fine": "voice_response_classified",
    "distress": "voice_response_classified",
    "incoherent": "voice_response_classified",
    "silence": "voice_response_classified",
    "ack": "escalation_acknowledged",
    "exhausted_timeout": "escalation_exhausted",
}

RESOLUTION_FOR_STATE = {
    "CANCELLED": "false_positive",
    "RESOLVED_OK": "ok",
    "FELL_BUT_FINE": "fell_ok",  # state FELL_BUT_FINE, stored resolution "fell_ok"
    "ACKNOWLEDGED": "acknowledged",
    "EXHAUSTED": "exhausted",
}

# ---------------------------------------------------------------------------
# The table.
# ---------------------------------------------------------------------------

TABLE: dict[tuple[str, str], tuple[str, str]] = {
    ("SUSPECTED", "window_open"): ("LOCAL_CANCEL", "start_cancel_timer"),

    ("LOCAL_CANCEL", "cancel"): ("CANCELLED", "noop"),
    ("LOCAL_CANCEL", "cancel_timeout"): ("CALLING_RESIDENT", "call_resident"),

    ("CALLING_RESIDENT", "no_answer"): ("RETRY_RESIDENT", "schedule_retry"),
    ("CALLING_RESIDENT", "voicemail"): ("VOICEMAIL", "leave_voicemail"),
    ("CALLING_RESIDENT", "connected"): ("CLASSIFYING", "noop"),
    ("CALLING_RESIDENT", "silence"): ("CALLING_CONTACT_1", "call_contact1"),

    ("RETRY_RESIDENT", "retry_timeout"): ("CALLING_RESIDENT", "call_resident"),
    ("RETRY_RESIDENT", "no_answer"): ("CALLING_CONTACT_1", "call_contact1"),
    ("RETRY_RESIDENT", "connected"): ("CLASSIFYING", "noop"),

    ("VOICEMAIL", "voicemail_done"): ("CALLING_CONTACT_1", "call_contact1"),

    ("CLASSIFYING", "okay"): ("RESOLVED_OK", "noop"),
    ("CLASSIFYING", "fell_but_fine"): ("FELL_BUT_FINE", "notify_family_warn"),
    ("CLASSIFYING", "distress"): ("CALLING_CONTACT_1", "call_contact1"),
    ("CLASSIFYING", "incoherent"): ("CALLING_CONTACT_1", "call_contact1"),

    ("FELL_BUT_FINE", "notified"): ("CALLING_CONTACT_1", "call_contact1"),

    ("CALLING_CONTACT_1", "contact_timeout"): ("CALLING_CONTACT_2", "call_contact2"),
    ("CALLING_CONTACT_2", "contact_timeout"): ("ESCALATED_FINAL", "final_escalation"),
    ("ESCALATED_FINAL", "exhausted_timeout"): ("EXHAUSTED", "noop"),
}

# "Any time, any human: ack halts the ladder" (PRD §4.2) — wire it from every
# non-terminal state instead of special-casing ack() outside the table.
for _s in STATES - TERMINAL_STATES - {"IDLE"}:
    TABLE.setdefault((_s, "ack"), ("ACKNOWLEDGED", "noop"))
# SCHEDULED_CALLBACK exists per the PRD diagram but nothing yet drives into or
# out of it — no caller sends request_callback (classify() only accepts the
# five classifications named in the module task). Wire its transitions when
# that tool is added; state is reserved in STATES so it's not forgotten.
del _s


# ---------------------------------------------------------------------------
# Timer wheel — one asyncio task per alert. start_timers/stop_timers are the
# lifespan hooks main.py calls; timers themselves are created lazily by
# whichever action schedules a timeout, so both hooks are plain, safe no-ops
# when nothing is in flight.
# ---------------------------------------------------------------------------

_timers: dict[str, asyncio.Task] = {}


def _cancel_timer(alert_id: str) -> None:
    t = _timers.pop(alert_id, None)
    if t and not t.done():
        t.cancel()


def _schedule(alert_id: str, delay_s: float, trigger: str) -> None:
    _cancel_timer(alert_id)

    async def _wait():
        try:
            await asyncio.sleep(delay_s)
        except asyncio.CancelledError:
            return
        _timers.pop(alert_id, None)
        try:
            await _apply(alert_id, trigger)
        except Exception as e:  # noqa: BLE001 — a timer must never vanish silently
            print(f"[alerts] timer alert={alert_id} trigger={trigger} failed: {e}")

    _timers[alert_id] = asyncio.create_task(_wait())


# Which trigger each waiting state is waiting FOR, and how long it waits. This
# is the timer half of TABLE, and it has to agree with the `_schedule(...)` call
# in the action that enters each state — a state here with the wrong trigger
# would re-arm an alert onto a transition TABLE has no entry for. States absent
# from this map are not waiting on a clock: VOICEMAIL and FELL_BUT_FINE chain
# straight through, CLASSIFYING waits on a human, and the terminal states are
# done.
def _pending_timer(state: str) -> tuple[str, float] | None:
    return {
        "LOCAL_CANCEL": ("cancel_timeout", float(cfg.CANCEL_WINDOW_S)),
        "CALLING_RESIDENT": ("silence", float(RESIDENT_RESPONSE_TIMEOUT_S)),
        "RETRY_RESIDENT": ("retry_timeout", float(RETRY_WAIT_S)),
        "CALLING_CONTACT_1": ("contact_timeout", float(cfg.CONTACT_WAIT_S)),
        "CALLING_CONTACT_2": ("contact_timeout", float(cfg.CONTACT_WAIT_S)),
        "ESCALATED_FINAL": ("exhausted_timeout", float(cfg.EXHAUSTED_AFTER_S)),
    }.get(state)


async def _rearm_pending() -> int:
    """Re-arm the ladder for alerts that were mid-escalation when we stopped.

    Timers are in-memory asyncio tasks, so a process restart used to strand
    every open alert exactly where it stood: the app kept showing a live
    takeover that would never advance and never close. In development the API
    runs under `uvicorn --reload`, so that is not a rare crash-only case — it
    is every time someone saves a file.

    The remaining wait is measured from the alert's own `updated_at`, so an
    alert that was 28 seconds into a 30 second cancel window resumes with two
    seconds left rather than a fresh thirty. Anything already past due fires on
    the next tick instead of being back-dated.
    """
    rearmed = 0
    now = datetime.now(timezone.utc)
    async for alert in db().alerts.find({"state": {"$nin": list(TERMINAL_STATES)}}):
        pending = _pending_timer(alert.get("state", ""))
        if not pending:
            continue
        trigger, window_s = pending
        try:
            since = datetime.fromisoformat(alert["updated_at"])
        except (KeyError, TypeError, ValueError):
            since = now
        if since.tzinfo is None:
            since = since.replace(tzinfo=timezone.utc)
        left = window_s - (now - since).total_seconds()
        _schedule(alert["_id"], max(0.1, left), trigger)
        rearmed += 1
    if rearmed:
        log.info("re-armed %d in-flight alert timer(s) after restart", rearmed)
    return rearmed


def start_timers() -> None:
    """Lifespan hook. Kicks off the re-arm as a task because the lifespan calls
    this synchronously and the re-arm needs the database."""
    try:
        asyncio.get_running_loop().create_task(_rearm_pending())
    except RuntimeError:
        # No loop (a synchronous test importing the module). Nothing in flight
        # to re-arm in that case either.
        pass


def stop_timers() -> None:
    for alert_id in list(_timers.keys()):
        _cancel_timer(alert_id)


# ---------------------------------------------------------------------------
# The transition engine.
# ---------------------------------------------------------------------------

async def _apply(alert_id: str, trigger: str, detail=None) -> dict:
    alert = await _get(alert_id)
    if alert is None:
        raise ValueError(f"unknown alert {alert_id!r}")
    state = alert["state"]
    key = (state, trigger)
    if key not in TABLE:
        raise ValueError(f"no transition for state={state!r} trigger={trigger!r}")
    next_state, action_name = TABLE[key]

    _cancel_timer(alert_id)
    update = {"state": next_state, "updated_at": datetime.now(timezone.utc).isoformat()}
    if next_state in RESOLUTION_FOR_STATE:
        update["resolution"] = RESOLUTION_FOR_STATE[next_state]
    await db().alerts.update_one({"_id": alert_id}, {"$set": update})
    alert.update(update)

    await emit(
        resident_id=alert["resident_id"],
        source="derived",
        type=_EVENT_TYPE_FOR_TRIGGER.get(trigger, "escalation_started"),
        embedding_text=f"Alert {alert_id}: {state} -> {next_state} ({trigger})"[:400],
        payload={
            "alert_id": alert_id, "from_state": state, "to_state": next_state,
            "trigger": trigger, "detail": detail,
        },
    )

    # Push the state change to any connected app. Without this the websocket only
    # ever fired on ack/resolve, so a phone watching a live fall saw nothing —
    # not the alert opening, not "calling Eleanor", not the escalation. Lazy
    # import: routers import alerts at startup, so a module-level import here
    # would be circular.
    try:
        from .routers import live

        await live.broadcast_alert(alert)
    except Exception as e:  # noqa: BLE001
        # A dead socket must never stall the escalation ladder.
        log.warning("alert broadcast failed for %s: %s", alert_id, e)

    await ACTIONS[action_name](alert, detail=detail)
    # Re-fetch: some actions (e.g. fell_but_fine -> notify_family_warn) chain
    # straight into another _apply() before returning, so the DB may already be
    # past `next_state` by the time we get here.
    return await _get(alert_id)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def open_alert(resident_id: str, trigger_event_id: str, kind: str, severity: str) -> dict:
    """Opens a new alert and starts the 30 s local-cancel window (PRD §4.2)."""
    if not resident_id or not kind:
        raise ValueError("resident_id and kind are required")
    if severity not in ("warn", "critical"):
        raise ValueError(f"invalid severity {severity!r}, must be 'warn' or 'critical'")

    alert_id = f"alt_{ULID()}"
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "_id": alert_id,
        "resident_id": resident_id,
        "trigger_event_id": trigger_event_id,
        "kind": kind,
        "severity": severity,
        "state": "SUSPECTED",
        "resolution": None,
        "resident_call_attempts": 0,
        "opened_at": now,
        "updated_at": now,
    }
    await db().alerts.insert_one(doc)
    await emit(
        resident_id=resident_id,
        source="derived",
        type="escalation_started",
        embedding_text=f"Alert opened for {resident_id}: {kind} ({severity})"[:400],
        payload={"alert_id": alert_id, "trigger_event_id": trigger_event_id, "kind": kind, "severity": severity},
    )
    await _apply(alert_id, "window_open")
    return await _get(alert_id)


async def cancel(alert_id: str, by: str) -> dict:
    """The band button / app cancel, valid only inside the local-cancel window."""
    alert = await _get(alert_id)
    if alert is None:
        raise ValueError(f"unknown alert {alert_id!r}")
    if alert["state"] != "LOCAL_CANCEL":
        raise ValueError(f"cannot cancel alert in state {alert['state']!r}")
    return await _apply(alert_id, "cancel", detail={"by": by})


async def classify(alert_id: str, classification: str, detail: str | None = None) -> dict:
    """Called by the voice layer with the outcome of a resident call.

    Silence escalates: if the voice layer never calls this before
    RESIDENT_RESPONSE_TIMEOUT_S elapses, the ladder escalates on its own via
    the "silence" timer trigger — no separate call needed for that case.
    """
    if classification not in CLASSIFICATIONS:
        raise ValueError(f"unknown classification {classification!r}, must be one of {sorted(CLASSIFICATIONS)}")
    alert = await _get(alert_id)
    if alert is None:
        raise ValueError(f"unknown alert {alert_id!r}")
    state = alert["state"]

    if classification == "no_answer":
        if state not in ("CALLING_RESIDENT", "RETRY_RESIDENT"):
            raise ValueError(f"cannot classify no_answer from state {state!r}")
        return await _apply(alert_id, "no_answer", detail=detail)

    if state in ("CALLING_RESIDENT", "RETRY_RESIDENT"):
        await _apply(alert_id, "connected")
        state = "CLASSIFYING"
    if state != "CLASSIFYING":
        raise ValueError(f"cannot classify {classification!r} from state {state!r}")
    return await _apply(alert_id, classification, detail=detail)


async def ack(alert_id: str, by: str, channel: str) -> dict:
    """Any human acknowledging the alert halts the ladder (PRD §4.2)."""
    return await _apply(alert_id, "ack", detail={"by": by, "channel": channel})
