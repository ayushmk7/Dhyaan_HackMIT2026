"""RF indoor localization. TECHNICAL_PRD §7.

Three boring layers stacked so the room estimate stops flapping:
  1. weighted k-NN over RSSI fingerprints (signal space, not physical space)
  2. a discrete Bayes filter (HMM) over a room adjacency graph
  3. dwell hysteresis before we actually commit to a room change

Layers 1+2 are pure functions (`classify`, `step`) — no I/O, trivially testable.
`observe()` is the only async/impure entry point: it loads fingerprints, runs
the pure pipeline, and emits events on commit.

We do not trilaterate (§7.3) — nearest-room-with-hysteresis, not a point on a map.
"""

import math
from datetime import datetime, timezone

from .db import db
from .events import emit

# --- Tuning knobs, visible on purpose (§7.3/§7.6) ------------------------
# A real home gets surveyed; these are the demo house's numbers. Re-tune per venue.
ZONES: dict[str, dict] = {
    "bedroom":     {"adjacent": ["hallway"], "p_stay": 0.95},
    "bathroom":    {"adjacent": ["hallway"], "p_stay": 0.85},
    "hallway":     {"adjacent": ["bedroom", "bathroom", "living_room", "kitchen"], "p_stay": 0.50},
    "kitchen":     {"adjacent": ["hallway", "living_room"], "p_stay": 0.80},
    "living_room": {"adjacent": ["hallway", "kitchen", "front_door"], "p_stay": 0.90},
    "front_door":  {"adjacent": ["living_room", "OUTSIDE"], "p_stay": 0.80},
    "OUTSIDE":     {"adjacent": ["front_door"], "p_stay": 0.80},
}
# ponytail: hardcoded 6-zone demo house. A real install draws this graph in the
# onboarding UI (zones.adjacent) and loads it per-resident; swap when there is
# more than one house.

K = 3                    # k-NN neighbors, §7.3 layer 1
PENALTY_DB = 20.0        # cost of an anchor seen in one vector and not the other
EPS = 1.0                # inverse-distance weight epsilon
KNN_UNKNOWN_L = 0.35     # layer-1 confidence floor -> "garbage scan" (never a confident wrong room)

ZETA = 1e-4              # HMM teleport floor, keeps a zeroed posterior recoverable
BETA, ETA = 1.5, 0.02    # emission tempering: sharpen, then floor
COMMIT_TICKS, COMMIT_P = 2, 0.60   # dwell hysteresis: N consecutive ticks + confidence to commit
UNKNOWN_P, UNKNOWN_TICKS = 0.45, 3  # posterior floor before we give up and say "unknown"

BATHROOM_THRESHOLD_S = 900   # 15 min floor, PRD §7.6 (max(900, p95*2) — no baseline wired in yet)
# ponytail: fixed floor, not resident-specific p95 * 2 — baselines.py isn't in scope here.
# Upgrade: read this resident's bathroom-dwell p95 from `baselines` and take the max.
ZONE_DWELL_THRESHOLD_S = 1800  # generic "still here" notice for any zone, PRD §7.6 "same shape"

# ponytail: per-resident HMM state lives in a process-local dict, not Mongo. One
# FastAPI worker (see events.py), so this is the whole "location_state" table.
# Upgrade: persist to a `location_state` collection when there's >1 worker or
# state must survive a restart.
_STATE: dict[str, dict] = {}


def _scan_vector(scan: dict) -> dict[str, float]:
    """Flatten an /ingest/rf payload into one {anchor_id: rssi} dict."""
    vec: dict[str, float] = {}
    for b in scan.get("beacons", []) or []:
        key = b.get("uuid") or f"{b.get('major')}-{b.get('minor')}"
        vec[str(key)] = float(b["rssi"])
    for w in scan.get("wifi", []) or []:
        vec[str(w["bssid"])] = float(w["rssi"])
    return vec


