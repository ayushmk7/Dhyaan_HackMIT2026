"""The seam between Abhinav's bridge and the real FSM.

These prove the four functions `dhyaan/voice/fsm_stub.py` fakes behave the same
when backed by MongoDB — so swapping the import in the bridge is safe.
"""

import asyncio

import pytest

from app import alerts, voice_adapter
from app import config as cfg
from app.events import emit


async def _open_fall(resident_id: str) -> str:
    """Open a fall alert and let it reach CALLING_RESIDENT.

    The FSM refuses to classify a call that has not happened yet, which is
    correct — so the cancel window has to actually elapse first.
    """
    ev = await emit(resident_id=resident_id, source="band", type="fall_suspected",
                    embedding_text="Band reported a suspected fall.",
                    payload={"peak_g": 3.4})
    a = await alerts.open_alert(resident_id, ev["_id"], "fall", "critical")
    await asyncio.sleep(0.12)   # cancel window, monkeypatched to 0.05s
    return a["_id"]


@pytest.fixture(autouse=True)
def fast_timers(monkeypatch):
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 0.05)
    monkeypatch.setattr(cfg, "CONTACT_WAIT_S", 5)      # long: we assert the first hop
    monkeypatch.setattr(cfg, "EXHAUSTED_AFTER_S", 5)


async def test_mark_ok_fine_resolves_the_alert(db, resident):
    alert_id = await _open_fall(resident)
    r = await voice_adapter.handle_voice_tool(alert_id, "resident", "mark_ok",
                                              {"status": "fine", "detail": "just sat down"})
    assert r["ok"] is True
    a = await db.alerts.find_one({"_id": alert_id})
    assert a["state"] == "RESOLVED_OK"


async def test_mark_ok_fell_but_fine_still_notifies_family(db, resident):
    alert_id = await _open_fall(resident)
    await voice_adapter.handle_voice_tool(alert_id, "resident", "mark_ok",
                                          {"status": "fell_but_fine"})
    a = await db.alerts.find_one({"_id": alert_id})
    # PRD §4.4: a confirmed fall always reaches the family, at warn not critical.
    assert a["state"] != "RESOLVED_OK"


async def test_escalate_distress_moves_to_contact_1(db, resident):
    alert_id = await _open_fall(resident)
    await voice_adapter.handle_voice_tool(alert_id, "resident", "escalate",
                                          {"reason": "distress"})
    a = await db.alerts.find_one({"_id": alert_id})
    assert a["state"] == "CALLING_CONTACT_1"


async def test_tool_calls_are_idempotent(db, resident):
    """Deepgram retries and FunctionCallCancelled replay tool calls."""
    alert_id = await _open_fall(resident)
    args = {"status": "fine"}
    first = await voice_adapter.handle_voice_tool(alert_id, "resident", "mark_ok", args)
    second = await voice_adapter.handle_voice_tool(alert_id, "resident", "mark_ok", args)
    assert first == second
    # The replay must not have driven a second transition.
    n = await db.events.count_documents({"type": "voice_response_classified",
                                         "source_id": alert_id})
    assert n == 1


async def test_unknown_tool_is_reported_not_raised(db, resident):
    alert_id = await _open_fall(resident)
    r = await voice_adapter.handle_voice_tool(alert_id, "resident", "make_toast", {})
    assert r["ok"] is False


async def test_call_binding_and_transcript_persist(db):
    await voice_adapter.db_bind_call("cal_1", "CA123", "MZ456")
    await voice_adapter.append_transcript("cal_1", "agent", "Are you okay?")
    await voice_adapter.append_transcript("cal_1", "user", "I'm fine")
    c = await db.calls.find_one({"_id": "cal_1"})
    assert c["twilio_call_sid"] == "CA123"
    assert c["stream_sid"] == "MZ456"
    assert [t["content"] for t in c["transcript"]] == ["Are you okay?", "I'm fine"]


async def test_emit_event_returns_a_real_event_id(db, resident):
    eid = await voice_adapter.emit_event(resident_id=resident, type="call_placed",
                                         payload={"to": "+15551231111"})
    assert eid.startswith("evt_")
    assert await db.events.find_one({"_id": eid}) is not None


@pytest.mark.parametrize("reason,expected", [("distress", "CALLING_CONTACT_1"),
                                             ("silence", "CALLING_CONTACT_1"),
                                             ("incoherent", "CALLING_CONTACT_1")])
async def test_every_escalate_reason_escalates(db, resident, reason, expected):
    alert_id = await _open_fall(resident)
    await voice_adapter.handle_voice_tool(alert_id, "resident", "escalate", {"reason": reason})
    a = await db.alerts.find_one({"_id": alert_id})
    assert a["state"] == expected
