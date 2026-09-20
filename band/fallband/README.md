# Fallband — Arduino App Lab app (UNO Q)

MCU sketch + Linux Python agent for Dhyaan. Spec: [`HARDWARE_SPEC.md`](../../HARDWARE_SPEC.md) §5–§6.
Wire contract: [`backend/fixtures/*.json`](../../backend/fixtures/) + `ingest.py` docstring.

## Layout

```
fallband/
├── app.yaml
├── config.json          # hub_url, band_key, thresholds, SITE_UUID
├── python/
│   ├── main.py          # Bridge → HTTP + BLE/Wi-Fi scan
│   ├── payloads.py
│   ├── uplink.py
│   ├── ble_scan.py
│   └── requirements.txt
└── sketch/
    ├── sketch.ino       # 208 Hz / ±16 g fall cascade
    ├── detector.h
    └── sketch.yaml
```

## Before first POST

1. Set `hub_url` to the DEMO hub — the public ngrok URL
   (`https://subsystem-mushroom-grooving.ngrok-free.dev`), which works from
   any WiFi. A Mac LAN IP only works when band and Mac share a network.
2. `band_key` is currently ignored (hub auth was removed); leave the default.
3. Pair the band in Mongo (do this once):

```python
await db().bands.insert_one({
    "_id": "band_unoq01",
    "resident_id": "res_eleanor",
    "thresholds_rev": 1,
    "firmware": "0.1.0",
})
```

4. Join a **phone hotspot** (prefer 5 GHz). Campus Wi-Fi often isolates clients.

## Bridge notify map (MCU → Python)

| Notify | Args | Hub |
|---|---|---|
| `fall` | seq, path, peak_g, ff_min_g, ff_ms, orient, still_std, gyro, jerk, age_ms | `POST /v1/ingest/band` `fall_suspected` |
| `cancel` | seq, age_ms | `POST /v1/ingest/band/cancel` |
| `impact_only` | … | POSTs `fall_suspected` (free_fall_ms=0) — escalates like a fall; `compat.impact_only_local_only=true` restores log-only |
| `button` / `step` | … | button → ingest; steps → heartbeat activity |

Workarounds: `battery_pct: 100` (F-09/A4), `peak_g` clamped to 20 (A7).

## Laptop tests (no board)

```bash
make -C band test-detector   # C++ FSM synthetics
make -C band test-py         # payload keys match fixtures
```

## On-device

1. Open this folder as an App Lab app (or copy to `/home/arduino/ArduinoApps/fallband`).
2. `pip3 install -r python/requirements.txt` on the board if needed.
3. Run the app. Logs: `arduino-app-cli app logs user:fallband -f`
4. Auto-start: `arduino-app-cli properties set default user:fallband`

## Survey mode (after Ayush A1–A2)

```bash
python3 python/main.py --survey kitchen
```

Speeds BLE to 3 s/scan. Hub must accept fingerprint start/stop (A2) for labels to stick.

## Bring-up

See [`../scripts/bringup.md`](../scripts/bringup.md) and [`../scripts/radio_check.sh`](../scripts/radio_check.sh).
