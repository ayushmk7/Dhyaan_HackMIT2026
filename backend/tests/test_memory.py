"""The resident memory: facts, supersession, zone validation, and the delete
that has to actually delete. VLM_PLAN §4.
"""

import pytest_asyncio


FACTS = [
    {"key": "breakfast", "text": "Eleanor usually has toast and tea for breakfast at about 8."},
    {"key": "walk", "text": "She walks to the shops around 10 most mornings."},
    {"key": "visitors", "text": "Her neighbour Cheryl comes on Tuesdays."},
]


@pytest_asyncio.fixture
async def consented(db, resident):
    await db.residents.update_one({"_id": "res_eleanor"}, {"$set": {"consent_memory": 1}})
    return "res_eleanor"


async def _add(client, facts=None):
    r = await client.post("/v1/residents/res_eleanor/profile/facts",
                          json=facts or FACTS)
    assert r.status_code == 200, r.text
    return r.json()["facts"]


# ---------------------------------------------------------------------------
# Facts
# ---------------------------------------------------------------------------

async def test_facts_are_written_embedded_and_active(client, consented, db):
    facts = await _add(client)
    assert len(facts) == 3
    rows = await db.profile_facts.find({}).to_list(length=10)
    assert all(r["active"] and r["embedding"] for r in rows)
    assert all(r["source"] == "family_onboarding" for r in rows)


async def test_facts_need_memory_consent(client, resident, db):
    r = await client.post("/v1/residents/res_eleanor/profile/facts",
                          json=FACTS)
    assert r.status_code == 403
    assert await db.profile_facts.count_documents({}) == 0


async def test_fact_text_is_validated_at_the_boundary(client, consented):
    r = await client.post("/v1/residents/res_eleanor/profile/facts",
                          json=[{"key": "breakfast", "text": "x" * 301}])
    assert r.status_code == 422
    r = await client.post("/v1/residents/res_eleanor/profile/facts",
                          json=[])
    assert r.status_code == 422


async def test_control_characters_are_stripped(client, consented, db):
    await _add(client, [{"key": "note", "text": "toast\x00 and\x07 tea"}])
    row = await db.profile_facts.find_one({"key": "note"})
    assert row["text"] == "toast and tea"


async def test_a_correction_supersedes_rather_than_overwrites(client, consented, db):
    facts = await _add(client)
    old = facts[0]["id"]
    r = await client.put(f"/v1/residents/res_eleanor/profile/facts/{old}",
                         json={"text": "Breakfast is now usually porridge, not toast."})
    assert r.status_code == 200, r.text
    new = r.json()["fact"]

    old_row = await db.profile_facts.find_one({"_id": old})
    assert old_row["active"] is False
    assert old_row["superseded_by"] == new["id"]
    # The old text is still there — a correction today must not rewrite what
    # last week's answers were based on.
    assert "toast" in old_row["text"]
    assert new["supersedes"] == old
    assert new["source"] == "family_edit"
    # The change itself is in the timeline and the retrieval pool.
    assert await db.events.count_documents({"type": "profile_updated"}) == 1


async def test_delete_a_fact_deactivates_it(client, consented, db):
    facts = await _add(client)
    r = await client.delete(
        f"/v1/residents/res_eleanor/profile/facts/{facts[0]['id']}")
    assert r.status_code == 200
    assert (await db.profile_facts.find_one({"_id": facts[0]["id"]}))["active"] is False
    profile = await client.get("/v1/residents/res_eleanor/profile")
    assert len(profile.json()["facts"]) == 2


# ---------------------------------------------------------------------------
# Profile and zone validation. There is no admin override.
# ---------------------------------------------------------------------------

async def test_bedroom_and_bathroom_zones_are_refused(client, resident, db):
    for zone in ("bedroom", "bathroom"):
        r = await client.put("/v1/residents/res_eleanor/profile",
                             json={"camera": {"zone": zone, "zone_hint": "x"}})
        assert r.status_code == 422, zone
    assert await db.cameras.count_documents({}) == 0


async def test_an_allowed_zone_creates_the_camera(client, resident, db):
    r = await client.put("/v1/residents/res_eleanor/profile",
                         json={"camera": {"zone": "living_room",
                                          "zone_hint": "Table left, armchair right."}})
    assert r.status_code == 200
    assert r.json()["camera"]["zone"] == "living_room"


