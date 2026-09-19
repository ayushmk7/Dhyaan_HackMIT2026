"""Tests for app/routers/setup.py: pairing, survey, contacts, push, simulate.

Uses the shared `db` / `client` / `resident` fixtures from tests/conftest.py.
Run: .venv/bin/python -m pytest tests/test_setup.py -x -q
"""

from app.location import _fingerprints_for, classify
from tests.conftest import APP_HEADERS

# ---------------------------------------------------------------------------
# 1. Auth
# ---------------------------------------------------------------------------

# ponytail: one representative path per route, same reasoning as
# test_api.py's _APP_ROUTES — require_app_key is the same dependency on all
# of them, so this proves the wiring once, not N times.
_SETUP_ROUTES = [
    ("POST", "/v1/admin/simulate"),
    ("POST", "/v1/bands/pair"),
    ("POST", "/v1/residents/res_eleanor/survey/start"),
    ("POST", "/v1/residents/res_eleanor/survey/sample"),
    ("POST", "/v1/residents/res_eleanor/survey/stop"),
    ("PUT", "/v1/residents/res_eleanor/contacts"),
    ("POST", "/v1/push/register"),
]


async def test_every_setup_route_401s_without_key(client, resident):
    for method, path in _SETUP_ROUTES:
        r = await client.request(method, path, json=[] if method == "PUT" else {})
        assert r.status_code == 401, f"{method} {path} -> {r.status_code}, expected 401"


# ---------------------------------------------------------------------------
# 2. POST /admin/simulate
# ---------------------------------------------------------------------------

