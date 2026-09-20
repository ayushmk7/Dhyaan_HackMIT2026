"""The camera ingest lane: consent gates, dedup, presence, the family filter.

Everything here goes through the real HTTP surface with the real fixtures, so a
passing test is also a passing contract check against API_CONTRACT_V3.md.
"""

import json
import pathlib
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
import pytest_asyncio

from app import presence
from app.routers import camera as camera_router
from tests.conftest import APP_HEADERS, BAND_HEADERS

FIXTURES = pathlib.Path(__file__).resolve().parents[1] / "fixtures"
OBS = json.loads((FIXTURES / "camera_observation.json").read_text())
HEARTBEAT = json.loads((FIXTURES / "camera_heartbeat.json").read_text())


@pytest_asyncio.fixture
async def camera(db, resident):
    presence.reset()
    camera_router._MONITOR.clear()   # module-level by design; see MonitorIn
    await db.cameras.insert_one({
        "_id": "cam_mac_01", "resident_id": "res_eleanor", "zone": "living_room",
        "zone_hint": "Living room. Table on the left, armchair by the window.",
        "state": "watching", "paused_until": None, "paused_by": None, "presence": {},
    })
    yield "cam_mac_01"
    presence.reset()


def obs(**over):
    """The shipped fixture, but now — its frozen `ts` is hours stale, which is
    exactly what presence treats as no-longer-in-view."""
    body = dict(OBS)
    body["ts"] = datetime.now(timezone.utc).isoformat()
    body.update(over)
    return body


async def post(client, body, expect=201):
    r = await client.post("/v1/ingest/camera", headers=BAND_HEADERS, json=body)
    assert r.status_code == expect, r.text
    return r


# ---------------------------------------------------------------------------
# The fixtures are the contract
# ---------------------------------------------------------------------------

async def test_the_shipped_observation_fixture_is_accepted_as_is(client, camera, db):
    r = await post(client, OBS)
    assert r.json()["observation_id"].startswith("obs_")
    assert await db.observations.count_documents({}) == 1


async def test_the_shipped_heartbeat_fixture_is_accepted_as_is(client, camera, db):
    r = await client.post("/v1/ingest/camera/heartbeat", headers=BAND_HEADERS,
                          json=HEARTBEAT)
    assert r.status_code == 204


# ---------------------------------------------------------------------------
# Dedup: the same lunch is one event, not six
# ---------------------------------------------------------------------------

async def test_one_entering_observation_is_exactly_one_event(client, camera, db):
    """room_entry needs a single observation, so one POST must produce one event
    and a second identical POST must produce none."""
    now = datetime.now(timezone.utc)
    r1 = await post(client, obs(activity="entering", spot="doorway", ts=now.isoformat()))
    assert len(r1.json()["event_ids"]) == 1

    r2 = await post(client, obs(activity="entering", spot="doorway",
                                ts=(now + timedelta(seconds=5)).isoformat()))
    assert r2.json()["event_ids"] == []
    assert await db.events.count_documents({"type": "room_entry"}) == 1


async def test_a_run_of_eating_observations_is_one_meal(client, camera, db):
    """Six observations over half an hour are one lunch, not six."""
    start = datetime.now(timezone.utc) - timedelta(minutes=30)
    for i in range(6):
        await post(client, obs(ts=(start + timedelta(minutes=5 * i)).isoformat()))

    assert await db.events.count_documents({"type": "meal_observed"}) == 1
    ev = await db.events.find_one({"type": "meal_observed"})
    assert ev["payload"]["n_observations"] == 6
    assert ev["ts_end"] is not None
    assert await db.observations.count_documents({}) == 6  # the audit trail is kept


async def test_a_gap_longer_than_the_rule_starts_a_new_meal(client, camera, db):
    start = datetime.now(timezone.utc) - timedelta(hours=8)
    for i in (0, 3):  # breakfast
        await post(client, obs(ts=(start + timedelta(minutes=i)).isoformat()))
    later = start + timedelta(hours=5)
    for i in (0, 3):  # lunch, well past the 600 s gap
        await post(client, obs(ts=(later + timedelta(minutes=i)).isoformat()))
    assert await db.events.count_documents({"type": "meal_observed"}) == 2


async def test_one_eating_observation_alone_is_not_a_meal(client, camera, db):
    """MIN_OBS is 2 for a reason: one frame of a plate is not a meal."""
    await post(client, obs())
    assert await db.events.count_documents({"type": "meal_observed"}) == 0


