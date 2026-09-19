"""scripts/simulate_band.py — stand-in for the physical band so the backend,
the escalation ladder, and the app can all be demoed before an Arduino exists.

CONTRACT: this script posts the exact JSON the Arduino firmware will post, to
the exact endpoints in app/routers/ingest.py, with the exact X-Band-Key
header. If this script and the firmware ever disagree on shape, the fixtures
in fixtures/*.json are wrong — fix the fixture, not this script, and tell
Utsav.

    python -m scripts.simulate_band fall
    python -m scripts.simulate_band fall --cancel
    python -m scripts.simulate_band walk
    python -m scripts.simulate_band rf --zone kitchen --dwell 300
    python -m scripts.simulate_band heartbeat --battery 12
    python -m scripts.simulate_band day
    python -m scripts.simulate_band fall --dry-run    # print, don't POST

Env vars (same names the real firmware config will use):
    DHYAAN_API   base URL, default http://localhost:8000
    BAND_KEY     X-Band-Key value, default band-dev-key (must match the server)
    BAND_ID      which paired band to act as, default band_a3f2 (seed.py's demo band)
"""

import argparse
import asyncio
import json
import math
import os
import random
import sys
from datetime import datetime, timedelta, timezone

import httpx

API = os.environ.get("DHYAAN_API", "http://localhost:8000")
BAND_KEY = os.environ.get("BAND_KEY", "band-dev-key")
DEFAULT_BAND_ID = os.environ.get("BAND_ID", "band_a3f2")
HEADERS = {"X-Band-Key": BAND_KEY, "Content-Type": "application/json"}

# =============================================================================
# Calibration knobs — a real LSM6DSOX / ESP32 beacon will NOT match these
# numbers. They exist so the backend can be exercised with *physically
# plausible* data instead of round numbers, and so there is one obvious place
# to re-tune when real hardware logs come in (see HARDWARE_INTEGRATION.md's
# placeholder table). Every range here traces to HARDWARE_SPEC.md.
# =============================================================================
CAL = {
    # HARDWARE_SPEC.md §6.9 IMPACT_G_AFTER_FF=2.8g floor / IMPACT_G_SOFT=3.5g,
    # and the §6.5 confidence formula saturates min(peak_g/6, 1) at 6g.
    "peak_g_range": (2.8, 6.0),
    # §6.1 phase 1: a forearm mount only sees a PARTIAL free fall (the body
    # pivots at the feet, the arm flails) — shallower and shorter than a
    # waist-mount drop. Real venue re-tune: log real falls, take the 5th-95th
    # percentile of free_fall_ms off the actual band, replace this tuple.
    "free_fall_ms_range": (60, 120),
    # §6.1 phase 3: orientation swings from standing/sitting to lying down.
    "post_impact_tilt_deg_range": (40, 80),
    # §6.1 phase 4 window is 2-30s; middle of it reads as a believable demo.
    "stillness_ms_range": (1500, 2500),
    "battery_pct_range": (55, 95),
    # Per-zone RSSI @ ~1-2m from that room's beacon, for our fake 4-beacon demo
    # house (HARDWARE_SPEC §3.2/§8). A REAL SITE SURVEY OVERWRITES THESE with
    # measured medians — never ship guessed numbers to a venue (§3.2 TxPower note).
    "zone_rssi": {
        "kitchen": -55, "bathroom": -60, "bedroom": -58,
        "living_room": -62, "front_door": -65, "hallway": -70,
    },
    # §3.1: body-worn RSSI swings +-10dB with orientation. We use a smaller
    # jitter so demo zone commits are repeatable instead of flaky.
    "rssi_jitter_db": 4,
}

FALL_EVENT_TYPE = "fall_suspected"


def _now_iso(offset_s: float = 0.0) -> str:
    t = datetime.now(timezone.utc).astimezone() + timedelta(seconds=offset_s)
    return t.isoformat(timespec="seconds")


