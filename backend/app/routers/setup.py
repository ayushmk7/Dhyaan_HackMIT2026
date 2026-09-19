"""Setup / demo-control surface for the React Native app: band pairing, RF
survey capture, the contact escalation ladder, push-token registration, and
the `/admin/simulate` demo trigger. See API_CONTRACT_V2.md — paths, bodies and
response shapes there are frozen; this file implements exactly that contract.
"""

import re
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from ulid import ULID

from ..db import db
from ..deps import require_app_key
from ..events import emit
from ..location import ZONES, _scan_vector
from .ingest import BeaconReading, WifiReading

router = APIRouter(prefix="/v1", tags=["setup"], dependencies=[Depends(require_app_key)])


def _ser(doc: dict) -> dict:
    out = dict(doc)
    out["id"] = out.pop("_id")
    return out


async def _require_resident(resident_id: str) -> None:
    if not await db().residents.find_one({"_id": resident_id}, {"_id": 1}):
        raise HTTPException(404, "resident not found")


# ---------------------------------------------------------------------------
# POST /admin/simulate — the demo trigger
# ---------------------------------------------------------------------------

class SimulateIn(BaseModel):
    resident_id: str = Field(min_length=1)
    kind: Literal["fall", "bathroom", "walk", "meal", "visitor", "out_of_view"]
    # Which way the simulated check-in call goes. Without this the outcome is
    # whatever the server process was last set to, which is unusable on stage —
    # you cannot restart the backend between demo runs to show "she's fine" and
    # then "she needs help". Ignored once real telephony is installed, because
    # then a human decides by answering the phone.
    script: Literal["okay", "distress", "fell_but_fine", "no_answer", "silence"] | None = None


@router.post("/admin/simulate")
async def admin_simulate(body: SimulateIn):
    await _require_resident(body.resident_id)

    if body.script:
        from .. import voice

        voice.set_script(body.script)

    if body.kind == "fall":
        # ponytail: the demo trigger's whole job is "behave exactly like a real
        # band POST", so it calls ingest.ingest_band() in-process instead of
        # re-deriving the fall_suspected -> open_alert wiring here. That means
        # it needs a band already paired to this resident (POST /bands/pair
        # first) — a resident with no band can't originate a band event,
        # simulated or not.
        band = await db().bands.find_one({"resident_id": body.resident_id})
        if not band:
            raise HTTPException(422, "resident has no paired band — POST /bands/pair first")

        from .ingest import BandEventIn, ingest_band  # lazy: avoid import cycle at module load

        resp = await ingest_band(BandEventIn(
            simulated=True,
            band_id=band["_id"],
            type="fall_suspected",
            ts=datetime.now(timezone.utc),
            peak_g=3.4,
            free_fall_ms=95,
            post_impact_tilt_deg=72,
            stillness_ms=1800,
            battery_pct=band.get("battery_pct") or 80,
        ))
        return {"event_id": resp["event_id"], "alert_id": resp.get("alert_id")}

    if body.kind in ("meal", "visitor", "out_of_view"):
        # The on-stage fallback if the webcam misbehaves (§6.1). It posts a
        # canned observation sequence through the REAL ingest path, so the
        # dedup, the presence state, the websocket push and the app all behave
        # exactly as they would for the camera — same reason the fall branch
        # calls ingest_band() instead of re-deriving the wiring here.
        from .camera import simulate_camera  # lazy: avoid import cycle at module load

        return await simulate_camera(body.resident_id, body.kind)

    if body.kind == "bathroom":
        from ..location import BATHROOM_THRESHOLD_S  # lazy: mirrors ingest.py's own lazy-import style

        ev = await emit(
            resident_id=body.resident_id, source="derived", type="bathroom_prolonged",
            embedding_text=f"{body.resident_id} in bathroom too long (simulated)",
            zone="bathroom", confidence=0.9,
            payload={
                "dwell_s": BATHROOM_THRESHOLD_S + 60,
                "threshold_s": BATHROOM_THRESHOLD_S,
                "simulated": True,
            },
        )
        return {"event_id": ev["_id"]}

    # kind == "walk": benign, no alert. walk_completed is a camera/VLM event
    # per app/events.py's taxonomy, so it's tagged source="camera" here too.
    ev = await emit(
        resident_id=body.resident_id, source="camera", type="walk_completed",
        embedding_text=f"{body.resident_id} completed a walk (simulated)",
        payload={"duration_s": 120, "simulated": True},
    )
    return {"event_id": ev["_id"]}