def _distance(scan: dict[str, float], fp: dict[str, float]) -> float:
    """PRD §7.3 layer 1: Euclidean over shared anchors + a penalty for missing ones,
    normalised by the anchor union so busier vectors aren't systematically "farther"."""
    common = scan.keys() & fp.keys()
    sq = sum((scan[a] - fp[a]) ** 2 for a in common)
    sym_diff = scan.keys() ^ fp.keys()
    sq += (PENALTY_DB ** 2) * len(sym_diff)
    union = len(scan.keys() | fp.keys()) or 1
    return math.sqrt(sq / union)


def _knn_likelihood(scan: dict[str, float], fingerprints: list[dict]) -> dict[str, float]:
    """Weighted k-NN -> a likelihood over zones (not a hard label). {} if nothing to compare."""
    if not fingerprints or not scan:
        return {}
    scored = sorted(fingerprints, key=lambda fp: _distance(scan, fp["vector"]))[:K]
    if _distance(scan, scored[0]["vector"]) >= PENALTY_DB - 1e-9:
        # Not a single shared anchor with our closest fingerprint — every zone is
        # equally (un)likely, which is not evidence for any of them.
        return {}
    weights = [1.0 / (_distance(scan, fp["vector"]) + EPS) for fp in scored]
    total = sum(weights) or 1.0
    lik: dict[str, float] = {}
    for fp, w in zip(scored, weights):
        lik[fp["zone"]] = lik.get(fp["zone"], 0.0) + w / total
    return lik


def classify(scan: dict, fingerprints: list[dict]) -> tuple[str, float]:
    """Pure layer-1 classification: RSSI vector -> (zone, confidence).

    `scan` is a flat {anchor_id: rssi} dict (use `_scan_vector` to build one from
    a raw /ingest/rf payload). `fingerprints` is a flat list of
    {"zone": str, "vector": {anchor_id: rssi}}.
    """
    lik = _knn_likelihood(scan, fingerprints)
    if not lik:
        return "location_unknown", 0.0
    top = max(lik, key=lik.get)
    conf = lik[top]
    if conf < KNN_UNKNOWN_L:
        return "location_unknown", conf
    return top, conf


def _transition_p(i: str, j: str, zones: dict = ZONES) -> float:
    if i == j:
        return zones[i]["p_stay"]
    if j in zones[i]["adjacent"]:
        return (1 - zones[i]["p_stay"]) / len(zones[i]["adjacent"])
    return ZETA


def _new_state() -> dict:
    return {
        "zone_id": None, "posterior": {}, "challenger": None,
        "challenger_ticks": 0, "low_ticks": 0, "since": None,
    }


def step(state: dict, scan: dict[str, float], fingerprints: list[dict], zones: dict = ZONES) -> dict:
    """One HMM tick (§7.3 layer 2+3), pure. Returns a NEW state dict with:
    `_transition` = (from_zone, to_zone) if a room change just committed, else None
    `_unknown` = True if the filter just gave up and dropped to location_unknown
    Room changes require passing through the adjacency graph (bedroom -> hallway ->
    kitchen, never straight across) because a single scan can't buy enough posterior
    to jump zones the prior forbids.
    """
    lik = _knn_likelihood(scan, fingerprints)
    tempered = {z: lik.get(z, 0.0) ** BETA + ETA for z in zones}

    prior = state.get("posterior") or {}
    cur = state.get("zone_id")
    if not prior:
        prior = {z: (1.0 if z == cur else ZETA) for z in zones}

    bel = {j: sum(_transition_p(i, j, zones) * prior.get(i, ZETA) for i in zones) for j in zones}
    bel = {j: bel[j] * tempered[j] for j in zones}
    total = sum(bel.values()) or 1.0
    bel = {j: v / total for j, v in bel.items()}

    top = max(bel, key=bel.get)
    new = dict(state, posterior=bel, _transition=None, _unknown=False)

    if top == cur:
        new["challenger"], new["challenger_ticks"] = None, 0
    elif top == state.get("challenger"):
        new["challenger_ticks"] = state.get("challenger_ticks", 0) + 1
    else:
        new["challenger"], new["challenger_ticks"] = top, 1

    if new["challenger_ticks"] >= COMMIT_TICKS and bel[top] >= COMMIT_P:
        new["_transition"] = (cur, top)
        new["zone_id"] = top
        new["challenger"], new["challenger_ticks"] = None, 0

    if bel[top] < UNKNOWN_P:
        new["low_ticks"] = state.get("low_ticks", 0) + 1
        if new["low_ticks"] >= UNKNOWN_TICKS and new.get("zone_id") is not None:
            new["_unknown"] = True
            new["zone_id"] = None
    else:
        new["low_ticks"] = 0

    return new


