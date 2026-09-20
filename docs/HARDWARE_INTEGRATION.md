# Hardware integration — replacing the simulator with a real band

`scripts/simulate_band.py` stands in for the Arduino UNO Q + LSM6DSOX band
(and the ESP32 BLE beacons) so the backend, the escalation ladder, and the
app can be built and demoed before any hardware exists. It posts the **exact
JSON the firmware will post**, to the **exact endpoints**. (It still sends an
`X-Band-Key` header; the API no longer checks it, there is no auth at all —
see `app/main.py`.) If the simulator and the firmware ever disagree on
shape, `fixtures/*.json` are wrong — fix the fixture, not the firmware.

Contract source of truth: `app/routers/ingest.py` (read the module docstring
first, it's the fill-in template Utsav codes against).

## Endpoints

| Endpoint | Fixture | When firmware calls it | Required fields |
|---|---|---|---|
| `POST /v1/ingest/band` | `fixtures/band_fall.json` | A fall cascade is detected (free-fall dip → impact spike → tilt change → stillness), or any other band event in `BAND_EVENT_TYPES` (`fall_suspected`, `fall_confirmed`, `fall_cancelled`, `button_pressed`, `band_motion_high`, `band_still`, `prolonged_inactivity`) | `band_id`, `type`, `ts`, `battery_pct`. `peak_g`/`free_fall_ms`/`post_impact_tilt_deg`/`stillness_ms` are optional but should be sent for any fall-family event — the alert dashboard shows them. |
| `POST /v1/ingest/band/cancel` | `fixtures/band_cancel.json` | The on-band button is pressed **inside the cancel-window** (`cancel_window_s` from the prior `/band` response, default 30s) | `band_id`, `alert_id` (from the `/band` response), `by` (`"button"` for firmware) |
| `POST /v1/ingest/heartbeat` | `fixtures/heartbeat.json` | Every ~60s per band, cheap liveness + battery ping | `band_id`, `battery_pct` |
| `POST /v1/ingest/rf` | `fixtures/rf_scan.json` | Every BLE/Wi-Fi scan cycle (HARDWARE_SPEC §3.1: BLE scan 3s/20s, Wi-Fi /60s) | `band_id`, `ts`, `beacons` (list of `{uuid, major, minor, rssi}`) and/or `wifi` (list of `{bssid, rssi}`) |

No auth header is required or checked (demo build; `app/main.py`). Unknown
`band_id` → 404. Bad field → 422.

## curl per endpoint (test firmware without the app)

```bash
curl -X POST http://localhost:8000/v1/ingest/band \
  -H "Content-Type: application/json" \
  -d @fixtures/band_fall.json

curl -X POST http://localhost:8000/v1/ingest/band/cancel \
  -H "Content-Type: application/json" \
  -d @fixtures/band_cancel.json    # alert_id must be a real, still-open alert

curl -X POST http://localhost:8000/v1/ingest/heartbeat \
  -H "Content-Type: application/json" \
  -d @fixtures/heartbeat.json

curl -X POST http://localhost:8000/v1/ingest/rf \
  -H "Content-Type: application/json" \
  -d @fixtures/rf_scan.json
```

## Running the simulator

```bash
python -m scripts.simulate_band fall              # full fall -> alert -> ladder
python -m scripts.simulate_band fall --cancel      # fall, then button press in the grace window
python -m scripts.simulate_band walk               # a normal day's motion, no alert
python -m scripts.simulate_band rf --zone kitchen --dwell 300
python -m scripts.simulate_band heartbeat --battery 12   # low-battery path
python -m scripts.simulate_band day                # a whole plausible day, sped up
python -m scripts.simulate_band fall --dry-run     # print the payload, POST nothing
```

Env vars: `DHYAAN_API` (default `http://localhost:8000`), `BAND_KEY` (sent as
`X-Band-Key`; the server ignores it), `BAND_ID` (default `band_a3f2`, seed.py's demo band).
`--band-id` and `--dry-run` go **after** the subcommand (e.g. `fall
--dry-run`), not before.

`rf`/`day` also upsert a matching fingerprint into the `fingerprints`
collection so a fresh demo DB has something to classify against — see the
`# ponytail:` note on `_seed_fingerprint()` in the script. That is a
simulator-only convenience; real hardware never touches Mongo directly.

## Replacing the simulator with real hardware

1. **Pair the band.** Insert it into the `bands` collection before firmware
   ever calls in — unknown bands are rejected, never auto-created:
   ```python
   # via scripts/seed.py's pattern, or a one-off:
   await db().bands.insert_one({"_id": "band_<serial>", "resident_id": "res_eleanor", "battery_pct": 100})
   ```
2. **Point the firmware at the Mac's LAN IP**, not `localhost` (the band is a
   separate device on the network): find it with `ipconfig getifaddr en0`
   (or equivalent) and set the firmware's base URL to
   `http://<that-ip>:8000`.
3. **`BAND_KEY` no longer matters.** The server checks no key (no auth,
   demo build). The firmware may keep sending `X-Band-Key`; it is ignored.
4. **Diff before trusting.** Run `python -m scripts.simulate_band <cmd>
   --dry-run` and capture the firmware's own outgoing JSON (log it, or point
   it at a request-bin) for the same event. They must match **in shape**
   (same keys, same types) — not in value. If they don't, the fixture or the
   firmware is wrong; fix whichever one drifted from `app/routers/ingest.py`.