# --- payload builders (pure — no I/O, easy to unit-test / diff) -------------

def fall_payload(band_id: str = DEFAULT_BAND_ID) -> dict:
    """One fall cascade snapshot: free-fall dip -> impact spike -> tilt change
    -> post-impact stillness, summarized the way the firmware will summarize
    it (peak/duration numbers, not a raw trace — see HARDWARE_SPEC §6.7-6.9)."""
    return {
        "band_id": band_id,
        "type": FALL_EVENT_TYPE,
        "ts": _now_iso(),
        "peak_g": round(random.uniform(*CAL["peak_g_range"]), 2),
        "free_fall_ms": random.randint(*CAL["free_fall_ms_range"]),
        "post_impact_tilt_deg": round(random.uniform(*CAL["post_impact_tilt_deg_range"]), 1),
        "stillness_ms": random.randint(*CAL["stillness_ms_range"]),
        "battery_pct": random.randint(*CAL["battery_pct_range"]),
        # ponytail: BandEventIn (app/routers/ingest.py) doesn't declare this
        # field, and pydantic silently drops unknown fields, so it does NOT
        # currently survive into the stored event. It rides along anyway so
        # the wire format is ready the day someone adds `simulated: bool` to
        # the model. See HARDWARE_INTEGRATION.md "how to tell if it is real".
        "simulated": True,
    }


def cancel_payload(band_id: str, alert_id: str) -> dict:
    return {"band_id": band_id, "alert_id": alert_id, "by": "button", "simulated": True}


def heartbeat_payload(band_id: str = DEFAULT_BAND_ID, battery_pct: int | None = None) -> dict:
    return {
        "band_id": band_id,
        "battery_pct": battery_pct if battery_pct is not None else random.randint(*CAL["battery_pct_range"]),
        "uptime_s": random.randint(60, 90_000),
        "simulated": True,
    }


def rf_payload(zone: str, band_id: str = DEFAULT_BAND_ID) -> dict:
    base = CAL["zone_rssi"].get(zone, -70)
    jitter = CAL["rssi_jitter_db"]
    rssi = round(base + random.uniform(-jitter, jitter))
    rssi = max(-95, min(-30, rssi))  # rssi is dBm, always <= 0 (ingest.py Field(le=0))
    return {
        "band_id": band_id,
        "ts": _now_iso(),
        "beacons": [{"uuid": f"bcn-{zone}", "major": 1, "minor": 1, "rssi": rssi}],
        "wifi": [],
        "simulated": True,
    }


def walk_payloads(band_id: str = DEFAULT_BAND_ID) -> list[dict]:
    """A normal day's motion: a brief high-motion burst then settling down.
    peak_g stays well under IMPACT_G_SOFT (3.5g) so it never reads as a fall."""
    return [
        {
            "band_id": band_id, "type": "band_motion_high", "ts": _now_iso(),
            "peak_g": round(random.uniform(1.1, 1.9), 2),
            "battery_pct": random.randint(*CAL["battery_pct_range"]),
            "simulated": True,
        },
        {
            "band_id": band_id, "type": "band_still", "ts": _now_iso(offset_s=90),
            "battery_pct": random.randint(*CAL["battery_pct_range"]),
            "simulated": True,
        },
    ]


# --- HTTP + CLI plumbing -----------------------------------------------------

class BandError(SystemExit):
    """A readable failure instead of a stack trace, with an exit code the
    caller (a demo script, CI, whoever) can branch on."""