async def test_the_sweeper_closes_an_episode_nobody_ended(client, camera, db):
    """Nobody sends an observation when she simply stops eating."""
    start = datetime.now(timezone.utc) - timedelta(hours=2)
    for i in (0, 4):
        await post(client, obs(ts=(start + timedelta(minutes=i)).isoformat()))
    assert await db.events.count_documents({"type": "meal_observed"}) == 1
    await presence.close_stale()
    assert presence._OPEN == {}


# ---------------------------------------------------------------------------
# Consent. Never simplified away.
# ---------------------------------------------------------------------------

async def test_consent_off_refuses_the_ingest_and_writes_nothing(client, camera, db):
    await db.residents.update_one({"_id": "res_eleanor"}, {"$set": {"consent_camera": 0}})
    await post(client, obs(), expect=403)
    assert await db.observations.count_documents({}) == 0
    assert await db.events.count_documents({"source": "camera"}) == 0


async def test_paused_camera_refuses_the_ingest_and_writes_nothing(client, camera, db):
    until = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    await db.cameras.update_one({"_id": camera}, {"$set": {"paused_until": until}})
    await post(client, obs(), expect=403)
    assert await db.observations.count_documents({}) == 0


async def test_an_expired_pause_no_longer_blocks(client, camera, db):
    until = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    await db.cameras.update_one({"_id": camera}, {"$set": {"paused_until": until}})
    await post(client, obs())


async def test_unknown_camera_is_404_not_autocreated(client, resident, db):
    await post(client, obs(camera_id="cam_rogue"), expect=404)
    assert await db.cameras.count_documents({}) == 0


async def test_bad_enum_is_422(client, camera):
    await post(client, obs(activity="cooking_meth"), expect=422)
    await post(client, obs(spot="bedroom"), expect=422)


async def test_device_key_is_required(client, camera):
    r = await client.post("/v1/ingest/camera", json=obs())
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# Presence
# ---------------------------------------------------------------------------

async def test_presence_never_leaks_a_room_or_the_evidence(client, camera, db):
    await post(client, obs())
    r = await client.get("/v1/residents/res_eleanor/presence", headers=APP_HEADERS)
    assert r.status_code == 200
    body = r.json()
    blob = json.dumps(body).lower()
    assert "zone" not in blob and "living" not in blob
    assert "evidence" not in blob and "fork" not in blob
    assert body["status"] == "in_view"
    assert body["sentence"].startswith("Eleanor is having something to eat")


async def test_absent_observation_flips_presence_out_of_view(client, camera, db):
    await post(client, obs())
    await post(client, obs(activity="absent", person_count=0, spot="unclear",
                           plate_or_cup_present=False, hand_to_mouth_observed=False))
    r = await client.get("/v1/residents/res_eleanor/presence", headers=APP_HEADERS)
    assert r.json()["status"] == "out_of_view"
    assert "out of view" in r.json()["sentence"]


async def test_consent_off_shows_camera_off_not_a_stale_activity(client, camera, db):
    await post(client, obs())
    await db.residents.update_one({"_id": "res_eleanor"}, {"$set": {"consent_camera": 0}})
    r = await client.get("/v1/residents/res_eleanor/presence", headers=APP_HEADERS)
    assert r.json()["status"] == "camera_off"
    assert r.json()["activity"] is None


async def test_no_camera_is_its_own_state(client, resident):
    r = await client.get("/v1/residents/res_eleanor/presence", headers=APP_HEADERS)
    assert r.json()["status"] == "no_camera"


# ---------------------------------------------------------------------------
# The family filter — asserted on the actual response body
# ---------------------------------------------------------------------------

