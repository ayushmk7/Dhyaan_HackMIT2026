<div align="center">

# Dhyaan

**Eldercare sensing that phones the grandparent first, and the family second.**

A wrist band that feels a fall, ESP32 anchors that know which room she is in,
and a camera whose pixels never leave the machine — folded into one event
stream the family can ask questions of.

`HackMIT 2026` · Arduino UNO Q + ESP32-S3 + MacBook-local inference

</div>

---

## Demo

https://github.com/user-attachments/assets/REPLACE-ME

<!-- 25 s launch video, 1920x1080. The file is committed at demo/dhyaan-launch.mp4.
     GitHub only plays video it hosts itself, so a relative path will not render:
     drag demo/dhyaan-launch.mp4 into the README editor (or into any issue
     comment), then paste the user-attachments URL it hands back over the line
     above. Source composition: brag-output/composition/. -->

**[`demo/dhyaan-launch.mp4`](demo/dhyaan-launch.mp4)** — 25 seconds, the five
beats below in order. The beat sheet the video follows — and the boot order that makes it
reproducible — is [`DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md).

| Beat | What you see | Where it comes from |
|---|---|---|
| **Where she is** | Room changes as the band walks past the anchors, bathroom dwell raises a flag | `backend/app/location.py` · `beacons/beacon.ino` |
| **What she did today** | "Eleanor ate lunch at the table, 12:31–12:48." No image, no room name | `backend/vision/` → `backend/app/presence.py` |
| **The fall** | Band buzzes, 30 s to cancel, then the phone rings *her* | `band/fallband/sketch/` → `backend/app/alerts.py` |
| **The second opinion** | Camera independently reports `on_floor`, which jumps the queue | `backend/vision/keyframe.py` |
| **The escalation** | She doesn't answer → the family's phone rings and the app goes full-screen | `backend/app/alerts.py` · `frontend/src/app/alert/` |

---

## Everything that looks at a person runs on this laptop

Not a design goal we bolted on afterwards. It is why the camera lane can exist
at all: the moment a frame is a request body to someone else's API, the
consent conversation with a 79-year-old is over.

| Job | Model | Where it runs | Measured |
|---|---|---|---|
| Scene → sentence | `qwen2.5vl:3b` | Ollama, `localhost:11434` | 0.69 s / call, warm |
| Person + food + dishes + seating | `yolov8s-worldv2` (open-vocabulary) | in-process, Ultralytics | 9–11.5 ms / frame |
| Posture (hips vs shoulders vs knees) | MediaPipe `pose_landmarker_lite` | in-process | ~13.8 ms / frame |
| Prompt vocabulary embeddings | CLIP `ViT-B/32` | in-process, once at startup | ~4 s, startup only |
| Motion | MOG2 on 320×180 grey | OpenCV | ~2 ms / frame |
| Daily-narrative embeddings | `nomic-embed-text`, 768-d | Ollama | offline once pulled |
| Fall cascade | threshold state machine, 208 Hz | STM32U585 **on the band** | no network at all |
| Room estimate | weighted k-NN + HMM + hysteresis | in the API process | pure functions, no model |

**Frames cross exactly one socket: loopback to Ollama.** No frame is ever
written to disk — there is no `cv2.imwrite`, no `VideoWriter`, no `frames/`
directory anywhere in `backend/vision/`, and the last test in
`backend/tests/test_vision_gate.py` walks the package's AST and fails the build
if anyone adds one. It is a structural promise, not a convention.

### The two things that do leave the machine, named out loud

| Edge | What crosses | What never crosses |
|---|---|---|
| **Anthropic** (`claude-opus-5`, `backend/app/llm.py`) | The day's already-anonymised event sentences, for the daily narrative and the family's questions | Pixels, audio, room names |
| **Twilio + Deepgram** (`dhyaan/voice/`) | The disclosed phone call, during the call only | Nothing is stored: we keep the transcript, never the audio (D-004) |

Both are text-only, both are on the escalation path rather than the sensing
path, and pulling the API keys degrades the system instead of breaking it —
`AVAILABLE = bool(ANTHROPIC_API_KEY)` and the voice bridge only mounts when
Twilio credentials exist, so `./dev.sh` runs zero-config with neither.

---

## Architecture

```mermaid
flowchart LR
    subgraph Home["Eleanor's home"]
        BAND["Arduino UNO Q band<br/>LSM6DSOX @ 208 Hz<br/>fall cascade + BLE scan"]
        B1["ESP32-S3 anchor<br/>minor 1 · kitchen"]
        B2["ESP32-S3 anchor<br/>minor 2 · bathroom"]
        CAM["USB webcam"]
    end

    subgraph Hub["MacBook — the hub. All inference is here."]
        VIS["vision worker<br/>MOG2 → YOLO-World → pose → qwen2.5vl"]
        API["FastAPI<br/>events · alerts FSM · presence"]
        LOC["localizer<br/>k-NN + HMM + hysteresis"]
        RAG["RAG<br/>nomic-embed-text + Mongo"]
    end

    subgraph Out["Off-box, text only"]
        CLAUDE["claude-opus-5<br/>narratives + answers"]
        PHONE["Twilio + Deepgram<br/>the actual call"]
    end

    B1 -. iBeacon adverts .-> BAND
    B2 -. iBeacon adverts .-> BAND
    BAND -->|"POST /v1/ingest/band · /ingest/rf"| API
    CAM --> VIS
    VIS -->|"sentences, never frames"| API
    API --> LOC
    API --> RAG
    RAG --> CLAUDE
    API --> PHONE
    API -->|"WebSocket + push"| APP["Expo app<br/>family · staff"]
```

---

## The camera lane, in order

`backend/vision/` is the only process in the system that ever holds a pixel.
Every stage exists to avoid paying for the next one.

| Stage | What it does | Cost | Drops |
|---|---|---|---|
| 0 · sample | Every 2nd frame at 30 fps → 15 fps | — | half |
| 1 · mask | Black out a normalised rectangle *before* any detector sees it | ~0 | the doorway you excluded |
| 2 · motion | MOG2 foreground ratio > 0.008 | ~2 ms | an empty room, all day |
| 3 · gate | One YOLO-World pass: person, food, dishes, seating | 9–11.5 ms | frames with nobody in them |
| 3b · posture | MediaPipe pose — hips relative to shoulders and knees | ~13.8 ms | false `on_floor` |
| 4 · keyframe | Is this frame worth 0.7 s of VLM? | pure state machine | ~59 of every 60 |
| 5 · VLM | 448×252 JPEG → `qwen2.5vl:3b` → strict JSON | 0.69 s | — |
| 6 · fold | Observations → one open interval per activity → one event | — | five duplicate lunches |

**Why posture is its own module.** The bbox aspect ratio (taller than wide =
standing, wider = floor) returned `on_floor` on 20 out of 20 webcam frames of
someone *sitting at a desk*. A desk does that to a rectangle: the chair, the
lean, the crop at the waist. A body does not become horizontal because its box
did. So we ask the body. And when the knees are under the desk — landmark
visibility 0.15 and 0.03 on those same frames — the answer is `unclear`, which
is a first-class result here. A carer paged at 3am by a confident wrong posture
is worse than one not paged by an admitted unknown.

**Why this model.** Same live frame, same prompt, warm, on this machine:

| Model | Latency | Verdict |
|---|---|---|
| `qwen3-vl:8b` | 7.3 s | too slow to be a "live" surface |
| `qwen3-vl:4b` | 1.95 s | spends its tokens on a `<think>` preamble |
| **`qwen2.5vl:3b`** | **0.69 s** | **shipped** — clean JSON, no thinking tax, same scene right |
| `moondream` | — | returned nothing usable against this schema |

**What the model is asked** (`backend/vision/vlm.py`): one JSON object, fixed
keys, closed value sets — `activity`, `person_count`, `posture`, `movement`,
`spot`, `assistive_device`, `food_visible`, `hand_to_mouth_observed`,
`confidence`, and one `evidence` clause under 70 characters. The prompt
forbids describing clothing, body, hair, race, age or health, and forbids
guessing what anyone is thinking. The resident's memory conditions the prompt
with her name, her appearance and her usual spots — but **not** her routine
facts, deliberately: "she eats at 8" must not turn an empty table into
breakfast.

**What it becomes.** `presence.py` folds observations into intervals (a meal
needs ≥2 observations over ≥120 s) and emits one event with a plain sentence:
*"Eleanor ate lunch at the table, 12:31–12:48."* The family surface gets that
sentence. It never gets the frame, the room name, the posture or the evidence
string — the filter is server-side, in `routers/camera.py` and
`rag.search(family=True)`, because a client-side privacy filter is not a
privacy control.

**Fall corroboration.** `on_floor` is the one posture band that jumps the
keyframe queue — it forces a VLM call immediately rather than waiting for the
next scheduled one, at most once per 30 s. The band is what opens the alert;
the camera is the second opinion that lands in the same event stream seconds
later, flagged `on_floor`, so the person looking at the alert sees both
sensors agreeing before anyone picks up a phone.

---

## Where she is: ESP32 anchors, all day

Falls are the headline. Location is the thing that runs the other 23 hours and
59 minutes, and it is the modality that catches the *slow* emergencies —
a bathroom dwell, a front door at 3am, a bedroom she never left.

**The anchors** (`beacons/beacon.ino`, NimBLE-Arduino 2.x). An ESP32-S3 per
room, advertising a hand-built iBeacon frame every 100 ms: Apple company ID,
type `0x02`, our site UUID `eee6331c-…`, major `1`, a per-room **minor**, and
the calibrated 1 m TX power. One line changes between boards:

```c
static const uint16_t ROOM_MINOR = 1;   // 1=kitchen 2=bathroom 3=bedroom 4=front_door
```

```sh
./beacons/flash.sh /dev/cu.usbmodemXXXX 2        # DevKitC → bathroom
./beacons/flash.sh /dev/cu.usbmodemXXXX 1 box    # S3-BOX  → kitchen
```

**The band scans, it does not transmit.** The UNO Q's Linux side runs a BLE
scan plus a Wi-Fi BSSID scan and POSTs the pair to `/v1/ingest/rf`. RSSI on a
2.4 GHz channel with a body in the way is brutally noisy, so each reading is
the **median over a 3 s window**, not a sample and not a mean — a mean chases
outliers.

**Three boring layers** (`backend/app/location.py`), stacked so the estimate
stops flapping:

1. **Weighted k-NN in signal space** (k=3). Compare the live vector to the
   surveyed fingerprints; an anchor seen in one vector and missing from the
   other costs 20 dB. Below a confidence floor of 0.35 the answer is
   "garbage scan", never a confident wrong room.
2. **A discrete Bayes filter over a room adjacency graph.** The bathroom is
   reachable from the hallway and nowhere else, and `p_stay` is 0.95 in the
   bedroom and 0.50 in the hallway, because a hallway is a place you pass
   through. A teleport floor keeps a zeroed posterior recoverable.
3. **Dwell hysteresis.** Two consecutive ticks *and* posterior ≥ 0.60 before
   we commit to a room change. Three weak ticks and we say `unknown` out loud.

We do not trilaterate. Nearest-room-with-hysteresis, never a dot on a floor
plan — a dot promises metre accuracy we cannot deliver, and the first time it
is in the wrong room the staff stop believing everything else on the screen.

**Calibration is a product step, not a lab step.** The onboarding survey walks
the family room by room, records ten scans each, and prints `separability_db`
per room pair. Below ~6 dB the app tells them to *merge the two zones*: one
correct "downstairs" beats two rooms that are right 55% of the time. Unplug an
anchor and `beacon_offline` fires and the room degrades to `unknown`, which is
a demo prop and also the honest failure mode.

**Honest accuracy.** Room-level, not metre-level: ~85–95% of committed
estimates in walled rooms after a survey; poor in an open-plan kitchen/living
room, which is one RF room and should be one zone; 20–60 s to commit a change.

**And the family never sees any of it** (D-001). Room, zone, posture and
evidence are for the staff surface and the baseline learner. The family gets
home/out, counts, and deviations from her own baseline. Priya knowing her
mother is in the bathroom *right now* is exactly the surveillance Eleanor
would take the band off over.

---

## The fall, and the ladder

On-band, at 208 Hz and ±16 g, with two entry paths — because a forearm band
is not a waist-mounted research dataset. The arm flails, the body pivots at
the feet, and insisting on a deep free-fall window is how a detector scores
95% on a treadmill and 40% on a grandmother.

| Path | Requires |
|---|---|
| `FREEFALL_IMPACT` | free-fall window → impact, lower impact bar |
| `SOFT_FALL` | no free fall at all → higher impact **plus** a mandatory orientation change |

Then the escalation, timings in `backend/app/alerts.py`:

| t | State | What happens |
|---|---|---|
| `T+0` | `SUSPECTED` | Buzzer + red LED on the band. The hub knows. **No human is notified yet** (D-002) |
| `T+0…30 s` | `LOCAL_CANCEL` | She presses the button → resolved `false_positive`, and nothing else happens |
| `T+30 s` | `CALLING_RESIDENT` | **She** gets the call. A voice agent, disclosed as recorded and as AI, 25 s timeout |
| on no-answer | `RETRY_RESIDENT` | Exactly one retry, 15 s later |
| `T+~120 s` | `CALLING_CONTACT_1` | Family call + time-sensitive push + full-screen in-app alert |
| `+60 s` | `CALLING_CONTACT_2` | Placed **in parallel**, contact 1 is not hung up on |
| `+60 s` | `ESCALATED_FINAL` | Every remaining contact, with 911 guidance and the address. **We never dial 911 ourselves** (D-005) |

30 s, not 60: someone who dropped the band knows within 5 seconds, and someone
who actually fell is not cancelling.

---

## Privacy, as enforced code

| Promise | Where it is enforced | How it fails |
|---|---|---|
| No frame ever hits disk | AST walk over `backend/vision/` in `test_vision_gate.py` | the test suite goes red |
| No frame leaves the machine | one socket, loopback to Ollama | — |
| Consent is checked before the device opens, and on every config poll | `vision/worker.py` | a failed config fetch means *no consent*, not "carry on" |
| Camera ingest fails closed | `routers/camera.py` | no camera doc, consent off or paused → nothing is written at all |
| Family never sees a room | server-side filter in `routers/camera.py`, `rag.py`, `presence.py` | — |
| No audio from the camera, ever | the worker never opens a microphone | — |
| Call audio is never stored | D-004 — text transcripts, 7-day retention | — |

> **This build has no authentication.** No login, no API key, no band key, no
> token on the websocket, and CORS is wide open. One laptop, one LAN, one
> demo. The notice at the top of `backend/app/main.py` says the same thing at
> more length. Do not expose it. The consent gates above still run — they
> protect the resident from the system, not the server from the network.

---

## Run it

Prerequisites: [Docker Desktop](https://www.docker.com/products/docker-desktop/),
[Ollama](https://ollama.com) (`brew install ollama`), `uv` (`brew install uv`)
or a Python 3.11+ you trust, and Node.

```bash
# first time only
cd backend && uv venv && uv pip install -e ".[vision]" --group dev
cd ../frontend && npm install && cd ..

# every time after that
./dev.sh
```

`dev.sh` starts mongo in Docker, starts `ollama serve` if it is not already
up, pulls `nomic-embed-text` once, seeds Eleanor if the DB is empty, and runs
the API on `0.0.0.0:8000` — reachable from a phone on the LAN, not just the
Mac. Re-running it is safe: it skips what is already running and never reseeds
a database that has data. Ctrl-C stops only what that run started.

It prints your Mac's LAN URL and the exact Expo command, because a phone in
Expo Go cannot resolve `localhost` to your Mac:

```bash
cd frontend
EXPO_PUBLIC_API_BASE=http://<mac-ip>:8000/v1 npx expo start --lan
```

(`cd backend && make ip` prints `<mac-ip>`. The iOS Simulator is fine with the
`localhost` default: `npx expo start`, then `i`. To demo with no backend at
all, `EXPO_PUBLIC_USE_MOCKS=true`.)

**The camera lane starts separately**, because it wants a camera or an explicit
stand-in:

```bash
cd backend
make vlm                                              # pull + warm qwen2.5vl:3b, once (3.2 GB)
python -m vision --source 0 --camera-id cam_mac_01 --demo
python -m vision --source 0 --preview                 # watch the cascade decide, live
make vision-synthetic                                 # no webcam: synthetic frames
```

`--demo` is not a separate code path. It is the same rules with smaller
numbers, so a bite becomes a sentence inside a 3-minute slot.

**Tests** need mongo but not `dev.sh`:

```bash
cd backend && make mongo && make test     # 274 tests, 21 s
make -C band test                         # fall detector + payload shapes
```

---

## Layout

| Path | What |
|---|---|
| [`backend/app/`](backend/app/) | FastAPI + MongoDB: events, alerts FSM, localizer, RAG, presence, memory |
| [`backend/vision/`](backend/vision/) | The camera worker. The only process that ever holds pixels |
| [`frontend/`](frontend/) | Expo / React Native app — family and staff surfaces |
| [`band/`](band/) | Arduino UNO Q band: 208 Hz fall cascade + BLE/Wi-Fi uplink |
| [`beacons/`](beacons/) | ESP32-S3 iBeacon room anchors |
| [`dhyaan/voice/`](dhyaan/voice/) | Twilio ↔ Deepgram bridge for the escalation call |
| [`testcam/`](testcam/) | Standalone detector bench. The evidence behind every latency number above |
| [`scripts/`](scripts/) + [`test_audio/`](test_audio/) | The voice lane's offline dev loop: replay a wav at the agent, no phone call |
| [`docs/`](docs/) | Specs, decisions, contracts. Start at [`docs/README.md`](docs/README.md) |

---

## Extending it

### Heart rate — the next sensor, and it is a small change

The band's sensors hang off a Qwiic (I²C) chain, which is exactly why this is
cheap: the SparkFun **SEN-15219** (MAX30101 optical front end + MAX32664
biometric hub, address `0x55`) plugs into the free end of the existing chain.
No new bus, no level shifting, no board change, ~$49.

What it buys, in order of how much it is worth:

1. **A fall gets a vital sign attached.** Right now the escalation call is the
   only way to learn anything about the person after an impact. Resting HR at
   `T+5 s` and again at `T+60 s` turns "she is not answering" into "she is not
   answering and her heart rate went from 68 to 130", which is the difference
   between a message and a dispatch.
2. **Immobility gets a second opinion.** `prolonged_inactivity` from an IMU
   cannot distinguish a nap from a syncope. A pulse can.
3. **The baseline learner already has the shape for it.** `baseline.py` learns
   per-resident distributions and flags deviation; resting HR is another
   series with a p5/p95, and *her* normal is the only normal that matters.

The work: a `ModulinoHR`-style read in the sketch's 1 Hz slow loop (the 208 Hz
fall loop is untouched — the MAX32664 hub does its own DSP and answers over
I²C at ~1 Hz), one more field on `POST /v1/ingest/heartbeat`, and a new event
type. The wire contract already carries `battery_pct` in that payload, so the
shape is there.

The honest caveat: wrist/forearm PPG is motion-sensitive and this band sits on
a forearm strapped next to a power bank. It is a *trend* sensor, not a medical
one, and it would be labelled that way in the app.

### Speakers and a microphone — wanted, and not possible on this hardware

Design called for a two-way in-room voice: Eleanor says "I'm okay" instead of
finding a button, and the band answers out loud during the grace window. We
could not build it in this box, for reasons that are hardware, not scheduling:

- **Qwiic is I²C.** The entire Modulino chain runs at 100–400 kHz on two
  wires. Audio wants I²S. There is no I²S microphone or speaker node in the
  Modulino line, and the bus the band is built on cannot carry a PCM stream
  at any bit depth worth hearing.
- **The UNO Q has no audio path.** No codec, no analog out, no MEMS mic. The
  only sound the band can make is the Modulino Buzzer — a self-oscillating
  piezo on the I²C bus — which is why the grace window is a 2 kHz chirp and a
  red LED rather than a voice.
- **The one board in the lab that *does* have a speaker and a mic array — the
  ESP32-S3-BOX — was already spoken for.** The hardware lab had exactly one
  DevKitC and one S3-BOX, and room localization needs two anchors at opposite
  corners or the fingerprints do not separate. Location beat audio for that
  board. (`beacons/README.md` still carries the note that the S3-BOX "later
  doubles as the in-room chime" — that is the path back.)
- **And the legal ceiling is real even with the hardware.** Always-on in-room
  audio is the single most restricted thing in this product category:
  Virginia bans audio outright in shared rooms, and the worst case is an
  all-party-consent state with no authorising statute. The camera lane
  therefore records no audio at all, by design — the only audio in the system
  is a disclosed phone call. See `docs/PRODUCT_SPEC.md`.

The product answer is the ESP32-S3-BOX as a dedicated in-room node, separate
from the band: speaker + mic array + Wi-Fi, mains-powered, one per room, with
the wake word and the ASR staying on the hub next to the VLM. The band keeps
the buzzer.

### The band itself

The 24 h prototype is a credit-card SBC and a 223 g power bank velcroed to a
forearm. It is a functional fall detector, room locator and uplink. It is not
something anyone would wear to bed. The product is an nRF52840- or
ESP32-C6-class band: the LSM6DSOX stays, the MCU shrinks to a 64 MHz Cortex-M4,
the battery becomes a 120 mAh pouch, and the budget is ~2 mA average, which is
about two months per charge. **The detection cascade and the RSSI pipeline port
unchanged**, which is why both are written as threshold state machines over
physical units rather than as a black box.

---

## Docs

[`docs/README.md`](docs/README.md) indexes everything. The short version:

| Doc | Read it for |
|---|---|
| [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) | What this is, who it is for, the competitive landscape, and where it is weak |
| [`docs/TECHNICAL_PRD.md`](docs/TECHNICAL_PRD.md) | The whole system: event model, alert FSM, voice layer, localization maths |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Every D-0xx decision and the argument behind it |
| [`docs/VLM_PLAN.md`](docs/VLM_PLAN.md) | The camera lane, including what it honestly cannot do |
| [`docs/HARDWARE_SPEC.md`](docs/HARDWARE_SPEC.md) | BOM, radios, power budget, placement, the fall cascade in pseudocode |
| [`docs/HARDWARE_INTEGRATION.md`](docs/HARDWARE_INTEGRATION.md) | The contract firmware must meet |
| [`docs/backend-README.md`](docs/backend-README.md) · [`docs/voice-README.md`](docs/voice-README.md) | Per-lane guides: API and known ceilings; the Twilio/Deepgram slice |
| [`docs/frontend-DESIGN.md`](docs/frontend-DESIGN.md) | The app's design system and its copy rules |
| [`docs/API_CONTRACT_V2.md`](docs/API_CONTRACT_V2.md) · [`docs/API_CONTRACT_V3.md`](docs/API_CONTRACT_V3.md) | Frozen HTTP surfaces. **Not successive versions** — V2 is setup/admin (pairing, survey, contacts, push), V3 is the camera lane. Disjoint endpoints, unfortunate names |

Bring-up, hands on hardware:
[`band/README.md`](band/README.md) · [`band/fallband/README.md`](band/fallband/README.md) ·
[`beacons/README.md`](beacons/README.md) · [`DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md)

Why the detector stack is what it is:
[`testcam/README.md`](testcam/README.md) benchmarks every backend on the same
frames, and [`testcam/FOOD.md`](testcam/FOOD.md) is the finding that drove the
whole open-vocabulary gate — COCO has exactly ten food classes, so a crisp
packet, a noodle box, a wrapper and a mug of soup are all invisible to a plain
YOLO. "Did she eat?" is unanswerable with a closed vocabulary.

Judging write-ups: [`SUBMISSIONS.md`](SUBMISSIONS.md) indexes them —
[`COST.md`](COST.md), [`docs/DROPBOX_CHALLENGE.md`](docs/DROPBOX_CHALLENGE.md),
[`docs/META_CHALLENGE.md`](docs/META_CHALLENGE.md).

---

## Two things to say out loud to a judge

**Eleanor's 15 days of history come from a seed script. The learner running on
top of it is real** — `baseline.py` builds her distributions from whatever
events exist, and it does not know or care that a script wrote them.

**The camera never writes a frame to disk, and the family never sees an image
or a room name.** They see sentences. That is not a limitation we are
apologising for; it is the only version of this product a grandparent would
agree to live with.
