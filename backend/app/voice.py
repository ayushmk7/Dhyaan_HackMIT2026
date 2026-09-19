"""Voice layer seam. TECHNICAL_PRD §5 (Twilio + Deepgram bridge).

FILL-IN TEMPLATE for Abhinav. This module is the ONLY thing alerts.py talks to
for telephony — swap the real implementation in with `set_impl()` and nothing
in alerts.py changes.

What to build, and where it's specified:
  - §5.2  Deepgram `Settings` message (mulaw/8000 both directions, no resampling)
  - §5.3  Placing the call: Twilio `Calls.json` with inline TwiML `<Connect><Stream>`,
          `timeout=25`, `machine_detection="Enable"`, `async_amd=true`
  - §5.4  The bridge: FastAPI websocket `/twilio/stream`, relays Twilio <-> Deepgram,
          handles `FunctionCallRequest` (call into alerts.classify / ack), barge-in via
          `clear` on `UserStartedSpeaking`
  - §5.5  Prompts (resident vs. contact, selected by `role` custom parameter)
  - §5.6  Voicemail: AMD verdict arrives async on `/twilio/amd`; a voicemail is NOT an
          answer — advance the FSM exactly as `no_answer`
  - §4.6  Tool definitions (`mark_ok`, `escalate`, `request_callback`, `end_call`)

Env vars (already in .env.example, unused by the stub below):
  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, DEEPGRAM_API_KEY,
  PUBLIC_BASE_URL

Wire in the real thing with:
    from app.voice import set_impl
    set_impl(TwilioDeepgramVoice())
where `TwilioDeepgramVoice` implements `place_call` / `hangup` /
`speak_final_escalation` with the same signatures as the stub below.
"""

from ulid import ULID

from .db import db
from .events import emit


class _StubVoice:
    """Default implementation: no telephony, just an events trail.

    # ponytail: logs + a fake sid so the whole ladder is provable in tests before
    # Twilio/Deepgram exist. Ceiling: no real audio, no classification ever comes
    # back on its own — tests/ops call alerts.classify() directly. Upgrade path:
    # a real IMPL calling Twilio's REST API + the §5.4 bridge, still returning a
    # call sid from place_call().
    """

    async def place_call(self, to_e164: str, role: str, alert_id: str) -> str:
        call_sid = f"CAstub{ULID()}"
        print(f"[voice:stub] place_call to={to_e164} role={role} alert={alert_id} -> {call_sid}")
        alert = await db().alerts.find_one({"_id": alert_id}, {"resident_id": 1})
        resident_id = alert["resident_id"] if alert else alert_id
        await emit(
            resident_id=resident_id,
            source="voice",
            type="call_placed",
            embedding_text=f"Called {role} at {to_e164} for alert {alert_id}",
            payload={"to": to_e164, "role": role, "alert_id": alert_id, "call_sid": call_sid},
        )
        return call_sid

    async def hangup(self, call_sid: str) -> None:
        print(f"[voice:stub] hangup {call_sid}")

    async def speak_final_escalation(self, call_sid: str, resident_name: str, address: str) -> None:
        print(f"[voice:stub] speak_final_escalation {call_sid} {resident_name} {address}")


IMPL = _StubVoice()


def set_impl(obj) -> None:
    """Swap the telephony implementation. `obj` must implement place_call/hangup/
    speak_final_escalation with the same signatures as `_StubVoice`."""
    global IMPL
    IMPL = obj


async def place_call(to_e164: str, role: str, alert_id: str) -> str:
    return await IMPL.place_call(to_e164, role, alert_id)


async def hangup(call_sid: str) -> None:
    await IMPL.hangup(call_sid)


async def speak_final_escalation(call_sid: str, resident_name: str, address: str) -> None:
    await IMPL.speak_final_escalation(call_sid, resident_name, address)
