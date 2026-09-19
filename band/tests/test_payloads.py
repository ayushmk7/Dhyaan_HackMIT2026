#!/usr/bin/env python3
"""Assert band payload builders match backend/fixtures/*.json key sets + types."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "band" / "fallband" / "python"))

from payloads import (  # noqa: E402
    FIXTURE_SHAPES,
    cancel_payload,
    fall_payload,
    heartbeat_payload,
    rf_payload,
)

FIXTURES = ROOT / "backend" / "fixtures"


def _check(name: str, body: dict, fixture_file: str) -> None:
    shape = FIXTURE_SHAPES[name]
    raw = json.loads((FIXTURES / fixture_file).read_text(encoding="utf-8"))
    for key, typ in shape.items():
        assert key in body, f"{name}: missing key {key!r} in builder"
        assert key in raw, f"{name}: fixture {fixture_file} missing {key!r}"
        if not isinstance(body[key], typ):
            raise AssertionError(
                f"{name}.{key}: builder type {type(body[key]).__name__} "
                f"not in {typ}"
            )
        if not isinstance(raw[key], typ):
            raise AssertionError(
                f"{name}.{key}: fixture type {type(raw[key]).__name__} "
                f"not in {typ}"
            )
    # Builder must not invent required fixture keys with wrong names.
    for key in shape:
        assert key in body and key in raw
    print(f"ok  {name} ↔ {fixture_file}")


def main() -> None:
    _check(
        "band_fall",
        fall_payload(
            band_id="band_unoq01",
            peak_g=3.4,
            free_fall_ms=95,
            post_impact_tilt_deg=72,
            stillness_ms=1800,
        ),
        "band_fall.json",
    )
    _check(
        "band_cancel",
        cancel_payload(band_id="band_unoq01", alert_id="alr_test"),
        "band_cancel.json",
    )
    _check(
        "heartbeat",
        heartbeat_payload(band_id="band_unoq01", uptime_s=38210),
        "heartbeat.json",
    )
    _check(
        "rf_scan",
        rf_payload(
            band_id="band_unoq01",
            beacons=[{"uuid": "eee6331c-6ea1-4873-83ed-ae648d10e07f", "major": 1, "minor": 1, "rssi": -58}],
            wifi=[{"bssid": "a4:2b:8c:11:02:9f", "rssi": -47}],
        ),
        "rf_scan.json",
    )

    # peak_g clamp (A7 workaround)
    p = fall_payload(
        band_id="band_unoq01",
        peak_g=27.7,
        free_fall_ms=100,
        post_impact_tilt_deg=50,
        stillness_ms=2000,
    )
    assert p["peak_g"] == 20.0, p["peak_g"]
    print("ok  peak_g clamp ≤ 20")

    # ble parse unit (no adapter needed)
    from ble_scan import parse_ibeacon, median_rssi

    # Craft a minimal iBeacon mfg payload
    import struct
    uuid_bytes = bytes.fromhex("eee6331c6ea1487383edae648d10e07f")
    mfg = bytes([0x02, 0x15]) + uuid_bytes + struct.pack(">HH", 1, 2) + struct.pack("b", -59)
    parsed = parse_ibeacon(mfg)
    assert parsed is not None
    u, maj, minor, txp = parsed
    assert minor == 2 and maj == 1 and txp == -59
    assert median_rssi([-60, -50, -70]) == -60
    print("ok  ble_scan parse/median")
    print("all payload tests passed")


if __name__ == "__main__":
    main()