async def test_activity_strips_room_names_from_the_response(client, camera, db, resident):
    """A seeded band/RF day carries zones and room words. Neither may survive
    the trip to the family app."""
    from app.events import emit

    now = datetime.now(timezone.utc)
    await emit(resident_id="res_eleanor", source="camera", type="meal_observed",
               ts=now, zone="kitchen", payload={"meal": "lunch"},
               embedding_text="Eleanor ate lunch in the kitchen.")
    await emit(resident_id="res_eleanor", source="band", type="zone_entered",
               ts=now, zone="bathroom", embedding_text="Eleanor moved into the bathroom.")

    date = now.astimezone(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
    r = await client.get(f"/v1/residents/res_eleanor/activity?date={date}",
                         headers=APP_HEADERS)
    assert r.status_code == 200
    blob = json.dumps(r.json()).lower()
    for word in ("kitchen", "bathroom", "bedroom", "living room", "hallway", "zone"):
        assert word not in blob, f"{word!r} reached the family app in {blob}"
    assert r.json()["tiles"]["meals"] == 1


async def test_activity_keeps_the_zone_on_the_event_for_staff(client, camera, db):
    """The filter is a family filter, not a deletion. Staff and the baseline
    learner still need the zone."""
    await post(client, obs(activity="entering", spot="doorway"))
    ev = await db.events.find_one({"type": "room_entry"})
    assert ev["zone"] == "living_room"
    assert "living" not in ev["embedding_text"].lower()


async def test_activity_items_carry_a_kind(client, camera, db):
    from app.events import emit

    now = datetime.now(timezone.utc)
    await emit(resident_id="res_eleanor", source="derived", type="daily_summary",
               ts=now, payload={"narrative": "A quiet day."},
               embedding_text="A quiet day.")
    date = now.astimezone(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
    r = await client.get(f"/v1/residents/res_eleanor/activity?date={date}",
                         headers=APP_HEADERS)
    kinds = {i["kind"] for i in r.json()["items"]}
    assert kinds == {"pattern"}


# ---------------------------------------------------------------------------
# Heartbeat, config, login, simulate
# ---------------------------------------------------------------------------

async def test_heartbeat_pause_records_who_paused_and_shows_paused(client, camera, db):
    until = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    r = await client.post("/v1/ingest/camera/heartbeat", headers=BAND_HEADERS, json={
        "camera_id": camera, "state": "paused", "paused_until": until,
        "fps": 0.0, "dropped_batches": 0})
    assert r.status_code == 204
    cam = await db.cameras.find_one({"_id": camera})
    assert cam["paused_by"] == "resident"
    p = await client.get("/v1/residents/res_eleanor/presence", headers=APP_HEADERS)
    assert p.json()["status"] == "paused"


async def test_camera_config_is_what_the_worker_needs_and_no_more(client, camera, db):
    await db.residents.update_one({"_id": "res_eleanor"}, {"$set": {
        "consent_memory": 1, "appearance": "short grey hair, glasses"}})
    r = await client.get(f"/v1/camera/config?camera_id={camera}", headers=BAND_HEADERS)
    body = r.json()
    assert body["zone"] == "living_room" and body["zone_label"] == "living room"
    assert body["consent_camera"] is True
    assert body["appearance"] == "short grey hair, glasses"
    # Facts are never sent to the VLM (§4.4) — they would bias it toward seeing
    # what the family expects.
    assert "facts" not in body


async def test_camera_config_withholds_appearance_without_memory_consent(client, camera, db):
    await db.residents.update_one({"_id": "res_eleanor"}, {"$set": {
        "consent_memory": 0, "appearance": "short grey hair"}})
    r = await client.get(f"/v1/camera/config?camera_id={camera}", headers=BAND_HEADERS)
    assert r.json()["appearance"] is None


@pytest.mark.parametrize("email,password", [
    # An email-shaped name with any password used to get in. It no longer does:
    # there is a user store now (tests/test_auth.py) and no account by that name.
    ("priya@dhyaan.demo", "anything"),
    ("not-an-email", "anything"),
    ("priya@dhyaan.demo", "   "),
    ("", ""),
])
async def test_login_rejects_anyone_not_on_file(client, resident, email, password):
    r = await client.post("/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 401


async def test_simulate_meal_goes_through_the_real_ingest_path(client, camera, db):
    r = await client.post("/v1/admin/simulate", headers=APP_HEADERS,
                          json={"resident_id": "res_eleanor", "kind": "meal"})
    assert r.status_code == 200, r.text
    assert await db.events.count_documents({"type": "meal_observed"}) == 1
    assert await db.observations.count_documents({}) == 3
    assert r.json()["presence"]["status"] == "in_view"


async def test_simulate_visitor_stores_nothing_about_the_visitor(client, camera, db):
    await client.post("/v1/admin/simulate", headers=APP_HEADERS,
                      json={"resident_id": "res_eleanor", "kind": "visitor"})
    ev = await db.events.find_one({"type": "visitor_present"})
    assert ev is not None
    assert set(ev["payload"]) == {"n_people", "n_observations"}
    assert "visitor" in ev["embedding_text"]


# ---------------------------------------------------------------------------
# The monitor channel
#
# It is family-visible by decision, not by accident: see the long comment above
# `MonitorIn` in app/routers/camera.py. These tests are what makes that decision
# hold — the allowlist, the scrub, the fail-closed check and the honest empty
# shape.
# ---------------------------------------------------------------------------

def tick(**over):
    body = {"camera_id": "cam_mac_01", "ts": datetime.now(timezone.utc).isoformat(),
            "fps": 3.1, "person_count": 1, "boxes": [[0.1, 0.2, 0.3, 0.9]],
            "gate": "person", "model": "qwen2.5vl:3b", "latency_ms": 690,
            "batch_frames": 1, "activity": "eating", "sentence": "eating at the table",
            "confidence": 0.82, "simulated": False}
    body.update(over)
    return body


async def send_tick(client, body=None, expect=204):
    r = await client.post("/v1/ingest/camera/monitor", headers=BAND_HEADERS,
                          json=body or tick())
    assert r.status_code == expect, r.text
    return r


async def get_monitor(client, camera_id="cam_mac_01"):
    r = await client.get(f"/v1/cameras/{camera_id}/monitor", headers=APP_HEADERS)
    assert r.status_code == 200, r.text
    return r.json()


async def test_a_monitor_tick_comes_back_on_the_family_route(client, camera):
    await send_tick(client)
    body = await get_monitor(client)
    assert body["online"] is True
    assert body["tick"]["person_count"] == 1
    assert body["tick"]["boxes"] == [[0.1, 0.2, 0.3, 0.9]]
    assert body["tick"]["gate"] == "person"
    assert body["camera"]["id"] == "cam_mac_01"


async def test_no_tick_is_an_honest_empty_shape_not_a_fabricated_one(client, camera):
    body = await get_monitor(client)
    assert body["tick"] is None
    assert body["online"] is False
    assert body["camera"]["state"] == "watching"   # what the doc says, not an invention


async def test_a_stale_tick_is_offline_rather_than_a_frozen_console(client, camera):
    old = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    await send_tick(client, tick(ts=old))
    body = await get_monitor(client)
    assert body["tick"] is None and body["online"] is False


async def test_the_monitor_tick_cannot_carry_zone_evidence_posture_or_movement(client, camera):
    """The allowlist, as a test. A worker that starts sending these must not be
    able to leak them by accident — `MonitorIn` does not declare them, so they
    vanish at the boundary."""
    await send_tick(client, tick(zone="living_room", evidence="A fork moves to her mouth.",
                                 posture="seated", movement="unsteady"))
    blob = json.dumps(await get_monitor(client)).lower()
    for word in ("zone", "living", "evidence", "fork", "posture", "movement", "unsteady"):
        assert word not in blob, f"{word!r} reached the family app in {blob}"


async def test_the_monitor_sentence_goes_through_the_family_filter(client, camera):
    """Prose is where a room name gets in, so the same scrub `/activity` uses
    runs here too."""
    await send_tick(client, tick(sentence="eating in the kitchen"))
    assert "kitchen" not in (await get_monitor(client))["tick"]["sentence"]


async def test_monitor_rejects_pixel_coordinates(client, camera):
    await send_tick(client, tick(boxes=[[12, 40, 300, 220]]), expect=422)
    await send_tick(client, tick(boxes=[[0.1, 0.2, 0.3]]), expect=422)
    await send_tick(client, tick(gate="recording"), expect=422)


async def test_monitor_needs_the_device_key(client, camera):
    r = await client.post("/v1/ingest/camera/monitor", json=tick())
    assert r.status_code == 401
    r = await client.get("/v1/cameras/cam_mac_01/monitor")
    assert r.status_code == 401
    r = await client.get("/v1/cameras")
    assert r.status_code == 401


async def test_monitor_fails_closed_exactly_as_the_ingest_does(client, camera, db):
    await db.residents.update_one({"_id": "res_eleanor"}, {"$set": {"consent_camera": 0}})
    await send_tick(client, expect=403)
    assert (await get_monitor(client))["tick"] is None

    await db.residents.update_one({"_id": "res_eleanor"}, {"$set": {"consent_camera": 1}})
    until = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    await db.cameras.update_one({"_id": camera}, {"$set": {"paused_until": until}})
    await send_tick(client, expect=403)
    assert (await get_monitor(client))["tick"] is None


async def test_monitor_for_an_unknown_camera_is_404_not_an_empty_console(client, camera):
    await send_tick(client, tick(camera_id="cam_rogue"), expect=404)
    r = await client.get("/v1/cameras/cam_rogue/monitor", headers=APP_HEADERS)
    assert r.status_code == 404


async def test_a_tick_is_pushed_over_the_websocket(client, camera):
    """The console updates without polling, or it is not a console."""
    import asyncio

    from app.routers import live

    sent = []

    class _Socket:
        async def send_json(self, msg):
            sent.append(msg)

    ws = _Socket()
    live._connections[ws] = {"resident_id": "res_eleanor", "lock": asyncio.Lock()}
    try:
        await send_tick(client)
    finally:
        live._connections.pop(ws, None)

    monitor = [m for m in sent if m.get("t") == "camera.monitor"]
    assert len(monitor) == 1
    assert monitor[0]["camera_id"] == "cam_mac_01"
    assert monitor[0]["boxes"] == [[0.1, 0.2, 0.3, 0.9]]
    assert "evidence" not in monitor[0]


# ---------------------------------------------------------------------------
# The camera list, and pausing
# ---------------------------------------------------------------------------

async def test_cameras_lists_what_the_console_needs(client, camera, db):
    await db.cameras.update_one({"_id": camera}, {"$set": {
        "last_heartbeat_at": datetime.now(timezone.utc).isoformat()}})
    rows = (await client.get("/v1/cameras", headers=APP_HEADERS)).json()
    assert len(rows) == 1
    row = rows[0]
    assert row["id"] == "cam_mac_01" and row["resident_id"] == "res_eleanor"
    assert row["consent"] is True and row["online"] is True and row["paused_until"] is None
    assert "zone" not in json.dumps(row).lower()


async def test_a_camera_with_a_stale_heartbeat_is_not_online(client, camera, db):
    await db.cameras.update_one({"_id": camera}, {"$set": {
        "last_heartbeat_at": (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()}})
    assert (await client.get("/v1/cameras", headers=APP_HEADERS)).json()[0]["online"] is False


async def test_pause_from_the_app_stops_the_ingest_and_resume_starts_it(client, camera, db):
    r = await client.post(f"/v1/cameras/{camera}/pause", headers=APP_HEADERS,
                          json={"hours": 2})
    assert r.status_code == 200
    assert r.json()["paused_by"] == "family"
    assert r.json()["presence"]["status"] == "paused"
    await post(client, obs(), expect=403)
    assert await db.observations.count_documents({}) == 0

    r = await client.post(f"/v1/cameras/{camera}/resume", headers=APP_HEADERS)
    assert r.status_code == 200 and r.json()["paused_until"] is None
    await post(client, obs())


async def test_the_app_cannot_undo_a_pause_she_set_on_her_own_hub(client, camera, db):
    """PRODUCT_SPEC §8.3 rule 1, as a status code."""
    until = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    r = await client.post("/v1/ingest/camera/heartbeat", headers=BAND_HEADERS, json={
        "camera_id": camera, "state": "paused", "paused_until": until,
        "fps": 0.0, "dropped_batches": 0})
    assert r.status_code == 204

    r = await client.post(f"/v1/cameras/{camera}/resume", headers=APP_HEADERS)
    assert r.status_code == 403
    cam = await db.cameras.find_one({"_id": camera})
    assert cam["paused_until"] == until


async def test_pause_and_resume_need_a_real_camera(client, camera):
    for path in (f"/v1/cameras/cam_rogue/pause", f"/v1/cameras/cam_rogue/resume"):
        r = await client.post(path, headers=APP_HEADERS, json={"hours": 1})
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# The on-stage fallback, all three kinds
# ---------------------------------------------------------------------------

async def test_simulate_out_of_view_flips_presence_and_writes_one_exit(client, camera, db):
    await client.post("/v1/admin/simulate", headers=APP_HEADERS,
                      json={"resident_id": "res_eleanor", "kind": "meal"})
    r = await client.post("/v1/admin/simulate", headers=APP_HEADERS,
                          json={"resident_id": "res_eleanor", "kind": "out_of_view"})
    assert r.status_code == 200, r.text
    assert r.json()["presence"]["status"] == "out_of_view"
    # One observation, one room_exit — two a step apart would be two events.
    assert await db.events.count_documents({"type": "room_exit"}) == 1


@pytest.mark.parametrize("kind", ["meal", "visitor", "out_of_view"])
async def test_every_simulated_kind_pushes_presence_to_the_app(client, camera, kind):
    import asyncio

    from app.routers import live

    sent = []

    class _Socket:
        async def send_json(self, msg):
            sent.append(msg)

    ws = _Socket()
    live._connections[ws] = {"resident_id": "res_eleanor", "lock": asyncio.Lock()}
    try:
        r = await client.post("/v1/admin/simulate", headers=APP_HEADERS,
                              json={"resident_id": "res_eleanor", "kind": kind})
    finally:
        live._connections.pop(ws, None)
    assert r.status_code == 200, r.text
    assert [m for m in sent if m.get("t") == "presence.update"]
    assert [m for m in sent if m.get("t") == "event.new"]


async def test_simulate_needs_a_camera_before_it_can_pretend_to_be_one(client, resident):
    r = await client.post("/v1/admin/simulate", headers=APP_HEADERS,
                          json={"resident_id": "res_eleanor", "kind": "meal"})
    assert r.status_code == 422
