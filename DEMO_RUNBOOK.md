# Demo runbook — Sunday 11:00 AM

The demo beat sheet, boot order, and recovery moves. Written against the state
of the system at 5 AM Sunday; anything marked ⚠ needs a human step first.

## The demo script

1. **Drink water** → VLM logs drinking + the room (runs on Ayush's machine:
   `make -C backend vision-demo`, webcam pointed at the table).
2. **Get up, change rooms** → band hears the beacons, app's location flips
   (~40 s to commit; `LOC_COMMIT_TICKS=1` halves it if it feels slow).
3. **Fall** (slap the band / drop on cushion) → app takeover opens at T+0.
4. **Cancel window lapses** (default 30 s; `CANCEL_WINDOW_S=15` for the stage)
   → **live phone call** to the demo phone. Answer, say "I'm not fine, I fell"
   or "I'm fine" depending on the beat.
5. **Resolution** → alert closes in the app, transcript visible on the alert.

## Boot order (demo machine)

```bash
./dev.sh                     # mongo -> ollama -> seed-if-empty -> API :8000
ngrok http 8000              # must print subsystem-mushroom-grooving.ngrok-free.dev
                             # (that URL is baked into .env and the band)
cd frontend && npx expo start
```

- `.env` at the repo root holds the Twilio/Deepgram creds; `dev.sh` sources it.
  No `.env` → API boots voice-less (stub) with no error. Check startup: a live
  boot mounts `/twilio/*` routes (`curl -s localhost:8000/openapi.json | grep twilio`).
- Seed honors `TEST_PHONE_E164` — whoever's phone is in `.env` is who Dhyaan
  calls as Asha AND as first contact.

## The band (UNO Q) — venue steps

Hand-back state (2026-09-20 ~5 AM): everything self-starts on power. On the
board: `fallband-ble.service` (host BLE scanner → `.ble_latest.json`; the App
Lab container has no Bluetooth, this feeds it), `fallband-hub-relay.service`
(bench/USB mode only, inert otherwise), bleak under `/home/arduino/blelib`.
`hub_url` is already the ngrok URL, so the band works from ANY WiFi:

1. ⚠ Join the board to venue WiFi or a hotspot (App Lab, or over USB:
   `adb shell nmcli dev wifi connect '<SSID>' password '<pw>'`).
2. Power from a wall wart or power bank. Nothing else.
3. Verify from any machine: band heartbeats show in the API log, and
   `GET /v1/residents/res_eleanor/location` moves when the band moves.

**Re-survey in final positions** (fingerprints are bench-geometry right now —
redo once beacons are placed, 35 s per room, band held in each "room"):

```bash
adb shell "docker exec fallband-app-main-1 python /app/python/survey.py kitchen 35"
adb shell "docker exec fallband-app-main-1 python /app/python/survey.py bathroom 35"
```

(Works over WiFi too: run the same `docker exec` via an SSH/adb-over-network
session, or temporarily plug USB.)

## Beacons (ESP32)

- S3-BOX = kitchen (minor 1), DevKitC = bathroom (minor 2). Power via USB;
  they advertise from cold boot, nothing to start.
- Sanity from the Mac: `.venv-voice/bin/python band/tools/rssi_monitor.py`.

## Timing knobs (already demo-tuned by default via dev.sh)

| Knob | Default | Stage setting |
|---|---|---|
| `CANCEL_WINDOW_S` | 30 | 15 if the pause feels long |
| `CONTACT_WAIT_S`  | 60 | 30 |
| `DEMO_FAST`       | 1 (dev.sh) | leave |
| `LOC_COMMIT_TICKS`| 2 (~40 s room flip) | 1 (~20 s) |
| `BATHROOM_THRESHOLD_S` | 90 via dev.sh | leave |

Set in the environment before `./dev.sh`.

## ⚠ Human items before 11 AM

1. `EXPO_PUBLIC_OPENAI_API_KEY` in `frontend/.env`, and `OPENAI_API_KEY` for
   the backend. Without them the conversation openers, Sunday letter and
   chat-plan beats degrade to their mocks, and the backend's written narratives
   and chat answers fall through to the local Ollama model. Everything still
   runs; it is just less good prose.
2. Board on venue WiFi (step above).
3. Vision runs on WHICHEVER machine hosts the backend — proven on Abhinav's
   Mac this morning (`make -C backend vision-demo`; camera permission must be
   granted interactively once). Ayush's machine needs the same one-time
   `uv pip install -e ".[vision]"` + camera grant if it hosts.
