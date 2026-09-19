"""The seam to the real FSM — REPLACE AT INTEGRATION (abhinavtodo B1.1–B1.3).

Ayush's backend owns the real implementations:
  - `dhyaan/events.py`  → emit(...)                      (PRD §3.4)
  - the alert FSM       → handle_voice_tool(alert_id, role, fn_name, args) -> dict
  - call-row helpers    → db_bind_call(call_id, call_sid, stream_sid),
                          append_transcript(call_id, role, content)

This module is a drop-in in-memory stand-in with the EXACT same signatures, so the
bridge and its tests run before the backend exists. Return shape agreed per B1.3:
`{"ok": True}` (plus optional keys the agent may speak from).

Idempotency (B5.4): repeated identical tool calls return the cached first result and
do NOT double-fire — `FunctionCallCancelled` and Deepgram retries rely on this.
"""
from __future__ import annotations

import json
import logging
from typing import Any

log = logging.getLogger("dhyaan.voice.fsm_stub")

# Test-inspectable state. Reset with reset().
TOOL_CALLS: list[dict] = []
EVENTS: list[dict] = []
TRANSCRIPTS: dict[str, list[dict]] = {}
CALL_BINDINGS: dict[str, dict] = {}
CALL_CLASSIFICATIONS: dict[str, str] = {}
ALERT_STATES: dict[str, str] = {}

_idempotency_cache: dict[str, dict] = {}


def reset() -> None:
    TOOL_CALLS.clear()
    EVENTS.clear()
    TRANSCRIPTS.clear()
    CALL_BINDINGS.clear()
    CALL_CLASSIFICATIONS.clear()
    ALERT_STATES.clear()
    _idempotency_cache.clear()


async def handle_voice_tool(alert_id: str, role: str, fn_name: str, args: dict) -> dict:
    key = f"{alert_id}:{fn_name}:{json.dumps(args, sort_keys=True)}"
    if key in _idempotency_cache:
        log.info("idempotent replay of %s for %s — returning cached result", fn_name, alert_id)
        return _idempotency_cache[key]

    record = {"alert_id": alert_id, "role": role, "fn": fn_name, "args": args}
    TOOL_CALLS.append(record)
    log.info("voice tool: %s", record)

    if fn_name == "mark_ok":
        ALERT_STATES[alert_id] = "resolved_ok" if args.get("status") == "fine" else "fell_but_fine"
    elif fn_name == "escalate":
        ALERT_STATES[alert_id] = "escalating"
    elif fn_name == "request_callback":
        ALERT_STATES[alert_id] = "scheduled_callback"
    # end_call: no state change here — the bridge hangs up after AgentAudioDone.

    result = {"ok": True}
    _idempotency_cache[key] = result
    return result


async def db_bind_call(call_id: str, call_sid: str, stream_sid: str) -> None:
    CALL_BINDINGS[call_sid] = {"call_id": call_id, "call_sid": call_sid, "stream_sid": stream_sid}


async def append_transcript(call_id: str, role: str, content: str) -> None:
    TRANSCRIPTS.setdefault(call_id, []).append({"role": role, "content": content})


def emit_event(*, resident_id: str = "res_eleanor", type: str, payload: dict | None = None,
               embedding_text: str = "", source: str = "voice", **kw: Any) -> str:
    """Stand-in for dhyaan.events.emit (§3.4). The real one writes SQLite + BUS."""
    eid = f"evt_stub_{len(EVENTS):04d}"
    EVENTS.append({"id": eid, "resident_id": resident_id, "source": source, "type": type,
                   "payload": payload or {}, "embedding_text": embedding_text, **kw})
    return eid


def advance_no_answer(alert_id: str, call_id: str, reason: str) -> None:
    """B6.4 — voicemail advances the FSM exactly as no_answer. The real FSM moves
    CALLING_RESIDENT → RETRY_RESIDENT/CALLING_CONTACT_1; here we just record it."""
    CALL_CLASSIFICATIONS[call_id] = "voicemail" if reason == "voicemail" else "no_answer"
    ALERT_STATES[alert_id] = "advance_as_no_answer"
    emit_event(type="call_no_answer", payload={"reason": reason, "call_id": call_id},
               embedding_text=f"The call was not answered ({reason}).")


def force_ack(alert_id: str, by: str = "demo") -> dict:
    """B9.3 — the last-resort demo button."""
    ALERT_STATES[alert_id] = "acknowledged"
    emit_event(type="escalation_acknowledged", payload={"by": by, "channel": "demo"},
               embedding_text=f"{by} acknowledged the alert.")
    return {"alert_id": alert_id, "state": "acknowledged"}