async def _send(client: httpx.AsyncClient, path: str, payload: dict, dry_run: bool) -> dict | None:
    if dry_run:
        print(json.dumps(payload, indent=2))
        return None
    try:
        r = await client.post(f"{API}{path}", json=payload, headers=HEADERS, timeout=10.0)
    except httpx.ConnectError as e:
        raise BandError(f"cannot reach backend at {API} ({path}) — is uvicorn running? ({e})") from e

    if r.status_code == 401:
        raise BandError(f"401 from {path}: BAND_KEY env var doesn't match the server's BAND_KEY", 3)
    if r.status_code == 404:
        band_id = payload.get("band_id")
        raise BandError(
            f"404 from {path}: band_id {band_id!r} is not paired — insert it into the "
            f"`bands` collection first (see HARDWARE_INTEGRATION.md)", 4,
        )
    if r.status_code >= 400:
        raise BandError(f"{r.status_code} from {path}: {r.text}", 5)

    body = r.json() if r.content else {}
    print(f"POST {path} -> {r.status_code} {json.dumps(body) if body else ''}".rstrip())
    return body


async def _seed_fingerprint(zone: str, band_id: str) -> None:
    """ponytail: a real fingerprint comes from the HARDWARE_SPEC §8 site
    survey (walk every zone, record RSSI, build the table). We don't have a
    venue to survey, so we upsert one fingerprint that matches our own fake
    RSSI, purely so `rf --zone X` has something to commit against in a fresh
    demo DB. This is simulator-only setup, NOT part of the firmware contract
    — real hardware never touches Mongo directly. Delete this the day a real
    onboarding/site-survey flow exists.
    """
    from app import db as dbmod

    d = await dbmod.connect()
    band = await d.bands.find_one({"_id": band_id})
    if not band:
        return  # unknown band; the real POST below will 404 with a clear message
    await d.fingerprints.update_one(
        {"resident_id": band["resident_id"], "zone": zone},
        {"$set": {"resident_id": band["resident_id"], "zone": zone,
                   "vectors": [{f"bcn-{zone}": CAL["zone_rssi"].get(zone, -70)}]}},
        upsert=True,
    )


async def cmd_fall(args) -> None:
    async with httpx.AsyncClient() as client:
        payload = fall_payload(band_id=args.band_id)
        body = await _send(client, "/v1/ingest/band", payload, args.dry_run)
        if args.dry_run:
            return
        alert_id = body.get("alert_id")
        print(f"fall_suspected posted (peak_g={payload['peak_g']}, "
              f"free_fall_ms={payload['free_fall_ms']}) -> alert {alert_id} "
              f"(cancel window {body.get('cancel_window_s')}s)")
        if args.cancel:
            c = cancel_payload(args.band_id, alert_id)
            result = await _send(client, "/v1/ingest/band/cancel", c, args.dry_run)
            print(f"button pressed inside the grace window -> state {result.get('state')}")
        else:
            print("no cancel pressed — the server-side escalation ladder (app/alerts.py) "
                  "is now running on its own timers; watch the `alerts` collection or "
                  "GET /v1/... live endpoints to see it progress")


async def cmd_walk(args) -> None:
    async with httpx.AsyncClient() as client:
        for payload in walk_payloads(band_id=args.band_id):
            await _send(client, "/v1/ingest/band", payload, args.dry_run)
        print("normal motion posted — no fall thresholds crossed, no alert expected")


async def cmd_heartbeat(args) -> None:
    async with httpx.AsyncClient() as client:
        payload = heartbeat_payload(band_id=args.band_id, battery_pct=args.battery)
        await _send(client, "/v1/ingest/heartbeat", payload, args.dry_run)
        if not args.dry_run and payload["battery_pct"] < 15:
            print(f"battery {payload['battery_pct']}% is below the low-battery floor (15%) "
                  "— expect a band_low_battery event")


async def cmd_rf(args) -> None:
    if not args.dry_run:
        await _seed_fingerprint(args.zone, args.band_id)

    # Dwell hysteresis (app/location.py COMMIT_TICKS=2) needs >=2 consecutive
    # matching scans before it commits to a room change. --dwell is a demo
    # knob for "how many scans to send", NOT a time machine: zone_dwell /
    # bathroom_prolonged alerts key off real wall-clock seconds server-side
    # (location.py uses datetime.now(), not our `ts`), so this can't fast
    # forward past the real 900s/1800s thresholds — only real waiting can.
    scan_interval_s = 5
    n_ticks = max(2, math.ceil(args.dwell / scan_interval_s))
    async with httpx.AsyncClient() as client:
        for i in range(n_ticks):
            payload = rf_payload(args.zone, band_id=args.band_id)
            body = await _send(client, "/v1/ingest/rf", payload, args.dry_run)
            if args.dry_run:
                continue
            if i == n_ticks - 1:
                print(f"resolved zone={body.get('zone')} confidence={body.get('confidence'):.2f} "
                      f"committed={body.get('committed')}")


