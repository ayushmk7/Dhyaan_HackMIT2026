#!/usr/bin/env python3
"""fallband Linux agent — Bridge → HTTP ingest + BLE/Wi-Fi scan.

HARDWARE_SPEC §5.1–5.4. Wire contract: backend/fixtures/*.json + ingest.py docstring.

MCU notifies (sketch.ino):
  fall(seq, path, peak_g, ff_min_g, ff_ms, orient_deg, still_std_g, gyro_max, jerk, age_ms)
  impact_only(seq, path, peak_g, orient_deg, still_std_g, reason)
  cancel(seq, age_ms)
  button(index, long_press)
  step(peak_g, jerk, gyro_dps)

MCU provides (Python → MCU via Bridge.call):
  set_thresholds, set_param, signal, get_status
"""
from __future__ import annotations

import json
import logging
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any

# Allow `python main.py` from this directory and `python -m` from band/.
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from ble_scan import scan_ibeacons_sync, wifi_scan_bssids  # noqa: E402
from payloads import (  # noqa: E402
    BATTERY_PCT_PLACEHOLDER,
    button_payload,
    cancel_payload,
    fall_payload,
    heartbeat_payload,
    rf_payload,
)
from uplink import Uplink  # noqa: E402

log = logging.getLogger("fallband")

# ---------------------------------------------------------------------------
# Bridge: real App Lab import, or a no-op stub for laptop dry-runs / tests.
# ---------------------------------------------------------------------------
try:
    from arduino.app_utils import App, Bridge  # type: ignore
    ON_DEVICE = True
except ImportError:
    ON_DEVICE = False

    class _StubBridge:
        _handlers: dict[str, Any] = {}

        @classmethod
        def provide(cls, name: str, fn):  # noqa: ANN001
            cls._handlers[name] = fn
            log.info("stub Bridge.provide(%s)", name)

        @classmethod
        def call(cls, name: str, *args):
            log.info("stub Bridge.call(%s, %s)", name, args)
            if name == "get_status":
                return "0,1,1,0,0,0,0,0,3.5"
            return None

    class _StubApp:
        @staticmethod
        def run(user_loop=None):  # noqa: ANN001
            if user_loop:
                while True:
                    user_loop()
                    time.sleep(0.05)

    Bridge = _StubBridge  # type: ignore
    App = _StubApp  # type: ignore


def _find_config() -> Path:
    env = os.environ.get("FALLBAND_CONFIG")
    if env:
        return Path(env)
    candidates = [
        _HERE.parent / "config.json",
        Path("/home/arduino/ArduinoApps/fallband/config.json"),
        Path.cwd() / "config.json",
    ]
    for p in candidates:
        if p.is_file():
            return p
    return candidates[0]


