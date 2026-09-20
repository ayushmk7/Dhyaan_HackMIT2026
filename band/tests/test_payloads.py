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

    # [claude] gait math: known step times -> known cadence/CV
    import gait

    # 30 perfectly regular steps, 0.5 s apart, in a 60 s window:
    # cadence = 30 steps / 60 s * 60 = 30 spm, both CVs exactly 0.
    times = [i * 0.5 for i in range(30)]
    peaks = [1.4] * 30
    s = gait.summarize(times, peaks, window_s=60.0, min_steps=10)
    assert s is not None
    assert s["steps"] == 30 and s["cadence_spm"] == 30.0, s
    assert s["step_interval_cv"] == 0.0 and s["peak_g_cv"] == 0.0, s
    assert s["peak_g_p50"] == 1.4 and s["peak_g_max"] == 1.4, s

    # Alternating 0.4/0.6 s intervals: mean 0.5, pop std 0.1 -> CV 0.2.
    t, times2 = 0.0, [0.0]
    for i in range(20):
        t += 0.4 if i % 2 == 0 else 0.6
        times2.append(t)
    s2 = gait.summarize(times2, [1.0 + 0.1 * (i % 2) for i in range(21)], window_s=60.0)
    assert abs(s2["step_interval_cv"] - 0.2) < 0.005, s2["step_interval_cv"]

    # Below the step floor -> no summary (shuffles are not a walk).
    assert gait.summarize([0.0, 0.5, 1.0], [1.2] * 3, window_s=60.0, min_steps=10) is None
    # Mismatched inputs / degenerate window -> None, never garbage.
    assert gait.summarize(times, peaks[:-1], window_s=60.0) is None
    assert gait.summarize(times, peaks, window_s=0.0) is None
    print("ok  gait summarize cadence/CV")

    # [claude] heartbeat carries the gait summary under "gait" (optional key).
    hb = heartbeat_payload(band_id="band_unoq01", uptime_s=10, gait=s)
    assert hb["gait"]["cadence_spm"] == 30.0
    assert "gait" not in heartbeat_payload(band_id="band_unoq01", uptime_s=10)
    print("ok  heartbeat gait passthrough")

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
