"""app/voice.py's stub call log. TECHNICAL_PRD §5 stand-in.

No dialogue engine here — these prove the stub writes a real `calls` row and
drives the *existing* alerts.py FSM through voice_adapter.handle_voice_tool,
the same way a real classification would. Timings are shrunk with
monkeypatch.setitem(voice.TIMINGS, ...), same spirit as the ladder timings in
tests/test_alerts.py.
"""

import asyncio

import pytest

from app import alerts, voice
from app import config as cfg


async def _wait_for_state(db, alert_id, target_states, timeout=3.0, interval=0.02):
    if isinstance(target_states, str):
        target_states = {target_states}
    elapsed = 0.0
    doc = None
    while elapsed < timeout:
        doc = await db.alerts.find_one({"_id": alert_id})
        if doc and doc["state"] in target_states:
            return doc
        await asyncio.sleep(interval)
        elapsed += interval
    raise AssertionError(
        f"alert {alert_id} did not reach {target_states} within {timeout}s, "
        f"stuck at {doc and doc['state']!r}"
    )


@pytest.fixture(autouse=True)
def fast_call_timings(monkeypatch):
    # Ring + turn gap shrunk so a whole scripted "conversation" finishes in
    # milliseconds, well inside any FSM timer used in these tests.
    monkeypatch.setitem(voice.TIMINGS, "ring_s", 0.01)
    monkeypatch.setitem(voice.TIMINGS, "turn_gap_s", 0.01)


def test_set_script_validates_and_defaults_to_no_answer():
    assert voice.SCRIPT == "no_answer"  # the honest default: silence escalates
    with pytest.raises(ValueError):
        voice.set_script("not_a_real_script")
    voice.set_script("okay")
    assert voice.SCRIPT == "okay"
    voice.set_script("no_answer")  # restore — set_script has no test-scoped undo


async def _wait_for_call(db, alert_id, timeout=3.0, interval=0.02):
    """The `calls` row is written while the FSM is transitioning, so reading it
    the instant the state flips is a race — it passes alone and fails in a full
    suite run when the loop is busier."""
    elapsed = 0.0
    while elapsed < timeout:
        call = await db.calls.find_one({"alert_id": alert_id})
        if call is not None:
            return call
        await asyncio.sleep(interval)
        elapsed += interval
    raise AssertionError(f"no calls row for {alert_id} within {timeout}s")


async def test_place_call_writes_a_simulated_calls_row(db, resident, monkeypatch):
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 0.05)
    alert = await alerts.open_alert(resident, "evt_v1", kind="fall", severity="critical")
    doc = await _wait_for_state(db, alert["_id"], "CALLING_RESIDENT")

    call = await _wait_for_call(db, alert["_id"])
    assert call is not None
    assert call["simulated"] is True
    assert call["to_e164"] == "+15551230000"
    assert call["role"] == "resident"
    assert call["call_sid"].startswith("CAstub")
    assert call["status"] in ("ringing", "no-answer")  # no_answer script, background task may have finished
    assert "started_at" in call
    assert doc["resident_call_attempts"] == 1


async def test_script_okay_resolves_alert_and_appends_transcript(db, resident, monkeypatch):
    monkeypatch.setattr(voice, "SCRIPT", "okay")
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 0.05)
    alert = await alerts.open_alert(resident, "evt_v2", kind="fall", severity="critical")
    await _wait_for_state(db, alert["_id"], "CALLING_RESIDENT")

    resolved = await _wait_for_state(db, alert["_id"], "RESOLVED_OK")
    assert resolved["resolution"] == "ok"

    call = await _wait_for_call(db, alert["_id"])
    assert call["status"] == "completed"
    transcript = call["transcript"]
    assert len(transcript) == 3
    assert all(voice.SIM_TAG in t["content"] for t in transcript)


async def test_script_distress_escalates_to_contact_1(db, resident, monkeypatch):
    monkeypatch.setattr(voice, "SCRIPT", "distress")
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 0.05)
    monkeypatch.setattr(cfg, "CONTACT_WAIT_S", 5)  # long: assert the first hop only
    alert = await alerts.open_alert(resident, "evt_v3", kind="fall", severity="critical")
    await _wait_for_state(db, alert["_id"], "CALLING_RESIDENT")

    resolved = await _wait_for_state(db, alert["_id"], "CALLING_CONTACT_1")
    assert resolved["severity"] == "critical"

    resident_call = await db.calls.find_one({"alert_id": alert["_id"], "role": "resident"})
    assert any(voice.SIM_TAG in t["content"] for t in resident_call["transcript"])


async def test_script_no_answer_default_leaves_ladder_to_escalate_itself(db, resident, monkeypatch):
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 0.05)
    monkeypatch.setattr(alerts, "RESIDENT_RESPONSE_TIMEOUT_S", 0.2)
    assert voice.SCRIPT == "no_answer"

    alert = await alerts.open_alert(resident, "evt_v4", kind="fall", severity="critical")
    await _wait_for_state(db, alert["_id"], "CALLING_RESIDENT")

    # Nobody calls alerts.classify() — the FSM's own "silence" timer must be
    # what moves this forward, not anything the stub decided.
    resolved = await _wait_for_state(db, alert["_id"], "CALLING_CONTACT_1", timeout=3.0)
    assert resolved["severity"] == "critical"

    await asyncio.sleep(0.05)  # let the stub's background task settle
    call = await db.calls.find_one({"alert_id": alert["_id"], "role": "resident"})
    assert call["simulated"] is True
    assert not call.get("transcript")  # no words nobody said


async def test_script_fell_but_fine_notifies_family_at_warn(db, resident, monkeypatch):
    monkeypatch.setattr(voice, "SCRIPT", "fell_but_fine")
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 0.05)
    monkeypatch.setattr(cfg, "CONTACT_WAIT_S", 5)
    alert = await alerts.open_alert(resident, "evt_v5", kind="fall", severity="critical")
    await _wait_for_state(db, alert["_id"], "CALLING_RESIDENT")

    resolved = await _wait_for_state(db, alert["_id"], "CALLING_CONTACT_1")
    assert resolved["severity"] == "warn"
    assert resolved["resolution"] == "fell_ok"


async def test_raising_conversation_task_does_not_break_the_alert(db, resident, monkeypatch):
    monkeypatch.setattr(voice, "SCRIPT", "okay")
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 0.05)

    async def _boom(*a, **kw):
        raise RuntimeError("simulated bridge crash")

    monkeypatch.setattr(voice.IMPL, "_run_call_inner", _boom)

    alert = await alerts.open_alert(resident, "evt_v6", kind="fall", severity="critical")
    doc = await _wait_for_state(db, alert["_id"], "CALLING_RESIDENT")
    assert doc["state"] == "CALLING_RESIDENT"

    # the crash must be swallowed, not left to explode async or wedge the alert
    await asyncio.sleep(0.1)
    fresh = await db.alerts.find_one({"_id": alert["_id"]})
    assert fresh["state"] == "CALLING_RESIDENT"  # untouched, no partial write

    call = await _wait_for_call(db, alert["_id"])
    assert call is not None
    assert call["simulated"] is True  # place_call's own write still happened
