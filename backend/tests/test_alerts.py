"""Fall-alert FSM tests. TECHNICAL_PRD §4.

Timings are monkeypatched to fractions of a second so the whole ladder — cancel
window, per-contact wait, exhaustion — runs in well under a second per test.
"""

import asyncio
from datetime import datetime, timedelta, timezone

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


async def _call_events(db, resident_id, expect=None, timeout=3.0, interval=0.02):
    """Call events, optionally waiting for `expect` of them.

    The FSM writes the state transition and then places the call, and the stub
    emits `call_placed` from a background task — so reading immediately after the
    state flips is a race that passes alone and fails in a full suite run. Poll
    when the test knows how many it expects; read once when asserting none.
    """
    q = {"resident_id": resident_id, "type": "call_placed"}
    if expect is None:
        return await db.events.find(q).to_list(length=None)
    elapsed = 0.0
    rows = []
    while elapsed < timeout:
        rows = await db.events.find(q).to_list(length=None)
        if len(rows) >= expect:
            return rows
        await asyncio.sleep(interval)
        elapsed += interval
    return rows


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

    calls = await _call_events(db, resident, expect=1)
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


async def test_restart_rearms_an_in_flight_ladder(db, resident, monkeypatch):
    """A process restart must not strand an open alert mid-escalation.

    Timers are in-memory asyncio tasks, so `uvicorn --reload` (which fires every
    time a file is saved in development) used to leave the phone showing a live
    takeover that would never advance and never close. `start_timers()` re-arms
    from what the database already knows.
    """
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 30)  # long: it must NOT fire on its own
    alert = await alerts.open_alert(resident, "evt_restart", kind="fall", severity="critical")
    assert alert["state"] == "LOCAL_CANCEL"

    # Simulate the restart: every in-memory timer dies with the process.
    alerts.stop_timers()
    assert not [t for t in alerts._timers.values() if not t.done()]

    # It has been "28 seconds" since the window opened, so 2 remain — shortened
    # here to keep the test fast while still exercising the elapsed-time maths.
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 0.05)
    alerts.start_timers()

    # A generous window on purpose. This waits on a real asyncio timer, and in a
    # full-suite run on a loaded machine (an API and a camera worker competing
    # for the same cores) the default 3 s occasionally lost the race. A test
    # that fails under load is worse than no test, because people learn to
    # ignore it; the assertion is about the timer being re-armed at all, not
    # about how fast the box is.
    doc = await _wait_for_state(db, alert["_id"], "CALLING_RESIDENT", timeout=15.0)
    assert doc["resident_call_attempts"] == 1


async def test_restart_leaves_closed_alerts_alone(db, resident, monkeypatch):
    """Re-arming must not resurrect a ladder that already finished."""
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 5)
    alert = await alerts.open_alert(resident, "evt_restart2", kind="fall", severity="critical")
    await alerts.cancel(alert["_id"], by="band_button")

    alerts.stop_timers()
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 0.05)
    alerts.start_timers()
    await asyncio.sleep(0.2)

    fresh = await db.alerts.find_one({"_id": alert["_id"]})
    assert fresh["state"] == "CANCELLED"
    assert await _call_events(db, resident) == []


async def test_a_failing_action_does_not_strand_the_ladder(db, resident, monkeypatch):
    """The action is where the real world is, and the clock must not live inside it.

    `_schedule()` used to be the last statement of `_call_resident` /
    `_call_contact`, so anything that raised first — Twilio down, a contact row
    with no `phone_e164` — aborted the action before it armed the next rung. The
    state was already written and the timer task's `except Exception: print(...)`
    ate the error, so the alert sat in CALLING_RESIDENT forever: the app said
    "Calling her now." indefinitely and contact 2 was never dialled.
    """
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 0.05)
    monkeypatch.setattr(alerts, "RESIDENT_RESPONSE_TIMEOUT_S", 0.05)
    monkeypatch.setattr(cfg, "CONTACT_WAIT_S", 0.05)

    async def _twilio_is_down(*a, **kw):
        raise RuntimeError("twilio is down")

    monkeypatch.setattr(alerts.voice, "place_call", _twilio_is_down)

    alert = await alerts.open_alert(resident, "evt_boom", kind="fall", severity="critical")
    await _wait_for_state(db, alert["_id"], "CALLING_RESIDENT")
    # Every rung below this one is reached only if the clock survived the raise.
    await _wait_for_state(db, alert["_id"], "CALLING_CONTACT_1")
    await _wait_for_state(db, alert["_id"], "CALLING_CONTACT_2")


