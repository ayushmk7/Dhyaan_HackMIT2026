# Dhyaan room anchors — 2-board plan (lab limit: 1× DevKitC + 1× S3-BOX)

Two BLE anchors placed at opposite corners, plus the venue's Wi-Fi BSSIDs in the
fingerprint, resolve a 3–4 zone tabletop home. The onboarding survey prints
`separability_db` per room pair — below ~6 dB, grab an nRF52 board from the
Hackster booth as a third anchor or merge the two colliding zones.

## Placement

| Board | Zone | `ROOM_MINOR` | Why |
|---|---|---|---|
| ESP32-S3-DevKitC-1 | bathroom | 2 | Bathroom-dwell alert works on nearest-beacon alone |
| ESP32-S3-BOX | kitchen | 1 | Opposite corner; later doubles as the in-room chime |

Place them as far apart as the "home" allows. Do not move either after the
survey — fingerprints are tied to positions.

## Flash (one command per board)

One-time setup:
```sh
brew install arduino-cli
arduino-cli config init
arduino-cli config add board_manager.additional_urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core update-index && arduino-cli core install esp32:esp32
arduino-cli lib install NimBLE-Arduino
```

Then, with the board on USB (`ls /dev/cu.usb*` to find the port):
```sh
./flash.sh /dev/cu.usbmodemXXXX 2        # DevKitC → bathroom
./flash.sh /dev/cu.usbmodemXXXX 1 box    # S3-BOX  → kitchen
```
The S3-BOX's screen stays dark under this sketch; that is expected. Label each
board with a marker before unplugging it.

Site UUID (already in the sketch, must match the band's `config.json` and the
backend `beacons` table): `eee6331c-6ea1-4873-83ed-ae648d10e07f` · major `1`.

## After flashing

1. Verify from a Mac: `python3 band/tools/rssi_monitor.py` (expect minors you flashed).
2. Measure `MEASURED_POWER_1M` per board (utsavtodo E8.1): band at exactly 1 m,
   line of sight, take the 15 s median RSSI; write it into the sketch and
   `config.json → rf.beacons[].tx_power_1m`, reflash. The −59 default is a guess.
3. Run the room survey from the app; check `separability_db` per pair.
4. Demo prop: unplugging one beacon mid-demo raises `beacon_offline` and shows
   the degrade-to-unknown story. Rehearse it once.

## No boards at all?

Wi-Fi-only mode still gives home/away plus coarse zones (the band scans BSSIDs
regardless). Old phones running a beacon-simulator app are drop-in anchors —
give each a unique minor in `config.json`.

## boxassist — S3-BOX kitchen beacon + alert screen

<!-- [claude] agent-added (2026-09-20) -->

`boxassist/boxassist.ino` upgrades the kitchen S3-BOX: same iBeacon frame as
`beacon.ino` (minor=1, byte-identical — safe for localization), plus a screen
that polls the backend and takes over with "Are you OK?" when an alert is open.
Tapping the giant button (or pressing the top **Boot** button) POSTs
`/demo/force_ack` and shows a 5 s "glad you're safe" screen.

One-time extra: `arduino-cli lib install LovyanGFX` (display autodetects the
original BOX and BOX-3).

Venue config — edit the two defines at the top of `boxassist/boxassist.ino`:
```c
#define WIFI_SSID "SET_ME_AT_VENUE"   // venue 2.4 GHz SSID
#define WIFI_PASS "SET_ME_AT_VENUE"
```
Left as placeholders, the box runs beacon-only (IDLE screen with a red
offline dot) — it never crashes or stops advertising without Wi-Fi.

Flash (replaces the `flash.sh ... 1 box` step for the kitchen box):
```sh
arduino-cli compile --fqbn esp32:esp32:esp32s3box beacons/boxassist
arduino-cli upload -p /dev/cu.usbmodemXXXX --fqbn esp32:esp32:esp32s3box beacons/boxassist
```
Status dot (bottom-left, IDLE only): green = polling OK, red = offline.
Backend URL and the `dev-key-change-me` bearer are `#define`s near the top if
the ngrok tunnel name changes.

### boxassist audio (voice prompt + chime)

<!-- [claude] agent-added (2026-09-20) -->

The kitchen box now speaks: entering ALERT plays an embedded voice prompt
("Asha, are you okay? Tap the screen if you're okay."), a soft chime repeats
every ~10 s while the alert stays open, and acking plays a short confirm tone.
No new libraries; audio lives in `boxassist/box_audio.h` (ES8311 + I2S, pins
verified against espressif/esp-bsp), `es8311_min.h` (trimmed codec driver) and
`voice_prompt.h` (16 kHz mono PCM, ~106 KB, generated with macOS `say -v
Samantha` + `afconvert`). If the codec/I2S init fails the box logs once and
runs silently — audio can never take down the beacon or screen. Volume is the
`AUDIO_VOLUME_PCT` define in `box_audio.h` (70 = moderate).

Unverified-on-hardware assumptions (compile-only so far): ES8311 register
sequence at MCLK=256*fs, WS pin picked by LovyanGFX board autodetect
(original=47, BOX-3=45), and the Wire-then-LGFX I2C bus handoff.

## bathhelp — DevKitC bathroom beacon + HELP button

<!-- [claude] agent-added (2026-09-20) -->

`bathhelp/bathhelp.ino` REPLACES `beacon.ino` on the bathroom DevKitC: identical
iBeacon frame (minor=2, byte-identical copy), plus when Wi-Fi is configured:

* polls `GET /v1/alerts?state=open` every 2 s — the onboard WS2812 pulses red
  while an alert is open, soft dim green otherwise (goes green on the poll
  after an ack). Beacon-only mode (placeholder SSID) = dim white breathing.
* holding **BOOT** >= 1.5 s = HELP: POSTs `/v1/ingest/band` with
  `{"band_id":"band_unoq01","type":"button_pressed","ts":"<ISO8601 UTC>","battery_pct":100}`
  (matches the backend `BandEventIn` schema exactly). Blue triple-flash = POST
  went out; red/blue alternating = HTTP failure. The backend currently only
  LOGS `button_pressed`; the pending backend hook will open the alert ladder —
  no firmware change needed then. `band_unoq01` must be registered in the
  backend `bands` collection or the POST 404s (`scripts/seed.py` only seeds
  `band_a3f2`).

Venue config: same `WIFI_SSID` / `WIFI_PASS` defines at the top of the sketch.
`LED_PIN` is 48 (some DevKitC v1.1 boards route the WS2812 to 38 instead).

Flash (replaces the `flash.sh ... 2` step for the bathroom board):
```sh
arduino-cli compile --fqbn esp32:esp32:esp32s3 beacons/bathhelp
arduino-cli upload -p /dev/cu.usbmodemXXXX --fqbn esp32:esp32:esp32s3 beacons/bathhelp
```
