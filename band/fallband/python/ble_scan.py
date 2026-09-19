"""BLE iBeacon scan → median RSSI per minor (HARDWARE_SPEC §3.1, §5.6)."""
from __future__ import annotations

import asyncio
import logging
import statistics
import struct
import time
from collections import defaultdict
from typing import Any, Callable

log = logging.getLogger("fallband.ble")

APPLE_ID = 0x004C


def parse_ibeacon(mfg: bytes) -> tuple[str, int, int, int] | None:
    """Return (uuid, major, minor, tx_power) or None."""
    if len(mfg) < 23 or mfg[0] != 0x02 or mfg[1] != 0x15:
        return None
    u = mfg[2:18].hex()
    uuid = f"{u[:8]}-{u[8:12]}-{u[12:16]}-{u[16:20]}-{u[20:]}"
    major, minor = struct.unpack(">HH", mfg[18:22])
    txp = struct.unpack("b", mfg[22:23])[0]
    return uuid, major, minor, txp


def median_rssi(samples: list[int]) -> int:
    return int(round(statistics.median(samples)))


async def scan_ibeacons(
    site_uuid: str,
    duration_s: float = 3.0,
    *,
    min_adverts: int = 3,
) -> list[dict[str, Any]]:
    """Passive scan; return one row per minor with median RSSI (n >= min_adverts)."""
    try:
        from bleak import BleakScanner
    except ImportError:
        log.error("bleak not installed — pip install bleak")
        return []

    site = site_uuid.lower()
    buckets: dict[tuple[str, int, int], list[int]] = defaultdict(list)

    def on_adv(device, adv) -> None:  # noqa: ANN001
        mfg = (adv.manufacturer_data or {}).get(APPLE_ID)
        if not mfg:
            return
        parsed = parse_ibeacon(bytes(mfg))
        if not parsed:
            return
        uuid, major, minor, _txp = parsed
        if uuid.lower() != site:
            return
        rssi = adv.rssi
        if rssi is None:
            return
        buckets[(uuid.lower(), major, minor)].append(int(rssi))

    scanner = BleakScanner(detection_callback=on_adv)
    await scanner.start()
    try:
        await asyncio.sleep(duration_s)
    finally:
        await scanner.stop()

    out: list[dict[str, Any]] = []
    for (uuid, major, minor), rssis in sorted(buckets.items(), key=lambda x: x[0][2]):
        if len(rssis) < min_adverts:
            log.debug("minor %s n=%d < %d — discard", minor, len(rssis), min_adverts)
            continue
        out.append({
            "uuid": uuid,
            "major": major,
            "minor": minor,
            "rssi": median_rssi(rssis),
            "n": len(rssis),
        })
    return out


def scan_ibeacons_sync(
    site_uuid: str,
    duration_s: float = 3.0,
    *,
    min_adverts: int = 3,
) -> list[dict[str, Any]]:
    return asyncio.run(scan_ibeacons(site_uuid, duration_s, min_adverts=min_adverts))


def wifi_scan_bssids() -> list[dict[str, Any]]:
    """Best-effort `iw` parse. Empty list if unavailable (venue Wi-Fi is bonus)."""
    import re
    import subprocess

    try:
        proc = subprocess.run(
            ["iw", "dev", "wlan0", "scan"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        text = proc.stdout or ""
    except Exception as e:
        log.debug("wifi scan skipped: %s", e)
        return []

    rows: list[dict[str, Any]] = []
    bssid = None
    for line in text.splitlines():
        m = re.match(r"BSS\s+([0-9a-f:]{17})", line, re.I)
        if m:
            bssid = m.group(1).lower()
            continue
        m = re.search(r"signal:\s*(-?\d+(?:\.\d+)?)\s*dBm", line)
        if m and bssid:
            rows.append({"bssid": bssid, "rssi": int(round(float(m.group(1))))})
            bssid = None
    return rows[:32]