5. Turn the simulator off (or leave it — it only ever acts as `BAND_ID`, so
   it can't collide with a real paired band using a different `band_id`).

## Placeholder table — what the simulator fakes vs. what firmware must supply

| Field | Simulated range | Real source | Calibration note |
|---|---|---|---|
| `peak_g` | 2.8–6.0 g | Peak `\|a\|` magnitude off `OUTX_L_A` (0x28), read raw over `Wire1` at 208 Hz, scaled by `16.0/32768.0` — **not** `Arduino_LSM6DSOX::readAcceleration()`, which hardcodes the ±4g scale factor and silently under-reports by 4x once `CTRL1_XL` is reprogrammed to `0x56` (±16g). HARDWARE_SPEC §6.3/§6.8. | Re-tune the range from real logged falls (5th–95th percentile), forearm mount specifically — a waist mount reads differently. |
| `free_fall_ms` | 60–120 ms | Duration `\|a\|` stays below `FREEFALL_MIN_G` (software free-fall detector, HARDWARE_SPEC §6.6/§6.9) or the hardware `FREE_FALL` register (0x5D) + `MD1_CFG`→INT1, if the optional solder-header wire is added. | Forearm free-fall is partial (arm flails, body pivots at the feet) — shallower/shorter than academic waist-mount datasets. Re-tune per mount position. |
| `post_impact_tilt_deg` | 40–80° | Change in the 1s-averaged gravity vector orientation before vs. after impact. | Depends on strap tightness and how the resident falls (forward/backward/sideways); re-tune from real fall logs, not a single test drop. |
| `stillness_ms` | 1500–2500 ms | Duration `σ(\|a\|) < 0.1g` and `\|ω\| < 25°/s` post-impact (HARDWARE_SPEC §6.1 phase 4, 2–30s window). | If real thresholds are too tight, genuine falls where someone immediately tries to get up will look like "pop back up, not a fall" — tune against real recovery-attempt footage. |
| `battery_pct` | 55–95% (heartbeat), forced value via `--battery` | `fuelgauge`/ADC read on the power path, or USB power-bank's own reporting if available. | The Anker A1688 has no fuel gauge exposed over the bus in the current BOM — firmware may need a voltage-divider ADC read and a discharge-curve lookup table instead of a clean percentage. |
| beacon `rssi` | per-zone mean (kitchen −55, bathroom −60, bedroom −58, living_room −62, front_door −65, hallway −70 dBm) ± 4 dB jitter | `bleak` BLE scan on the QRB2210/Debian side, **median** (not mean) RSSI per beacon over a 3s window (HARDWARE_SPEC §3.1/§5.2 — median survives body-shadowing outliers that would drag a mean 10dB). | **Must be re-measured per venue** via the §8 site survey (walk every zone, record RSSI). The simulated numbers are guesses for a demo house, not calibrated `TxPower`/distance numbers. |
| `band_id` | `band_a3f2` (or `--band-id`) | The band's flashed serial/identity, set once at provisioning and paired into the `bands` collection (step 1 above). | N/A — this one's just an identity, not a sensor reading. |

## How to tell if it is real

Every payload the simulator builds carries `"simulated": true`. **Today this
does not persist**: `BandEventIn`/`HeartbeatIn`/`RFScanIn`/`BandCancelIn` in
`app/routers/ingest.py` don't declare that field, and pydantic silently drops
unrecognized fields on parse — so it never reaches the stored `events` doc.
This is a known gap, not a design decision; the fix is a one-line addition
to those models plus threading `simulated` through to `emit(payload=...)`,
which belongs to whoever owns `app/` next (out of scope for this simulator
per this handover's file boundaries).

Until that lands, to tell simulated data from real data in the database
today:

- **Check the band identity.** Give the simulator a dedicated `--band-id`
  (e.g. `band_sim_demo`) distinct from every real paired band's id, and
  filter `db.events.find({"source_id": "band_sim_demo"})` /
  `db.bands.find({"_id": "band_sim_demo"})`. This is the reliable method
  right now.
- **Check for round-trip realism.** Real sensor data drifts and correlates
  with real-world noise (RSSI wobble, slightly-off timestamps); the
  simulator's numbers are drawn from the flat `CAL` ranges in
  `scripts/simulate_band.py` and will look suspiciously clean/uniform across
  many events if you eyeball a run in Compass/`mongosh`.
- **Before a demo with a judge or a live resident**, run
  `db.bands.find({}, {"_id": 1, "resident_id": 1})` and confirm the band ids
  present match the physical bands actually worn — not `band_a3f2` from a
  simulator run left running in another terminal.
