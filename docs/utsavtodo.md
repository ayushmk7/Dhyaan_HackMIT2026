# Utsav — hardware + firmware

Your lane: **E (band, beacons, firmware, site survey)**.
Not yours: backend and ML are Ayush's ([`ayushneedtodo.md`](./ayushneedtodo.md)), voice and the app are Abhinav's ([`abhinavtodo.md`](./abhinavtodo.md)).

Source of truth: [`HARDWARE_SPEC.md`](./HARDWARE_SPEC.md) — read §6 (fall cascade) and §3 + §8 (RF) before you wire anything. Why the specs say what they say: [`DECISIONS.md`](./DECISIONS.md).

## Status — 2026-09-19 evening (code)

| | |
|---|---|
| **Done in repo** | MCU sketch + `detector.h` + laptop tests · App Lab `python/main.py` uplink (fall/cancel/heartbeat/rf) · `config.json` · `rssi_monitor.py` · beacon sketch · D-016–D-020 · `make -C band test` |
| **Still needs hardware** | Parts checkout, radio check on board, Modulino flash/verify, beacon flash/label, IMU cal, site survey (blocked on Ayush A1–A3) |
| **Venue checklist** | [`band/scripts/bringup.md`](./band/scripts/bringup.md) |

## ⚠ Changed Saturday evening — read before you continue (`DECISIONS.md`)

- **Drop from 0.5 m onto a firm cushion, not 1 m onto a mattress** (D-008). A 1 m drop falls ~450 ms and `FF_MAX_MS = 400` rejects it as "dropped, not worn". E9.4, E12.1 and E12.3 below are updated.
- **Don't fit `FF_THRESHOLD_G` from the drops** (D-008). Keep 0.40 g. Drops read ≈0 g and would push it to ~0.1 g, below what a real forearm fall reaches. E9.5 is updated; do record `F_min` into `config.json → calibration.f_min`.
- **`worn` is judged on the 10 s before an event**, not the stillness after it (D-008). Otherwise the "unworn never alerts" rule vetoes the drop. E5.4 is updated.
- **Ring buffer 1024 samples, not 512** (D-008), so the fall trace is still in memory when the event is sent. E4.2 is updated.
- **No `battery_pct`** (D-013). A USB power bank reports no charge level, and a voltage divider can't estimate it. The backend currently *requires* it (follow-up F-09 for Ayush); until that lands, send the field as the backend demands and tell the team the value is a placeholder.
- **BLE fallback is a spare ESP32-S3 scanner or a Mac, not an iPhone** (D-013). E6.3's gate is updated.
- **Stretch — walking profile, band side (~45 min, D-009, `HARDWARE_SPEC.md` §6.9):** step detector on the MCU (`Bridge.notify("step", …)`); Python aggregates a walking summary onto each heartbeat; apply the profile from the heartbeat reply via `set_thresholds` (clamped locally to [2.5 g, `F_min` − 0.3 g]); button B held 3 s = calibration mode; `demo_chirp_impact_only` flag. Tests 13–17 in §10.2. Drop it if it isn't working by H18.
- **Arduino track needs the real band at judging.** Cut #6 below (a phone instead of the band) gives that track up.

## Do these in the first 15 minutes

- [ ] **Z1** Get to the hardware hub **now** and check out: UNO Q, Modulino Movement (or a bare LSM6DSOX), Qwiic cables, and 3–4 ESP32-S3 boards for beacons. First come, first served, and HackMIT publishes no inventory. — 20 min — ⛔ BLOCKER
- [ ] **Z2** If there is no IMU in the building, say so in the group chat immediately. **The UNO Q has no onboard IMU** and the whole band depends on an external one. This changes the plan at H0, not at H10. — 5 min — ⛔ BLOCKER
- [ ] **Z3** Grab a USB-C power meter and a 3 A-rated cable while you are there. Arduino publishes no current figure for this board, so the entire power budget is guesswork until you measure it. — 5 min

## Four traps that will each cost you hours

The spec found these by reading datasheets against library source. Handle them in E1–E2, before you write detection logic.

| # | Trap | What happens if you miss it |
|---|---|---|
| 1 | Stock `Arduino_LSM6DSOX` sets `CTRL1_XL=0x4A` = **±4 g** | Every real impact clips at 4.0 g. Your 2.8 g threshold sits under a ceiling that flattens the signal, and detection "mysteriously" underperforms. Set `0x56` (208 Hz, ±16 g) and read raw registers — `readAcceleration()` hard-codes a ÷4 scale |
| 2 | Modulino datasheet I²C addresses are 8-bit left-shifted; the library divides by 2 | A bus scan prints different addresses than the datasheet. Scan first, write down what you actually see |
| 3 | Qwiic on the UNO Q is **`Wire1` (I2C4)**, not `Wire` | Nothing enumerates and you assume the board is dead |
| 4 | `VBAT` is "reserved for future features"; board wants 3 A | Use a USB-C power bank. Never strap a bare pouch cell to a human arm |

**Your seam with Ayush**: the band POSTs event JSON to `/v1/ingest/band`. Agree the exact payload at **H2** and commit it as a fixture file. He builds against your fixture; you build against his endpoint. Neither of you waits.

## The clock

Hacking started **Saturday 11:00** and stops **Sunday 11:00**. Expo judging is **Sunday 12:00–14:30**, panel judging 14:45–16:45. Hour numbers below are hours since Saturday 11:00.

| Hour | Clock | Gate |
|---|---|---|
| H0 | Sat 11:00 | Start |
| H6 | Sat 17:00 | Hard gates on anything with an external dependency |
| H12 | Sat 23:00 | Feature freeze on anything not on the critical path |
| **H13** | **Sun 00:00** | **⛔ Plume project must exist or you cannot be judged** |
| H18 | Sun 05:00 | Integration freeze — no new code paths after this |
| H22 | Sun 09:00 | Rehearse the demo three times, on the real hardware |
| H24 | Sun 11:00 | Hacking stops |

