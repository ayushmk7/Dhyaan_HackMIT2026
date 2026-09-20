# Sponsor challenge submissions — copy-paste blurbs for Plume

We submit to 8. Each blurb is ready to paste; longer write-ups live in the
linked files. Demo video + repo link are shared across all.

## Deepgram — "Build Something Worth Talking To" (strongest fit)
Dhyaan's core is a production Deepgram Voice Agent, not TTS bolted on: when an
elder falls, Dhyaan phones her through Twilio, Flux STT hears her answer, the
agent classifies it with function calls (mark_ok / escalate / leave_message),
Aura-2 speaks, barge-in interrupts mid-sentence, voicemail is detected and
treated as no-answer, and silence escalates by default. The person's own words
choose who gets woken up. Bridge: `dhyaan/voice/` (12 offline integration
tests); live classification matrix 5/5 on recorded clips.

## Arduino — "Touch Grass"
The wearable is an Arduino UNO Q: the STM32 side runs a 208 Hz IMU fall
cascade; the Linux side runs the cancel window, BLE room-fingerprint scanning,
and HTTPS uplink. Raw acceleration becomes a phone call to a daughter. Code:
`band/`.

## Espressif — AIoT
Both boards are active nodes, not just anchors. The S3-BOX (`beacons/boxassist/`)
runs BLE advertising, WiFi+TLS polling, a touch UI, and speaker playback
concurrently on one S3: it stays the kitchen iBeacon while watching the care
backend, and on a fall it takes over its screen ("Are you OK?"), speaks the
prompt in the same Deepgram voice that makes the phone calls, and a tap
acknowledges the alert through the whole system — proven live on hardware
(tap -> HTTPS through a phone hotspot -> alert acknowledged everywhere).
The DevKitC (`beacons/bathhelp/`) is the bathroom anchor plus a nurse-call
help button and alert status LED. Both feed the k-NN + Bayes indoor localizer
(`backend/app/location.py`) that powers bathroom-dwell alerts and home/away.
Roadmap: esp-sr on-device "help me" wake phrase on the BOX's mic array.

## Long Lake — "Convince a Non-Believer"
Our users are the people frontier AI overlooked: an 81-year-old who will never
open an app, and her 46-year-old daughter who thinks AI is a chatbot. Her one
great experience: the phone rings after a fall, an AI listens to her say "I
can't get up," and the right human is called in seconds. The skeptic watches
AI show judgment, not autocomplete.

## Meta — "Bringing People Closer Together with AI"
Write-up: `META_CHALLENGE.md`. Dhyaan answers "is she safe?" so calls can be
about life again: conversation openers from her real day, her own words carried
home from check-in calls, a family-chat-to-plan synthesizer, the Sunday letter.

## Dropbox — "Turn digital chaos into something useful"
Write-up: `DROPBOX_CHALLENGE.md`. Her care file: paste or photograph the
kitchen-drawer folder (discharge summaries, med lists) and it becomes
medication schedules, appointments with actions, and an EMS card on the fall
alert screen.

## The Token Company — LLM cost saving
Write-up: `COST.md`. Cost-first architecture: local YOLO answers structural
questions so the VLM is consulted ~0.2% as often (7.3 s → 18 ms per decision),
local Ollama models take vision + embeddings to $0 marginal, Haiku runs the
latency-critical voice path, and every event compresses to a ≤400-char sentence
before any model sees it.

## Ramp — "Save Time. Save Money."
Families pay ~$25/mo instead of a 24/7 call-center subscription, and skip the
nightly "just checking" call; facilities triage 40 rooms with one ranked list
instead of hourly rounds.
