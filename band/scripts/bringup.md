# Band bring-up (Phase 0 + 2) — run at the venue

Physical steps the agent cannot do from a laptop. Check each box when done.

## Phase 0 — parts & radio

- [ ] **E1.1** Checkout: UNO Q **4 GB**, Modulino Movement/Buttons/Buzzer (or Plug-and-Make Kit), 4× ESP32-S3, 5 A e-marked USB-C cable, 5 V/3 A power bank, Qwiic, straps
- [ ] **E2.1** Cold-boot (~20 s) — boot animation appears
- [ ] **E2.2** Arduino App Lab connects over USB-C
- [ ] **E2.3** Copy `band/scripts/radio_check.sh` to the board and run it — `hci0` UP RUNNING
- [ ] **E2.4** Join phone hotspot (prefer **5 GHz**), note `ip -4 addr show wlan0`
- [ ] **E2.5** Blink sketch runs (MCU toolchain OK)

Hard gate: board won’t enumerate / Wi-Fi / Blink → iPhone accel fallback (`HARDWARE_SPEC` §12.1).

## Phase 2 — Modulinos + fall sketch

- [ ] Power down. Chain **UNO Q QWIIC → Movement → Buttons → Buzzer**. Power up.
- [ ] Flash `band/bringup/i2c_scan.ino` (or paste into App Lab). Expect bus addresses **`0x6A`, `0x3E`, `0x1E`** on **Wire1**.
- [ ] Deploy `band/fallband/` as an App Lab app (sketch + python).
- [ ] Edit `config.json` → `hub_url` to Mac LAN IP (`ipconfig getifaddr en0`), match `BAND_KEY`.
- [ ] Pair Mongo: `band_unoq01` → `res_eleanor` (see `band/fallband/README.md`).
- [ ] Table slap reads **> 4 g** (proves ±16 g).
- [ ] **0.5 m** cushion drop → buzzer → hub alert (`fall_suspected`).
- [ ] Button A inside grace → `/v1/ingest/band/cancel` accepted.

## Beacons (Phase 3)

- [ ] Flash `beacons/beacon.ino` ×4 with `ROOM_MINOR` 1–4; **label before unplugging**.
- [ ] `python3 band/tools/rssi_monitor.py` on Mac sees all four minors.
- [ ] Measure `tx_power_1m` at 1 m; update sketch + `config.json`.
