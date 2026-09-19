"""Real implementations of the four functions `dhyaan/voice/fsm_stub.py` stands in for.

Abhinav's bridge (`dhyaan/voice/bridge.py`) calls a small seam that the stub fakes
in memory. This module is that seam backed by the real FSM and MongoDB, with the
*same signatures*, so the switch is one import change in the bridge:

    - from dhyaan.voice import fsm_stub as fsm
    + from app import voice_adapter as fsm

Everything else in the bridge stays as written.

Wiring it up (do this once, at startup, in `dhyaan/voice/app.py`):

    from app import db, voice_adapter
    await db.connect()
    voice_adapter.install()      # routes app/alerts.py's outbound calls to Twilio

`install()` closes the other direction too: `app/alerts.py` places calls through
`app/voice.py`, whose stub only logs. `install()` swaps in Abhinav's
`dhyaan.voice.outbound.place_call` so the FSM's ladder dials real numbers.
"""

import asyncio
import logging

from . import alerts, voice
from .db import db
from .events import emit

log = logging.getLogger("dhyaan.voice_adapter")

# Bridge tool name -> alerts.classify() classification. PRD §4.4/§4.6.
_TOOL_TO_CLASSIFICATION = {
    ("mark_ok", "fine"): "okay",
    ("mark_ok", "fell_but_fine"): "fell_but_fine",
}

# ponytail: per-process idempotency cache, same as the stub's. Deepgram retries
# and FunctionCallCancelled both replay tool calls, and the ladder must not
# double-fire. Move to a Mongo upsert keyed on the same string if the bridge ever
# runs in more than one process.
_idempotency: dict[str, dict] = {}


async def handle_voice_tool(alert_id: str, role: str, fn_name: str, args: dict) -> dict:
    """The voice agent called one of its four tools. Drive the real FSM."""
    key = f"{alert_id}:{fn_name}:{sorted(args.items())}"
    if key in _idempotency:
        return _idempotency[key]

    await emit(
        resident_id=await _resident_for(alert_id),
        source="voice",
        type="voice_response_classified",
        source_id=alert_id,
        payload={"tool": fn_name, "args": args, "role": role},
        embedding_text=f"On a check-in call, the agent called {fn_name}.",
    )

    result: dict = {"ok": True}
    try:
        if fn_name == "mark_ok":
            status = args.get("status", "fine")
            await alerts.classify(alert_id, _TOOL_TO_CLASSIFICATION[("mark_ok", status)],
                                  args.get("detail", ""))
        elif fn_name == "escalate":
            reason = args.get("reason", "incoherent")
            # PRD §4.4: silence and incoherence both escalate as critical.
            classification = "distress" if reason == "distress" else "incoherent"
            await alerts.classify(alert_id, classification, args.get("detail", reason))
        elif fn_name == "request_callback":
            await alerts.classify(alert_id, "okay", f"callback in {args.get('minutes', 5)}m")
            result["minutes"] = args.get("minutes", 5)
        elif fn_name == "end_call":
            pass  # the bridge hangs up after AgentAudioDone; no state change here
        else:
            log.warning("unknown voice tool %r", fn_name)
            result = {"ok": False, "error": f"unknown tool {fn_name}"}
    except ValueError as e:
        # The FSM refuses transitions that make no sense (classifying a call that
        # was already resolved, or one that never connected). That must not raise
        # into the bridge's websocket and kill a live call — report and move on.
        log.warning("voice tool %s rejected for %s: %s", fn_name, alert_id, e)
        result = {"ok": False, "error": str(e)}

    _idempotency[key] = result
    return result


async def db_bind_call(call_id: str, call_sid: str, stream_sid: str | None = None, **extra) -> None:
    """Create/refresh one `calls` row. Abhinav's bridge calls this with just the
    three positionals once Twilio's media stream connects; app/voice.py's stub
    calls it with those same three plus the richer fields (`alert_id`, `role`,
    `status`, `started_at`, `simulated`, ...) that `get_alert` will read straight
    off `db().calls` once it stops reconstructing calls from events (see the
    ponytail note in app/routers/residents.py::get_alert). `stream_sid` stays
    optional and `**extra` is additive, so this is still the one write path —
    not a second one bolted on beside it.
    """
    update = {"twilio_call_sid": call_sid, "call_sid": call_sid}
    if stream_sid is not None:
        update["stream_sid"] = stream_sid
    update.update(extra)
    await db().calls.update_one(
        {"_id": call_id},
        {"$set": update},
        upsert=True,
    )


async def append_transcript(call_id: str, role: str, content: str) -> None:
    await db().calls.update_one(
        {"_id": call_id},
        {"$push": {"transcript": {"role": role, "content": content}}},
        upsert=True,
    )


async def emit_event(*, resident_id: str = "res_eleanor", type: str,
                     payload: dict | None = None, embedding_text: str = "",
                     source: str = "voice", **kw) -> str:
    doc = await emit(resident_id=resident_id, source=source, type=type,
                     payload=payload or {},
                     embedding_text=embedding_text or f"Voice layer recorded {type}.",
                     **kw)
    return doc["_id"]


async def _resident_for(alert_id: str) -> str:
    a = await db().alerts.find_one({"_id": alert_id}, {"resident_id": 1})
    return a["resident_id"] if a else "res_unknown"


class _TwilioVoice:
    """Routes app/alerts.py's ladder into Abhinav's Twilio outbound module."""

    async def place_call(self, to_e164: str, role: str, alert_id: str) -> str:
        from dhyaan.voice import outbound

        call_id = f"cal_{alert_id}_{role}"
        # outbound.place_call is sync (the Twilio SDK is), so keep the loop free.
        sid = await asyncio.to_thread(
            outbound.place_call, to_e164=to_e164, alert_id=alert_id,
            role=role, call_id=call_id,
        )
        await db().calls.update_one(
            {"_id": call_id},
            {"$set": {"alert_id": alert_id, "to_e164": to_e164, "role": role,
                      "twilio_call_sid": sid}},
            upsert=True,
        )
        return sid

    async def hangup(self, call_sid: str) -> None:
        from dhyaan.voice import outbound

        await asyncio.to_thread(outbound.hangup, call_sid)


def install() -> None:
    """Point the FSM's outbound calls at real Twilio. Call once at startup."""
    voice.set_impl(_TwilioVoice())
    log.info("voice_adapter installed — alerts ladder now dials via Twilio")
