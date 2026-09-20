"""The camera fall-confirmation guard (app/fallcheck.py).

The fixed safety design under test: the fall alert ALWAYS opens; the camera can
only cancel it inside the LOCAL_CANCEL window, on confident upright-and-moving
evidence timestamped after the trigger, and camera-absent / low-confidence /
stale evidence changes nothing at all.

Camera observations go through the real HTTP ingest lane (like test_camera.py),
so what cancels here is exactly what the worker on the hub would post.
"""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

from app import alerts, fallcheck, presence
from app import config as cfg
from app import events as eventsmod


@pytest_asyncio.fixture
async def camera(db, resident):
    presence.reset()
    await db.cameras.insert_one({
        "_id": "cam_mac_01", "resident_id": "res_eleanor", "zone": "living_room",
        "zone_hint": "Living room. Table on the left, armchair by the window.",
        "state": "watching", "paused_until": None, "paused_by": None, "presence": {},
    })
    yield "cam_mac_01"
    presence.reset()


@pytest.fixture
def guard():
    """The guard, subscribed for one test and always removed afterwards — a
    leaked subscriber would act on every later test's database."""
    fallcheck.start_fallcheck()
    yield
    fallcheck.stop_fallcheck()
    assert fallcheck._active is None
    assert not any(fn is fallcheck._on_event for fn in eventsmod._subscribers)


def walk_obs(camera_id, ts, confidence=0.9, posture="upright", activity="walking"):
    """The minimum ObservationIn body the worker's VLM lane would post."""
    return {
        "camera_id": camera_id, "resident_id": "res_eleanor", "ts": ts.isoformat(),
        "span_s": 12.0, "n_frames": 1, "person_count": 1, "activity": activity,
        "posture": posture, "movement": "normal", "spot": "unclear",
        "confidence": confidence, "evidence": "one person walking across the room",
        "model": "test",
    }


async def _post_walking_pair(client, camera, t0, **over):
    """Two walking observations — the dedup's min_obs for a walking episode —
    so the second POST emits one activity_observed event on the bus."""
    for dt in (0, 1):
        r = await client.post("/v1/ingest/camera",
                              json=walk_obs(camera, t0 + timedelta(seconds=dt), **over))
        assert r.status_code == 201, r.text
    return r


async def _wait_for_state(db, alert_id, target, timeout=3.0, interval=0.02):
    elapsed, doc = 0.0, None
    while elapsed < timeout:
        doc = await db.alerts.find_one({"_id": alert_id})
        if doc and doc["state"] == target:
            return doc
        await asyncio.sleep(interval)
        elapsed += interval
    raise AssertionError(f"alert {alert_id} stuck at {doc and doc['state']!r}, wanted {target}")


async def _audit_events(db):
    return await db.events.find({"type": "fall_autocancelled"}).to_list(length=None)


# ---------------------------------------------------------------------------
# (a) Upright + moving, confident, after the trigger -> auto-cancel, no calls.
# ---------------------------------------------------------------------------

async def test_upright_walking_during_window_autocancels_with_audit(
        client, camera, db, resident, guard, monkeypatch):
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 0.5)
    alert = await alerts.open_alert(resident, "evt_fall_a", kind="fall", severity="critical")
    assert alert["state"] == "LOCAL_CANCEL"  # the alert OPENED — nothing suppressed that

    # Evidence timestamped clearly after the trigger (beyond GUARD_S).
    t0 = datetime.now(timezone.utc) + timedelta(seconds=fallcheck.GUARD_S + 1)
    await _post_walking_pair(client, camera, t0)

    fresh = await db.alerts.find_one({"_id": alert["_id"]})
    assert fresh["state"] == "CANCELLED"
    assert fresh["resolution"] == "false_positive"

    # The FSM's own transition row says the camera did it...
    cancelled = await db.events.find({"type": "fall_cancelled"}).to_list(length=None)
    assert len(cancelled) == 1
    assert cancelled[0]["payload"]["detail"] == {"by": "camera"}

    # ...and exactly one audit event names the evidence.
    audits = await _audit_events(db)
    assert len(audits) == 1
    p = audits[0]["payload"]
    assert p["alert_id"] == alert["_id"]
    assert p["by"] == "camera"
    assert p["activity"] == "walking"
    assert p["confidence"] >= fallcheck.MIN_CONF
    assert p["observation_ids"] and audits[0]["derived_from"]
    assert p["seconds_after_trigger"] > 0

    # Let the (would-be) cancel window expire: no call may ever fire.
    await asyncio.sleep(0.7)
    assert await db.events.find({"type": "call_placed"}).to_list(length=None) == []
    fresh = await db.alerts.find_one({"_id": alert["_id"]})
    assert fresh["state"] == "CANCELLED"


# ---------------------------------------------------------------------------
# (b) Low confidence -> nothing changes.
# ---------------------------------------------------------------------------

