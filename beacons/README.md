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
