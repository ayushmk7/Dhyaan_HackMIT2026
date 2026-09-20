"""Offline integration tests for the voice bridge.

A fake Twilio websocket + a fake Deepgram socket exercise the full bridge with no
accounts, no network: SettingsApplied gating, media encoding both directions,
barge-in, function calls, silence-default, voicemail-as-no-answer, retry-once.
"""
from __future__ import annotations

import asyncio
import base64
import json
from contextlib import asynccontextmanager

import pytest

from dhyaan.voice import bridge, fsm_stub
from dhyaan.voice.settings import build_settings

pytestmark = pytest.mark.asyncio


# ---- fakes -------------------------------------------------------------------

class FakeDG:
    """Looks enough like a websockets client connection for the bridge."""

    def __init__(self):
        self.sent: list = []           # everything the bridge sent us
        self._incoming: asyncio.Queue = asyncio.Queue()
        self.auto_settings_applied = True

    async def send(self, data):
        self.sent.append(data)
        if (self.auto_settings_applied and isinstance(data, str)
                and json.loads(data).get("type") == "Settings"):
            await self.push({"type": "SettingsApplied"})

    async def push(self, obj):
        await self._incoming.put(json.dumps(obj) if isinstance(obj, dict) else obj)

    def __aiter__(self):
        return self

    async def __anext__(self):
        item = await self._incoming.get()
        if item is StopAsyncIteration:
            raise StopAsyncIteration
        return item

    async def close(self):
        await self._incoming.put(StopAsyncIteration)


class FakeTwilioWS:
    def __init__(self):
        self.sent: list[dict] = []
        self._incoming: asyncio.Queue = asyncio.Queue()

    async def accept(self):
        pass

    async def send_text(self, text: str):
        self.sent.append(json.loads(text))

    async def push(self, obj: dict):
        await self._incoming.put(json.dumps(obj))

    async def close_input(self):
        await self._incoming.put(None)

    async def iter_text(self):
        while True:
            item = await self._incoming.get()
            if item is None:
                return
            yield item


START = {
    "event": "start",
    "start": {
        "streamSid": "MZ123", "callSid": "CA123",
        "customParameters": {"alert_id": "alr_1", "call_id": "cal_1", "role": "resident"},
    },
}


@asynccontextmanager
async def running_bridge(monkeypatch, dg: FakeDG, tw: FakeTwilioWS, hangups: list):
    fsm_stub.reset()
    monkeypatch.setattr(bridge, "SILENCE_TIMEOUT_S", 0.15)
    monkeypatch.setattr(bridge, "KEEPALIVE_INTERVAL_S", 0.05)

    @asynccontextmanager
    async def fake_connect():
        yield dg

    async def fake_hangup(call_sid):
        hangups.append(call_sid)

    monkeypatch.setattr(bridge, "dg_connect", fake_connect)
    monkeypatch.setattr(bridge, "hangup_call", fake_hangup)

    task = asyncio.create_task(bridge.twilio_stream(tw))
    try:
        yield task
    finally:
        if not task.done():
            await tw.close_input()
            await dg.close()
            try:
                await asyncio.wait_for(task, 2)
            except asyncio.TimeoutError:
                task.cancel()


async def settle(t=0.05):
    await asyncio.sleep(t)


# ---- tests ---------------------------------------------------------------------

async def test_settings_gate_and_media_both_directions(monkeypatch):
    dg, tw, hangups = FakeDG(), FakeTwilioWS(), []
    dg.auto_settings_applied = False
    async with running_bridge(monkeypatch, dg, tw, hangups):
        await tw.push(START)
        await settle()
        # Settings sent to DG on start
        settings_sent = [json.loads(s) for s in dg.sent if isinstance(s, str)]
        assert any(s.get("type") == "Settings" for s in settings_sent)
        assert json.loads([s for s in dg.sent if isinstance(s, str)][0])["audio"]["input"]["encoding"] == "mulaw"

        # media BEFORE SettingsApplied must NOT be relayed (B3.2)
        payload = base64.b64encode(b"\x7f\x00\x7f\x00").decode()
        await tw.push({"event": "media", "media": {"payload": payload}})
        await settle()
        assert not any(isinstance(s, (bytes, bytearray)) for s in dg.sent)

        # after SettingsApplied it flows — as RAW BINARY (B3.3)
        await dg.push({"type": "SettingsApplied"})
        await settle()
        await tw.push({"event": "media", "media": {"payload": payload}})
        await settle()
        binary = [s for s in dg.sent if isinstance(s, (bytes, bytearray))]
        assert binary == [b"\x7f\x00\x7f\x00"]

        # DG binary → Twilio JSON media with streamSid (B3.4, B4.2)
        await dg.push(b"\x01\x02\x03")
        await settle()
        media_out = [m for m in tw.sent if m.get("event") == "media"]
        assert media_out and media_out[0]["streamSid"] == "MZ123"
        assert base64.b64decode(media_out[0]["media"]["payload"]) == b"\x01\x02\x03"

        await tw.push({"event": "stop"})
        await settle()