async def test_ack_beats_a_firing_timer_to_one_transition(db, resident, monkeypatch):
    """Two triggers, one alert, one transition.

    The firing timer pops itself from `_timers` before it applies, so an ack
    landing in that gap cancels nothing and both sides read the same state. Ack
    wrote ACKNOWLEDGED and the timer then wrote CALLING_CONTACT_1 on top of it —
    the family got dialled for an alert a human had already taken.
    """
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 5)  # long: we fire it by hand
    alert = await alerts.open_alert(resident, "evt_race", kind="fall", severity="critical")

    stale = await alerts._get(alert["_id"])   # what the timer read before ack landed
    acked = await alerts.ack(alert["_id"], by="priya", channel="app")
    assert acked["state"] == "ACKNOWLEDGED"

    async def stale_get(alert_id):
        return dict(stale)

    monkeypatch.setattr(alerts, "_get", stale_get)
    await alerts._apply(alert["_id"], "cancel_timeout")

    fresh = await db.alerts.find_one({"_id": alert["_id"]})
    assert fresh["state"] == "ACKNOWLEDGED"
    assert fresh["resident_call_attempts"] == 0
    assert await _call_events(db, resident) == []
    # The loser must not emit either: the ladder is replayed from `events`, and
    # a transition that never happened would show up in the timeline as one.
    assert await db.events.count_documents(
        {"payload.alert_id": alert["_id"], "payload.to_state": "CALLING_RESIDENT"}
    ) == 0


async def test_restart_rearms_an_alert_waiting_on_a_classification(db, resident, monkeypatch):
    """CLASSIFYING had no clock and no entry in `_pending_timer`.

    She picked up, the process restarted — which under `uvicorn --reload` is
    every file save — and `_rearm_pending` skipped the alert because the map had
    no row for the state it was in. A live fall stopped escalating in silence and
    never reached a terminal state.
    """
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 0.05)
    monkeypatch.setattr(alerts, "RESIDENT_RESPONSE_TIMEOUT_S", 30)
    monkeypatch.setattr(cfg, "CONTACT_WAIT_S", 30)
    alert = await alerts.open_alert(resident, "evt_classify", kind="fall", severity="critical")
    await _wait_for_state(db, alert["_id"], "CALLING_RESIDENT")

    await alerts._apply(alert["_id"], "connected")  # she answered; nobody classifies
    assert (await db.alerts.find_one({"_id": alert["_id"]}))["state"] == "CLASSIFYING"

    alerts.stop_timers()
    monkeypatch.setattr(alerts, "RESIDENT_RESPONSE_TIMEOUT_S", 0.05)
    alerts.start_timers()

    await _wait_for_state(db, alert["_id"], "CALLING_CONTACT_1")


async def test_a_retried_fall_reuses_the_alert_it_already_opened(db, resident, monkeypatch):
    """One fall, one ladder.

    The band retries its POST and the staff "Simulate a fall" button gets pressed
    twice. Each one used to open its own alert with its own timers, and the
    cancel carries a single alert id — so the band button stopped one ladder
    while the other went on dialling her daughter.
    """
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 5)
    first = await alerts.open_alert(resident, "evt_band1", kind="fall", severity="critical")
    second = await alerts.open_alert(resident, "evt_band2", kind="fall", severity="critical")

    assert second["_id"] == first["_id"]
    assert await db.alerts.count_documents({}) == 1
    # One ladder started, not two (the open event is the one carrying the trigger).
    assert await db.events.count_documents(
        {"type": "escalation_started", "payload.trigger_event_id": {"$exists": True}}
    ) == 1


