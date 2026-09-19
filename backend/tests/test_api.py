"""Tests for app/routers/residents.py and app/routers/live.py.

Uses the shared `db` / `client` / `resident` fixtures from tests/conftest.py.
Run: .venv/bin/python -m pytest tests/test_api.py -x -q  (needs mongo on
localhost:27017 — `make mongo`).
"""

from datetime import datetime, timezone

import pytest

from app.events import emit
from tests.conftest import APP_HEADERS


# ---------------------------------------------------------------------------
# 1. Auth
# ---------------------------------------------------------------------------

# ponytail: one representative path per HTTP method that exists in this file,
# not a combinatorial sweep of every route. A missing/bad key is rejected by
# the same `require_app_key` dependency for all of them, so this proves the
# wiring once rather than N times.
_APP_ROUTES = [
    ("GET", "/v1/residents"),
    ("GET", "/v1/residents/res_eleanor"),
    ("GET", "/v1/residents/res_eleanor/timeline"),
    ("GET", "/v1/residents/res_eleanor/location"),
    ("GET", "/v1/residents/res_eleanor/day"),
    ("GET", "/v1/alerts?state=open"),
    ("GET", "/v1/alerts/alt_x"),
    ("POST", "/v1/alerts/alt_x/ack"),
    ("POST", "/v1/alerts/alt_x/resolve"),
    ("POST", "/v1/alerts/alt_x/feedback"),
    ("POST", "/v1/residents/res_eleanor/notes"),
]


async def test_every_app_route_401s_without_key(client, resident):
    for method, path in _APP_ROUTES:
        r = await client.request(method, path, json={} if method == "POST" else None)
        assert r.status_code == 401, f"{method} {path} -> {r.status_code}, expected 401"


# ---------------------------------------------------------------------------
# 2. GET /residents
# ---------------------------------------------------------------------------

async def test_list_residents_serialises_id_and_status(client, resident, db):
    await emit(
        resident_id=resident, source="derived", type="zone_entered",
        embedding_text="Eleanor entered the kitchen", zone="kitchen",
        confidence=0.9, payload={"method": "ble"},
    )

    r = await client.get("/v1/residents", headers=APP_HEADERS)
    assert r.status_code == 200
    body = r.text
    assert "_id" not in body  # no raw mongo key leaks into the wire format
    assert "ObjectId" not in body

    residents = r.json()
    eleanor = next(x for x in residents if x["id"] == "res_eleanor")
    assert eleanor["display_name"] == "Eleanor"
    assert eleanor["battery_pct"] == 88
    assert eleanor["location"]["zone"] == "kitchen"
    assert eleanor["open_alert"] is None
    assert eleanor["state"] == "ok"