async def _fingerprints_for(resident_id: str) -> list[dict]:
    docs = await db().fingerprints.find({"resident_id": resident_id}).to_list(length=1000)
    return [{"zone": d["zone"], "vector": v} for d in docs for v in d.get("vectors", [])]


async def observe(resident_id: str, scan: dict) -> dict:
    """Full path for one RF scan: classify, smooth, emit on change. Returns the
    current best-guess location for the /rf response body."""
    fingerprints = await _fingerprints_for(resident_id)
    vec = _scan_vector(scan)
    state = _STATE.get(resident_id) or _new_state()
    now = datetime.now(timezone.utc)

    new_state = step(state, vec, fingerprints)
    from_zone, to_zone = new_state.pop("_transition") or (None, None)
    went_unknown = new_state.pop("_unknown")

    if to_zone:
        if from_zone:
            dwell_s = (now - state["since"]).total_seconds() if state.get("since") else 0.0
            await emit(
                resident_id=resident_id, source="derived", type="zone_exited",
                embedding_text=f"{resident_id} left {from_zone} for {to_zone}",
                zone=from_zone, payload={"to_zone": to_zone, "dwell_s": dwell_s},
            )
        await emit(
            resident_id=resident_id, source="derived", type="zone_entered",
            embedding_text=f"{resident_id} entered {to_zone}",
            zone=to_zone, confidence=new_state["posterior"].get(to_zone, 0.0),
            payload={"from_zone": from_zone},
        )
        new_state["since"] = now
        new_state["dwell_alerted"] = False
        new_state["bathroom_alerted"] = False
    elif went_unknown:
        await emit(
            resident_id=resident_id, source="derived", type="location_unknown",
            embedding_text=f"{resident_id} location unknown", confidence=0.0,
            payload={"reason": "low_posterior", "last_zone": state.get("zone_id")},
        )
        new_state["since"] = None

    zone_id = new_state.get("zone_id")
    if zone_id and new_state.get("since"):
        dwell_s = (now - new_state["since"]).total_seconds()
        if zone_id == "bathroom" and dwell_s > BATHROOM_THRESHOLD_S and not new_state.get("bathroom_alerted"):
            new_state["bathroom_alerted"] = True
            await emit(
                resident_id=resident_id, source="derived", type="bathroom_prolonged",
                embedding_text=f"{resident_id} in bathroom {int(dwell_s)}s",
                zone="bathroom", confidence=new_state["posterior"].get("bathroom", 0.0),
                payload={"dwell_s": dwell_s, "threshold_s": BATHROOM_THRESHOLD_S},
            )
        elif dwell_s > ZONE_DWELL_THRESHOLD_S and not new_state.get("dwell_alerted"):
            new_state["dwell_alerted"] = True
            await emit(
                resident_id=resident_id, source="derived", type="zone_dwell",
                embedding_text=f"{resident_id} still in {zone_id} after {int(dwell_s)}s",
                zone=zone_id, confidence=new_state["posterior"].get(zone_id, 0.0),
                payload={"dwell_s": dwell_s, "expected_p95_s": ZONE_DWELL_THRESHOLD_S},
            )

    _STATE[resident_id] = new_state
    return {
        "zone": zone_id or "location_unknown",
        "confidence": new_state["posterior"].get(zone_id, 0.0) if zone_id else 0.0,
        "posterior": new_state["posterior"],
        "committed": to_zone is not None,
    }
