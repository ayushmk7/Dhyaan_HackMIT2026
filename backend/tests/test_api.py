"""Tests for app/routers/residents.py and app/routers/live.py.

Uses the shared `db` / `client` / `resident` fixtures from tests/conftest.py.
Run: .venv/bin/python -m pytest tests/test_api.py -x -q  (needs mongo on
localhost:27017 — `make mongo`).
"""

import json
from datetime import datetime, timezone

import pytest

from app.events import emit


# ---------------------------------------------------------------------------
# 2. GET /residents
# ---------------------------------------------------------------------------

async def test_list_residents_serialises_id_and_status(client, resident, db):
    await emit(
        resident_id=resident, source="derived", type="zone_entered",
        embedding_text="Eleanor entered the kitchen", zone="kitchen",
        confidence=0.9, payload={"method": "ble"},
    )

    r = await client.get("/v1/residents")
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
    r = await client.get("/v1/residents/res_eleanor")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == "res_eleanor"
    assert body["consent"] == {"camera": True, "voice": True}
    names = {c["name"] for c in body["contacts"]}
    assert names == {"Priya", "Sam"}
    assert "_id" not in body and all("_id" not in c for c in body["contacts"])


async def test_get_resident_404(client, resident):
    r = await client.get("/v1/residents/nope")
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

    r = await client.get(f"/v1/residents/{resident}/timeline")
    assert r.status_code == 200
    events = r.json()
    assert len(events) == 3
    # `/timeline` returns the family row shape (routers/camera.py::_family_item),
    # which has no `ts_epoch` — order on `ts`, which it does carry.
    stamps = [e["ts"] for e in events]
    assert stamps == sorted(stamps, reverse=True)  # newest first
    assert all("id" in e and "_id" not in e for e in events)

    r = await client.get(f"/v1/residents/{resident}/timeline?limit=1")
    assert len(r.json()) == 1

    r = await client.get(f"/v1/residents/{resident}/timeline?types=meal_observed")
    types_seen = {e["type"] for e in r.json()}
    assert types_seen == {"meal_observed"}
    assert len(r.json()) == 2

    r = await client.get(f"/v1/residents/{resident}/timeline?types=not_a_real_type")
    assert r.status_code == 422


async def test_timeline_never_ships_a_room_name(client, db, resident):
    """D-001: `/timeline` is a family surface. It used to return the raw Mongo
    doc, so `zone` rode along and `embedding_text` said "moved into the
    bathroom" in as many words — 183 of 200 seeded rows carried a room."""
    await emit(resident_id=resident, source="band", type="zone_entered",
               zone="bathroom", embedding_text="Eleanor moved into the bathroom.")
    await emit(resident_id=resident, source="camera", type="meal_observed",
               zone="kitchen", embedding_text="Eleanor ate lunch in the kitchen.")

    rows = (await client.get(f"/v1/residents/{resident}/timeline")).json()
    assert [r["type"] for r in rows] == ["meal_observed"]  # zone_entered is excluded
    assert all("zone" not in r for r in rows)
    blob = json.dumps(rows).lower()
    assert "bathroom" not in blob and "kitchen" not in blob


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
        f"/v1/alerts/{alert_id}/ack", json={"by": "con_priya", "channel": "app"},
    )
    assert r1.status_code == 200
    assert r1.json()["state"] == "ACKNOWLEDGED"

    # Acking again must not error or corrupt the alert.
    r2 = await client.post(
        f"/v1/alerts/{alert_id}/ack", json={"by": "con_priya", "channel": "app"},
    )
    assert r2.status_code == 200
    assert r2.json()["state"] == "ACKNOWLEDGED"
    assert r2.json()["id"] == alert_id


