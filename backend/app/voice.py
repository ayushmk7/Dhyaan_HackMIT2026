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
  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_E164, DEEPGRAM_API_KEY,
  PUBLIC_WSS, PUBLIC_HTTPS

Wire in the real thing with:
    from app.voice import set_impl
    set_impl(TwilioDeepgramVoice())
where `TwilioDeepgramVoice` implements `place_call` / `hangup` /
`speak_final_escalation` with the same signatures as the stub below.

---

Until that lands, `_StubVoice` below also plays a scripted, clearly-fake phone
call so the React Native alert screen has a call log + transcript to render
against a live backend. See SCRIPTS / set_script() / TIMINGS.
"""

import asyncio
import logging
from datetime import datetime, timezone

from ulid import ULID

from .db import db
from .events import emit

log = logging.getLogger("dhyaan.voice_stub")

# ponytail: no dialogue engine, no state machine of our own — alerts.py's FSM
# already exists and is what actually drives the ladder. This module only
# plays back a canned transcript and hands the outcome to
# voice_adapter.handle_voice_tool, exactly as a real classification would.

# Every line this stub ever writes is prefixed, so nothing it produces can be
# mistaken for a real recording or a real transcript.
SIM_TAG = "[SIMULATED CALL — no telephony wired up]"

# Delays that make the call "feel" real without slowing tests. Tests shrink
# these with monkeypatch.setitem(voice.TIMINGS, "ring_s", ...), same spirit as
# app/config.py's ladder timings in tests/test_alerts.py.
TIMINGS = {
    "ring_s": 2.0,       # time before "pickup" (or before giving up unanswered)
    "turn_gap_s": 0.8,   # pause between each simulated transcript turn
}

# name -> (transcript turns, tool call to fire once the "call" ends).
# Each turn is (speaker, text); tool call is (fn_name, args) matching the four
# tools voice_adapter.handle_voice_tool understands, or None to fire nothing
# and let alerts.py's own timers decide what happens next.
SCRIPTS: dict[str, tuple[list[tuple[str, str]], tuple[str, dict] | None]] = {
    "okay": (
        [
            ("agent", f"{SIM_TAG} Hi, this is your wellness check-in calling. Are you okay?"),
            ("resident", f"{SIM_TAG} Yes, I'm fine, just sat down for a moment. No need to worry."),
            ("agent", f"{SIM_TAG} Glad to hear it. Take care."),
        ],
        ("mark_ok", {"status": "fine", "detail": f"{SIM_TAG} resident said she is fine"}),
    ),
    "distress": (
        [
            ("agent", f"{SIM_TAG} Hi, this is your wellness check-in calling. Are you okay?"),
            ("resident", f"{SIM_TAG} No — I need help, please send someone."),
        ],
        ("escalate", {"reason": "distress", "detail": f"{SIM_TAG} resident asked for help"}),
    ),
    "fell_but_fine": (
        [
            ("agent", f"{SIM_TAG} Hi, this is your wellness check-in calling. Are you okay?"),
            ("resident", f"{SIM_TAG} I did fall, but I'm alright — just startled."),
        ],
        ("mark_ok", {"status": "fell_but_fine", "detail": f"{SIM_TAG} resident says she fell but is fine"}),
    ),
    # Nobody picked up. No transcript is fabricated for words nobody said —
    # alerts.py's own timers (RESIDENT_RESPONSE_TIMEOUT_S / contact_timeout)
    # escalate from here exactly as they would for a real unanswered call.
    "no_answer": ([], None),
    # The call connects but nothing usable comes back (dead air / bad line).
    # Also fires no tool call — same "let the timers decide" outcome as
    # no_answer, just logged differently so a demo can tell the two apart.
    "silence": (
        [("system", f"{SIM_TAG} call connected — no response detected on the line")],
        None,
    ),
}

# ponytail: honest default for a system with no telephony yet. It escalates,
# which is the safe direction — never default to an outcome that quietly
# resolves an alert nobody actually confirmed.
SCRIPT = "no_answer"


# What the agent says when it reaches a family member. It does not ask them to
# classify anything — acknowledgement comes from the app or the ladder times out.
CONTACT_SCRIPT: list[tuple[str, str]] = [
    ("agent", f"{SIM_TAG} Hi, this is Dhyaan calling about Asha. Her band detected a "
              "possible fall and she did not answer when we called her."),
    ("agent", f"{SIM_TAG} Can you check on her? Acknowledge in the app and we will stop "
              "calling the rest of her contacts."),
]


def set_script(name: str) -> None:
    """Choose what the next simulated call "says". For the demo trigger and
    tests — not exposed to alerts.py or the FSM in any way."""
    if name not in SCRIPTS:
        raise ValueError(f"unknown script {name!r}, must be one of {sorted(SCRIPTS)}")
    global SCRIPT
    SCRIPT = name


# Hold references: asyncio only keeps a weak reference to a running task, so a
# task nobody holds can be garbage-collected mid-flight. Same pattern as
# app/rag.py's _embed_tasks.
_bg_tasks: set = set()


class _StubVoice:
    """Default implementation: no telephony, just an events trail plus a
    scripted, clearly-simulated `calls` row and transcript.

    # ponytail: logs + a fake sid + a canned script so the whole ladder
    # (including the call log / transcript the RN app renders) is provable in
    # tests before Twilio/Deepgram exist. Ceiling: no real audio, no real
    # classification — the outcome is picked by SCRIPT, not by anything a
    # person said. Upgrade path: a real IMPL calling Twilio's REST API + the
    # §5.4 bridge, still returning a call sid from place_call().
    """

    async def place_call(self, to_e164: str, role: str, alert_id: str) -> str:
        call_sid = f"CAstub{ULID()}"
        call_id = f"cal_stub_{ULID()}"
        script = SCRIPT  # snapshot: a set_script() call mid-flight must not retarget this call
        print(f"[voice:stub] place_call to={to_e164} role={role} alert={alert_id} "
              f"-> {call_sid} script={script}")

        alert = await db().alerts.find_one({"_id": alert_id}, {"resident_id": 1})
        resident_id = alert["resident_id"] if alert else alert_id

        from . import voice_adapter  # ponytail: local import — voice_adapter imports this module at its top

        await voice_adapter.db_bind_call(
            call_id, call_sid, None,
            alert_id=alert_id, resident_id=resident_id, to_e164=to_e164, role=role,
            status="ringing", started_at=datetime.now(timezone.utc).isoformat(),
            simulated=True,
        )

        await emit(
            resident_id=resident_id,
            source="voice",
            type="call_placed",
            embedding_text=f"{SIM_TAG} Called {role} at {to_e164} for alert {alert_id}"[:400],
            payload={"to": to_e164, "role": role, "alert_id": alert_id,
                     "call_sid": call_sid, "simulated": True},
        )

        # Don't block the ladder on the "conversation" — place_call returns as
        # soon as the call is "placed", same as a real Twilio API call would.
        task = asyncio.create_task(self._run_call(call_id, alert_id, role, script))
        _bg_tasks.add(task)
        task.add_done_callback(_bg_tasks.discard)

        return call_sid

    async def _run_call(self, call_id: str, alert_id: str, role: str, script: str) -> None:
        # A simulated call must never be able to break a real alert. Whatever
        # goes wrong here is logged and dropped — the ladder's own timers still
        # escalate on schedule regardless.
        try:
            await self._run_call_inner(call_id, alert_id, role, script)
        except Exception as e:  # noqa: BLE001
            log.warning("simulated call %s (alert %s, script %s) failed: %s",
                       call_id, alert_id, script, e)

    async def _run_call_inner(self, call_id: str, alert_id: str, role: str, script: str) -> None:
        from . import voice_adapter

        # PRD §5.5: the resident and the contact get different prompts, so they
        # get different scripts here. Replaying the resident's "I need help" at
        # the daughter is not just cosmetic — it is the line a judge reads on
        # screen, and it would be attributed to the wrong person.
        if role != "resident":
            turns, tool_call = CONTACT_SCRIPT, None
        else:
            turns, tool_call = SCRIPTS[script]
        await asyncio.sleep(TIMINGS["ring_s"])

        if not turns:
            await db().calls.update_one(
                {"_id": call_id},
                {"$set": {"status": "no-answer", "ended_at": datetime.now(timezone.utc).isoformat()}},
            )
            return

        await db().calls.update_one({"_id": call_id}, {"$set": {"status": "in-progress"}})
        for speaker, text in turns:
            await voice_adapter.append_transcript(call_id, speaker, text)
            await asyncio.sleep(TIMINGS["turn_gap_s"])

        await db().calls.update_one(
            {"_id": call_id},
            {"$set": {"status": "completed", "ended_at": datetime.now(timezone.utc).isoformat()}},
        )

        if tool_call:
            fn_name, args = tool_call
            await voice_adapter.handle_voice_tool(alert_id, role, fn_name, args)

    async def hangup(self, call_sid: str) -> None:
        print(f"[voice:stub] hangup {call_sid}")

    async def speak_final_escalation(self, call_sid: str, resident_name: str, address: str) -> None:
        print(f"[voice:stub] {SIM_TAG} speak_final_escalation {call_sid} {resident_name} {address}")


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
