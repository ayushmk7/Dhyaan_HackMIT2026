# Brag Plan: Dhyaan

## What is this app?
Dhyaan is eldercare sensing built out of three lanes that corroborate each other: a forearm band that feels a fall at 208 Hz, ESP32-S3 BLE anchors that resolve which room she is in all day, and a camera whose frames never leave the laptop — a local VLM turns them into plain sentences her family can read.

## The angle
Everyone else's demo shows a dashboard. This one shows **two independent sensors agreeing before anyone is phoned**, and the fact that the thing watching a 79-year-old in her own kitchen never sends a pixel anywhere. The video is the product's chain of custody: radio → room, camera → sentence, IMU → impact, camera → confirmation, phone → *her first*. Restraint is the point; this is a medical-adjacent product, not a toy, so nothing flashes, nothing strobes, and every number on screen is one we measured.

## Hook (first 2-3 seconds)
The wordmark at full scale on the product's own near-white paper, with the one blue accent rule under it, and a single line that states the inversion the whole product is built on: it calls the grandparent first, and the family second. No sound design theatrics — a soft music bed enters under it.

## Key moments (the middle)
- Two ESP32 anchors pulsing iBeacon adverts; RSSI values ticking; room chips arriving one by one until `BATHROOM` commits at 0.87 confidence. A room name, never a dot on a map.
- The camera console (the app's real night-ground pane, REC pill, `PERSON 01` box, `MODEL qwen2.5vl:3b`) resolving into one sentence card: "Eleanor ate lunch at the table, 12:31–12:48." The pane dissolves; the sentence stays. That is exactly what the family gets.
- The 208 Hz accelerometer trace spiking through ±16 g, then the 30-second cancel ring counting down while the band buzzes.
- Posture flips to `on_floor`, the keyframe queue is jumped, the VLM answers in 0.69 s, and two source chips — BAND and CAMERA — lock together.

## Outro / punchline
The real alert takeover: "Eleanor may have fallen." · "Calling Eleanor now…" · then the family line. Cut to the wordmark and the product's own consent-screen sentence, verbatim: **"A fall always calls. Nothing else ever does."**

## User flow worth showing
Entry → key action → result, as the system actually runs it:
1. The band scans the room anchors; the localizer commits a room (`backend/app/location.py`).
2. The camera lane writes a sentence to her timeline; the family's Today screen shows it with the day's figures (`Meals`, `Minutes seen`).
3. A fall opens an alert; the app goes full-screen takeover and the ladder starts calling *her* (`frontend/src/app/alert/[id].tsx`).

## Tone
- Preset: polished
- Creative direction: quiet premium medical-device film, built from the product's own screens
- Interpretation: six scenes, long settled holds, soft 0.6s crossfades, no zoom punches, no comedy. Type is mixed case at medium weight. Energy comes from data moving (RSSI ticking, a countdown ring, a posture flag flipping), never from cuts fighting for attention.

## Format: landscape — 1920x1080
## Duration: 24.2s

## Visual identity (from the project)
- Background (paper): `#F3F5F9`
- Card / raised: `#FFFFFF`
- Text (ink): `#0B1220`
- Metadata (inkMuted): `#596371`
- Accent (the one blue): `#1F56C2` · wash `#EEF3FC` · focal plate `#B9CDF3` · alarm plate `#8AAEEA`
- Night ground (camera console pane): deep blue, never black
- Display font: Fraunces (the product's serif, used only for a quoted human sentence and the wordmark)
- Body font: system SF / Inter fallback; machine readouts in a mono face, uppercase — the product's rule that the brutalist voice marks MACHINE origin only
- Strongest visual element: the alert takeover (light-blue plate, heavy ink rule, one navy plate button) and the camera console's telemetry strip

## Share copy (draft)
Dhyaan: a band that feels the fall, ESP32 anchors that know the room, and a VLM that runs on the laptop so the camera's frames never leave it. It calls your grandmother first, and you second.

## Audio direction
- Role: warm restrained bed with sparse motion-matched accents
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (109.96 BPM, 117.36s)
- Music treatment: enters at 0.0s at low level (~0.28), holds under the whole piece, ducks slightly under the alert scene, fades out over the last 1.2s so the final line lands in near-silence
- Music cue guidance: bundled preset read from `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`. Strong cues in window: 8.74s, 17.47s, 18.56s, 22.93s, 24.56s. Lock three: the sentence card landing (~8.74s), the two-sensor agreement (~17.47s), the takeover headline (~22.93s). Beat grid for sequential reveals: room chips at 4.39 / 5.34 / 6.00; stat tiles at 10.93 / 12.02.
- Audio-reactive treatment: subtle; use RMS to breathe the accent glow behind the wordmark and the presence of the sentence card. No waveforms, no equalizer bars, no pulsing text.
- SFX posture: sparse. Roughly five cues in 24s — a soft interface tick per room chip, one dry low impact at the fall, a single countdown tick texture, one short announcement cue at the two-sensor lock, one quiet confirm at the takeover. Nothing comedic, nothing bright.
- Audio-coupled moments: room chips arriving one by one; the 30→0 countdown ring; the posture flag flipping to `on_floor`; the takeover headline landing.
- Restraint rule: the fall must never sound like a game hit. No whooshes on crossfades. No sound at all under the final consent line — it lands dry.

## Storyboard

### Scene 1 — Wordmark — 3.5s
Paper ground `#F3F5F9`. The Dhyaan wordmark in Fraunces at full scale, centred, ink. A 2px ink rule draws under it left-to-right in 0.5s. Below the rule, one line settles: "Eldercare sensing that phones the grandparent first, and the family second." A faint accent glow breathes behind the wordmark on the music RMS.
Sequential/interaction: none.
Audio intent: the bed enters, low and warm. Nothing punctuates. Confidence.
Audio-coupled idea: none — the glow reacts to RMS only.
Music: warm, low.
Transition mood: soft crossfade → Scene 2

### Scene 2 — Which room, all day — 4.5s
Left: two ESP32-S3 anchor glyphs labelled `MINOR 1 · KITCHEN` and `MINOR 2 · BATHROOM`, each emitting a slow concentric advert ring every 100 ms (slowed for legibility). Centre: a band glyph with a live RSSI readout ticking in mono (`-58 dBm`, `-71 dBm`). Right: three room chips arrive one by one — `KITCHEN 0.31`, `HALLWAY 0.44`, `BATHROOM 0.87` — and the third gets a `COMMITTED` stamp and the accent plate. Caption below, ink, mixed case: "Room level. Never a dot on a map."
Sequential/interaction: yes — three room chips arrive on the beat grid at 4.39 / 5.34 / 6.00, each with a soft interface tick; the full set holds on screen for 1.4s after the last one.
Audio intent: procedural, quiet, instrument-like.
Audio-coupled idea: beat-aligned chip reveal with one low-frequency-risk interface tick each.
Music: steady bed.
Transition mood: soft crossfade → Scene 3

### Scene 3 — The camera writes sentences — 4.5s
The app's real camera console pane on its night-blue ground: `REC` pill top-left, burned-in clock top-right, one accent person box labelled `PERSON 01`, telemetry strip along the bottom in uppercase mono — `FPS 14.8` · `MODEL qwen2.5vl:3b` · `PERSON YOLO11n`. At 8.74s the pane dissolves and a white sentence card lands in its place, ink, Fraunces: "Eleanor ate lunch at the table, 12:31–12:48." Two stat tiles slide under it: `Meals 3` and `Minutes seen 214`. A muted line under the card: "The model runs on this laptop. No frame is ever written to disk."
Sequential/interaction: yes — the sentence card is beat-locked to the strong cue at 8.74s; the two stat tiles snap to beats at 10.93 / 12.02 and hold 1.5s.
Audio intent: the moment the machine's noise becomes a human sentence. The bed opens up slightly.
Audio-coupled idea: one soft announcement cue as the card lands; nothing on the tiles but the beat.
Music: bed lifts.
Transition mood: soft crossfade → Scene 4

### Scene 4 — The fall — 3.5s
A single accelerometer trace draws left to right in accent blue at a legible rate, labelled `208 Hz · ±16 g`. It spikes hard; at the spike the whole frame takes one restrained ink flash (no strobe) and the trace freezes with a marker reading `IMPACT`. A ring appears around the marker and sweeps once as a countdown readout runs `30 → 27 → 24`, with the label "Thirty seconds to cancel. Then Dhyaan calls her."
Sequential/interaction: yes — the countdown readout ticks visibly.
Audio intent: gravity, not spectacle. One dry low impact, then a soft repeating tick under the countdown.
Audio-coupled idea: impact SFX exactly on the spike frame; countdown ticks on the ring sweep.
Music: bed ducks fractionally under the impact.
Transition mood: hard-ish clean cut → Scene 5

### Scene 5 — Two sensors agree — 4.0s
Split frame. Left plate: `BAND` — `fall_suspected` · `peak 3.4 g` · `tilt 72°`. Right plate: `CAMERA` — a posture readout flipping `seated → unclear → on_floor`, with a small note "keyframe queue jumped" and `VLM 0.69 s`. At 17.47s the two plates slide together and lock under one accent rule reading `AGREE`. Caption: "The band opens the alert. The camera is the second opinion."
Sequential/interaction: yes — the posture value flips through three states before settling on `on_floor`; the lock is beat-locked to 17.47s.
Audio intent: the click of two things fitting. One short announcement cue at the lock, nothing else.
Audio-coupled idea: the plate lock lands with the cue.
Music: bed steady.
Transition mood: soft crossfade → Scene 6

### Scene 6 — She is called first — 4.2s
The alert takeover, recreated from the app: the deepest light-blue plate `#8AAEEA`, a heavy ink rule, the kind label `Possible fall` in uppercase mono, and the headline in ink at full scale: "Eleanor may have fallen." Under it the ladder line, replaced once: "Calling Eleanor now…" → "Calling Priya · Marcus is next if she doesn't pick up". One navy plate button reads `I've got her`. At 22.93s the takeover crossfades to the wordmark on paper, and the last line settles alone, dry, in ink: "A fall always calls. Nothing else ever does."
Sequential/interaction: yes — the ladder line swaps once, holding 1.3s each; the headline is beat-locked to 22.93s.
Audio intent: one quiet confirm as the takeover lands, then the music fades out under the final line so it reads in near-silence.
Audio-coupled idea: confirm cue on the takeover; silence on the last line.
Music: fade to zero over the final 1.2s.
Transition mood: end.

**Music mood for this video:** restrained upbeat corporate bed, kept low and warm throughout
**Audio summary:** A low warm bed carries the whole piece; sparse interface ticks mark the room chips, one dry impact marks the fall, one announcement cue marks the two sensors agreeing, and the music fades out entirely so the closing consent line lands in silence.