async def test_resolve_alert(client, db, resident):
    alert = await _open_alert(db, resident)
    r = await client.post(
        f"/v1/alerts/{alert['_id']}/resolve", json={"resolution": "false_positive"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["resolution"] == "false_positive"

    r = await client.get("/v1/alerts?state=open")
    assert alert["_id"] not in [a["id"] for a in r.json()]


async def test_resolving_an_alert_frees_the_resident_for_the_next_fall(client, db, resident):
    """The staff "resolve" button must not deafen us to her next fall.

    `resolve` writes MANUALLY_RESOLVED, which the FSM table doesn't model, so
    alerts.open_alert's one-fall-one-ladder dedup went on treating the resolved
    alert as live and handed it back instead of starting a ladder — for up to a
    full hour, the staleness bound. The list endpoint said "no open alerts"
    while a real fall was being swallowed.
    """
    from app import alerts

    first = await _open_alert(db, resident)
    r = await client.post(
        f"/v1/alerts/{first['_id']}/resolve", json={"resolution": "false_positive"},
    )
    assert r.status_code == 200

    alerts.stop_timers()
    second = await alerts.open_alert(
        resident_id=resident, trigger_event_id="evt_second_fall",
        kind="fall", severity="critical",
    )
    assert second["_id"] != first["_id"]

    r = await client.get("/v1/alerts?state=open")
    assert [a["id"] for a in r.json()] == [second["_id"]]


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
    )
    assert r.status_code == 200
    assert r.json()["type"] == "family_note"

    r = await client.post(
        f"/v1/residents/{resident}/notes",
        json={"text": "Checked on her at rounds", "author": "Nurse Sam", "role": "staff"},
    )
    assert r.status_code == 200
    assert r.json()["type"] == "staff_note"

    r = await client.post(
        f"/v1/residents/{resident}/notes", json={"text": "", "author": "x"},
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

    from app import db as dbmod
    from app.events import emit as _emit
    from app.main import app

    tc = TestClient(app)

    with anyio.from_thread.start_blocking_portal() as portal:
        tc.portal = portal
        try:
            portal.call(dbmod.connect, "mongodb://localhost:27017", "dhyaan_test")

            # No token on the socket any more (demo build, see app/main.py).
            with tc.websocket_connect("/v1/live?resident_id=res_ws_test") as ws:
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


# ---------------------------------------------------------------------------
# 9. One alert shape, REST and websocket
#
# These two lived apart and drifted: the socket pushed the raw Mongo doc, so it
# had no `closed_at` and no `ladder`, and the app's full-screen takeover reads
# both. Resolving an alert closed it over REST and left it stuck on the phone.
# ---------------------------------------------------------------------------

class _Socket:
    def __init__(self):
        self.sent = []

    async def send_json(self, msg):
        self.sent.append(msg)


def _listen(resident_id):
    import asyncio

    from app.routers import live

    ws = _Socket()
    live._connections[ws] = {"resident_id": resident_id, "lock": asyncio.Lock()}
    return ws


def _stop(ws):
    from app.routers import live

    live._connections.pop(ws, None)
    return [m["alert"] for m in ws.sent if m.get("t") == "alert.update"]


async def test_a_resolved_alert_closes_the_takeover_over_the_websocket(client, db, resident):
    alert = await _open_alert(db, resident)
    ws = _listen(resident)
    try:
        r = await client.post(f"/v1/alerts/{alert['_id']}/resolve",
                              json={"resolution": "false_positive"})
        assert r.status_code == 200
    finally:
        pushed = _stop(ws)

    assert pushed, "resolving an alert must push it"
    assert pushed[-1]["closed_at"], "the phone dismisses the takeover on closed_at"
    assert pushed[-1]["closed_at"] == r.json()["closed_at"], "REST and WS must not drift"


async def test_an_open_alert_is_pushed_with_a_null_closed_at(client, db, resident):
    ws = _listen(resident)
    try:
        await _open_alert(db, resident)
    finally:
        pushed = _stop(ws)
    assert pushed and pushed[-1]["closed_at"] is None


async def test_the_escalation_ladder_replays_in_order(client, db, resident):
    """TECHNICAL_PRD §4.3: replayable from `events` alone — nothing is stored
    for this, it is projected on read."""
    from app import alerts

    alert = await _open_alert(db, resident)
    ws = _listen(resident)
    try:
        await alerts.ack(alert["_id"], by="Priya", channel="app")
    finally:
        pushed = _stop(ws)

    r = await client.get(f"/v1/alerts/{alert['_id']}")
    ladder = r.json()["ladder"]
    assert [s["step"] for s in ladder] == ["suspected", "cancel_window", "acknowledged"]
    assert [s["at"] for s in ladder] == sorted(s["at"] for s in ladder)
    assert all(s["detail"] for s in ladder), "every row is a sentence the screen prints"
    assert ladder[-1]["detail"].startswith("Priya is on it")
    assert pushed[-1]["ladder"] == ladder, "REST and WS must not drift"


# ---------------------------------------------------------------------------
# The rollup trigger and the broadcast fan-out
# ---------------------------------------------------------------------------

async def test_rollup_rejects_an_unpadded_date_instead_of_500ing(client, resident):
    """"2026-9-1" used to reach baseline._day_range_utc and die there, out of a
    button the timeline screen presses. A caller's bad date is a 422."""
    r = await client.post("/v1/admin/rollup",
                          json={"resident_id": resident, "date": "2026-9-1"})
    assert r.status_code == 422, r.text


async def test_one_stalled_phone_does_not_hold_up_everyone_elses_event():
    """`events.emit()` awaits its subscribers, so `broadcast` sits on the
    fall-ingest path. Serially and without a clock, one phone on bad venue wifi
    blocked every other client's event — and the fall behind it."""
    import asyncio
    import time

    from app.routers import live

    class _Stalled:
        closed = False

        async def send_json(self, msg):
            await asyncio.sleep(5)

        async def close(self):
            self.closed = True

    class _Fine:
        def __init__(self):
            self.sent = []

        async def send_json(self, msg):
            self.sent.append(msg)

        async def close(self):
            pass

    stalled, fine = _Stalled(), _Fine()
    for ws in (stalled, fine):
        live._connections[ws] = {"resident_id": "res_eleanor", "lock": asyncio.Lock()}
    try:
        t0 = time.monotonic()
        await live.broadcast({"t": "ping"}, "res_eleanor")
        elapsed = time.monotonic() - t0
    finally:
        for ws in (stalled, fine):
            live._connections.pop(ws, None)

    assert elapsed < 3, f"broadcast waited {elapsed:.1f}s on one stalled socket"
    assert fine.sent, "the healthy socket was starved by the stalled one"
    assert stalled.closed and stalled not in live._connections
