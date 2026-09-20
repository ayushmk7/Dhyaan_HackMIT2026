# Dhyaan room beacons (ESP32-S3)

Four boards, one sketch, one edited line each. ~10 min for the first board, ~3 min each after.

## One-time Arduino IDE setup (utsavtodo E7.1)
1. Preferences → Additional Boards Manager URLs:
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
2. Boards Manager → install **esp32 by Espressif Systems** → select **ESP32S3 Dev Module**
3. Library Manager → install **NimBLE-Arduino**

## Per board
| Board | `ROOM_MINOR` | Room | Sharpie label |
|---|---|---|---|
| 1 | 1 | kitchen | K |
| 2 | 2 | bathroom | B |
| 3 | 3 | bedroom | BR |
| 4 | 4 | front_door | D |

Edit `ROOM_MINOR`, flash, **label the board with a marker before unplugging it** —
four identical black PCBs in a bag is a 45-minute mistake (HARDWARE_SPEC §3.4).

Site UUID (already in the sketch, generated for this deployment):
`eee6331c-6ea1-4873-83ed-ae648d10e07f` — the band agent's `config.json` and the
backend `beacons` table must use the same UUID / major / minors.

## After flashing (don't skip)
- **Measure `MEASURED_POWER_1M` per beacon** (utsavtodo E8.1): hold the band 1.0 m
  away, line of sight, take the 15 s median RSSI, write it into both the beacon's
  sketch and `config.json → beacons[].tx_power_1m`. The −59 default is only a guess
  and every distance estimate scales off this byte.
- Power each from any USB wall wart (mains — battery life is not a concern tonight).
- Demo prop: unplugging one beacon mid-demo shows the `beacon_offline` event and the
  degrade-to-unknown story (§3.5) — rehearse it once.

Boxes vs DevKitC: either works — the sketch is identical. Prefer the bare DevKitC
boards for the four room anchors (smaller, cheaper to lose); keep an S3-BOX as the
spare / fifth zone.
