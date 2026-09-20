#!/usr/bin/env python3
# [claude] agent-added file (2026-09-20): one-shot survey driver, not part of
# Utsav's original fallband app.
"""One-shot site survey from the band's own radio.

Stand in a room holding the band, then run this ON the UNO Q (container):

    docker exec fallband-app-main-1 python /app/python/survey.py kitchen 30

It scans iBeacons with the same BlueZ path the agent uses and feeds the
backend's survey endpoints (setup.py: start -> sample xN -> stop), which write
the fingerprint location.py's k-NN matches against. Re-running a zone replaces
its old fingerprint. Runs fine alongside the live agent — passive BLE scans
share hci0.

Config (hub_url, band-site UUID, scan seconds) comes from /app/config.json;
the app API key defaults to the dev key and can be overridden with APP_KEY.
"""
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

from ble_scan import scan_ibeacons_sync

CFG = json.loads(Path(__file__).resolve().parents[1].joinpath("config.json").read_text())
HUB = CFG["hub_url"].rstrip("/")
RESIDENT = CFG.get("user_id", "res_eleanor")
APP_KEY = os.getenv("APP_KEY", "dev-key-change-me")
SITE = CFG["rf"]["site_uuid"]
SCAN_S = float(CFG["rf"].get("ble_scan_seconds", 3))


def call(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{HUB}/v1/residents/{RESIDENT}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {APP_KEY}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:200]
        raise SystemExit(f"{path} -> {e.code}: {detail}")


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: survey.py <zone> [seconds=30]")
    zone = sys.argv[1]
    total_s = float(sys.argv[2]) if len(sys.argv) > 2 else 30.0

    survey = call("/survey/start", {"zone": zone})
    sid = survey["survey_id"]
    print(f"survey {sid} for {zone!r}: scanning ~{total_s:.0f}s, stay in the room")

    deadline = time.time() + total_s
    accepted = empty = 0
    while time.time() < deadline:
        # [claude] pace the loop: with the host-scan relay in play the call
        # returns instantly instead of blocking for a scan window.
        time.sleep(2.0)
        beacons = scan_ibeacons_sync(SITE, SCAN_S, min_adverts=1)
        wire = [{"uuid": b["uuid"], "major": b["major"], "minor": b["minor"], "rssi": b["rssi"]}
                for b in beacons]
        if not wire:
            empty += 1
            print("  no beacons heard this pass — are they powered?")
            continue
        r = call("/survey/sample", {"survey_id": sid, "beacons": wire})
        accepted = r["samples"]
        print(f"  sample {accepted}: {[(b['minor'], b['rssi']) for b in wire]}")

    if accepted == 0:
        raise SystemExit(f"heard nothing in {zone!r} ({empty} empty passes) — no fingerprint written")
    done = call("/survey/stop", {"survey_id": sid})
    print(f"fingerprint saved: {done}")


if __name__ == "__main__":
    main()