class FallbandAgent:
    def __init__(self, cfg: dict[str, Any], config_path: Path):
        self.cfg = cfg
        self.config_path = config_path
        self.band_id = cfg.get("band_id") or cfg.get("device_id") or "band_unoq01"
        self.compat = cfg.get("compat") or {}
        self.battery_pct = BATTERY_PCT_PLACEHOLDER if self.compat.get("battery_pct_placeholder", True) else 100
        self.uplink = Uplink(
            hub_url=cfg["hub_url"],
            band_key=cfg.get("band_key") or os.environ.get("BAND_KEY", ""),
            spool_dir=os.environ.get("FALLBAND_SPOOL", "/tmp/fallband_spool"),
        )
        self.t0 = time.time()
        self.lock = threading.Lock()
        self.open_alert_id: str | None = None
        self.open_seq: int | None = None
        self.cancel_window_s = int((cfg.get("imu") or {}).get("grace_seconds", 30))
        self.last_room: str | None = None
        self.last_room_ts: float = 0.0
        self.profile_rev = int((cfg.get("profile") or {}).get("rev") or 0)
        self.step_buf: list[dict[str, float]] = []
        self._last_hb = 0.0
        self._last_ble = 0.0
        self._last_wifi = 0.0
        self._wifi_cache: list[dict[str, Any]] = []
        self._survey_room: str | None = None
        self._cfg_mtime = config_path.stat().st_mtime if config_path.is_file() else 0.0

    # ---- MCU → Linux --------------------------------------------------------

    def on_fall(
        self,
        seq,
        path,
        peak_g,
        ff_min_g,
        ff_ms,
        orient_deg,
        still_std_g,
        gyro_max,
        jerk,
        age_ms,
    ):
        seq = int(seq)
        path = int(path)
        peak_g = float(peak_g)
        ff_ms = int(ff_ms)
        orient_deg = float(orient_deg)
        age_ms = int(age_ms)
        # still_ms ≈ age_ms on soft path; free-fall path includes settle+still.
        stillness_ms = max(0, age_ms - ff_ms) if path == 0 else max(0, age_ms)
        body = fall_payload(
            band_id=self.band_id,
            peak_g=peak_g,
            free_fall_ms=ff_ms if path == 0 else 0,
            post_impact_tilt_deg=orient_deg,
            stillness_ms=stillness_ms,
            path=path,
            battery_pct=self.battery_pct,
        )
        log.info("FALL seq=%s peak_g=%.2f ff_ms=%s orient=%.1f → POST /band", seq, peak_g, ff_ms, orient_deg)
        resp = self.uplink.post("/v1/ingest/band", body, critical=True)
        with self.lock:
            if resp and resp.get("alert_id"):
                self.open_alert_id = resp["alert_id"]
                self.open_seq = seq
            if resp and resp.get("cancel_window_s") is not None:
                self.cancel_window_s = int(resp["cancel_window_s"])
                # D-017: push hub grace onto MCU.
                try:
                    Bridge.call("set_param", "grace_s", float(self.cancel_window_s))
                except Exception as e:
                    log.warning("set_param grace_s failed: %s", e)
        self._signal_uplink()

    def on_impact_only(self, seq, path, peak_g, orient_deg, still_std_g, reason):
        # A5: hub rejects impact_only today — log locally for expo ticker.
        log.info(
            "impact_only seq=%s path=%s peak_g=%.2f orient=%.1f reason=%s (local only until A5)",
            seq, path, float(peak_g), float(orient_deg), reason,
        )

    def on_cancel(self, seq, age_ms):
        seq = int(seq)
        with self.lock:
            alert_id = self.open_alert_id
        if not alert_id:
            log.warning("cancel seq=%s but no open alert_id — button only silenced locally", seq)
            return
        body = cancel_payload(band_id=self.band_id, alert_id=alert_id)
        log.info("CANCEL seq=%s alert=%s age_ms=%s", seq, alert_id, age_ms)
        resp = self.uplink.post("/v1/ingest/band/cancel", body, critical=True)
        code = 1
        if resp is None:
            code = 3
        elif resp.get("cancelled") is False or resp.get("status_code") == 409:
            code = 2  # too late
        else:
            with self.lock:
                self.open_alert_id = None
                self.open_seq = None
            code = 1
        try:
            Bridge.call("signal", code)
        except Exception as e:
            log.warning("signal(%s) failed: %s", code, e)

    def on_button(self, index, long_press):
        index = int(index)
        long_press = int(long_press)
        log.info("button %s long=%s", index, long_press)
        if index == 1 and long_press:
            # Button B held 3 s → calibration mode on MCU (stretch).
            try:
                Bridge.call("set_param", "calibrate", 1.0)
            except Exception as e:
                log.warning("calibrate mode: %s", e)
            return
        if index == 0:
            return  # cancel handled via on_cancel while in grace
        body = button_payload(band_id=self.band_id, battery_pct=self.battery_pct)
        self.uplink.post("/v1/ingest/band", body, critical=False)

    def on_step(self, peak_g, jerk, gyro_dps):
        self.step_buf.append({
            "peak_g": float(peak_g),
            "jerk": float(jerk),
            "gyro_dps": float(gyro_dps),
            "t": time.time(),
        })
        # Keep ~30 s window.
        cutoff = time.time() - 30.0
        self.step_buf = [s for s in self.step_buf if s["t"] >= cutoff]

    # ---- config → MCU -------------------------------------------------------

    def push_config_to_mcu(self) -> None:
        imu = self.cfg.get("imu") or {}
        mapping = {
            "ff_g": imu.get("ff_threshold_g"),
            "ff_min_ms": imu.get("ff_min_ms"),
            "ff_max_ms": imu.get("ff_max_ms"),
            "drop_latch_ms": imu.get("drop_latch_ms"),
            "impact_ff_g": imu.get("impact_g_after_ff"),
            "impact_soft_g": imu.get("impact_g_soft"),
            "impact_floor_g": imu.get("impact_g_floor"),
            "impact_ceil_margin": imu.get("impact_g_ceil_margin"),
            "jerk_min_g_s": imu.get("jerk_min_g_per_s"),
            "orient_deg": imu.get("orient_change_deg"),
            "still_ms": imu.get("still_window_ms"),
            "still_std_g": imu.get("still_std_g"),
            "still_gyro_dps": imu.get("still_gyro_dps"),
            "grace_s": imu.get("grace_seconds"),
            "rearm_ms": imu.get("rearm_ms"),
            "worn_lookback_ms": imu.get("worn_lookback_ms"),
            "worn_std_g": imu.get("worn_std_g"),
            "steps_enabled": 1.0 if imu.get("steps_enabled") else 0.0,
            "step_min_peak_g": imu.get("step_min_peak_g"),
            "step_min_interval_ms": imu.get("step_min_interval_ms"),
            "demo_chirp": 1.0 if imu.get("demo_chirp_impact_only") else 0.0,
        }
        cal = self.cfg.get("calibration") or {}
        if cal.get("f_min"):
            mapping["f_min"] = cal["f_min"]
        bias = imu.get("accel_bias") or [0, 0, 0]
        gain = imu.get("accel_gain") or [1, 1, 1]
        mapping.update({
            "bias_x": bias[0], "bias_y": bias[1], "bias_z": bias[2],
            "gain_x": gain[0], "gain_y": gain[1], "gain_z": gain[2],
        })
        for name, val in mapping.items():
            if val is None:
                continue
            try:
                Bridge.call("set_param", str(name), float(val))
            except Exception as e:
                log.warning("set_param %s: %s", name, e)

        try:
            Bridge.call(
                "set_thresholds",
                float(imu.get("ff_threshold_g", 0.40)),
                float(imu.get("impact_g_after_ff", 2.80)),
                float(imu.get("impact_g_soft", 3.50)),
                int(self.cfg.get("thresholds_rev", 0)),
            )
        except Exception as e:
            log.warning("set_thresholds: %s", e)

    def maybe_reload_config(self) -> None:
        try:
            mtime = self.config_path.stat().st_mtime
        except OSError:
            return
        if mtime <= self._cfg_mtime:
            return
        self._cfg_mtime = mtime
        self.cfg = json.loads(self.config_path.read_text(encoding="utf-8"))
        log.info("reloaded %s", self.config_path)
        self.push_config_to_mcu()

    # ---- timers -------------------------------------------------------------

    def _signal_uplink(self) -> None:
        try:
            Bridge.call("signal", 4 if self.uplink.uplink_ok else 3)
        except Exception:
            pass

    def heartbeat_tick(self) -> None:
        period = float(self.cfg.get("heartbeat_period_s", 30))
        now = time.time()
        if now - self._last_hb < period:
            return
        self._last_hb = now
        activity = None
        if self.step_buf:
            peaks = [s["peak_g"] for s in self.step_buf]
            activity = {
                "steps": len(self.step_buf),
                "peak_g_p50": sorted(peaks)[len(peaks) // 2],
                "peak_g_max": max(peaks),
            }
        body = heartbeat_payload(
            band_id=self.band_id,
            uptime_s=int(now - self.t0),
            battery_pct=self.battery_pct,
            profile_rev=self.profile_rev,
            activity=activity,
        )
        resp = self.uplink.post("/v1/ingest/heartbeat", body, critical=False)
        self._signal_uplink()
        drained = self.uplink.drain_spool()
        if drained:
            log.info("drained %d spooled events", drained)
        # Stretch: apply walking profile from reply (F-10 / PRD §8.7).
        if isinstance(resp, dict) and resp.get("profile"):
            prof = resp["profile"]
            soft = prof.get("impact_g_soft")
            after = prof.get("impact_g_after_ff")
            rev = int(resp.get("profile_rev", self.profile_rev))
            if soft is not None and after is not None:
                try:
                    Bridge.call(
                        "set_thresholds",
                        float((self.cfg.get("imu") or {}).get("ff_threshold_g", 0.40)),
                        float(after),
                        float(soft),
                        rev,
                    )
                    self.profile_rev = rev
                except Exception as e:
                    log.warning("profile apply: %s", e)

    def ble_tick(self) -> None:
        rf = self.cfg.get("rf") or {}
        period = float(rf.get("ble_scan_period_s", 20))
        if self._survey_room:
            period = 3.0
        now = time.time()
        if now - self._last_ble < period:
            return
        self._last_ble = now
        site = rf.get("site_uuid") or ""
        dur = float(rf.get("ble_scan_seconds", 3))
        min_n = int(rf.get("min_adverts_n", 3))
        try:
            beacons = scan_ibeacons_sync(site, dur, min_adverts=min_n)
        except Exception as e:
            log.warning("BLE scan failed: %s", e)
            beacons = []
        # Strip helper `n` before wire (fixture shape is uuid/major/minor/rssi).
        wire_beacons = [
            {"uuid": b["uuid"], "major": b["major"], "minor": b["minor"], "rssi": b["rssi"]}
            for b in beacons
        ]
        body = rf_payload(
            band_id=self.band_id,
            beacons=wire_beacons,
            wifi=list(self._wifi_cache),
        )
        if self._survey_room:
            body["survey_zone"] = self._survey_room  # hub ignores until A2
            log.info("survey %s: %d beacons", self._survey_room, len(wire_beacons))
        resp = self.uplink.post("/v1/ingest/rf", body, critical=False)
        if isinstance(resp, dict) and resp.get("zone"):
            self.last_room = resp["zone"]
            self.last_room_ts = time.time()
            log.info("room=%s conf=%s", resp.get("zone"), resp.get("confidence"))

    def wifi_tick(self) -> None:
        rf = self.cfg.get("rf") or {}
        period = float(rf.get("wifi_scan_period_s", 60))
        now = time.time()
        if now - self._last_wifi < period:
            return
        self._last_wifi = now
        try:
            self._wifi_cache = wifi_scan_bssids()
        except Exception as e:
            log.debug("wifi tick: %s", e)
            self._wifi_cache = []

    def tick(self) -> None:
        self.maybe_reload_config()
        self.heartbeat_tick()
        self.wifi_tick()
        self.ble_tick()


def load_config(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> None:
    argv = list(argv if argv is not None else sys.argv[1:])
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    config_path = _find_config()
    if not config_path.is_file():
        log.error("config not found at %s — copy fallband/config.json and set hub_url/band_key", config_path)
        sys.exit(1)
    cfg = load_config(config_path)
    agent = FallbandAgent(cfg, config_path)

    # Optional: python main.py --survey kitchen
    if "--survey" in argv:
        i = argv.index("--survey")
        room = argv[i + 1] if i + 1 < len(argv) else "kitchen"
        agent._survey_room = room
        # Speed scans for fingerprint collection (E8.2).
        agent.cfg.setdefault("rf", {})["ble_scan_period_s"] = 3
        log.info("survey mode room=%s (3 s scan period)", room)

    Bridge.provide("fall", agent.on_fall)
    Bridge.provide("impact_only", agent.on_impact_only)
    Bridge.provide("cancel", agent.on_cancel)
    Bridge.provide("button", agent.on_button)
    Bridge.provide("step", agent.on_step)

    def loop():
        agent.tick()
        time.sleep(0.2)

    # Push thresholds once Python is up (MCU may have booted first).
    def boot():
        time.sleep(2.0 if ON_DEVICE else 0.0)
        agent.push_config_to_mcu()
        log.info(
            "fallband up band_id=%s hub=%s on_device=%s",
            agent.band_id, cfg.get("hub_url"), ON_DEVICE,
        )

    threading.Thread(target=boot, daemon=True).start()

    if "--once" in argv:
        # Laptop smoke: one tick then exit (used by make test-py indirectly).
        boot()
        agent.tick()
        return

    App.run(user_loop=loop)


if __name__ == "__main__":
    main()