async def cmd_day(args) -> None:
    """A whole plausible day, sped up: wake in the bedroom, drift through the
    house, battery drains, no fall — the "everything is fine" demo path."""
    schedule = [
        (7, "bedroom"), (8, "kitchen"), (10, "living_room"), (12, "kitchen"),
        (14, "living_room"), (16, "hallway"), (18, "kitchen"), (20, "living_room"),
        (22, "bathroom"), (23, "bedroom"),
    ]
    async with httpx.AsyncClient() as client:
        for hour, zone in schedule:
            print(f"-- {hour:02d}:00 {zone} --")
            if not args.dry_run:
                await _seed_fingerprint(zone, args.band_id)
            for _ in range(2):  # satisfy COMMIT_TICKS
                payload = rf_payload(zone, band_id=args.band_id)
                await _send(client, "/v1/ingest/rf", payload, args.dry_run)
            battery = max(15, 95 - hour * 3)
            hb = heartbeat_payload(band_id=args.band_id, battery_pct=battery)
            await _send(client, "/v1/ingest/heartbeat", hb, args.dry_run)
            if not args.dry_run:
                await asyncio.sleep(args.speed)
    print("day complete — no fall triggered, this is the boring/happy path")


def build_parser() -> argparse.ArgumentParser:
    # ponytail: --band-id/--dry-run are defined ONCE, on a shared `parents=[common]`
    # parser attached to each subcommand (not to the top-level parser too) — argparse
    # applies a parent's defaults again at the subparser, which silently clobbers a
    # value already set at the top level back to its default. Defining it twice
    # made `--dry-run fall` (flag before the subcommand) parse clean but then
    # actually perform live POSTs, which defeats the entire point of --dry-run.
    # One definition point, after the subcommand (`fall --dry-run`), as documented.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--band-id", default=DEFAULT_BAND_ID, help="band to act as (default: %(default)s)")
    common.add_argument("--dry-run", action="store_true", help="print payloads instead of POSTing them")

    p = argparse.ArgumentParser(prog="python -m scripts.simulate_band", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("fall", help="full fall -> alert -> ladder", parents=[common])
    s.add_argument("--cancel", action="store_true", help="press the band button inside the grace window")
    s.set_defaults(fn=cmd_fall)

    s = sub.add_parser("walk", help="a normal day's motion, no alert", parents=[common])
    s.set_defaults(fn=cmd_walk)

    s = sub.add_parser("rf", help="an RF/room-localization scan", parents=[common])
    s.add_argument("--zone", required=True, choices=sorted(CAL["zone_rssi"]))
    s.add_argument("--dwell", type=int, default=10, help="seconds of simulated dwell (default: %(default)s)")
    s.set_defaults(fn=cmd_rf)

    s = sub.add_parser("heartbeat", help="a periodic band heartbeat", parents=[common])
    s.add_argument("--battery", type=int, default=None, help="battery pct (default: random plausible value)")
    s.set_defaults(fn=cmd_heartbeat)

    s = sub.add_parser("day", help="a whole plausible day, sped up", parents=[common])
    s.add_argument("--speed", type=float, default=0.2, help="real seconds per simulated hour (default: %(default)s)")
    s.set_defaults(fn=cmd_day)

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        asyncio.run(args.fn(args))
    except BandError as e:
        print(str(e), file=sys.stderr)
        return e.code if isinstance(e.code, int) else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