# ---------------------------------------------------------------------------
# POST /bands/pair
# ---------------------------------------------------------------------------

class PairIn(BaseModel):
    band_id: str = Field(min_length=1)
    resident_id: str = Field(min_length=1)
    force: bool = False  # not in the contract's example body, but required by its own text


@router.post("/bands/pair")
async def pair_band(body: PairIn):
    await _require_resident(body.resident_id)

    d = db()
    existing = await d.bands.find_one({"_id": body.band_id})
    if existing and existing["resident_id"] != body.resident_id and not body.force:
        # Silently repairing a band to a new resident is how a fall gets
        # attributed to the wrong person — refuse unless force says otherwise.
        raise HTTPException(
            409,
            f"band {body.band_id!r} is already paired to resident "
            f"{existing['resident_id']!r}; pass force=true to repair it",
        )

    now = datetime.now(timezone.utc).isoformat()
    await d.bands.update_one(
        {"_id": body.band_id},
        {"$set": {"resident_id": body.resident_id, "paired_at": now}},
        upsert=True,
    )
    band = await d.bands.find_one({"_id": body.band_id})
    return {"ok": True, "band": _ser(band)}


# ---------------------------------------------------------------------------
# RF survey: start / sample / stop -> app/location.py's `fingerprints` store
# ---------------------------------------------------------------------------

# ponytail: process-local dict, same shortcut app/location.py's `_STATE` takes
# (one FastAPI worker). A restart mid-survey drops in-progress samples — the
# operator just re-runs start/sample, nothing durable was promised yet. Upgrade
# to a `surveys` collection if this needs to survive a restart or run behind
# more than one worker.
_SURVEYS: dict[str, dict] = {}

MIN_SURVEY_SAMPLES = 3


class SurveyStartIn(BaseModel):
    zone: str


@router.post("/residents/{resident_id}/survey/start")
async def survey_start(resident_id: str, body: SurveyStartIn):
    await _require_resident(resident_id)
    if body.zone not in ZONES:
        raise HTTPException(422, f"unknown zone {body.zone!r}; must be one of {sorted(ZONES)}")

    survey_id = f"srv_{ULID()}"
    _SURVEYS[survey_id] = {"resident_id": resident_id, "zone": body.zone, "samples": []}
    return {"survey_id": survey_id, "zone": body.zone}


class SurveySampleIn(BaseModel):
    survey_id: str = Field(min_length=1)
    beacons: list[BeaconReading] = Field(default_factory=list)
    wifi: list[WifiReading] = Field(default_factory=list)


@router.post("/residents/{resident_id}/survey/sample")
async def survey_sample(resident_id: str, body: SurveySampleIn):
    survey = _SURVEYS.get(body.survey_id)
    if not survey or survey["resident_id"] != resident_id:
        raise HTTPException(404, "unknown survey_id for this resident")
    if not body.beacons and not body.wifi:
        raise HTTPException(422, "sample must include at least one beacon or wifi reading")

    vec = _scan_vector({
        "beacons": [b.model_dump() for b in body.beacons],
        "wifi": [w.model_dump() for w in body.wifi],
    })
    survey["samples"].append(vec)
    return {"survey_id": body.survey_id, "samples": len(survey["samples"])}


class SurveyStopIn(BaseModel):
    survey_id: str = Field(min_length=1)