async def test_barge_in_sends_clear_with_streamsid(monkeypatch):
    dg, tw, hangups = FakeDG(), FakeTwilioWS(), []
    async with running_bridge(monkeypatch, dg, tw, hangups):
        await tw.push(START)
        await settle()
        await dg.push({"type": "UserStartedSpeaking"})
        await settle()
        clears = [m for m in tw.sent if m.get("event") == "clear"]
        assert clears and clears[0]["streamSid"] == "MZ123"
        await tw.push({"event": "stop"})
        await settle()


async def test_function_call_roundtrip_and_no_silence_default(monkeypatch):
    dg, tw, hangups = FakeDG(), FakeTwilioWS(), []
    async with running_bridge(monkeypatch, dg, tw, hangups):
        await tw.push(START)
        await settle()
        await dg.push({"type": "FunctionCallRequest", "functions": [
            {"id": "f1", "name": "mark_ok", "arguments": json.dumps({"status": "fine"})},
        ]})
        await settle()
        # FSM saw it
        assert fsm_stub.TOOL_CALLS == [
            {"alert_id": "alr_1", "role": "resident", "fn": "mark_ok", "args": {"status": "fine"}}
        ]
        # FunctionCallResponse echoed with id/name/content
        resp = [json.loads(s) for s in dg.sent if isinstance(s, str)
                and json.loads(s).get("type") == "FunctionCallResponse"]
        assert resp and resp[0]["id"] == "f1" and resp[0]["name"] == "mark_ok"
        assert json.loads(resp[0]["content"]) == {"ok": True}

        await tw.push({"event": "stop"})
        await settle(0.1)
        # tool was called → NO incoherent default on close (B5.6 inverse)
        assert not any(c["args"].get("reason") == "incoherent" for c in fsm_stub.TOOL_CALLS)


async def test_close_without_tool_call_defaults_incoherent(monkeypatch):
    dg, tw, hangups = FakeDG(), FakeTwilioWS(), []
    async with running_bridge(monkeypatch, dg, tw, hangups):
        await tw.push(START)
        await settle()
        await tw.push({"event": "stop"})
        await settle(0.1)
    escalates = [c for c in fsm_stub.TOOL_CALLS if c["fn"] == "escalate"]
    assert escalates and escalates[0]["args"]["reason"] == "incoherent"


async def test_end_call_hangs_up_after_agent_audio_done(monkeypatch):
    monkeypatch.setenv("HANGUP_GRACE_S", "0")  # no farewell beat in tests
    dg, tw, hangups = FakeDG(), FakeTwilioWS(), []
    async with running_bridge(monkeypatch, dg, tw, hangups):
        await tw.push(START)
        await settle()
        await dg.push({"type": "FunctionCallRequest", "functions": [
            {"id": "f1", "name": "mark_ok", "arguments": json.dumps({"status": "fine"})},
            {"id": "f2", "name": "end_call", "arguments": "{}"},
        ]})
        await settle()
        assert hangups == []  # deferred: nothing until the farewell finishes
        await dg.push({"type": "AgentAudioDone"})
        await settle()
        assert hangups == ["CA123"]
        await tw.push({"event": "stop"})
        await settle()


async def test_silence_after_greeting_repeats_then_escalates(monkeypatch):
    dg, tw, hangups = FakeDG(), FakeTwilioWS(), []
    async with running_bridge(monkeypatch, dg, tw, hangups):
        await tw.push(START)
        await settle()
        await dg.push({"type": "AgentAudioDone"})  # greeting finished → timer armed
        await settle(0.2)  # first strike → InjectAgentMessage
        injects = [json.loads(s) for s in dg.sent if isinstance(s, str)
                   and json.loads(s).get("type") == "InjectAgentMessage"]
        assert len(injects) == 1
        await settle(0.2)  # second strike → escalate silence
        silence = [c for c in fsm_stub.TOOL_CALLS
                   if c["fn"] == "escalate" and c["args"]["reason"] == "silence"]
        assert len(silence) == 1
        await tw.push({"event": "stop"})
        await settle()


async def test_transcripts_appended(monkeypatch):
    dg, tw, hangups = FakeDG(), FakeTwilioWS(), []
    async with running_bridge(monkeypatch, dg, tw, hangups):
        await tw.push(START)
        await settle()
        await dg.push({"type": "ConversationText", "role": "assistant", "content": "Are you okay?"})
        await dg.push({"type": "ConversationText", "role": "user", "content": "I'm fine."})
        await settle()
        assert fsm_stub.TRANSCRIPTS["cal_1"] == [
            {"role": "assistant", "content": "Are you okay?"},
            {"role": "user", "content": "I'm fine."},
        ]
        await tw.push({"event": "stop"})
        await settle()


