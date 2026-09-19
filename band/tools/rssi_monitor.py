#!/usr/bin/env python3
# rssi_monitor.py — live iBeacon RSSI. Run on Mac or UNO Q while placing beacons.
#   pip3 install bleak ; python3 band/tools/rssi_monitor.py
# HARDWARE_SPEC §8.3 — SITE_UUID must match beacons/beacon.ino and fallband/config.json.
import asyncio
import statistics
import struct
import sys
import time
from collections import defaultdict, deque
from pathlib import Path

try:
    from bleak import BleakScanner
except ImportError:
    print("pip3 install bleak", file=sys.stderr)
    sys.exit(1)

APPLE_ID = 0x004C
SITE_UUID = "eee6331c-6ea1-4873-83ed-ae648d10e07f"
ROOMS = {1: "kitchen", 2: "bathroom", 3: "bedroom", 4: "front_door"}
WINDOW = 30

# Optional: override from config.json
_cfg = Path(__file__).resolve().parents[1] / "fallband" / "config.json"
if _cfg.is_file():
    import json
    try:
        SITE_UUID = json.loads(_cfg.read_text()).get("rf", {}).get("site_uuid", SITE_UUID)
    except Exception:
        pass

hist: dict[int, deque] = defaultdict(lambda: deque(maxlen=WINDOW))
last: dict[int, tuple] = {}


def parse_ibeacon(mfg: bytes):
    if len(mfg) < 23 or mfg[0] != 0x02 or mfg[1] != 0x15:
        return None
    uuid = mfg[2:18].hex()
    uuid = f"{uuid[:8]}-{uuid[8:12]}-{uuid[12:16]}-{uuid[16:20]}-{uuid[20:]}"
    major, minor = struct.unpack(">HH", mfg[18:22])
    return uuid, major, minor, struct.unpack("b", mfg[22:23])[0]


def on_adv(device, adv):
    mfg = adv.manufacturer_data.get(APPLE_ID)
    if not mfg:
        return
    parsed = parse_ibeacon(bytes(mfg))
    if not parsed:
        return
    uuid, major, minor, txp = parsed
    if uuid.lower() != SITE_UUID.lower():
        return
    hist[minor].append(adv.rssi)
    last[minor] = (time.time(), txp)


async def main():
    measure_1m = "--measure-1m" in sys.argv
    scanner = BleakScanner(detection_callback=on_adv)
    await scanner.start()
    print(f"scanning for {SITE_UUID} ... Ctrl-C to stop")
    if measure_1m:
        print("MEASURE 1m mode: hold band 1.0 m LOS from ONE beacon for 15 s; note median.")
    print()
    try:
        while True:
            await asyncio.sleep(2)
            rows = []
            for minor in sorted(set(ROOMS) | set(hist)):
                r = list(hist[minor])
                if not r:
                    rows.append(f"  {minor:>2} {ROOMS.get(minor, '?'):<11} {'--- MISSING ---':>26}")
                    continue
                med = statistics.median(r)
                age = time.time() - last[minor][0]
                txp = last[minor][1]
                bar = "#" * max(0, min(40, int((med + 100) * 0.8)))
                rows.append(
                    f"  {minor:>2} {ROOMS.get(minor, '?'):<11} "
                    f"med={med:6.1f} n={len(r):>2} tx1m_adv={txp:>4} "
                    f"age={age:4.1f}s |{bar}"
                )
            print("\033[2J\033[H" + "minor room        median RSSI            \n" + "\n".join(rows))
            print("\nAfter E8.1: write med into beacons/beacon.ino MEASURED_POWER_1M")
            print("and config.json → rf.beacons[].tx_power_1m, then reflash that board.")
    except KeyboardInterrupt:
        await scanner.stop()


if __name__ == "__main__":
    asyncio.run(main())
