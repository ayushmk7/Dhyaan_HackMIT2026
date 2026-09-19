"""tests/test_simulator.py — proves the hardware simulator actually stands in
for the band, and that fixtures/*.json still match the real ingest models
(this is the test that catches the firmware contract drifting).
"""

import glob
import json
import os

from app import location as location_mod
from app.routers.ingest import BandCancelIn, BandEventIn, HeartbeatIn, RFScanIn
from tests.conftest import BAND_HEADERS

from scripts import simulate_band as sim

FIXTURE_MODELS = {
    "band_fall.json": BandEventIn,
    "band_cancel.json": BandCancelIn,
    "heartbeat.json": HeartbeatIn,
    "rf_scan.json": RFScanIn,
}

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "..", "fixtures")


def test_every_fixture_validates_against_its_model():
    """Loops over every fixture so a firmware-contract drift fails loudly here
    instead of surfacing as a 422 the first time real hardware talks to us."""
    for name, model in FIXTURE_MODELS.items():
        with open(os.path.join(FIXTURES_DIR, name)) as f:
            data = json.load(f)
        model.model_validate(data)  # raises pydantic.ValidationError on drift


def test_every_fixture_file_is_wired_to_a_model():
    """Catches the inverse drift: a new fixture nobody added to the map above."""
    on_disk = {os.path.basename(p) for p in glob.glob(os.path.join(FIXTURES_DIR, "*.json"))}
    assert on_disk == set(FIXTURE_MODELS)


async def test_fall_simulation_creates_event_and_opens_alert(client, resident, db):
    payload = sim.fall_payload(band_id="band_a3f2")
    r = await client.post("/v1/ingest/band", json=payload, headers=BAND_HEADERS)
    assert r.status_code == 201, r.text
    body = r.json()

    evt = await db.events.find_one({"_id": body["event_id"]})
    assert evt is not None
    assert evt["type"] == "fall_suspected"
    assert evt["resident_id"] == resident

    assert "alert_id" in body
    alert = await db.alerts.find_one({"_id": body["alert_id"]})
    assert alert is not None


async def test_cancel_resolves_without_a_call(client, resident, db):
    fall = await client.post("/v1/ingest/band", json=sim.fall_payload(band_id="band_a3f2"),
                              headers=BAND_HEADERS)
    alert_id = fall.json()["alert_id"]

    cancel = await client.post(
        "/v1/ingest/band/cancel",
        json=sim.cancel_payload(band_id="band_a3f2", alert_id=alert_id),
        headers=BAND_HEADERS,
    )
    assert cancel.status_code == 200, cancel.text
    assert cancel.json()["state"] == "CANCELLED"

    alert = await db.alerts.find_one({"_id": alert_id})
    assert alert["state"] == "CANCELLED"

    # the escalation ladder (resident call, contact call, ...) must never have started
    calls = await db.events.find({"resident_id": resident, "type": "call_placed"}).to_list(length=None)
    assert calls == []


def test_simulated_events_carry_the_simulated_flag():
    """Every payload builder marks its output so nobody demos fake data by
    accident (see HARDWARE_INTEGRATION.md "how to tell if it is real")."""
    assert sim.fall_payload()["simulated"] is True
    assert sim.cancel_payload(band_id="band_a3f2", alert_id="alt_x")["simulated"] is True
    assert sim.heartbeat_payload()["simulated"] is True
    assert sim.rf_payload(zone="kitchen")["simulated"] is True
    for p in sim.walk_payloads():
        assert p["simulated"] is True


async def test_rf_simulation_produces_zone_event(client, resident, db):
    location_mod._STATE.clear()  # module-level HMM state is shared across tests

    await db.fingerprints.insert_one({
        "resident_id": resident,
        "zone": "kitchen",
        "vectors": [{"bcn-kitchen": sim.CAL["zone_rssi"]["kitchen"]}],
    })

    # dwell hysteresis (app/location.py COMMIT_TICKS=2) needs 2 consecutive
    # matching scans before it commits to a room.
    for _ in range(2):
        payload = sim.rf_payload(zone="kitchen", band_id="band_a3f2")
        r = await client.post("/v1/ingest/rf", json=payload, headers=BAND_HEADERS)
        assert r.status_code == 200, r.text

    assert r.json()["zone"] == "kitchen"
    evt = await db.events.find_one({"resident_id": resident, "type": "zone_entered"})
    assert evt is not None
    assert evt["zone"] == "kitchen"
