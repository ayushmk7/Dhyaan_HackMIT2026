"""Tests for app/location.py.

k-NN (`classify`) and the HMM (`step`) are the non-trivial logic here, so they
are tested directly as pure functions per the task brief. The one test that
needs Mongo is the fingerprint loader, which is the only impure thing here.
"""

from app.location import _fingerprints_for, _new_state, classify, step

FINGERPRINTS = [
    {"zone": "kitchen", "vector": {"bcn_kitchen": -50, "bcn_hall": -70}},
    {"zone": "kitchen", "vector": {"bcn_kitchen": -53, "bcn_hall": -72}},
    {"zone": "hallway", "vector": {"bcn_hall": -45, "bcn_kitchen": -65, "bcn_bedroom": -68}},
    {"zone": "bedroom", "vector": {"bcn_bedroom": -48, "bcn_hall": -75}},
    {"zone": "bedroom", "vector": {"bcn_bedroom": -51, "bcn_hall": -73}},
]

KITCHEN_SCAN = {"bcn_kitchen": -52, "bcn_hall": -71}
HALLWAY_SCAN = {"bcn_hall": -46, "bcn_kitchen": -66, "bcn_bedroom": -67}
BEDROOM_SCAN = {"bcn_bedroom": -49, "bcn_hall": -74}
GARBAGE_SCAN = {"totally_unseen_mac_1": -80, "totally_unseen_mac_2": -90}


def test_classify_matches_kitchen():
    zone, conf = classify(KITCHEN_SCAN, FINGERPRINTS)
    assert zone == "kitchen"
    assert conf > 0.5


def test_classify_garbage_is_unknown():
    zone, conf = classify(GARBAGE_SCAN, FINGERPRINTS)
    assert zone == "location_unknown"


def test_classify_no_fingerprints_is_unknown():
    zone, conf = classify(KITCHEN_SCAN, [])
    assert zone == "location_unknown"
    assert conf == 0.0


def _settle(state, scan, ticks=1):
    for _ in range(ticks):
        state = step(state, scan, FINGERPRINTS)
    return state


def test_hysteresis_ignores_single_spurious_reading():
    # Start committed in the kitchen with a confident posterior.
    state = dict(_new_state(), zone_id="kitchen",
                 posterior={z: 0.02 for z in ["bedroom", "bathroom", "hallway", "living_room", "front_door", "OUTSIDE"]} | {"kitchen": 0.9})

    state = _settle(state, KITCHEN_SCAN, ticks=2)
    assert state["zone_id"] == "kitchen"

    # One spurious bedroom-looking scan (bedroom isn't even adjacent to kitchen).
    state = step(state, BEDROOM_SCAN, FINGERPRINTS)
    assert state["zone_id"] == "kitchen"

    # Back to kitchen readings — should never have flipped.
    state = _settle(state, KITCHEN_SCAN, ticks=3)
    assert state["zone_id"] == "kitchen"


def test_genuine_sustained_move_commits():
    state = dict(_new_state(), zone_id="kitchen",
                 posterior={z: 0.02 for z in ["bedroom", "bathroom", "hallway", "living_room", "front_door", "OUTSIDE"]} | {"kitchen": 0.9})

    # Walks kitchen -> hallway -> bedroom, each sustained (the only legal path;
    # you cannot go bedroom<->kitchen without the hallway).
    state = _settle(state, HALLWAY_SCAN, ticks=4)
    assert state["zone_id"] == "hallway"

    state = _settle(state, BEDROOM_SCAN, ticks=4)
    assert state["zone_id"] == "bedroom"


async def test_a_fingerprint_for_an_unknown_zone_is_dropped(resident, db):
    """`step` only sums over ZONES, so a fingerprint for a zone outside the
    graph wins `classify` and can never be committed — the resident sits at
    location_unknown for as long as she stands there. Drop it at load."""
    await db.fingerprints.insert_many([
        {"resident_id": resident, "zone": "dining_room",
         "vectors": [{"bcn_dining": -50}]},
        {"resident_id": resident, "zone": "kitchen",
         "vectors": [{"bcn_kitchen": -50}]},
    ])
    fingerprints = await _fingerprints_for(resident)
    assert [f["zone"] for f in fingerprints] == ["kitchen"]
    assert classify({"bcn_dining": -51}, fingerprints)[0] == "location_unknown"
