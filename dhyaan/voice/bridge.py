"""Twilio ⇄ Deepgram Voice Agent bridge — TECHNICAL_PRD §5.4, abhinavtodo B3–B7.

The three rules people get wrong (§5.4), enforced and tested here:
  1. Twilio → Deepgram is RAW BINARY (base64-decode, send bytes). Deepgram → Twilio
     is base64-encoded and wrapped in {"event":"media","streamSid",...}.
  2. streamSid rides EVERY frame sent to Twilio, including "clear".
  3. "clear" on UserStartedSpeaking IS the barge-in implementation.

No resampling anywhere: both sides are mulaw/8000 by Settings. The only transform
in the pipe is base64.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect

from . import fsm_stub as fsm  # default: in-memory stub; use_fsm() swaps in the real FSM


def use_fsm(module) -> None:
    """Bind the seam to a real FSM module (backend/app/voice_adapter.py) at startup."""
    global fsm
    fsm = module


async def _fsm_call(fn, *args, **kwargs):
    """The stub's helpers are sync; the real adapter's are async. Tolerate both."""
    r = fn(*args, **kwargs)
    if asyncio.iscoroutine(r):
        r = await r
    return r
from .outbound import retry_or_escalate
from .settings import build_settings, voicemail_message

log = logging.getLogger("dhyaan.voice.bridge")
router = APIRouter()

DG_URL = "wss://agent.deepgram.com/v1/agent/converse"
KEEPALIVE_INTERVAL_S = 8.0
SILENCE_TIMEOUT_S = 20.0  # §4.4: 20 s of silence after the greeting

# call_sid → live session, so /twilio/amd can reach the running bridge (B6).
SESSIONS: dict[str, "Session"] = {}


class Session:
    def __init__(self, ctx: dict, dg: Any, stream_sid: str, call_sid: str):
        self.ctx = ctx
        self.dg = dg
        self.stream_sid = stream_sid
        self.call_sid = call_sid
        self.pending_hangup = False
        self.tool_called = False
        self.classification: str | None = None
        self.greeting_done = False
        self.silence_strikes = 0
        self.silence_timer: asyncio.Task | None = None


@asynccontextmanager
async def dg_connect():
    """Deepgram agent socket. Tests monkeypatch this with a fake."""
    import websockets

    headers = {"Authorization": f"Token {os.environ.get('DEEPGRAM_API_KEY', '')}"}
    async with websockets.connect(DG_URL, additional_headers=headers) as dg:
        yield dg


async def hangup_call(call_sid: str) -> None:
    """Twilio REST hangup; monkeypatched in tests."""
    from .outbound import hangup

    await asyncio.to_thread(hangup, call_sid)


async def _send_tw(tw: WebSocket, payload: dict) -> None:
    # B4.2: streamSid must already be in payload — assert loudly in dev.
    assert "streamSid" in payload, f"outbound Twilio frame missing streamSid: {payload}"
    await tw.send_text(json.dumps(payload))


def _arm_silence_timer(sess: Session) -> None:
    """B5.7 — 20 s of silence after the greeting: repeat once, then escalate."""

    async def fire():
        try:
            await asyncio.sleep(SILENCE_TIMEOUT_S)
        except asyncio.CancelledError:
            return
        sess.silence_strikes += 1
        if sess.silence_strikes == 1:
            await sess.dg.send(json.dumps({
                "type": "InjectAgentMessage",
                "message": "I'm calling to check that you're okay. Can you hear me?",
            }))
            _arm_silence_timer(sess)
        else:
            await fsm.handle_voice_tool(sess.ctx.get("alert_id", ""), sess.ctx.get("role", ""),
                                        "escalate", {"reason": "silence"})
            sess.tool_called = True
            sess.pending_hangup = True

    if sess.silence_timer:
        sess.silence_timer.cancel()
    sess.silence_timer = asyncio.create_task(fire())


def _disarm_silence_timer(sess: Session) -> None:
    if sess.silence_timer:
        sess.silence_timer.cancel()
        sess.silence_timer = None
    sess.silence_strikes = 0


@router.websocket("/twilio/stream")
async def twilio_stream(tw: WebSocket) -> None:
    await tw.accept()
    sess: Session | None = None

    async with dg_connect() as dg:
        settings_applied = asyncio.Event()

        async def twilio_to_deepgram():
            nonlocal sess
            try:
                async for raw in tw.iter_text():
                    m = json.loads(raw)
                    ev = m.get("event")
                    if ev == "start":
                        stream_sid = m["start"]["streamSid"]
                        call_sid = m["start"].get("callSid", "")
                        ctx = m["start"].get("customParameters", {})
                        sess = Session(ctx, dg, stream_sid, call_sid)
                        SESSIONS[call_sid] = sess
                        await fsm.db_bind_call(ctx.get("call_id", ""), call_sid, stream_sid)
                        await dg.send(json.dumps(build_settings(ctx)))
                    elif ev == "media":
                        # B3.2: nothing relays until SettingsApplied.
                        if not settings_applied.is_set():
                            continue
                        # B3.3: raw binary to Deepgram — never JSON-wrapped.
                        await dg.send(base64.b64decode(m["media"]["payload"]))
                    elif ev == "stop":
                        break
            except WebSocketDisconnect:
                pass

        async def deepgram_to_twilio():
            async for msg in dg:
                if isinstance(msg, (bytes, bytearray)):
                    if sess is None:
                        continue
                    await _send_tw(tw, {
                        "event": "media",
                        "streamSid": sess.stream_sid,
                        "media": {"payload": base64.b64encode(bytes(msg)).decode()},
                    })
                    continue

                e = json.loads(msg)
                t = e.get("type")

                if t == "SettingsApplied":
                    settings_applied.set()

                elif t == "UserStartedSpeaking":
                    if sess:
                        _disarm_silence_timer(sess)
                        # Barge-in: flush Twilio's playback buffer, right now.
                        await _send_tw(tw, {"event": "clear", "streamSid": sess.stream_sid})

                elif t == "ConversationText":
                    if sess:
                        if e.get("role") == "user":
                            _disarm_silence_timer(sess)
                        await fsm.append_transcript(sess.ctx.get("call_id", ""),
                                                    e.get("role", ""), e.get("content", ""))

                elif t == "FunctionCallRequest":
                    for fn in e.get("functions", []):
                        args = json.loads(fn["arguments"]) if fn.get("arguments") else {}
                        if sess:
                            _disarm_silence_timer(sess)
                            if fn["name"] == "end_call":
                                sess.pending_hangup = True
                                result: dict = {"ok": True}
                            else:
                                result = await fsm.handle_voice_tool(
                                    sess.ctx.get("alert_id", ""), sess.ctx.get("role", ""),
                                    fn["name"], args)
                                sess.tool_called = True
                        else:
                            result = {"ok": False, "error": "no session"}
                        await dg.send(json.dumps({
                            "type": "FunctionCallResponse",
                            "id": fn.get("id"), "name": fn["name"],
                            "content": json.dumps(result),
                        }))

                elif t == "FunctionCallCancelled":
                    pass  # B5.4 — the FSM call was idempotent; nothing to undo

                elif t == "AgentAudioDone":
                    if sess and not sess.greeting_done:
                        sess.greeting_done = True
                        _arm_silence_timer(sess)
                    if sess and sess.pending_hangup:
                        await hangup_call(sess.call_sid)

                elif t in ("Error", "Warning"):
                    log.error("deepgram %s: %s %s", t, e.get("code"), e.get("description"))

        tasks = [asyncio.create_task(twilio_to_deepgram()),
                 asyncio.create_task(deepgram_to_twilio()),
                 asyncio.create_task(_keepalive(dg))]
        try:
            # First loop to finish (usually Twilio "stop") tears the rest down — B3.7.
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            if sess:
                _disarm_silence_timer(sess)
                # B5.6 / B6.4: silence escalates — but a voicemail already advanced
                # as no_answer, and a tool call means the agent decided.
                if not sess.tool_called and sess.classification != "voicemail":
                    await fsm.handle_voice_tool(sess.ctx.get("alert_id", ""),
                                                sess.ctx.get("role", ""), "escalate",
                                                {"reason": "incoherent",
                                                 "detail": "call ended with no tool call"})
                SESSIONS.pop(sess.call_sid, None)


async def _keepalive(dg: Any) -> None:
    while True:
        await asyncio.sleep(KEEPALIVE_INTERVAL_S)
        try:
            await dg.send(json.dumps({"type": "KeepAlive"}))
        except Exception:
            return


# ---- HTTP callbacks ----------------------------------------------------------

# Only the confident verdicts trigger the voicemail flow. `machine_start` false-
# positives on live humans (observed on a real call 9/19: human answer classified
# machine_start, bridge left voicemail and hung up on her). A real voicemail still
# gets the message at the beep; a misread human just keeps talking to the agent.
VOICEMAIL_ANSWERED_BY = {"machine_end_beep", "machine_end_silence",
                         "machine_end_other", "fax"}


@router.post("/twilio/status")
async def twilio_status(request: Request) -> dict:
    form = dict(await request.form())
    log.info("twilio status: %s", form)
    call_sid = str(form.get("CallSid", ""))
    status = str(form.get("CallStatus", ""))
    binding = fsm.CALL_BINDINGS.get(call_sid, {})
    await _fsm_call(fsm.emit_event, type="call_status",
                    payload={"call_sid": call_sid, "status": status,
                             **({"call_id": binding["call_id"]} if binding else {})},
                    embedding_text=f"Call status {status}.")
    return {"ok": True}


@router.post("/twilio/amd")
async def twilio_amd(request: Request) -> dict:
    """B6 — AsyncAmd verdict. The stream is already live when this lands."""
    form = dict(await request.form())
    call_sid = str(form.get("CallSid", ""))
    answered_by = str(form.get("AnsweredBy", "unknown"))
    log.info("AMD verdict for %s: %s", call_sid, answered_by)

    sess = SESSIONS.get(call_sid)
    if answered_by in VOICEMAIL_ANSWERED_BY:
        if sess:
            sess.classification = "voicemail"
            sess.pending_hangup = True  # hang up on AgentAudioDone after the script
            _disarm_silence_timer(sess)
            await sess.dg.send(json.dumps({
                "type": "InjectAgentMessage",
                "message": voicemail_message(sess.ctx),
            }))
            await _fsm_call(fsm.emit_event, type="call_answered",
                            payload={"answered_by": answered_by, "call_id": sess.ctx.get("call_id")},
                            embedding_text="The call went to voicemail.")
            # B6.4 — THE rule: a voicemail is NOT an answer. Advance as no_answer.
            await _fsm_call(fsm.advance_no_answer, sess.ctx.get("alert_id", ""),
                            sess.ctx.get("call_id", ""), reason="voicemail")
    elif answered_by == "human":
        if sess:
            await _fsm_call(fsm.emit_event, type="call_answered",
                            payload={"answered_by": "human", "call_id": sess.ctx.get("call_id")},
                            embedding_text="The call was answered by a person.")
    # B6.5: "unknown" (AMD timed out) → treat as human; normal agent flow, no branch.
    return {"ok": True, "answered_by": answered_by}


@router.post("/demo/force_ack")
async def force_ack(request: Request) -> dict:
    """B9.3 — the last-resort demo path: curl this to acknowledge the open alert."""
    body: dict = {}
    try:
        body = await request.json()
    except Exception:
        pass
    alert_id = body.get("alert_id", "alr_demo")
    return await _fsm_call(fsm.force_ack, alert_id, by=body.get("by", "demo"))


async def on_call_status(*, call_id: str, alert_id: str, role: str, to_e164: str,
                         status: str, attempt: int) -> str:
    """B2.4 wiring: feed a terminal Twilio status through the one-retry policy."""

    async def place_again(next_attempt: int) -> None:
        from .outbound import place_call

        await asyncio.to_thread(place_call, to_e164=to_e164, alert_id=alert_id,
                                role=role, call_id=call_id, attempt=next_attempt)

    async def exhausted() -> None:
        fsm.advance_no_answer(alert_id, call_id, reason=status)

    return await retry_or_escalate(status=status, attempt=attempt,
                                   place=place_again, on_exhausted=exhausted)