async def test_low_confidence_walking_does_not_cancel(
        client, camera, db, resident, guard, monkeypatch):
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 5)
    alert = await alerts.open_alert(resident, "evt_fall_b", kind="fall", severity="critical")

    t0 = datetime.now(timezone.utc) + timedelta(seconds=fallcheck.GUARD_S + 1)
    await _post_walking_pair(client, camera, t0, confidence=0.55)

    fresh = await db.alerts.find_one({"_id": alert["_id"]})
    assert fresh["state"] == "LOCAL_CANCEL"  # untouched: the ladder proceeds
    assert await _audit_events(db) == []


async def test_upright_but_on_floor_activity_never_cancels(
        client, camera, db, resident, guard, monkeypatch):
    """The allowlist, not a blocklist: a confident on_floor observation is the
    opposite of refuting evidence and must change nothing."""
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 5)
    alert = await alerts.open_alert(resident, "evt_fall_b2", kind="fall", severity="critical")

    t0 = datetime.now(timezone.utc) + timedelta(seconds=fallcheck.GUARD_S + 1)
    for dt in (0, 1):
        r = await client.post("/v1/ingest/camera", json=walk_obs(
            camera, t0 + timedelta(seconds=dt), confidence=0.95,
            posture="on_floor", activity="on_floor"))
        assert r.status_code == 201, r.text

    fresh = await db.alerts.find_one({"_id": alert["_id"]})
    assert fresh["state"] == "LOCAL_CANCEL"
    assert await _audit_events(db) == []


# ---------------------------------------------------------------------------
# (c) Evidence predating the trigger -> nothing changes.
# ---------------------------------------------------------------------------

async def test_observation_predating_the_trigger_does_not_cancel(
        client, camera, db, resident, guard, monkeypatch):
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 5)
    alert = await alerts.open_alert(resident, "evt_fall_c", kind="fall", severity="critical")

    # She was walking BEFORE the fall. High confidence, upright — and stale.
    t0 = datetime.now(timezone.utc) - timedelta(seconds=60)
    await _post_walking_pair(client, camera, t0, confidence=0.95)

    fresh = await db.alerts.find_one({"_id": alert["_id"]})
    assert fresh["state"] == "LOCAL_CANCEL"
    assert await _audit_events(db) == []


# ---------------------------------------------------------------------------
# (d) No camera events at all -> the ladder proceeds untouched.
# ---------------------------------------------------------------------------

async def test_no_camera_events_alert_escalates_normally(db, resident, guard, monkeypatch):
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 0.05)
    alert = await alerts.open_alert(resident, "evt_fall_d", kind="fall", severity="critical")

    doc = await _wait_for_state(db, alert["_id"], "CALLING_RESIDENT")
    assert doc["resident_call_attempts"] == 1
    assert await _audit_events(db) == []


# ---------------------------------------------------------------------------
# (e) Alert already past LOCAL_CANCEL -> no cancel attempt, no error.
# ---------------------------------------------------------------------------

async def test_walking_after_window_closed_is_ignored(
        client, camera, db, resident, guard, monkeypatch):
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 0.05)
    alert = await alerts.open_alert(resident, "evt_fall_e", kind="fall", severity="critical")
    await _wait_for_state(db, alert["_id"], "CALLING_RESIDENT")

    t0 = datetime.now(timezone.utc) + timedelta(seconds=fallcheck.GUARD_S + 1)
    r = await _post_walking_pair(client, camera, t0, confidence=0.95)
    assert r.status_code == 201  # the ingest itself must not blow up

    fresh = await db.alerts.find_one({"_id": alert["_id"]})
    assert fresh["state"] == "CALLING_RESIDENT"  # the camera may not touch it now
    assert await _audit_events(db) == []
    assert await db.events.find({"type": "fall_cancelled"}).to_list(length=None) == []


# ---------------------------------------------------------------------------
# The no-camera rehearsal path: POST /admin/simulate {"kind": "walk"} emits a
# camera-sourced walk_completed, which qualifies at event level.
# ---------------------------------------------------------------------------

async def test_simulated_walk_event_cancels_and_is_flagged_simulated(
        db, resident, guard, monkeypatch):
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 5)
    monkeypatch.setattr(fallcheck, "GUARD_S", 0.0)
    alert = await alerts.open_alert(resident, "evt_fall_f", kind="fall", severity="critical")

    await eventsmod.emit(
        resident_id=resident, source="camera", type="walk_completed",
        embedding_text="res_eleanor completed a walk (simulated)",
        payload={"duration_s": 120, "simulated": True},
    )

    fresh = await db.alerts.find_one({"_id": alert["_id"]})
    assert fresh["state"] == "CANCELLED"
    audits = await _audit_events(db)
    assert len(audits) == 1
    assert audits[0]["payload"]["simulated"] is True
    assert audits[0]["payload"]["evidence_event_type"] == "walk_completed"