async def test_get_resident_detail_has_contacts_and_consent(client, resident):
    r = await client.get("/v1/residents/res_eleanor", headers=APP_HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == "res_eleanor"
    assert body["consent"] == {"camera": True, "voice": True}
    names = {c["name"] for c in body["contacts"]}
    assert names == {"Priya", "Sam"}
    assert "_id" not in body and all("_id" not in c for c in body["contacts"])


async def test_get_resident_404(client, resident):
    r = await client.get("/v1/residents/nope", headers=APP_HEADERS)
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# 3. Timeline: newest-first, limit, types
# ---------------------------------------------------------------------------

async def test_timeline_newest_first_limit_and_types(client, resident):
    for i, etype in enumerate(["meal_observed", "walk_started", "meal_observed"]):
        await emit(
            resident_id=resident, source="camera", type=etype,
            embedding_text=f"event {i}",
            ts=datetime(2026, 9, 19, 12, i, tzinfo=timezone.utc),
        )

    r = await client.get(f"/v1/residents/{resident}/timeline", headers=APP_HEADERS)
    assert r.status_code == 200
    events = r.json()
    assert len(events) == 3
    epochs = [e["ts_epoch"] for e in events]
    assert epochs == sorted(epochs, reverse=True)  # newest first
    assert all("id" in e and "_id" not in e for e in events)

    r = await client.get(f"/v1/residents/{resident}/timeline?limit=1", headers=APP_HEADERS)
    assert len(r.json()) == 1

    r = await client.get(f"/v1/residents/{resident}/timeline?types=meal_observed", headers=APP_HEADERS)
    types_seen = {e["type"] for e in r.json()}
    assert types_seen == {"meal_observed"}
    assert len(r.json()) == 2

    r = await client.get(f"/v1/residents/{resident}/timeline?types=not_a_real_type", headers=APP_HEADERS)
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# 4. Ack: flips state, idempotent
# ---------------------------------------------------------------------------

async def _open_alert(db, resident):
    pytest.importorskip("app.alerts", reason="app/alerts.py not ready yet")
    from app import alerts

    trigger = await emit(
        resident_id=resident, source="band", type="fall_suspected",
        embedding_text="Band reported a possible fall",
    )
    return await alerts.open_alert(
        resident_id=resident, trigger_event_id=trigger["_id"], kind="fall", severity="critical",
    )


async def test_ack_flips_state_and_is_idempotent(client, db, resident):
    alert = await _open_alert(db, resident)
    alert_id = alert["_id"]

    r1 = await client.post(
        f"/v1/alerts/{alert_id}/ack", json={"by": "con_priya", "channel": "app"}, headers=APP_HEADERS,
    )
    assert r1.status_code == 200
    assert r1.json()["state"] == "ACKNOWLEDGED"

    # Acking again must not error or corrupt the alert.
    r2 = await client.post(
        f"/v1/alerts/{alert_id}/ack", json={"by": "con_priya", "channel": "app"}, headers=APP_HEADERS,
    )
    assert r2.status_code == 200
    assert r2.json()["state"] == "ACKNOWLEDGED"
    assert r2.json()["id"] == alert_id


async def test_resolve_alert(client, db, resident):
    alert = await _open_alert(db, resident)
    r = await client.post(
        f"/v1/alerts/{alert['_id']}/resolve", json={"resolution": "false_positive"}, headers=APP_HEADERS,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["resolution"] == "false_positive"

    r = await client.get("/v1/alerts?state=open", headers=APP_HEADERS)
    assert alert["_id"] not in [a["id"] for a in r.json()]


# ---------------------------------------------------------------------------
# 5. Feedback: writes feedback_given event, sets review_state
# ---------------------------------------------------------------------------

async def test_feedback_writes_event_and_review_state(client, db, resident):
    trigger = await emit(
        resident_id=resident, source="derived", type="baseline_deviation",
        embedding_text="Eleanor walked 0 times today, usually 3",
    )
    await db.alerts.insert_one({
        "_id": "alt_test_feedback",
        "resident_id": resident,
        "trigger_event_id": trigger["_id"],
        "kind": "baseline_deviation",
        "severity": "warn",
        "state": "CALLING_CONTACT_1",
        "opened_at": datetime.now(timezone.utc).isoformat(),
    })

    r = await client.post(
        "/v1/alerts/alt_test_feedback/feedback",
        json={"verdict": "expected", "reason": "visiting her sister", "scope": "day"},
        headers=APP_HEADERS,
    )
    assert r.status_code == 200

    fb = await db.events.find_one({"type": "feedback_given", "resident_id": resident})
    assert fb is not None
    assert fb["payload"]["verdict"] == "expected"
    assert fb["payload"]["reason"] == "visiting her sister"

    updated_trigger = await db.events.find_one({"_id": trigger["_id"]})
    assert updated_trigger["review_state"] == "expected"


async def test_notes_write_family_and_staff_events(client, resident):
    r = await client.post(
        f"/v1/residents/{resident}/notes",
        json={"text": "Called to check in, she sounded great", "author": "Priya", "role": "family"},
        headers=APP_HEADERS,
    )
    assert r.status_code == 200
    assert r.json()["type"] == "family_note"

    r = await client.post(
        f"/v1/residents/{resident}/notes",
        json={"text": "Checked on her at rounds", "author": "Nurse Sam", "role": "staff"},
        headers=APP_HEADERS,
    )
    assert r.status_code == 200
    assert r.json()["type"] == "staff_note"

    r = await client.post(
        f"/v1/residents/{resident}/notes", json={"text": "", "author": "x"}, headers=APP_HEADERS,
    )
    assert r.status_code == 422  # empty note body is rejected, not silently accepted


# ---------------------------------------------------------------------------
# 6. Websocket: receives an event pushed after a real emit()
# ---------------------------------------------------------------------------

def test_websocket_receives_pushed_event():
    """Runs its own event loop via a manually-owned anyio portal (shared by the
    websocket connection and the `emit()` call) instead of `with TestClient(app)
    as c:`, because that form also drives app/main.py's lifespan — which starts
    app.alerts's timer wheel and would make this test depend on a module this
    file doesn't otherwise need."""
    import anyio.from_thread
    from starlette.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect

    from app import db as dbmod
    from app.config import API_KEY
    from app.events import emit as _emit
    from app.main import app

    tc = TestClient(app)

    with anyio.from_thread.start_blocking_portal() as portal:
        tc.portal = portal
        try:
            portal.call(dbmod.connect, "mongodb://localhost:27017", "dhyaan_test")

            # Bad token -> rejected with close code 1008, no data ever flows.
            with pytest.raises(WebSocketDisconnect) as exc:
                with tc.websocket_connect("/v1/live?token=wrong-key"):
                    pass
            assert exc.value.code == 1008

            with tc.websocket_connect(f"/v1/live?token={API_KEY}&resident_id=res_ws_test") as ws:
                async def do_emit():
                    return await _emit(
                        resident_id="res_ws_test", source="manual", type="staff_note",
                        embedding_text="ws push test",
                    )

                portal.call(do_emit)
                msg = ws.receive_json()
                assert msg["t"] == "event.new"
                assert msg["event"]["resident_id"] == "res_ws_test"
                assert msg["event"]["type"] == "staff_note"
                assert "id" in msg["event"]
        finally:
            portal.call(dbmod.close)
