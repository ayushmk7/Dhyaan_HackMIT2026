#!/usr/bin/env python3
"""Dry-run / live POST of fixture-shaped band payloads (no MCU required).

  FALLBAND_CONFIG=band/fallband/config.json \\
    python3 band/scripts/verify_ingest.py --dry-run

  BAND_KEY=... python3 band/scripts/verify_ingest.py --live fall
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "band" / "fallband" / "python"))

from payloads import cancel_payload, fall_payload, heartbeat_payload, rf_payload  # noqa: E402
from uplink import Uplink  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--live", choices=("fall", "heartbeat", "rf", "all"), default=None)
    ap.add_argument("--config", default=os.environ.get("FALLBAND_CONFIG", str(ROOT / "band/fallband/config.json")))
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    band_id = cfg.get("band_id", "band_unoq01")
    site = (cfg.get("rf") or {}).get("site_uuid", "eee6331c-6ea1-4873-83ed-ae648d10e07f")

    fall = fall_payload(
        band_id=band_id, peak_g=3.4, free_fall_ms=95,
        post_impact_tilt_deg=72, stillness_ms=1800,
    )
    hb = heartbeat_payload(band_id=band_id, uptime_s=120)
    rf = rf_payload(
        band_id=band_id,
        beacons=[
            {"uuid": site, "major": 1, "minor": 1, "rssi": -58},
            {"uuid": site, "major": 1, "minor": 2, "rssi": -72},
            {"uuid": site, "major": 1, "minor": 3, "rssi": -65},
            {"uuid": site, "major": 1, "minor": 4, "rssi": -80},
        ],
    )

    if args.dry_run or not args.live:
        print("=== fall ===")
        print(json.dumps(fall, indent=2))
        print("=== heartbeat ===")
        print(json.dumps(hb, indent=2))
        print("=== rf ===")
        print(json.dumps(rf, indent=2))
        if not args.live:
            print("\n(OK dry-run — pass --live fall to POST)")
            return

    key = cfg.get("band_key") or os.environ.get("BAND_KEY", "")
    if not key or key.startswith("CHANGE_ME"):
        print("Set band_key in config.json or BAND_KEY env", file=sys.stderr)
        sys.exit(1)
    up = Uplink(cfg["hub_url"], key, spool_dir="/tmp/fallband_spool_verify")

    if args.live in ("fall", "all"):
        r = up.post("/v1/ingest/band", fall, critical=True)
        print("fall →", r)
        if r and r.get("alert_id"):
            c = cancel_payload(band_id=band_id, alert_id=r["alert_id"])
            print("cancel →", up.post("/v1/ingest/band/cancel", c, critical=True))
    if args.live in ("heartbeat", "all"):
        print("heartbeat →", up.post("/v1/ingest/heartbeat", hb))
    if args.live in ("rf", "all"):
        print("rf →", up.post("/v1/ingest/rf", rf))


if __name__ == "__main__":
    main()
