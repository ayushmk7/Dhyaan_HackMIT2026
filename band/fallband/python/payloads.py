#!/usr/bin/env python3
"""Payload builders for the band → hub contract.

Fixtures in backend/fixtures/*.json are the source of truth (DECISIONS D-011).
Real firmware never sets simulated=true.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


# Hub rejects peak_g > 20 until Ayush lands A7 (le=28). Clamp on the wire.
PEAK_G_WIRE_MAX = 20.0
# No fuel gauge on the power bank (D-013 / F-09). Placeholder until A4.
BATTERY_PCT_PLACEHOLDER = 100


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def fall_payload(
    *,
    band_id: str,
    peak_g: float,
    free_fall_ms: int,
    post_impact_tilt_deg: float,
    stillness_ms: int,
    path: int = 0,
    battery_pct: int = BATTERY_PCT_PLACEHOLDER,
    ts: str | None = None,
) -> dict[str, Any]:
    """POST /v1/ingest/band — matches fixtures/band_fall.json keys."""
    return {
        "band_id": band_id,
        "type": "fall_suspected",
        "ts": ts or now_iso(),
        "peak_g": round(min(float(peak_g), PEAK_G_WIRE_MAX), 2),
        "free_fall_ms": int(free_fall_ms),
        "post_impact_tilt_deg": round(float(post_impact_tilt_deg), 1),
        "stillness_ms": int(stillness_ms),
        "battery_pct": int(battery_pct),
        # Extra keys pydantic drops today; harmless and useful once A5 lands.
        "path": "FREEFALL_IMPACT" if path == 0 else "SOFT_FALL",
    }


def cancel_payload(*, band_id: str, alert_id: str) -> dict[str, Any]:
    """POST /v1/ingest/band/cancel — matches fixtures/band_cancel.json."""
    return {"band_id": band_id, "alert_id": alert_id, "by": "button"}


def heartbeat_payload(
    *,
    band_id: str,
    uptime_s: int,
    battery_pct: int = BATTERY_PCT_PLACEHOLDER,
    profile_rev: int = 0,
    activity: dict[str, Any] | None = None,
    gait: dict[str, Any] | None = None,
    activity_label: str | None = None,
) -> dict[str, Any]:
    """POST /v1/ingest/heartbeat — matches fixtures/heartbeat.json (+ stretch fields).

    [claude] `gait` is the per-window summary from gait.summarize() (cadence,
    interval CV, peak-g CV). Hub persists it as a gait_summary event; older
    hubs simply drop the unknown key.

    [claude] `activity_label` is the voted output of the on-device neural
    classifier (har.py): walking / sitting / standing / lying. Rides the
    heartbeat the same way gait does; hub stores it on the band doc and emits
    an activity_classified event when it changes.
    """
    body: dict[str, Any] = {
        "band_id": band_id,
        "battery_pct": int(battery_pct),
        "uptime_s": int(uptime_s),
        "profile_rev": int(profile_rev),
    }
    if activity is not None:
        body["activity"] = activity
    if gait is not None:
        body["gait"] = gait
    if activity_label is not None:
        body["activity_label"] = activity_label  # [claude]
    return body


def rf_payload(
    *,
    band_id: str,
    beacons: list[dict[str, Any]],
    wifi: list[dict[str, Any]] | None = None,
    ts: str | None = None,
) -> dict[str, Any]:
    """POST /v1/ingest/rf — matches fixtures/rf_scan.json shape."""
    return {
        "band_id": band_id,
        "ts": ts or now_iso(),
        "beacons": beacons,
        "wifi": wifi or [],
    }


def button_payload(*, band_id: str, battery_pct: int = BATTERY_PCT_PLACEHOLDER) -> dict[str, Any]:
    return {
        "band_id": band_id,
        "type": "button_pressed",
        "ts": now_iso(),
        "battery_pct": int(battery_pct),
    }


# Required keys / types for make test-py (must match fixture files).
FIXTURE_SHAPES: dict[str, dict[str, type | tuple[type, ...]]] = {
    "band_fall": {
        "band_id": str,
        "type": str,
        "ts": str,
        "peak_g": (int, float),
        "free_fall_ms": int,
        "post_impact_tilt_deg": (int, float),
        "stillness_ms": int,
        "battery_pct": int,
    },
    "band_cancel": {
        "band_id": str,
        "alert_id": str,
        "by": str,
    },
    "heartbeat": {
        "band_id": str,
        "battery_pct": int,
        "uptime_s": int,
    },
    "rf_scan": {
        "band_id": str,
        "ts": str,
        "beacons": list,
        "wifi": list,
    },
}
