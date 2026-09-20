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
  calls as Eleanor AND as first contact.

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

1. `EXPO_PUBLIC_ANTHROPIC_API_KEY` in `frontend/.env` — without it the
   conversation openers, Sunday letter, and chat-plan beats silently vanish.
   (Muse key instead, if obtained — strengthens the Meta track; needs a small
   provider swap in `frontend/src/lib/ai.ts`, ask the agent.)
2. Board on venue WiFi (step above).
3. Vision lane on Ayush's machine: `uv pip install -e ".[vision]"` once, then
   `make -C backend vision-demo`; needs `ollama` + `qwen2.5vl:3b` pulled.
4. Phone that will be "Eleanor's" charged and on ring.

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
