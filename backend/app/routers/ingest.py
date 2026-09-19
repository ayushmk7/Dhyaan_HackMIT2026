"""
=============================================================================
FILL-IN TEMPLATE — band firmware contract (Utsav: code against this section
only, you should not need to read anything below it).

All requests: header  X-Band-Key: <the shared band key>
All bodies: JSON. `ts` is ISO-8601 (e.g. "2026-09-19T14:31:02-04:00").
Unknown band_id -> 404. Bad/missing key -> 401. Bad field -> 422.

-----------------------------------------------------------------------------
POST /v1/ingest/band  — a fall or button event
  body: {"band_id": "band_a3f2", "type": "fall_suspected",
         "ts": "2026-09-19T14:31:02-04:00", "peak_g": 3.4, "free_fall_ms": 95,
         "post_impact_tilt_deg": 72, "stillness_ms": 1800, "battery_pct": 64}
  type in: fall_suspected | fall_confirmed | fall_cancelled | button_pressed |
           band_motion_high | band_still | prolonged_inactivity
  201 -> {"event_id": "evt_...", "alert_id": "alr_...", "cancel_window_s": 30}
         ("alert_id" only present when this event opened one, e.g. fall_suspected)

  curl -X POST http://localhost:8000/v1/ingest/band \
    -H "X-Band-Key: $BAND_KEY" -H "Content-Type: application/json" \
    -d @fixtures/band_fall.json

-----------------------------------------------------------------------------
POST /v1/ingest/band/cancel  — on-band button press inside the grace window
  body: {"band_id": "band_a3f2", "alert_id": "alr_...", "by": "button"}
  200 -> {"cancelled": true, ...}

  curl -X POST http://localhost:8000/v1/ingest/band/cancel \
    -H "X-Band-Key: $BAND_KEY" -H "Content-Type: application/json" \
    -d '{"band_id":"band_a3f2","alert_id":"alr_123","by":"button"}'

-----------------------------------------------------------------------------
POST /v1/ingest/heartbeat  — every 60s per band, cheap
  body: {"band_id": "band_a3f2", "battery_pct": 64, "uptime_s": 38210}
  204 (no body)

  curl -X POST http://localhost:8000/v1/ingest/heartbeat \
    -H "X-Band-Key: $BAND_KEY" -H "Content-Type: application/json" \
    -d @fixtures/heartbeat.json

-----------------------------------------------------------------------------
POST /v1/ingest/rf  — an RSSI scan (BLE beacons + Wi-Fi APs seen right now)
  body: {"band_id": "band_a3f2", "ts": "2026-09-19T14:31:02-04:00",
         "beacons": [{"uuid": "bcn-kitchen", "major": 1, "minor": 1, "rssi": -58}],
         "wifi": [{"bssid": "a4:2b:8c:11:02:9f", "rssi": -47}]}
  rssi is dBm, always <= 0.
  200 -> {"zone": "kitchen", "confidence": 0.88, "posterior": {...}, "committed": true}

  curl -X POST http://localhost:8000/v1/ingest/rf \
    -H "X-Band-Key: $BAND_KEY" -H "Content-Type: application/json" \
    -d @fixtures/rf_scan.json
=============================================================================

TECHNICAL_PRD §2 ("Ingest") wins over the older contested spec: these four
routes, X-Band-Key auth. Field-level shape here (flat `type`, flat `beacons`/
`wifi` lists) is this team's agreed contract, not the PRD's literal JSON
example (which nests under `payload` and calls it `kind`/`ble`) — same
endpoints, cleaned-up body.
"""

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from .. import location
from ..config import CANCEL_WINDOW_S
from ..db import db
from ..deps import require_band_key
from ..events import emit

router = APIRouter(prefix="/v1/ingest", tags=["ingest"], dependencies=[Depends(require_band_key)])

BAND_EVENT_TYPES = (
    "fall_suspected", "fall_confirmed", "fall_cancelled", "button_pressed",
    "band_motion_high", "band_still", "prolonged_inactivity",
)
LOW_BATTERY_PCT = 15


async def _resident_for_band(band_id: str) -> str:
    """band_id -> resident_id. Unknown bands are rejected, never auto-created —
    a stray/misconfigured band must not silently create data for a resident."""
    band = await db().bands.find_one({"_id": band_id})
    if not band:
        raise HTTPException(404, f"unknown band_id {band_id!r}")
    return band["resident_id"]


# --- /band ------------------------------------------------------------------