## The critical path — all three of you sit on it

```
Utsav: band fires an event   →   Ayush: ingest + FSM   →   Abhinav: the phone rings
                                         ↓
                              Abhinav: agent classifies the answer
                                         ↓
                              Ayush: FSM escalates   →   Abhinav: family's phone lights up
```

**That chain is the demo.** A fall goes in, a phone rings, a person answers, the right human gets called. Everything else — the cameras, the room tracking, the learned baseline, the chat — makes it a product and wins the data prizes, but if that chain does not run end to end you have nothing to show a judge.

## The interface contract — agree these at H1, do not renegotiate at H14

Three people cannot integrate at hour 18 unless the seams were frozen at hour 1. Each seam has one owner who writes it down and one consumer who codes against it.

| Seam | Owner writes | Consumer codes against | Frozen by |
|---|---|---|---|
| **Band → backend** | Utsav posts the exact event JSON he will send | Ayush's `/v1/ingest/band` accepts it | **H2** |
| **Backend → app** | Ayush publishes the endpoint list + websocket payloads | Abhinav's API client + fixtures mirror them | **H2** |
| **FSM → voice** | Ayush exposes "place a call to X for alert Y" and an "agent classified it as Z" callback | Abhinav's bridge calls exactly those | **H3** |
| **Band → RF** | Utsav posts the RSSI scan payload shape | Ayush's localizer consumes it | **H4** |

The rule: **the owner writes a real example payload into the repo as a `.json` fixture file, not a message in Discord.** The consumer builds against the fixture. If the fixture changes, the owner tells the consumer out loud.

## When you are behind — cut in this order

You will be behind. Cut from the bottom up, never from the top.

| # | Cut | Lose | Still works |
|---|---|---|---|
| 1 | RAG chat | The "ask about mum" moment | Timeline still shows events |
| 2 | Camera + VLM | ADL tracking, the B2B story | B2C fall + location demo intact |
| 3 | Baseline learner | "We learn her normal" | Hard-rule alerts still fire |
| 4 | RF localization | Room-level location | Fall detection unaffected |
| 5 | Second contact in the ladder | Redundancy | Ladder still escalates once |
| 6 | The physical band | The object judges can touch — **and the Arduino track**, which requires live UNO Q + Modulino input | A phone posting the same JSON demos the same system |

**Never cut:** the event table, the FSM, the outbound call.

## Truth in demos

Write these on the whiteboard. Say them out loud to judges. Being the team that volunteers which parts are synthetic buys more credibility than being the team that gets caught.