4. Phone that will be "Asha's" charged, ringer ON, Focus/DND OFF.
5. Hide Expo Go's floating dev button (shake device / dev menu) — it is the
   single most un-Apple pixel on screen.
6. Pendant CNN caveat: trained on waist-worn data; "walking" needs the
   pendant chest-high and steady. If it abstains it keeps the last label —
   say "activity classification" not "guaranteed live label" if unsure.

## Hard lessons from the all-nighter (read before rehearsing)

- **After ANY power change to the UNO Q, wait ~2 minutes** before demoing a
  fall: the Linux agent boots long after the chip chirps. Ready = a heartbeat
  in the API log. Drops during the boot window are silently lost.
- **Box I'M OK is PRESS AND HOLD (~1 second)**, not a tap — the touch and
  speaker share a wire, and the hold is what separates a finger from bus
  noise (touch v4, two confirm rounds). Say "press and hold" on stage.
- **The band is a silent sensor** — only a Movement Modulino is chained. No
  buzzer, no cancel button on the band. The BOX, app, and phone carry all
  alerting sound; cancel = box tap or app. (Chaining Buttons+Buzzer Modulinos
  from the kit adds both with zero code changes, auto-detected at boot.)
- **Demo phone: Focus/DND OFF, ringer ON.** A 5 AM rehearsal call was
  silently swallowed by iPhone Sleep Focus.
- **Box WiFi can drop on hotspot churn** — if its polls vanish from the API
  log, power-cycle the box; it rejoins on boot.
- **iOS hotspot names use a typographic apostrophe (U+2019)** — copy-paste
  the SSID, never retype it. Hotspot needs Maximize Compatibility ON (2.4GHz).
- **Drop physics**: free-fall + hard landing + LYING STILL afterwards. The
  power bank must fall WITH the pendant (pocket-worn = automatic). Handling
  bumps under ~5g no longer trigger; real drops measure 5.7-10g.
- **Never push repo config.json to the board without re-setting hub_url**
  (repo copy now carries the ngrok URL, but verify after any push:
  `adb shell grep hub_url /home/arduino/ArduinoApps/fallband-app/config.json`).

## Moving the demo host (e.g. to Ayush's machine)

The tunnel domain belongs to the ngrok ACCOUNT, not the machine — every
device (band, box, DevKitC, Twilio) follows it. No reflashing, no device
config changes. ~20 min:

1. Stop ngrok on the old machine (one tunnel per domain).
2. New machine: `ngrok config add-authtoken <Abhinav's token>` then
   `ngrok http 8000 --url subsystem-mushroom-grooving.ngrok-free.dev`.
3. Pull the repo; AirDrop the two secret files (root `.env`,
   `frontend/.env`) — never through git.
4. `cd backend && uv venv && uv pip install -e ".[vision]" --group dev`;
   docker mongo; `ollama pull nomic-embed-text` (VLM already pulled there).
5. `./dev.sh` — a fresh DB seeds Asha with TEST_PHONE_E164 and band_unoq01.
6. Fresh DB has no fingerprints: run the 2x35s room survey (above).
7. `make vision-demo` once interactively for the camera permission prompt.
8. App can run on EITHER laptop: point it at the tunnel
   (`EXPO_PUBLIC_API_BASE=https://subsystem-mushroom-grooving.ngrok-free.dev/v1`).
9. Bonus of hosting where vision runs: the fall auto-cancel's clock-sync
   caveat disappears (one clock).
10. REHEARSE ON THE MACHINE THAT PERFORMS. No exceptions.

## Recovery moves (fastest first)

- **Call never comes**: check ngrok is up and printing the SAME domain; check
  the API log for `POST /twilio/status`. Nuclear: re-run the fall.
- **Alert stuck / needs forcing**: `curl -X POST localhost:8000/demo/force_ack
  -H 'Content-Type: application/json' -d '{"alert_id":"<id>","by":"demo"}'`.
- **Fall won't trigger from the band**: fixture instead —
  `curl -X POST localhost:8000/v1/ingest/band -H 'X-Band-Key: band-dev-key'
  -H 'Content-Type: application/json' -d @backend/fixtures/band_fall.json`
  (bump `ts` to now first).
- **Room won't flip**: check `fallband-ble` is active on the board
  (`systemctl --user status fallband-ble` as arduino) and the relay file is
  fresh; re-survey if beacons moved.
- **App looks dead**: it's the backend — `curl localhost:8000/health`.
- **Voicemail picked up the call**: the ladder already treats it as no-answer
  and calls the next contact; let it ride.
