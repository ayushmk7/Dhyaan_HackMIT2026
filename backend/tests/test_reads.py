"""Tests for the new read endpoints added to app/routers/residents.py:
baselines, summaries, location/history, and GET /events/{id}.

Uses the shared `db` / `client` / `resident` fixtures from tests/conftest.py.
Run: .venv/bin/python -m pytest tests/test_reads.py -x -q
"""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.events import emit
from tests.conftest import APP_HEADERS

# ---------------------------------------------------------------------------
# 1. Auth
# ---------------------------------------------------------------------------

_READ_ROUTES = [
    ("GET", "/v1/residents/res_eleanor/baselines"),
    ("GET", "/v1/residents/res_eleanor/summaries"),
    ("GET", "/v1/residents/res_eleanor/location/history?date=2026-01-01"),
    ("GET", "/v1/events/evt_x"),
]


async def test_every_read_route_401s_without_key(client, resident):
    for method, path in _READ_ROUTES:
        r = await client.request(method, path)
        assert r.status_code == 401, f"{method} {path} -> {r.status_code}, expected 401"


# ---------------------------------------------------------------------------
# 2. GET /residents/{id}/baselines
# ---------------------------------------------------------------------------

async def test_baselines_shape_units_and_cold_start_flagged(client, resident, db):
    await db.baselines.insert_many([
        {
            "resident_id": resident, "feature": "wake_time_min", "mu": 402.0, "mad": 25.0,
            "sigma": 37.0, "n_obs": 2, "lam": None, "last_value": 410.0,
            "updated_at": "2026-09-18T00:00:00+00:00", "cold_start": True,
        },
        {
            "resident_id": resident, "feature": "meal_count", "mu": 0.0, "mad": 0.0,
            "sigma": 1.0, "n_obs": 30, "lam": 2.9, "last_value": 3.0,
            "updated_at": "2026-09-18T00:00:00+00:00", "cold_start": False,
        },
    ])

    r = await client.get(f"/v1/residents/{resident}/baselines", headers=APP_HEADERS)
    assert r.status_code == 200, r.text
    rows = {row["feature"]: row for row in r.json()}

    wake = rows["wake_time_min"]
    assert wake["cold_start"] is True  # flagged, not hidden
    assert wake["unit"] == "min"
    assert wake["direction"] == "high"
    assert wake["n_obs"] == 2

    meals = rows["meal_count"]
    assert meals["cold_start"] is False
    assert meals["unit"] == "count"
    assert meals["direction"] == "low"
    assert meals["lam"] == 2.9


async def test_baselines_unknown_resident_404s(client, resident):
    r = await client.get("/v1/residents/res_ghost/baselines", headers=APP_HEADERS)
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# 3. GET /residents/{id}/summaries
# ---------------------------------------------------------------------------

async def test_summaries_pairs_narrative_with_deviations(client, resident, db):
    date_local = "2026-09-18"
    await emit(
        resident_id=resident, source="derived", type="daily_summary",
        embedding_text="Quiet day.",
        payload={"narrative": "Eleanor had a quiet day, ate breakfast and lunch.", "date_local": date_local},
    )
    await emit(
        resident_id=resident, source="derived", type="baseline_deviation",
        embedding_text="Woke up unusually late today.",
        payload={"feature": "wake_time_min", "severity": "warn", "date_local": date_local, "value": 500},
    )

    r = await client.get(f"/v1/residents/{resident}/summaries?days=7", headers=APP_HEADERS)
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body) == 1
    day = body[0]
    assert day["date"] == date_local
    assert "quiet day" in day["narrative"]
    assert len(day["deviations"]) == 1
    dev = day["deviations"][0]
    assert dev["feature"] == "wake_time_min"
    assert dev["severity"] == "warn"
    assert "unusually late" in dev["text"]


async def test_summaries_unknown_resident_404s(client, resident):
    r = await client.get("/v1/residents/res_ghost/summaries", headers=APP_HEADERS)
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# 4. GET /residents/{id}/location/history
# ---------------------------------------------------------------------------

async def test_location_history_segments_and_open_final_runs_to_now(client, resident, db):
    now = datetime.now(timezone.utc)
    t_enter_kitchen = now - timedelta(minutes=30)
    t_exit_kitchen = now - timedelta(minutes=20)
    t_enter_hallway = t_exit_kitchen + timedelta(seconds=1)

    await emit(
        resident_id=resident, source="derived", type="zone_entered",
        embedding_text="entered kitchen", zone="kitchen", ts=t_enter_kitchen,
        confidence=0.9, payload={"from_zone": None},
    )
    await emit(
        resident_id=resident, source="derived", type="zone_exited",
        embedding_text="left kitchen", zone="kitchen", ts=t_exit_kitchen,
        payload={"to_zone": "hallway", "dwell_s": 600},
    )
    await emit(
        resident_id=resident, source="derived", type="zone_entered",
        embedding_text="entered hallway", zone="hallway", ts=t_enter_hallway,
        confidence=0.8, payload={"from_zone": "kitchen"},
    )

    tz = ZoneInfo("America/New_York")
    date_local = datetime.now(tz).date().isoformat()
    r = await client.get(
        f"/v1/residents/{resident}/location/history?date={date_local}", headers=APP_HEADERS,
    )
    assert r.status_code == 200, r.text
    segments = r.json()
    assert len(segments) == 2

    kitchen_seg = segments[0]
    assert kitchen_seg["zone"] == "kitchen"
    assert abs(kitchen_seg["seconds"] - 600) <= 5

    hallway_seg = segments[1]
    assert hallway_seg["zone"] == "hallway"
    assert hallway_seg["to"] is not None
    # Open final segment ran to "now" (~20 min), not zero.
    assert hallway_seg["seconds"] > 60


async def test_location_history_bad_date_422s(client, resident):
    r = await client.get(
        f"/v1/residents/{resident}/location/history?date=not-a-date", headers=APP_HEADERS,
    )
    assert r.status_code == 422


async def test_location_history_unknown_resident_404s(client, resident):
    r = await client.get(
        "/v1/residents/res_ghost/location/history?date=2026-01-01", headers=APP_HEADERS,
    )
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# 5. GET /events/{event_id}
# ---------------------------------------------------------------------------

async def test_get_event_by_id(client, resident):
    doc = await emit(
        resident_id=resident, source="manual", type="staff_note",
        embedding_text="Checked in, all fine.", payload={"author": "Nurse Joy", "role": "staff"},
    )
    r = await client.get(f"/v1/events/{doc['_id']}", headers=APP_HEADERS)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == doc["_id"]
    assert "_id" not in body
    assert body["type"] == "staff_note"


async def test_get_event_unknown_404s(client, resident):
    r = await client.get("/v1/events/evt_does_not_exist", headers=APP_HEADERS)
    assert r.status_code == 404