- The 14 days of resident history come from a seed script. The learner running on it is real.
- The "home" is a taped-out floor plan with four beacons 3–8 m apart at chest height.
- The band is a dev board on a strap, not a product.
- We do not dial 911. This is a research prototype — not FDA-cleared, and it cannot detect all falls. (Don't say "not a medical device" — `PRODUCT_SPEC.md` §8.7, D-003.)

## Two things that are already known to be true

- **Submission is on Plume, not Devpost**, and the project must exist before Sunday 00:00.
- **Prior art is close.** [LifeLine](https://devpost.com/software/lifeline-5prxbs) (TerraHacks 2025) already does fall detection → automated LLM phone call. The one thing nobody has done is **call the fallen person first and let their answer choose the escalation tier**. That is the whole differentiator — point the demo at it and say so.

---

## ⛔ Spec conflicts you must resolve at H1 — before firmware locks its POST format

The two specs were written in parallel and disagree in three places. **Resolve them out loud at the H1 standup, write the decision in the repo, and do not let anyone code past it.** The resolutions below are the defaults; overrule them together if you have a reason.

| # | Conflict | Resolution |
|---|---|---|
| 1 | **Band → backend endpoint.** `HARDWARE_SPEC` §5.4–5.7 says `POST /v1/events`, rich `fallband.event.v1` schema, no auth. `TECHNICAL_PRD` §10.5 says `POST /v1/ingest/band` + `/ingest/rf` + `/ingest/band/cancel`, simpler payload, `X-Band-Key` HMAC. | **PRD wins** — it owns the API surface and the app codes against it. Utsav conforms. Drop the HMAC to a shared static header for the demo if it costs more than 20 minutes. |
| 2 | **Sensor config.** PRD §4.1 said 104 Hz / ±8 g / GPIO interrupt. `HARDWARE_SPEC` §6 says 208 Hz / ±16 g / Bridge.notify. | **Hardware spec wins** — its numbers came from reading the datasheet against library source, and the ±4 g clipping trap is real. PRD §4.1 has been corrected to match. |
| 3 | **Resolution naming.** `POST /alerts/{id}/resolve` takes `resolution: "fell_ok"`; the FSM state is `FELL_BUT_FINE`. | Pick one string, grep the repo, done in five minutes. Leave it and you will debug it at H19. |

Also flagged, lower stakes: REST auths with `Authorization: Bearer <JWT>` while the websocket takes `?token=<jwt>` in the query string. Unavoidable for WS, but query-string tokens land in server logs — fine for a hackathon, worth saying out loud if a judge asks about security.
## E. Hardware + firmware

Owner: Utsav. Scope: UNO Q band (MCU sketch + Linux Python), Modulino IMU chain, ESP32 beacons, RF site survey, IMU calibration, power/battery, physical band build, fall test rig. Excludes: FastAPI/DB/backend, Twilio+Deepgram bridge, CV/VLM, server-side RF classifier (k-NN/HMM), baseline learner, RAG, React Native app — the band only *collects* RSSI and POSTs observations.

**⚠ Schema conflict to resolve before writing a single POST call:** `HARDWARE_SPEC.md §5.4–5.7` specifies `POST /v1/events` with a rich `fallband.event.v1` JSON (nested `detector`/`location`/`window` blocks, no auth mentioned). `TECHNICAL_PRD.md §10.5` specifies a *different, simpler* contract: `POST /v1/ingest/band` with `{"band_id","kind","ts","payload":{peak_g,free_fall_ms,post_impact_tilt_deg,stillness_ms,battery_pct}}`, `POST /v1/ingest/band/cancel`, `POST /v1/ingest/rf` with `{"band_id","ts","wifi":{bssid:rssi},"ble":{beacon_id:{rssi,n}},"scan_ms"}`, `POST /v1/ingest/heartbeat`, and **HMAC auth via `X-Band-Key`** (not the plain unauthenticated POST the hardware spec assumes). These cannot both be right. Task E1.3 below locks this down at hour 0 — do not let A/C build divergent assumptions for hours.

---

### E1. Parts checkout & contract lock (hour 0–1)

- [ ] **E1.1** Check out core-path parts at the hardware hub — 15 min — ⛔ BLOCKER — _done when:_ you are holding all of: UNO Q **4 GB** (ABX00173, not 2 GB), Modulino Movement, Modulino Buttons (or Plug-and-Make-Kit substitute if sold out), Modulino Buzzer, 4× ESP32-S3-DevKitC-1 (Espressif-sponsored lab stock), USB-C power bank rated **5 V/3 A** (e.g. Anker A1688), a **5 A e-marked USB-C↔C cable** (not a phone charge cable), Qwiic cables, VELCRO forearm straps.
  - If Modulino Buttons is sold out: grab **Arduino Plug and Make Kit (AKX00069)** instead — contains Movement/Buttons/Buzzer/Pixels + a spare UNO R4 WiFi you can use as a backup beacon.
  - Ask the hardware lab directly whether they stock ESP32-S3-DevKitC-1 boards — inventory is unconfirmed in writing.
- [ ] **E1.2** Verify cable/board before leaving the desk — 5 min — 🔁 PARALLEL-OK — _done when:_ cable is confirmed 5 A e-marked (check packaging/markings) and the UNO Q box says 4 GB / 32 GB.
- [x] **E1.3** Lock the band→backend wire contract with whoever owns the FastAPI hub (out of your scope to build, but you must agree on the shape) — 10 min — ⛔ BLOCKER (gates E5, E6, E8) — _done when:_ you have written down, in `config.json` or a shared note, the exact chosen: endpoint paths (`/v1/ingest/band` vs `/v1/events`), payload field names, and whether `X-Band-Key` HMAC signing is required on hour-1 builds or deferred. Default to the **PRD `/v1/ingest/band` + `/v1/ingest/rf` + `/v1/ingest/heartbeat` contract** (§10.5) since that's what the backend is more likely to implement against — but get it confirmed, don't assume. **✓ Locked: fixtures + `X-Band-Key` static header; see `band/fallband/config.json`.**
- [x] **E1.4** Power planning sanity check — 2 min — 🔁 PARALLEL-OK — _done when:_ you can state out loud why the band uses a USB-C power bank and not a LiPo pouch cell: **`VBAT` (3.8 V, JMISC) is documented "reserved for system design and future features," not a battery input, and the UNO Q wants 5 V @ 3 A** — no LiPo boost board on hand does that safely, and a bare pouch cell must never be strapped to a human forearm (§4.5).

---

### E2. UNO Q bring-up, radio verification, flashing (hour 0–3)

- [ ] **E2.1** Unbox and cold-boot the UNO Q over the 5 A cable — 10 min — ⛔ BLOCKER — _done when:_ boot animation appears; do not panic before ~20 s (QRB2210 signals ready to the STM32 about 20 s after rails come up).
- [ ] **E2.2** Install Arduino App Lab (macOS) and connect over USB-C — 10 min — ⛔ BLOCKER — _done when:_ the board appears as a device in App Lab.
- [ ] **E2.3** `[UNVERIFIED]` — run the BLE/radio check FIRST, before any sketch work — 10 min — ⛔ BLOCKER — _done when:_ all commands below run without error and `hci0` shows `UP RUNNING` with a BD address. This is flagged as the single highest-risk unknown in the whole build (spec §13 item 1) — do it now, not at hour 12.
  ```bash
  bluetoothctl --version              # expect BlueZ 5.6x
  hciconfig -a                        # expect hci0, UP RUNNING, with a BD address
  sudo btmgmt info                    # look for 'le' and 'adv' in supported settings
  sudo btmgmt find -l                 # LE-only discovery; should print nearby BLE devices
  python3 -c "import bleak; print(bleak.__version__)" || pip3 install bleak
  ```
  If `hci0` is missing: `sudo systemctl status bluetooth`, `sudo rfkill list`, `sudo rfkill unblock bluetooth`, `dmesg | grep -i blue`. **If still dead, do not keep debugging past hour 6 — see E6.4's hard gate.**
- [ ] **E2.4** Join Wi-Fi via a phone hotspot forced to **5 GHz** — 10 min — ⛔ BLOCKER — _done when:_ `nmcli device` shows `wlan0` connected and `ip -4 addr show wlan0` prints an IP. Forcing 5 GHz keeps Wi-Fi off the 2.4 GHz band the BLE scanner shares (shared PCB antenna, §3.1) — bring a hotspot, do not rely on campus Wi-Fi (MIT/eduroam is WPA2-Enterprise and often client-isolated).
  ```bash
  sudo nmcli d wifi connect "<SSID>" password "<PASSWORD>"
  nmcli device
  ip -4 addr show wlan0
  ```
- [ ] **E2.5** Blink test — 5 min — ⛔ BLOCKER — _done when:_ a new App Lab sketch with Blink pasted in makes the LED blink, confirming the MCU toolchain works.
  > **🚦 HARD GATE — hour 3.** If the board will not enumerate, join Wi-Fi, or flash Blink: stop, do not spend hour 4 debugging it. Fall back to the iPhone accelerometer web page (spec §12.1) as the interim fall-event source and keep this ticket open in the background.

---

### E3. Modulino chain wiring + I2C bring-up (hour 3–5)

- [ ] **E3.1** Power down, chain the Qwiic bus, power up — 5 min — ⛔ BLOCKER — _done when:_ **UNO Q QWIIC → Movement J1**, **Movement J2 → Buttons J1**, **Buttons J2 → Buzzer J1** are connected (Qwiic is keyed, cannot go in backwards) and the board is powered again.
- [ ] **E3.2** Install `Arduino_Modulino` library — 5 min — 🔁 PARALLEL-OK — _done when:_ library installs via App Lab UI (preferred, auto-writes `sketch.yaml`) or `arduino-cli lib install "Arduino_Modulino"`.
- [ ] **E3.3** **TRAP — run a raw I2C bus scan before writing any sensor code** — 10 min — ⛔ BLOCKER — _done when:_ the scan below prints addresses and you have **written down what you actually saw**, not what the datasheet says. Modulino datasheet addresses are 8-bit left-shifted; the library divides by 2, so the numbers in your code and the numbers a bus scanner prints are different: Movement lib `0x6A` → bus prints `0x6A` (7-bit exception); Buttons lib `0x7C` → bus prints `0x3E`; Buzzer lib `0x3C` → bus prints `0x1E`.
  ```cpp
  #include <Wire.h>
  void setup() {
    Serial.begin(); Wire1.begin();          // Wire1 = Qwiic = I2C4 on UNO Q
    for (uint8_t a = 1; a < 127; a++) {
      Wire1.beginTransmission(a);
      if (Wire1.endTransmission() == 0) { Serial.print("found 0x"); Serial.println(a, HEX); }
    }
  }
  void loop() {}
  ```
  Expect `0x6A`, `0x3E`, `0x1E`. Nothing found → **you used `Wire` instead of `Wire1`** (see E3.4 — this is the #1 UNO Q + Modulino mistake). Some missing → reseat Qwiic cables, they unlatch easily.
- [ ] **E3.4** **TRAP — hard-code the bus object as `Wire1`, never `Wire`, everywhere in this project** — 2 min (a rule, not a build step) — ⛔ BLOCKER — _done when:_ every I2C call in the sketch uses `Wire1`. The Qwiic connector on the UNO Q is the **secondary I2C bus (I2C4)** → the Arduino object is `Wire1`; `Wire` is D20/D21 on the UNO headers, which is not where the Modulinos are. `Modulino.begin()` already defaults to `Wire1` on `ARDUINO_UNO_Q`, so calling that is safe — any raw `Wire.` in your own code is the bug.
- [ ] **E3.5** "Hello sensor" smoke test with the stock library — 5 min — ⛔ BLOCKER — _done when:_ flat on a table, one axis reads ≈ **1.00 g**, others ≈ 0.
  ```cpp
  #include <Arduino_Modulino.h>
  ModulinoMovement movement;
  void setup() { Serial.begin(); Modulino.begin(); movement.begin(); }
  void loop() {
    if (movement.available()) {
      movement.update();
      Serial.print(movement.getX()); Serial.print(",");
      Serial.print(movement.getY()); Serial.print(",");
      Serial.println(movement.getZ());
    }
    delay(1000);
  }
  ```
  **If it reads ≈0.25 g of what you expect, you already hit the ±4 g scaling bug** — see E4.1, don't debug wiring, go fix the register config.
- [ ] **E3.6** Buzzer + Buttons smoke test — 5 min — 🔁 PARALLEL-OK — _done when:_ `buzzer.tone(2000, 200);` audibly sounds, and `buttons.isPressed('A')` / `buttons.setLeds(true,false,false)` respond to a physical press.
  > **🚦 HARD GATE — hour 5.** Not printing sane g values? Swap the Qwiic cable, then the Modulino itself. Still dead → fall back to the iPhone feed (§12.1) and keep debugging in the background.

---

### E4. Fall-detection sketch on the STM32 (hour 5–10)

> **Code complete** in `band/fallband/sketch/` — still needs flash + cushion-drop verify on hardware (see `band/scripts/bringup.md`).

- [x] **E4.1** **TRAP — fix the ±4 g clipping bug before writing any threshold logic** — 20 min — ⛔ BLOCKER — _done when:_ a hard table slap reads **> 4 g** instead of pinning at 4.0, and resting magnitude is 1.00 g. The stock `Arduino_LSM6DSOX` library (which `ModulinoMovement` wraps) sets `CTRL1_XL = 0x4A` → 104 Hz, **±4 g**. Every real impact clips at 4.0 g and the 2.8 g fall threshold can never see a real signal. Fix: after `movement.begin()`, rewrite the registers over `Wire1`, and **read raw registers instead of `readAcceleration()`**, which hard-codes a `data * 4.0 / 32768.0` scale that becomes wrong (4× too small) at ±16 g.
  ```cpp
  static const uint8_t IMU_ADDR=0x6A, CTRL1_XL=0x10, CTRL2_G=0x11,
                       TAP_CFG0=0x56, TAP_CFG2=0x58, FREE_FALL=0x5D, MD1_CFG=0x5E,
                       OUTX_L_A=0x28, OUTX_L_G=0x22;
  void wr(uint8_t reg, uint8_t val) {
    Wire1.beginTransmission(IMU_ADDR); Wire1.write(reg); Wire1.write(val); Wire1.endTransmission();
  }
  void configureIMU() {
    wr(CTRL1_XL, 0x56);   // ODR 208 Hz, FS_XL=01 -> +/-16 g, LPF2 on
    wr(CTRL2_G,  0x5C);   // 208 Hz, +/-2000 dps
    wr(TAP_CFG0, 0x41);   // latched IRQ, clear-on-read
    wr(TAP_CFG2, 0x80);   // INTERRUPTS_ENABLE
    wr(FREE_FALL,0x8A);   // FF_DUR 17 (~82 ms @208 Hz), FF_THS 250 mg
    wr(MD1_CFG,  0x10);   // INT1_FF (informational only — INT1 is header-only, not on Qwiic)
  }
  // scaling for raw reads: A_SCALE = 16.0f/32768.0f;  G_SCALE = 2000.0f/32768.0f;
  ```
  Note `FS_XL` bit ordering is non-obvious: `0=±2g, 1=±16g, 2=±4g, 3=±8g`. Verify against ST's driver if unsure (`lsm6dsox_reg.h`).
- [x] **E4.2** Build the 1024-sample ring buffer + fixed-period 208 Hz loop — 30 min — ⛔ BLOCKER — _done when:_ loop uses a `micros()` deadline (`PERIOD_US = 4808`), never `delay()`, and pushes raw `int16` samples into a 1024-slot ring (`& 1023` mask). (Was 512 — too short to hold the fall trace at confirmation, D-008.)
- [x] **E4.3** Implement `IDLE → FREEFALL → IMPACT`, log-only — 45 min — ⛔ BLOCKER — _done when:_ dropping the board onto a cushion from ~30 cm prints a clean state transition to `Serial`.
  - Thresholds to start from `config.json` (not literals in the sketch): `FF_THRESHOLD_G=0.40`, `FF_MIN_MS=80`, `FF_MAX_MS=400`, `IMPACT_G_AFTER_FF=2.80`, `IMPACT_G_SOFT=3.50`, `JERK_MIN_G_PER_S=30`.
- [x] **E4.4** Add `POST_IMPACT_STILL` (orientation change + stillness σ) — 45 min — ⛔ BLOCKER — _done when:_ `orient_deg = acos(dot(g_pre,g_post))` and `std_g` over a 2 s window compute correctly against the pseudocode in spec §6.7.
  - `ORIENT_CHANGE_DEG=45`, `STILL_WINDOW_MS=2000`, `STILL_STD_G=0.12`, `STILL_GYRO_DPS=25`.
- [x] **E4.5** Add `CONFIRMED` → buzzer/LED pattern → button cancel → `REARM` — 30 min — ⛔ BLOCKER — _done when:_ pressing button 'A' during the grace window transitions to `REARM` and silences the buzzer; letting the 30 s timer expire also transitions to `REARM`.
- [x] **E4.6** Wire `Bridge.notify("fall", ...)` (and `impact_only`, `cancel`) — 20 min — ⛔ BLOCKER (gates E5) — _done when:_ a Python `Bridge.provide()` handler on the Linux side receives the notification, confirmed via `Serial`/log output. **Rule: `confirm_fall()` fires ONCE, immediately, at the start of the grace window — never wait for the 30 s to elapse before uploading**, so a band that dies on impact still triggers the hub's independent escalation timer.
  - Never call `Bridge.call()`, `Serial.print()`, or `Monitor.print()` inside a `provide()` callback — use `provide_safe()` for anything touching Arduino APIs.
  - Laptop proof: `make -C band test-detector` (D-020). On-device Bridge proof still needs a flash.

---

### E5. Linux-side Python — cancel window + event POST (hour 6–13)

> **Code complete** in `band/fallband/python/` — set `hub_url` / `band_key`, pair `band_unoq01`, flash app on board.

- [x] **E5.1** Scaffold `python/main.py` with `Bridge.provide()` handlers for `fall`/`impact_only`/`cancel` — 30 min — ⛔ BLOCKER — _done when:_ triggering a fake fall via the sketch prints the received payload in Python.
- [x] **E5.2** Implement the local 30 s cancel window and buzzer/LED coordination — 20 min — ⛔ BLOCKER — _done when:_ a button press inside 30 s prevents (or immediately follows with) a cancel POST, and no press lets the window expire and the alert stand. _(MCU owns grace UI; Python posts cancel and `signal` feedback.)_
- [x] **E5.3** Build the outbound POST client against the **contract locked in E1.3** — 45 min — ⛔ BLOCKER — _done when:_ `curl`-equivalent POSTs succeed against the hub with the agreed schema, 3-retry (0.5/2/5 s) then spool to `/home/arduino/spool/*.json`, drained on next successful heartbeat.
  - PRD contract: `X-Band-Key` static shared secret, fixtures for body shapes. `make -C band test-py` asserts key/type parity.
  - **A fall event is never dropped; `/v1/ingest/rf` posts are cheap and idempotent — drop them under pressure, not fall events.**
- [x] **E5.4** Add the 30 s telemetry/heartbeat timer — 15 min — 🔁 PARALLEL-OK — _done when:_ a heartbeat POST fires every 30 s including walking-summary stretch fields. **`worn` for a fall decision is judged over the 10 s *before* the event** (D-008).
- [ ] **E5.5** Auto-start on boot — 10 min — 🔁 PARALLEL-OK — _done when:_ the app survives a battery swap / reboot without manual restart. _(Command documented in `band/fallband/README.md` — run on device.)_
  ```bash
  arduino-app-cli properties set default user:fallband
  arduino-app-cli app list
  arduino-app-cli app logs /home/arduino/ArduinoApps/fallband -f
  ```

---

### E6. Wi-Fi/BLE RSSI scanning on the band (hour 5–6, then ongoing)

The band **only collects RSSI** and ships observations — the room classifier (k-NN/HMM) is out of scope, owned server-side.

> **Code complete** (`ble_scan.py` + `main.py` loop + `band/tools/rssi_monitor.py`). On-device BLE verify + survey still open; survey blocked on Ayush A1–A3.

- [x] **E6.1** Install `bleak`, run the live RSSI monitor script — 15 min — ⛔ BLOCKER — _done when:_ all four beacons appear with medians and counts. _(Script ready: `python3 band/tools/rssi_monitor.py` — needs beacons powered.)_
  ```bash
  pip3 install bleak
  python3 band/tools/rssi_monitor.py
  ```
- [x] **E6.2** Wrap into a scan loop and emit RF observations — 30 min — ⛔ BLOCKER — _done when:_ a 3 s BLE scan every 20 s (Wi-Fi refreshed every wifi_scan_period) produces median RSSI and posts via E5.3's client. Discard anchors with `n < min_adverts_n`; never impute missing as −100 dBm.
- [ ] **E6.3** `[UNVERIFIED]` — confirm BLE scanning actually works on the shipped Debian image — already checked at E2.3; re-verify once `bleak` is wired into the loop — 10 min — ⛔ BLOCKER — _done when:_ `sudo btmgmt find -l` and the `bleak` loop both consistently see beacons over a 2-minute soak. _(Use `band/scripts/radio_check.sh`.)_
  > **🚦 HARD GATE — hour 6.** If BLE scanning is not working (no `hci0`, empty `btmgmt find`, or `bleak` throwing): **stop and pick a fallback now, do not let this eat the fall detector's time:**
  > - Fall back to **Wi-Fi-RSSI-only** room classification (works, but unstable in a crowded venue — say so honestly), OR
  > - Flash a **spare ESP32-S3 as a BLE scanner** that posts the same RF JSON to the same endpoint over Wi-Fi (~45 min), or run the `bleak` scanner on a Mac for bench tests — the hub and demo stay untouched. **Not an iPhone:** iOS hides iBeacon adverts from ordinary Bluetooth scanning and Safari has no Web Bluetooth (D-013).
- [ ] **E6.4** Force the demo hotspot to 5 GHz — 2 min — 🔁 PARALLEL-OK — _done when:_ `iw dev wlan0 info` (or the hotspot's own settings) confirms 5 GHz. Wi-Fi and BLE share the same 2.4 GHz PCB trace antenna on the UNO Q; keeping Wi-Fi traffic on 5 GHz is the single cheapest fix for dropped BLE adverts.

---

### E7. ESP32 beacon flashing (hour 1–3, 🔁 PARALLEL-OK the whole way — does not touch the UNO Q)

- [ ] **E7.1** Install ESP32 board support + NimBLE library — 10 min — 🔁 PARALLEL-OK — _done when:_ Boards Manager URL `https://espressif.github.io/arduino-esp32/package_esp32_index.json` is added, **esp32 by Espressif Systems** is installed, board is set to **ESP32S3 Dev Module**, and Library Manager has **NimBLE-Arduino** installed.
- [ ] **E7.2** Generate one site UUID and flash 4 beacons, changing only `ROOM_MINOR` per board — 40 min (~10 min/board) — ⛔ BLOCKER (gates E8) — _done when:_ all 4 boards enumerate `iBeacon up: major=1 minor={1..4}` over Serial, and each board is **labeled with its minor number in marker before being unplugged** (four identical black PCBs in a bag is a documented 45-minute mistake).
  ```bash
  uuidgen   # run once; paste into SITE_UUID below and into config.json
  ```
  ```cpp
  // beacon.ino — flash one per room; change ROOM_MINOR and nothing else.
  #include <NimBLEDevice.h>
  static const uint16_t ROOM_MINOR = 1;   // 1=kitchen 2=bathroom 3=bedroom 4=front_door
  static const char*    SITE_UUID  = "b9407f30-f5f8-466e-aff9-25556b570000"; // uuidgen your own!
  static const uint16_t SITE_MAJOR = 1;
  static const int8_t   MEASURED_POWER_1M = -59;   // PLACEHOLDER — overwrite from E8 survey
  static const uint16_t ADV_INTERVAL_MS   = 100;
  void setup() {
    NimBLEDevice::init("");
    NimBLEDevice::setPower(ESP_PWR_LVL_P3);        // ~0 dBm
    NimBLEBeacon beacon;
    beacon.setManufacturerId(0x004C);
    beacon.setProximityUUID(NimBLEUUID(SITE_UUID));
    beacon.setMajor(SITE_MAJOR); beacon.setMinor(ROOM_MINOR);
    beacon.setSignalPower(MEASURED_POWER_1M);
    NimBLEAdvertisementData adv;
    adv.setFlags(0x04); adv.setManufacturerData(beacon.getData());
    NimBLEAdvertising* a = NimBLEDevice::getAdvertising();
    a->setAdvertisementData(adv);
    a->setMinInterval(ADV_INTERVAL_MS * 1000 / 625);
    a->setMaxInterval(ADV_INTERVAL_MS * 1000 / 625);
    a->start();
  }
  void loop() { delay(10000); }
  ```
- [ ] **E7.3** Power beacons on USB wall warts and verify from a laptop with `rssi_monitor.py` before going near the UNO Q — 10 min — ⛔ BLOCKER — _done when:_ all four minors are visible. This de-risks beacons independently of the band.
- [ ] **E7.4** Place beacons per placement rules — 10 min — 🔁 PARALLEL-OK — _done when:_ beacons are at **chest height (1.2–1.5 m)**, **3–8 m apart**, none co-planar on the same wall, none inside metal cabinets/behind fridges/on mirrors, door beacon **beside** the frame not in it.

---

### E8. RF site survey & beacon calibration (hour 15–18, re-run hour 21)

- [ ] **E8.1** Measure `tx_power_1m` per beacon (do not trust the −59 dBm placeholder) — 15 min — ⛔ BLOCKER — _done when:_ for each of the 4 beacons, you hold the band exactly 1.0 m away, line of sight, band facing beacon with body behind the band, and record the 15 s median RSSI from `rssi_monitor.py` as that beacon's `tx_power_1m`. Write into `config.json → beacons[].tx_power_1m` and reflash each ESP32's `MEASURED_POWER_1M` to match.
- [ ] **E8.2** Collect labeled fingerprints per room — 30 min — ⛔ BLOCKER — _done when:_ each room (kitchen/bathroom/bedroom/front_door + hallways labeled `transit`) has ~10 labeled RSSI vectors collected while walking slowly around the room's usable area for 30 s at a **3 s scan period** (drop from the live 20 s period during survey only).
  ```bash
  python3 main.py --survey --room kitchen
  ```
- [ ] **E8.3** Push the fingerprint database to the hub — 5 min — ⛔ BLOCKER — _done when:_ `POST /v1/config/{device_id}` (or a file copy) delivers the fingerprint set to whoever owns the k-NN/HMM classifier.
- [ ] **E8.4** Verify with a scripted walkthrough — 15 min — ⛔ BLOCKER — _done when:_ walking bedroom → hallway → bathroom → hallway → kitchen → front door → back yields the correct room within 2 scans (~40 s) of entering each, and zero confident wrong rooms (`location_unknown` in a hallway is a pass).
- [ ] **E8.5** Re-run the entire survey (E8.1–E8.4) in the actual demo space on the morning of — 25 min — ⛔ BLOCKER — _done when:_ walkthrough passes again in the real venue; a survey from the practice room does not transfer geometry.
- [ ] **E8.6** Venue reality check — 5 min — 🔁 PARALLEL-OK — _done when:_ you've confirmed via `iw dev wlan0 scan | grep -c SSID` (twice, 5 min apart) that the venue has hundreds of transient Wi-Fi BSSIDs, and you've decided to **demo on BLE beacons only, treating Wi-Fi as a bonus feature** — a crowded hall breaks Wi-Fi fingerprinting and that's expected, not a bug to chase.

---

### E9. IMU calibration (hour 15, ~25 min, once)

- [ ] **E9.1** Static zero-g offset — 2 min — ⛔ BLOCKER — _done when:_ resting on a table in all six orientations (±X/±Y/±Z up, 5 s each) gives `bias_axis = (up+down)/2`, `gain_axis = (up-down)/2` written to `config.json → accel_bias/accel_gain`, and **resting `|a|` reads 1.00 ± 0.02 g in every orientation** — if it doesn't, this is an I2C/scaling bug (go back to E4.1), not a calibration problem.
- [ ] **E9.2** Wear it for real, mark the position — 1 min — ⛔ BLOCKER — _done when:_ strap tension and forearm position match what will be worn at demo time (mounting compliance and position change the impact signature significantly).
- [ ] **E9.3** Log 10 negatives — 8 min — ⛔ BLOCKER — _done when:_ 10× each of: sit down hard, slam forearm on table, clap hard 5×, set band on table and walk away, 20 steps normal walking, stand up quickly — all logged with peak_g.
- [ ] **E9.4** Log 10 simulated falls — safe rig only — 10 min — ⛔ BLOCKER — _done when:_ drop the **band, never a person**, from **0.5 m onto a firm cushion stack** (not a soft mattress), varying landing (flat/edge-on/face-down), let it land and stay still 5 s, 10 times, all logged, every `peak_g` ≥ 3 g. (Was 1.0 m — rejected by `FF_MAX_MS`, D-008.)
- [ ] **E9.5** Fit thresholds from the negative/positive split — 4 min — ⛔ BLOCKER — _done when:_ `IMPACT_G_SOFT = N_max + 0.45*(F_min - N_max)` and `IMPACT_G_AFTER_FF = IMPACT_G_SOFT - 0.7` are computed and written to `config.json`, and `F_min` is written to `config.json → calibration.f_min` (it caps the walking profile). **Leave `FF_THRESHOLD_G` at 0.40 g — do not fit it from drops** (D-008). If `F_min <= N_max` (classes overlap on peak alone), **do not widen the threshold** — lean on `ORIENT_CHANGE_DEG`/`STILL_STD_G` instead.
- [ ] **E9.6** Verify — 2 min — ⛔ BLOCKER — _done when:_ 5 fresh negatives + 5 fresh drops score **5/5 detected, 0/5 false**. If worse, re-fit once and stop — a threshold tuned to noise is worse than a conservative one. Bias toward false positives: a false positive is an annoying phone call, a false negative is nine hours on a bathroom floor.

---

### E10. Power & battery validation

- [ ] **E10.1** `[UNVERIFIED]` — measure real current draw with a USB-C power meter and correct the power budget table — 15 min, at **hour 2** — ⛔ BLOCKER — _done when:_ you have actual mA figures for idle QRB2210/Debian, BLE scan burst, Wi-Fi scan burst, replacing the spec's estimates (Arduino publishes no typical-current figure for the UNO Q at all — every number in the budget is an engineering estimate until you measure).
- [ ] **E10.2** 20-minute untouched idle soak — 20 min, at **hour 3** — 🔁 PARALLEL-OK — _done when:_ the power bank does not auto-shut-off from low current draw (many banks cut off below ~50–100 mA; the UNO Q idles well above that, but verify your specific bank rather than assume).
- [ ] **E10.3** 4-hour continuous battery test with BLE + Wi-Fi scanning running — 240 min (run in background during other work) — 🔁 PARALLEL-OK — _done when:_ no reset occurs over 4 h continuous operation.
- [ ] **E10.4** Confirm power source is the USB-C bank, never a LiPo cell strapped to the band — 1 min (a check, not a build step) — ⛔ BLOCKER — _done when:_ you can point to the physical power bank on the strap and confirm no bare pouch cell is anywhere near the wearer's skin (§4.5 — mechanical damage to a pouch cell on a body is the #1 field cause of runaway).

---

### E11. Physical band build (hour 21–23)

- [ ] **E11.1** Strap-down mount: board + power bank on forearm — 20 min — ⛔ BLOCKER — _done when:_ both are velcro-strapped snugly to the marked forearm position (same spot used in E9.2 calibration — moving it invalidates the thresholds), Qwiic chain routed so nothing snags, sensor face left open (board runs warm inside a sleeve).
- [ ] **E11.2** Tape everything down — 10 min — 🔁 PARALLEL-OK — _done when:_ cables, connectors, and the power bank are taped so nothing disconnects during a drop or arm movement. Tape is a legitimate engineering material at hour 21.
- [ ] **E11.3** Rehearse the unstrap for the demo — 10 min — ⛔ BLOCKER — _done when:_ you can strap on, talk over it, unstrap, and set up the drop rig in one smooth motion without fumbling on stage.

---

### E12. Test suite: safe fall rig + false-positive suite (hour 15–18 first pass, hour 23–24 final rehearsal)

- [ ] **E12.1** Build the safe fall test rig — 10 min — ⛔ BLOCKER — _done when:_ you have 2+ **firm** stacked cushions positioned for a clean **0.5 m** drop, and everyone on the team has said out loud "we drop the band, never a person — not a teammate, not a judge."
- [ ] **E12.2** Run the false-positive suite and log every case — 20 min — ⛔ BLOCKER — _done when:_ all of the following are logged as `case, peak_g, ff_min_g, ff_dur_ms, orient_deg, std_g, gyro_max, room, state` and **none of them CONFIRM**:
  - sit down hard in a chair (expect impact 1.5–2.5 g, orientation change < 20°)
  - slam forearm onto a table (expect impact 2.5–5 g, jerk > 60 g/s, orientation < 15° — **the hardest case**, orientation is the only thing that saves you here)
  - clap hard 5× (expect 5 spikes of 1–3 g, no orientation change, arm keeps moving σ > 0.3 g)
  - set band on table and walk away (expect `|a| → 1.00 g`, σ < 0.01 g — must also flag `worn:false`)
  - normal walking, 20 steps (periodic 0.7–1.4 g at 1.8–2.2 Hz)
  - stand up quickly (brief 0.8 g dip, 1.3 g rise, orientation < 25°)
  - arm swing / reach overhead (gyro > 150°/s, no post-stillness)
- [ ] **E12.3** Run the positive fall suite — 15 min — ⛔ BLOCKER — _done when:_ drop onto a firm cushion (0.5 m) and drop onto carpet-over-hardwood (0.5 m) both CONFIRM, with the carpet drop's impact peak landing well above 4.0 g (proving the ±16 g fix from E4.1 actually works — pinning at 4.0 g here means the register fix regressed).
- [ ] **E12.4** Run the cancel/timeout/power-loss cases — 10 min — ⛔ BLOCKER — _done when:_ (a) pressing button A at t+5s after a confirmed fall produces `CANCELLED` and the hub does not dial, (b) letting a confirmed fall run to grace expiry triggers the downstream call, (c) unplugging the power bank mid-grace still results in the hub's independent 30 s timer firing (proves the "fire on confirm, not on grace-expiry" design in E4.6).
- [ ] **E12.5** Run RF test cases R1–R7 alongside the fall suite — 20 min — 🔁 PARALLEL-OK — _done when:_ standing still in each room holds a stable room classification, walking between rooms updates within 2 scans, unplugging one beacon triggers `beacon_offline` without shifting the reported room, and powering off all beacons degrades to `location_unknown` rather than a confident wrong room.
- [ ] **E12.6** Final rehearsal — 3 full end-to-end runs — 30 min, hour 23–24 — ⛔ BLOCKER — _done when:_ strap on → talk → unstrap → drop → buzzer → no-cancel → call fires with the correct room named, three times in a row, on the real network, in the real demo space.

---

### E-checkpoints

| Hour | What must work | One-command proof |
|---|---|---|
| 1 | BLE adapter is alive on the shipped Debian image | `hciconfig -a` shows `hci0 UP RUNNING` and `sudo btmgmt find -l` prints nearby devices |
| 2 | Real current draw measured, power budget corrected | USB-C power meter reading recorded against the table in `config.json`/notes |
| 3 | Board enumerates, joins Wi-Fi (5 GHz), flashes Blink | `nmcli device \| grep wlan0` shows connected + LED blinks after flashing Blink |
| 5 | I2C chain scans clean; IMU reports sane g values | bus-scan sketch prints `0x6A 0x3E 0x1E`; flat-table read shows one axis ≈1.00 g |
| 6 | BLE scanning sees all 4 beacons; go/no-go on fallback decided | `python3 rssi_monitor.py` shows all 4 minors with `n ≥ 3` |
| 10 | Fall state machine fires end-to-end into Python | drop board 30 cm onto cushion → `Bridge.notify("fall_event", ...)` payload printed on the Linux side |
| 13 | Band → hub → escalation path fires with a real phone ringing | full drop test rings a real phone, room named in the alert |
| 18 | IMU calibrated (5/5 detected, 0/5 false); RF survey passes walkthrough | E9.6 log shows 5/5 + 0/5; E8.4 walkthrough shows correct room within 2 scans everywhere |
| 21 | Re-survey done in actual demo space; strap-down complete | E8.5 walkthrough re-passes in venue; board+bank taped to forearm |
| 23 | Wi-Fi kill / beacon unplug / reboot all degrade safely | kill AP 60s → events spool and drain with 0 loss; unplug 1 beacon → `beacon_offline`, no room shift |
| 24 | Three consecutive clean end-to-end demo runs | E12.6 rehearsal log: 3/3 runs, correct room called each time |