@router.post("/residents/{resident_id}/survey/stop")
async def survey_stop(resident_id: str, body: SurveyStopIn):
    survey = _SURVEYS.get(body.survey_id)
    if not survey or survey["resident_id"] != resident_id:
        raise HTTPException(404, "unknown survey_id for this resident")

    n = len(survey["samples"])
    if n < MIN_SURVEY_SAMPLES:
        # A 1-2 sample fingerprint is worse than none — location.classify's
        # k-NN would confidently average over almost nothing. Refuse instead
        # of writing a bad fingerprint; the survey stays open so the caller
        # can keep sampling and stop again.
        raise HTTPException(422, f"need at least {MIN_SURVEY_SAMPLES} samples, got {n}")

    now = datetime.now(timezone.utc).isoformat()
    # Shape matches exactly what location.py's `_fingerprints_for` reads:
    # one doc per (resident, zone), `vectors` a list of flat {anchor: rssi}
    # dicts. A re-survey of the same zone replaces the old vectors outright
    # rather than accumulating stale ones forever.
    await db().fingerprints.update_one(
        {"resident_id": resident_id, "zone": survey["zone"]},
        {"$set": {"vectors": survey["samples"], "updated_at": now}},
        upsert=True,
    )
    del _SURVEYS[body.survey_id]
    return {"zone": survey["zone"], "samples": n, "stored": True}


# ---------------------------------------------------------------------------
# PUT /residents/{id}/contacts — replace the whole escalation ladder
# ---------------------------------------------------------------------------

_PHONE_RE = re.compile(r"^\+\d{8,15}$")


class ContactIn(BaseModel):
    name: str = Field(min_length=1)
    phone_e164: str
    relationship: str = Field(min_length=1)
    ladder_order: int

    @field_validator("phone_e164")
    @classmethod
    def _valid_phone(cls, v: str) -> str:
        # Loose E.164 check: '+' then 8-15 digits. Not a full libphonenumber
        # validation (no new dependency for this) but enough to catch a typo'd
        # or unformatted number at the trust boundary before it's dialed.
        if not _PHONE_RE.match(v):
            raise ValueError("phone_e164 must look like +<country><number>, 8-15 digits total")
        return v


@router.put("/residents/{resident_id}/contacts")
async def replace_contacts(resident_id: str, body: list[ContactIn]):
    if not body:
        # An escalation ladder with nobody on it is a silent failure, not a
        # valid empty state.
        raise HTTPException(422, "contact ladder cannot be empty")

    await _require_resident(resident_id)
    d = db()

    ordered = sorted(body, key=lambda c: c.ladder_order)
    docs = [
        {
            "_id": f"con_{ULID()}",
            "resident_id": resident_id,
            "name": c.name,
            "phone_e164": c.phone_e164,
            "relationship": c.relationship,
            "ladder_order": i,
        }
        for i, c in enumerate(ordered, start=1)  # renumber densely from 1
    ]

    # ponytail: delete-then-insert, not one atomic replace — a crash between
    # the two ops loses the ladder. Upgrade: a Mongo transaction (needs a
    # replica set) or bulk_write with an ordered upsert list.
    await d.contacts.delete_many({"resident_id": resident_id})
    await d.contacts.insert_many(docs)
    return {"ok": True, "contacts": [_ser(x) for x in docs]}


# ---------------------------------------------------------------------------
# POST /push/register
# ---------------------------------------------------------------------------

class PushRegisterIn(BaseModel):
    token: str = Field(min_length=1)
    resident_id: str | None = None
    role: Literal["family", "staff"] = "family"


@router.post("/push/register")
async def push_register(body: PushRegisterIn):
    if body.resident_id:
        await _require_resident(body.resident_id)

    now = datetime.now(timezone.utc).isoformat()
    # ponytail: the contract's own note says this "stores the token on the
    # contact [or staff record]", but the request carries no contact_id and
    # this schema has no staff collection at all — there's nothing existing to
    # attach it to. A dedicated push_tokens collection keyed by the token
    # (upsert = idempotent registration) is the honest lazy option. Upgrade:
    # fold this into `contacts` / a real `staff` collection once either one
    # exists and the request carries an id for it.
    await db().push_tokens.update_one(
        {"_id": body.token},
        {"$set": {"resident_id": body.resident_id, "role": body.role, "updated_at": now}},
        upsert=True,
    )
    return {"ok": True}
