"""Fall-alert FSM tests. TECHNICAL_PRD §4.

Timings are monkeypatched to fractions of a second so the whole ladder — cancel
window, per-contact wait, exhaustion — runs in well under a second per test.
"""

import asyncio

import pytest

from app import alerts
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


async def _call_events(db, resident_id):
    return await db.events.find({"resident_id": resident_id, "type": "call_placed"}).to_list(length=None)


async def test_cancel_inside_window_is_false_positive_no_call(db, resident, monkeypatch):
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 5)  # generous; we cancel immediately
    alert = await alerts.open_alert(resident, "evt_fake1", kind="fall", severity="critical")
    assert alert["state"] == "LOCAL_CANCEL"

    resolved = await alerts.cancel(alert["_id"], by="band_button")
    assert resolved["state"] == "CANCELLED"
    assert resolved["resolution"] == "false_positive"

    # ladder must not have started
    assert await _call_events(db, resident) == []
    # and the timer must actually be dead, not just racing
    await asyncio.sleep(0.1)
    fresh = await db.alerts.find_one({"_id": alert["_id"]})
    assert fresh["state"] == "CANCELLED"


async def test_cancel_window_expiry_calls_resident(db, resident, monkeypatch):
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 0.05)
    alert = await alerts.open_alert(resident, "evt_fake2", kind="fall", severity="critical")

    doc = await _wait_for_state(db, alert["_id"], "CALLING_RESIDENT")
    assert doc["resident_call_attempts"] == 1

    calls = await _call_events(db, resident)
    assert len(calls) == 1
    assert calls[0]["payload"]["role"] == "resident"
    assert calls[0]["payload"]["to"] == "+15551230000"


async def test_classify_okay_resolves_ok(db, resident, monkeypatch):
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 0.05)
    alert = await alerts.open_alert(resident, "evt_fake3", kind="fall", severity="critical")
    await _wait_for_state(db, alert["_id"], "CALLING_RESIDENT")

    resolved = await alerts.classify(alert["_id"], "okay")
    assert resolved["state"] == "RESOLVED_OK"
    assert resolved["resolution"] == "ok"


async def test_classify_distress_escalates_full_ladder(db, resident, monkeypatch):
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 0.05)
    monkeypatch.setattr(cfg, "CONTACT_WAIT_S", 0.05)
    monkeypatch.setattr(cfg, "EXHAUSTED_AFTER_S", 0.05)
    alert = await alerts.open_alert(resident, "evt_fake4", kind="fall", severity="critical")
    await _wait_for_state(db, alert["_id"], "CALLING_RESIDENT")

    resolved = await alerts.classify(alert["_id"], "distress")
    assert resolved["state"] == "CALLING_CONTACT_1"
    assert resolved["severity"] == "critical"

    await _wait_for_state(db, alert["_id"], "CALLING_CONTACT_2")
    await _wait_for_state(db, alert["_id"], "ESCALATED_FINAL")

    calls = await _call_events(db, resident)
    roles_to = {(c["payload"]["role"], c["payload"]["to"]) for c in calls}
    assert ("contact", "+15551231111") in roles_to  # Priya, ladder_order 1
    assert ("contact", "+15551232222") in roles_to  # Sam, ladder_order 2


async def test_classify_fell_but_fine_notifies_family_at_warn(db, resident, monkeypatch):
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 0.05)
    monkeypatch.setattr(cfg, "CONTACT_WAIT_S", 5)
    alert = await alerts.open_alert(resident, "evt_fake5", kind="fall", severity="critical")
    await _wait_for_state(db, alert["_id"], "CALLING_RESIDENT")

    resolved = await alerts.classify(alert["_id"], "fell_but_fine")
    assert resolved["state"] == "CALLING_CONTACT_1"
    assert resolved["severity"] == "warn"
    assert resolved["resolution"] == "fell_ok"

    calls = await _call_events(db, resident)
    assert any(c["payload"]["role"] == "contact" for c in calls)


async def test_silence_escalates(db, resident, monkeypatch):
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 0.05)
    monkeypatch.setattr(alerts, "RESIDENT_RESPONSE_TIMEOUT_S", 0.05)
    alert = await alerts.open_alert(resident, "evt_fake6", kind="fall", severity="critical")
    await _wait_for_state(db, alert["_id"], "CALLING_RESIDENT")

    # nobody ever calls classify()
    doc = await _wait_for_state(db, alert["_id"], "CALLING_CONTACT_1")
    assert doc["severity"] == "critical"
