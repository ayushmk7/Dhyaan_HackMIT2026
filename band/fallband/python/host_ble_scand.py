#!/usr/bin/env python3
# [claude] agent-added file (2026-09-20). Not part of Utsav's original app.
"""Host-side BLE scanner for the fallband app.

Arduino App Lab runs the app in a Docker container with no D-Bus/Bluetooth
access, so scans made in-container are silently empty. This daemon runs on the
UNO Q's host Linux (where BlueZ works), scans for the site's iBeacons on a
loop, and writes the latest result next to config.json — the container sees it
through the app bind-mount and ble_scan.scan_ibeacons_sync() prefers it while
fresh (see the [claude] relay block there).

Run on the board host:

    PYTHONPATH=/home/arduino/blelib:/home/arduino/ArduinoApps/fallband-app/python \
        python3 /home/arduino/ArduinoApps/fallband-app/python/host_ble_scand.py

The systemd unit fallband-ble.service does exactly that at boot.
"""
import json
import logging
import os
import time
from pathlib import Path

# Belt and braces: never let this process serve itself a stale copy of the
# relay file — ble_scan reads this env var at import, so set it BEFORE the
# import. The daemon must always scan the real radio.
os.environ["FALLBAND_BLE_RELAY"] = "/nonexistent"

from ble_scan import scan_ibeacons_sync  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s: %(message)s")
log = logging.getLogger("fallband.blehost")

APP_DIR = Path(__file__).resolve().parents[1]
CFG = json.loads((APP_DIR / "config.json").read_text())
RF = CFG.get("rf") or {}
SITE = RF["site_uuid"]
# Longer than the app's own window: one host pass should catch EVERY beacon,
# or k-NN vectors flap between rooms on missing anchors.
SCAN_S = float(os.getenv("FALLBAND_BLE_HOST_SCAN_S", 2 * float(RF.get("ble_scan_seconds", 3))))
# [claude] 1, not config min_adverts_n: at 6 s windows a single advert is real;
# requiring 3 produced minute-long empty stretches on the bench.
MIN_N = 1
PERIOD_S = float(os.getenv("FALLBAND_BLE_HOST_PERIOD_S", "5"))
OUT = APP_DIR / ".ble_latest.json"


def main() -> None:
    log.info("scanning %s every %.0fs -> %s", SITE, PERIOD_S, OUT)
    while True:
        started = time.time()
        try:
            beacons = scan_ibeacons_sync(SITE, SCAN_S, min_adverts=MIN_N)
        except Exception as e:
            log.warning("scan failed: %s", e)
            beacons = []
        tmp = OUT.with_suffix(".json.tmp")
        tmp.write_text(json.dumps({"ts": time.time(), "beacons": beacons}))
        tmp.replace(OUT)  # atomic: the container never reads a half-written file
        if beacons:
            log.info("heard %s", [(b["minor"], b["rssi"]) for b in beacons])
        time.sleep(max(0.0, PERIOD_S - (time.time() - started)))


if __name__ == "__main__":
    main()