class BandEventIn(BaseModel):
    # Set by scripts/simulate_band.py. Real firmware never sends it, so anything
    # carrying simulated=true is fake data — the flag is persisted onto the event
    # so nobody demos a seeded fall believing it came off a wrist. See
    # HARDWARE_INTEGRATION.md.
    simulated: bool = False
    band_id: str = Field(min_length=1)
    type: Literal[BAND_EVENT_TYPES]
    ts: datetime
    peak_g: float | None = Field(default=None, ge=0, le=20)
    free_fall_ms: int | None = Field(default=None, ge=0, le=5000)
    post_impact_tilt_deg: float | None = Field(default=None, ge=0, le=180)
    stillness_ms: int | None = Field(default=None, ge=0, le=600_000)
    battery_pct: int = Field(ge=0, le=100)


@router.post("/band", status_code=201)
async def ingest_band(body: BandEventIn):
    resident_id = await _resident_for_band(body.band_id)

    doc = await emit(
        resident_id=resident_id,
        source="band",
        type=body.type,
        ts=body.ts if body.ts.tzinfo else body.ts.replace(tzinfo=timezone.utc),
        embedding_text=f"Band {body.band_id} reported {body.type}",
        source_id=body.band_id,
        payload={
            "peak_g": body.peak_g,
            "free_fall_ms": body.free_fall_ms,
            "post_impact_tilt_deg": body.post_impact_tilt_deg,
            "stillness_ms": body.stillness_ms,
            "battery_pct": body.battery_pct,
            "simulated": body.simulated,
        },
    )

    resp = {"event_id": doc["_id"]}
    if body.type == "fall_suspected":
        from ..alerts import open_alert  # lazy: alerts.py may still be mid-write

        alert = await open_alert(
            resident_id=resident_id, trigger_event_id=doc["_id"],
            kind="fall", severity="critical",
        )
        resp["alert_id"] = alert["_id"]
        resp["cancel_window_s"] = CANCEL_WINDOW_S
    return resp


# --- /band/cancel -------------------------------------------------------------

class BandCancelIn(BaseModel):
    simulated: bool = False
    band_id: str = Field(min_length=1)
    alert_id: str = Field(min_length=1)
    by: Literal["button", "voice", "staff"] = "button"


@router.post("/band/cancel")
async def ingest_band_cancel(body: BandCancelIn):
    await _resident_for_band(body.band_id)  # 404s unknown bands before touching alerts

    from ..alerts import cancel  # lazy: alerts.py may still be mid-write

    return await cancel(body.alert_id, by=body.by)


# --- /heartbeat ---------------------------------------------------------------

class HeartbeatIn(BaseModel):
    simulated: bool = False
    band_id: str = Field(min_length=1)
    battery_pct: int = Field(ge=0, le=100)
    uptime_s: int | None = Field(default=None, ge=0)


@router.post("/heartbeat", status_code=204)
async def ingest_heartbeat(body: HeartbeatIn):
    now = datetime.now(timezone.utc).isoformat()
    prev = await db().bands.find_one_and_update(
        {"_id": body.band_id},
        {"$set": {"last_seen_at": now, "battery_pct": body.battery_pct}},
    )
    if prev is None:
        raise HTTPException(404, f"unknown band_id {body.band_id!r}")

    if body.battery_pct < LOW_BATTERY_PCT:
        await emit(
            resident_id=prev["resident_id"], source="band", type="band_low_battery",
            embedding_text=f"Band {body.band_id} battery at {body.battery_pct}%",
            source_id=body.band_id, confidence=1.0,
            payload={"battery_pct": body.battery_pct, "simulated": body.simulated},
        )
    return Response(status_code=204)


# --- /rf ------------------------------------------------------------------

class BeaconReading(BaseModel):
    uuid: str | None = None
    major: int | None = None
    minor: int | None = None
    rssi: int = Field(ge=-100, le=0)


class WifiReading(BaseModel):
    bssid: str = Field(min_length=1)
    rssi: int = Field(ge=-100, le=0)


class RFScanIn(BaseModel):
    simulated: bool = False
    band_id: str = Field(min_length=1)
    ts: datetime
    beacons: list[BeaconReading] = Field(default_factory=list)
    wifi: list[WifiReading] = Field(default_factory=list)


@router.post("/rf")
async def ingest_rf(body: RFScanIn):
    resident_id = await _resident_for_band(body.band_id)
    scan = {
        "beacons": [b.model_dump() for b in body.beacons],
        "wifi": [w.model_dump() for w in body.wifi],
    }
    return await location.observe(resident_id, scan)