async def test_a_stuck_alert_does_not_swallow_the_next_fall(db, resident, monkeypatch):
    """The dedup above is bounded, and the bound is the whole point.

    An alert that got stuck non-terminal — the process died between rungs, a
    state nothing drives out of — would otherwise match forever, and every later
    fall for that resident would quietly return the dead one and dial nobody.
    """
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 5)
    stuck = await alerts.open_alert(resident, "evt_old", kind="fall", severity="critical")
    alerts.stop_timers()
    await db.alerts.update_one(
        {"_id": stuck["_id"]},
        {"$set": {"opened_at": (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()}},
    )

    fresh = await alerts.open_alert(resident, "evt_new", kind="fall", severity="critical")
    assert fresh["_id"] != stuck["_id"]
    assert fresh["state"] == "LOCAL_CANCEL"


async def test_a_manually_resolved_alert_does_not_swallow_the_next_fall(db, resident, monkeypatch):
    """Staff pressed "resolve"; the next fall must still open a ladder.

    `POST /v1/alerts/{id}/resolve` writes `MANUALLY_RESOLVED`, a state the FSM
    table does not model — so the dedup below, matching on `$nin
    TERMINAL_STATES`, still counted the resolved alert as open and returned it
    instead of dialling. The staleness bound eventually let the next fall
    through, so the symptom was a fall silently swallowed for up to an hour.
    `opened_at` stays fresh here precisely so that bound cannot be what saves us.
    """
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 5)
    resolved = await alerts.open_alert(resident, "evt_first", kind="fall", severity="critical")
    alerts.stop_timers()
    now = datetime.now(timezone.utc).isoformat()
    await db.alerts.update_one(
        {"_id": resolved["_id"]},
        {"$set": {"state": "MANUALLY_RESOLVED", "resolution": "false_positive",
                  "opened_at": now, "resolved_at": now}},
    )

    fresh = await alerts.open_alert(resident, "evt_second", kind="fall", severity="critical")
    assert fresh["_id"] != resolved["_id"]
    assert fresh["state"] == "LOCAL_CANCEL"


async def test_restart_closes_an_alert_that_went_stale_instead_of_dialling(db, resident, monkeypatch):
    """A days-old open alert must not ring anyone when the process comes back.

    The remaining wait is measured from `updated_at` and anything past due fires
    on the next tick, so an alert still open from last week used to place a real
    call the moment the API restarted — at whatever hour that happened to be.
    """
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 30)
    alert = await alerts.open_alert(resident, "evt_stale", kind="fall", severity="critical")
    assert alert["state"] == "LOCAL_CANCEL"

    alerts.stop_timers()
    await db.alerts.update_one(
        {"_id": alert["_id"]},
        {"$set": {"updated_at": (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()}},
    )
    alerts.start_timers()

    doc = await _wait_for_state(db, alert["_id"], "EXHAUSTED")
    assert doc["resolution"] == "exhausted"
    assert await _call_events(db, resident) == []


async def test_one_bad_leg_does_not_stop_the_last_rung(db, resident, monkeypatch):
    """`ESCALATED_FINAL` dials every contact, so one refusal must not end the loop.

    The two `await voice.*` calls sat bare in the `for contact` loop: Twilio
    rejecting contact 1's number raised straight out of the action and contact 2
    — the person who might actually be home — was never dialled.
    """
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 0.05)
    monkeypatch.setattr(alerts, "RESIDENT_RESPONSE_TIMEOUT_S", 0.05)
    monkeypatch.setattr(cfg, "CONTACT_WAIT_S", 0.05)
    monkeypatch.setattr(cfg, "EXHAUSTED_AFTER_S", 0.05)

    dialled = []
    real_place_call = alerts.voice.place_call

    async def flaky(to_e164, role, alert_id):
        dialled.append((role, to_e164))
        if role == "contact_final" and to_e164 == "+15551231111":  # Priya, rung 1
            raise RuntimeError("twilio rejected the leg")
        return await real_place_call(to_e164, role, alert_id)

    monkeypatch.setattr(alerts.voice, "place_call", flaky)

    alert = await alerts.open_alert(resident, "evt_lastrung", kind="fall", severity="critical")
    await _wait_for_state(db, alert["_id"], "EXHAUSTED")

    assert ("contact_final", "+15551232222") in dialled  # Sam, rung 2