async def test_appearance_over_200_chars_is_refused(client, resident):
    r = await client.put("/v1/residents/res_eleanor/profile",
                         json={"appearance": "a" * 201})
    assert r.status_code == 422


async def test_consent_requires_a_stated_relationship(client, resident):
    r = await client.put("/v1/residents/res_eleanor/profile",
                         json={"consent": {"camera": True, "signed_by": "Priya",
                                           "relationship": "   "}})
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# DELETE /memory — the promise that makes the rest defensible
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def stuffed(client, consented, db):
    """A resident with facts, an appearance, usual spots, observations and
    camera events — everything the delete has to clear."""
    from app.events import emit

    await _add(client)
    await db.residents.update_one({"_id": "res_eleanor"}, {"$set": {
        "appearance": "short grey hair, glasses",
        "usual_spots": {"14": {"armchair": 22, "sofa": 3}},
    }})
    await db.observations.insert_many([
        {"_id": "obs_1", "resident_id": "res_eleanor", "activity": "eating",
         "evidence": "a plate and a fork"},
        {"_id": "obs_2", "resident_id": "res_eleanor", "activity": "sitting",
         "evidence": "seated in the armchair"},
    ])
    await emit(resident_id="res_eleanor", source="camera", type="meal_observed",
               embedding_text="Eleanor ate lunch at the table, 12:41-13:05.",
               payload={"meal": "lunch"})
    await emit(resident_id="res_eleanor", source="band", type="fall_suspected",
               embedding_text="Band reported a possible fall.")
    return "res_eleanor"


async def _forget(client, scope="all", confirm="Eleanor"):
    return await client.request(
        "DELETE", "/v1/residents/res_eleanor/memory",
        json={"scope": scope, "confirm": confirm})


async def test_forget_everything_leaves_nothing_behind(client, stuffed, db):
    r = await _forget(client)
    assert r.status_code == 200, r.text
    assert r.json()["deleted"] == {"profile_facts": 3, "observations": 2,
                                   "camera_events": 1, "usual_spots": True}

    assert await db.profile_facts.count_documents({}) == 0
    assert await db.observations.count_documents({}) == 0
    assert await db.events.count_documents({"source": "camera"}) == 0
    resident = await db.residents.find_one({"_id": "res_eleanor"})
    assert "appearance" not in resident
    assert "usual_spots" not in resident
    # The band lane is a different consent grant and is untouched.
    assert await db.events.count_documents({"type": "fall_suspected"}) == 1
    # One event records the deletion, with counts only.
    ev = await db.events.find_one({"type": "memory_deleted"})
    assert ev["payload"]["scope"] == "all"


async def test_forget_profile_keeps_the_observations(client, stuffed, db):
    await _forget(client, scope="profile")
    assert await db.profile_facts.count_documents({}) == 0
    assert await db.observations.count_documents({}) == 2
    assert await db.events.count_documents({"type": "meal_observed"}) == 1


async def test_forget_camera_keeps_the_facts(client, stuffed, db):
    await _forget(client, scope="camera")
    assert await db.profile_facts.count_documents({}) == 3
    assert await db.observations.count_documents({}) == 0
    assert await db.events.count_documents({"type": "meal_observed"}) == 0


async def test_a_mistyped_confirmation_deletes_nothing(client, stuffed, db):
    r = await _forget(client, confirm="eleanor")  # wrong case: this is irreversible
    assert r.status_code == 422
    assert await db.profile_facts.count_documents({}) == 3
    assert await db.observations.count_documents({}) == 2


async def test_withdrawing_memory_consent_forgets_the_profile(client, stuffed, db):
    r = await client.put("/v1/residents/res_eleanor/profile",
                         json={"consent": {"memory": False, "relationship": "daughter"}})
    assert r.status_code == 200
    assert await db.profile_facts.count_documents({}) == 0
    assert r.json()["appearance"] is None
    # The camera observations are a separate grant and survive.
    assert await db.observations.count_documents({}) == 2


async def test_forgetting_resets_the_family_presence(client, stuffed, db):
    await db.cameras.insert_one({"_id": "cam_mac_01", "resident_id": "res_eleanor",
                                 "zone": "living_room", "state": "watching",
                                 "presence": {"status": "in_view", "activity": "eating"}})
    await _forget(client, scope="camera")
    cam = await db.cameras.find_one({"_id": "cam_mac_01"})
    assert cam["presence"] == {}