async def test_voicemail_advances_as_no_answer_not_incoherent(monkeypatch):
    monkeypatch.setenv("HANGUP_GRACE_S", "0")  # no farewell beat in tests
    dg, tw, hangups = FakeDG(), FakeTwilioWS(), []
    async with running_bridge(monkeypatch, dg, tw, hangups):
        await tw.push(START)
        await settle()
        # AMD verdict lands over HTTP while the stream is live
        sess = bridge.SESSIONS["CA123"]
        assert sess.ctx["alert_id"] == "alr_1"

        class FakeReq:
            async def form(self):
                return {"CallSid": "CA123", "AnsweredBy": "machine_end_beep"}

        await bridge.twilio_amd(FakeReq())
        await settle()
        # voicemail script injected, classification set, FSM advanced as no_answer (B6.4)
        injects = [json.loads(s) for s in dg.sent if isinstance(s, str)
                   and json.loads(s).get("type") == "InjectAgentMessage"]
        assert injects and "Dhyaan" in injects[0]["message"]
        assert fsm_stub.CALL_CLASSIFICATIONS["cal_1"] == "voicemail"
        assert fsm_stub.ALERT_STATES["alr_1"] == "advance_as_no_answer"
        # after the script finishes, hang up (B6 step 3)
        await dg.push({"type": "AgentAudioDone"})
        await settle()
        assert hangups == ["CA123"]
        await tw.push({"event": "stop"})
        await settle(0.1)
    # and NO incoherent default fired on close (voicemail already advanced)
    assert not any(c["args"].get("reason") == "incoherent" for c in fsm_stub.TOOL_CALLS)


async def test_amd_unknown_treated_as_human(monkeypatch):
    dg, tw, hangups = FakeDG(), FakeTwilioWS(), []
    async with running_bridge(monkeypatch, dg, tw, hangups):
        await tw.push(START)
        await settle()

        class FakeReq:
            async def form(self):
                return {"CallSid": "CA123", "AnsweredBy": "unknown"}

        res = await bridge.twilio_amd(FakeReq())
        assert res["answered_by"] == "unknown"
        await settle()
        # no voicemail injection, no hangup, session untouched (B6.5)
        assert not any(isinstance(s, str) and json.loads(s).get("type") == "InjectAgentMessage"
                       for s in dg.sent)
        assert bridge.SESSIONS["CA123"].classification is None
        await tw.push({"event": "stop"})
        await settle()


async def test_retry_exactly_once(monkeypatch):
    from dhyaan.voice.outbound import retry_or_escalate

    placed, exhausted = [], []

    async def place(attempt):
        placed.append(attempt)

    async def on_exhausted():
        exhausted.append(True)

    # attempt 1 no-answer → one retry
    r1 = await retry_or_escalate(status="no-answer", attempt=1, place=place,
                                 on_exhausted=on_exhausted, delay_s=0.01)
    assert r1 == "retried" and placed == [2] and not exhausted
    # attempt 2 also fails → escalate, no third attempt
    r2 = await retry_or_escalate(status="busy", attempt=2, place=place,
                                 on_exhausted=on_exhausted, delay_s=0.01)
    assert r2 == "escalated" and placed == [2] and exhausted == [True]
    # completed → nothing
    r3 = await retry_or_escalate(status="completed", attempt=1, place=place,
                                 on_exhausted=on_exhausted, delay_s=0.01)
    assert r3 == "no_action" and placed == [2]


async def test_idempotent_tool_calls(monkeypatch):
    fsm_stub.reset()
    a = await fsm_stub.handle_voice_tool("alr_9", "resident", "escalate", {"reason": "distress"})
    b = await fsm_stub.handle_voice_tool("alr_9", "resident", "escalate", {"reason": "distress"})
    assert a == b == {"ok": True}
    assert len(fsm_stub.TOOL_CALLS) == 1  # no double-fire (B5.4)


async def test_settings_shape():
    s = build_settings({"role": "resident", "alert_id": "a", "call_id": "c"})
    assert s["audio"] == {
        "input": {"encoding": "mulaw", "sample_rate": 8000},
        "output": {"encoding": "mulaw", "sample_rate": 8000, "container": "none"},
    }
    fns = s["agent"]["think"]["functions"]
    assert [f["name"] for f in fns] == [
        "mark_ok", "escalate", "request_callback", "leave_message", "end_call",
    ]
    assert [f["name"] for f in fns if f.get("defer_until_eot")] == ["end_call"]
    contact = build_settings({"role": "contact_1"})
    assert "check on" in contact["agent"]["greeting"]
    assert "third_party" in contact["agent"]["think"]["prompt"]