async def test_simulate_fall_opens_real_alert(client, resident, db):
    r = await client.post(
        "/v1/admin/simulate", headers=APP_HEADERS,
        json={"resident_id": resident, "kind": "fall"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["event_id"].startswith("evt_")
    assert body["alert_id"]

    ev = await db.events.find_one({"_id": body["event_id"]})
    assert ev["type"] == "fall_suspected"
    assert ev["payload"]["simulated"] is True

    r2 = await client.get("/v1/alerts?state=open", headers=APP_HEADERS)
    assert any(a["id"] == body["alert_id"] for a in r2.json())


async def test_simulate_bathroom_produces_bathroom_prolonged_no_alert(client, resident, db):
    r = await client.post(
        "/v1/admin/simulate", headers=APP_HEADERS,
        json={"resident_id": resident, "kind": "bathroom"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "alert_id" not in body or body.get("alert_id") is None
    ev = await db.events.find_one({"_id": body["event_id"]})
    assert ev["type"] == "bathroom_prolonged"
    assert ev["payload"]["simulated"] is True


async def test_simulate_walk_produces_benign_walk_completed(client, resident, db):
    r = await client.post(
        "/v1/admin/simulate", headers=APP_HEADERS,
        json={"resident_id": resident, "kind": "walk"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    ev = await db.events.find_one({"_id": body["event_id"]})
    assert ev["type"] == "walk_completed"
    assert ev["payload"]["simulated"] is True


async def test_simulate_unknown_resident_404s(client, resident):
    r = await client.post(
        "/v1/admin/simulate", headers=APP_HEADERS,
        json={"resident_id": "res_nobody", "kind": "walk"},
    )
    assert r.status_code == 404


async def test_simulate_fall_without_paired_band_422s(client, db):
    await db.residents.insert_one({"_id": "res_noband", "display_name": "No Band"})
    r = await client.post(
        "/v1/admin/simulate", headers=APP_HEADERS,
        json={"resident_id": "res_noband", "kind": "fall"},
    )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# 3. POST /bands/pair
# ---------------------------------------------------------------------------

async def test_pair_new_band_ok(client, resident, db):
    r = await client.post(
        "/v1/bands/pair", headers=APP_HEADERS,
        json={"band_id": "band_new1", "resident_id": resident},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["band"]["id"] == "band_new1"
    assert body["band"]["resident_id"] == resident


async def test_pair_taken_band_rejected_without_force(client, resident, db):
    await db.residents.insert_one({"_id": "res_other", "display_name": "Other"})
    await client.post(
        "/v1/bands/pair", headers=APP_HEADERS,
        json={"band_id": "band_shared", "resident_id": resident},
    )
    r = await client.post(
        "/v1/bands/pair", headers=APP_HEADERS,
        json={"band_id": "band_shared", "resident_id": "res_other"},
    )
    assert r.status_code == 409

    band = await db.bands.find_one({"_id": "band_shared"})
    assert band["resident_id"] == resident  # unchanged — no silent steal

    r2 = await client.post(
        "/v1/bands/pair", headers=APP_HEADERS,
        json={"band_id": "band_shared", "resident_id": "res_other", "force": True},
    )
    assert r2.status_code == 200
    band = await db.bands.find_one({"_id": "band_shared"})
    assert band["resident_id"] == "res_other"


async def test_pair_unknown_resident_404s(client, resident):
    r = await client.post(
        "/v1/bands/pair", headers=APP_HEADERS,
        json={"band_id": "band_x", "resident_id": "res_ghost"},
    )
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# 4. Survey start/sample/stop -> fingerprints
# ---------------------------------------------------------------------------

KITCHEN_SAMPLES = [
    {"beacons": [{"uuid": "bcn-kitchen", "rssi": -50}], "wifi": [{"bssid": "ap1", "rssi": -60}]},
    {"beacons": [{"uuid": "bcn-kitchen", "rssi": -52}], "wifi": [{"bssid": "ap1", "rssi": -58}]},
    {"beacons": [{"uuid": "bcn-kitchen", "rssi": -49}], "wifi": [{"bssid": "ap1", "rssi": -61}]},
]


async def test_survey_flow_stores_fingerprint_classify_reads(client, resident, db):
    r = await client.post(
        f"/v1/residents/{resident}/survey/start", headers=APP_HEADERS,
        json={"zone": "kitchen"},
    )
    assert r.status_code == 200, r.text
    survey_id = r.json()["survey_id"]
    assert r.json()["zone"] == "kitchen"

    for i, sample in enumerate(KITCHEN_SAMPLES, start=1):
        rs = await client.post(
            f"/v1/residents/{resident}/survey/sample", headers=APP_HEADERS,
            json={"survey_id": survey_id, **sample},
        )
        assert rs.status_code == 200, rs.text
        assert rs.json()["samples"] == i

    rstop = await client.post(
        f"/v1/residents/{resident}/survey/stop", headers=APP_HEADERS,
        json={"survey_id": survey_id},
    )
    assert rstop.status_code == 200, rstop.text
    assert rstop.json() == {"zone": "kitchen", "samples": 3, "stored": True}

    fp_doc = await db.fingerprints.find_one({"resident_id": resident, "zone": "kitchen"})
    assert fp_doc is not None
    assert len(fp_doc["vectors"]) == 3

    # This is the test that matters: location.classify() actually accepts the
    # shape survey/stop wrote, via the same loader observe() uses.
    fingerprints = await _fingerprints_for(resident)
    zone, conf = classify({"bcn-kitchen": -51, "ap1": -59}, fingerprints)
    assert zone == "kitchen"
    assert conf > 0.5


async def test_survey_stop_under_3_samples_rejected(client, resident):
    r = await client.post(
        f"/v1/residents/{resident}/survey/start", headers=APP_HEADERS,
        json={"zone": "bathroom"},
    )
    survey_id = r.json()["survey_id"]
    await client.post(
        f"/v1/residents/{resident}/survey/sample", headers=APP_HEADERS,
        json={"survey_id": survey_id, "beacons": [{"uuid": "bcn-bath", "rssi": -55}], "wifi": []},
    )
    rstop = await client.post(
        f"/v1/residents/{resident}/survey/stop", headers=APP_HEADERS,
        json={"survey_id": survey_id},
    )
    assert rstop.status_code == 422


async def test_survey_sample_requires_a_reading(client, resident):
    r = await client.post(
        f"/v1/residents/{resident}/survey/start", headers=APP_HEADERS,
        json={"zone": "hallway"},
    )
    survey_id = r.json()["survey_id"]
    rs = await client.post(
        f"/v1/residents/{resident}/survey/sample", headers=APP_HEADERS,
        json={"survey_id": survey_id, "beacons": [], "wifi": []},
    )
    assert rs.status_code == 422


async def test_survey_start_unknown_zone_rejected(client, resident):
    r = await client.post(
        f"/v1/residents/{resident}/survey/start", headers=APP_HEADERS,
        json={"zone": "attic"},
    )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# 5. PUT /residents/{id}/contacts
# ---------------------------------------------------------------------------

async def test_contacts_replace_renumbers_densely(client, resident, db):
    r = await client.put(
        f"/v1/residents/{resident}/contacts", headers=APP_HEADERS,
        json=[
            {"name": "Zed", "phone_e164": "+15559990000", "relationship": "neighbor", "ladder_order": 10},
            {"name": "Ann", "phone_e164": "+15559990001", "relationship": "daughter", "ladder_order": 1},
            {"name": "Bo", "phone_e164": "+15559990002", "relationship": "son", "ladder_order": 5},
        ],
    )
    assert r.status_code == 200, r.text
    contacts = r.json()["contacts"]
    orders = [c["ladder_order"] for c in contacts]
    assert orders == [1, 2, 3]
    by_order = {c["ladder_order"]: c["name"] for c in contacts}
    assert by_order[1] == "Ann"
    assert by_order[2] == "Bo"
    assert by_order[3] == "Zed"

    stored = await db.contacts.find({"resident_id": resident}).to_list(None)
    assert len(stored) == 3  # old Priya/Sam ladder fully replaced


async def test_contacts_empty_ladder_rejected(client, resident):
    r = await client.put(
        f"/v1/residents/{resident}/contacts", headers=APP_HEADERS, json=[],
    )
    assert r.status_code == 422


async def test_contacts_bad_phone_rejected(client, resident):
    r = await client.put(
        f"/v1/residents/{resident}/contacts", headers=APP_HEADERS,
        json=[{"name": "Bad", "phone_e164": "5551234", "relationship": "friend", "ladder_order": 1}],
    )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# 6. POST /push/register
# ---------------------------------------------------------------------------

async def test_push_register_is_idempotent(client, resident, db):
    for _ in range(2):
        r = await client.post(
            "/v1/push/register", headers=APP_HEADERS,
            json={"token": "tok_abc", "resident_id": resident, "role": "family"},
        )
        assert r.status_code == 200
        assert r.json() == {"ok": True}

    assert await db.push_tokens.count_documents({"_id": "tok_abc"}) == 1


async def test_push_register_unknown_resident_404s(client, resident):
    r = await client.post(
        "/v1/push/register", headers=APP_HEADERS,
        json={"token": "tok_x", "resident_id": "res_ghost", "role": "family"},
    )
    assert r.status_code == 404
