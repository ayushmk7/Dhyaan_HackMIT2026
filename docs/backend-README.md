# Dhyaan — backend

FastAPI + MongoDB. One process, one database, no message broker. Everything the
band, the app, the camera worker and the voice agent do becomes an **event**;
alerts, baselines and the chat are all readers of that one collection.

Specs: [`./TECHNICAL_PRD.md`](./TECHNICAL_PRD.md) · [`./HARDWARE_SPEC.md`](./HARDWARE_SPEC.md) ·
[`./VLM_PLAN.md`](./VLM_PLAN.md) (camera lane) · [`./API_CONTRACT_V3.md`](./API_CONTRACT_V3.md)

## Run it

```bash
make mongo     # docker mongo:7 on :27017
uv venv && uv pip install -e . --group dev        # add ".[vision]" for the camera lane
make embedder  # ollama serve + pull nomic-embed-text (once)
make seed      # Asha + 14 days of history plus today, today deliberately anomalous
make run       # 0.0.0.0:8000
make test      # 274 tests
make ip        # the URL to paste into the React Native app
```

Or `../dev.sh` from the repo root, which sequences mongo → ollama → seed (only
if the DB is empty) → API and prints the LAN URL. It defaults `DEMO_FAST=1`
(every camera dedup gap and duration shrinks to a tenth, and the RF dwell
notices to 90 s / 180 s, so a two-minute demo puts meals and visits on the
timeline) and `CHAT_FALLBACK_MODEL=qwen2.5vl:3b` (Ask answers in prose from the
vision model already resident in Ollama, with no key and no extra download).
`DEMO_FAST=0 ./dev.sh` restores the real thresholds.

Config is env vars, all with working defaults — see `.env.example`. Nothing here
needs an API key: with no `ANTHROPIC_API_KEY` the narrative and chat layers fall
back to the local Ollama model if `CHAT_FALLBACK_MODEL` is set and to plain
templates if it is not, and the whole demo runs offline.

**There is no authentication.** No login, no API key, no band key, no token on
the websocket. The notice at the top of `app/main.py` is the full statement;
the short version is that anything which can reach the port can read and write
everything, and this must not leave the LAN. What *is* still enforced, and is
not auth: the camera consent gates, the pause, the family response filter and
the typed-name confirmation on memory delete. They protect the resident from
the system, not the server from the network. See "Camera lane" below.

## What works right now

```
band POST → event → alert opens → 30s cancel window → call placed
          → classified → escalates to contact 1 → contact 2 → final
camera worker → observation → dedup → meal_observed / activity_observed
             → presence sentence on the phone, never a frame
```

Verified end to end against a live server. The voice calls are a stub that logs
and emits `call_placed`; swapping in real Twilio does not touch the FSM.

| Area | State |
|---|---|
| Event store, alerts FSM, escalation ladder | Real |
| Band ingest, RF room localization (k-NN + hysteresis) | Real |
| REST API + websocket for React Native | Real |
| Baseline learner (robust z + Poisson) | Real |
| RAG retrieval + citations + medical and surveillance guards | Real, semantic (`nomic-embed-text` via Ollama) |
| Camera lane: open-vocabulary detector + local VLM, presence, monitor channel | Real (`vision/`, `app/routers/camera.py`, `app/presence.py`, `app/memory.py`) |
| Telephony (Twilio + Deepgram) | **Stub, fill in — `app/voice.py`**; the live bridge mounts itself when `TWILIO_ACCOUNT_SID` and `DEEPGRAM_API_KEY` are set |
| Authentication, authorization | **None.** Removed on purpose for the demo build |

## For Utsav — the band contract

Endpoints are `POST /v1/ingest/{band,band/cancel,heartbeat,rf}`. No auth
header: the API has none (demo build, see the notice in `app/main.py`); an
`X-Band-Key` header is ignored if sent. **The JSON your firmware must send is in
`fixtures/`** — those files are the contract, not the prose in the PRD:

| File | Endpoint |
|---|---|
| `fixtures/band_fall.json` | `POST /v1/ingest/band` |
| `fixtures/heartbeat.json` | `POST /v1/ingest/heartbeat` |
| `fixtures/rf_scan.json` | `POST /v1/ingest/rf` |

Test your firmware payload against a running server before you trust it:

```bash
curl -X POST http://<mac-ip>:8000/v1/ingest/band \
  -H "Content-Type: application/json" \
  -d @fixtures/band_fall.json
# -> {"event_id": "evt_...", "alert_id": "alt_...", "cancel_window_s": 30}
```

An unknown `band_id` returns 404 rather than silently creating a band — pair it
first by inserting into the `bands` collection (`make seed` does this for
`band_a3f2`). Header docs and per-endpoint curl examples are at the top of
`app/routers/ingest.py`.

## For Abhinav — the two seams

**Telephony.** `app/voice.py` is a template with a `set_impl()` hook. Implement
`place_call`, `hangup`, `speak_final_escalation` against Twilio + Deepgram and
call `set_impl(YourImpl())` at startup. The FSM in `app/alerts.py` needs no
changes — it already drives the full ladder, proved by `tests/test_alerts.py`.
Classifications flow back in via `alerts.classify(alert_id, classification,
detail)` with one of `okay | fell_but_fine | no_answer | distress | incoherent`.
**Silence escalates** — not calling `classify` at all is treated as distress.

**App API.** No auth on any route, and none on the websocket
(`ws://<host>/v1/live?resident_id=<id>`): anyone who can reach the port can
read and write everything. Demo build; `app/main.py` says so at the top. Mongo `_id` is always serialised as `id`, and
every timestamp is an ISO-8601 string. `GET /v1/residents` is built to fill the
home screen in one request.

## Known ceilings

Marked `# ponytail:` in the code, with upgrade paths:

- **Embeddings need `ollama serve`.** `make embedder` starts it and pulls
  `nomic-embed-text` (768d, local, offline once pulled, no API key). If it is not
  running, `embed()` silently falls back to a hash bag-of-tokens and logs a
  warning once — retrieval still works but ranks by keyword overlap only. Events
  embedded by each backend have different widths; `_cosine` skips mismatched
  pairs rather than raising, so a half-embedded corpus degrades instead of
  breaking. Re-run `make seed` after starting the embedder to re-embed cleanly.
- **Embedding is off the critical path.** It runs as a background task, so a
  fall POST never waits on the embedder. Retrieval is therefore eventually
  consistent — anything that writes then queries immediately (tests, scripts)
  must `await rag.drain_embeddings()` first. `make seed` already does.
- No vector index. Brute-force cosine in numpy, fine to ~50k events on a laptop.
- **No auth at all**, and one tenant. Not two shared secrets, not JWT: nothing.
  Put real auth back before this is reachable from anywhere but the demo LAN.
- Room-localization HMM state, the camera dedup's open episodes and the
  monitor tick are all process-local, so they reset on restart.
- `/alerts/{id}` reconstructs its call log from `source="voice"` events; there is
  no separate `calls` collection yet.
- The camera lane exists (below) but does not feed `app/location.py`: room
  localization is still RF-only, and the camera's zone rides on its events for
  the learner and staff without ever reaching a family surface.

## Seeded demo data

`make seed` writes 14 days plus today for Asha (`display_name` only; ids such as
`res_eleanor` and `band_a3f2` are unchanged, and older docs still say Eleanor)
in **her local timezone**, not UTC. Today is deliberately anomalous: no walk, no
lunch. After running the rollup the learner flags it on its own. The staff-facing
`embedding_text` reads:

> walk count was 0, versus a usual rate of about 4.7 (surprise 2.06)
> longest inactivity 15240s (baseline 8160s, z=3.93)

The family never sees that line. `baseline.py::_family_text` writes
`payload.narrative` beside it, one plain sentence with no feature slug, no
z-score and nothing in seconds (*"Asha went about 4 hours without moving. She
usually settles for about 2 hours."*), and `/activity`, `/summaries` and the
chat citations all prefer it. The no-key daily narrative
(`rag._template_narrative`) is prose too: no date stamp, no event count, meals
named rather than counted so a search for *has she been eating* can match it.
Neither uses an em dash; `docs/frontend-DESIGN.md` bans them in family copy.

The history is synthetic. The learner running on it is real. Say that to judges.

Two things worth knowing about that number. `TECHNICAL_PRD` §8.2's worked example
(λ=3.1, zero walks → urgent) does not clear its own threshold: `-log10(e^-3.1)`
is 1.28, under the 1.3 warn cutoff. Asha is seeded to walk 4–6×/day so zero is
genuinely surprising. And the seed must write local wall-clock time — in UTC, her
night bathroom trips land in the previous evening and poison `wake_time_min`.

## Integrating Abhinav's voice bridge

`dhyaan/voice/` (lane B) was built against `dhyaan/voice/fsm_stub.py`, an
in-memory stand-in. `app/voice_adapter.py` is that same seam backed by the real
FSM and MongoDB, with identical signatures. The switch is one import:

```diff
- from dhyaan.voice import fsm_stub as fsm
+ from app import voice_adapter as fsm
```

and one call at startup in `dhyaan/voice/app.py`:

```python
from app import db, voice_adapter
await db.connect()
voice_adapter.install()   # the FSM ladder now dials through Twilio
```

`install()` closes the loop the other way too: `app/alerts.py` places its calls
through `app/voice.py`, whose default stub only logs. `install()` swaps in
`dhyaan.voice.outbound.place_call` so the ladder dials real numbers.

Proved by `tests/test_voice_adapter.py` (8 tests): tool calls drive real state
transitions, replays are idempotent, transcripts and call bindings persist, and
a tool call the FSM refuses returns `{"ok": false}` instead of raising into the
websocket and killing a live call.

## Camera lane

One camera in one room, a local detector and a local vision-language model, and
a sentence. The worker is a separate process (`backend/vision/`, `python -m
vision`), not an asyncio task in the API, for three reasons: the macOS camera
prompt attaches to the process that opens the device, a blocking model call must
never sit on the event loop next to a fall ingest, and it makes the privacy
claim structural: **the API process never has a frame to leak.** The full
design and every measured number is in `VLM_PLAN.md` §3; this section is what
you need to run it and what will bite.

### Install and run

```bash
uv pip install -e ".[vision]"     # opencv, ultralytics (torch, ~1 GB, ~2 min),
                                  # ultralytics' CLIP fork (pinned), mediapipe==0.10.35 (pinned)
make vlm                          # pull + warm qwen2.5vl:3b (3.2 GB, stays resident)
make vision                       # against the local API
make vision-demo                  # on-stage: fast rules + preview window
make vision-synthetic             # no webcam: a scripted drawn room, on-stage rules
```

First start needs the network once: `yolov8s-worldv2.pt` (~25 MB) and CLIP
ViT-B/32 (~340 MB, for the text embeddings) download by name and are gitignored.
A half-downloaded CLIP checkpoint is deleted on the next start rather than
re-downloaded on every start (`openvocab._clip_cache_is_sound`). The two pins
are not optional: `set_classes()` needs the CLIP fork and ultralytics tries to
pip-install it at runtime, which fails in a uv venv; mediapipe 1.0.1 hard-aborts
inside a Metal helper on this machine and takes the lane down with no traceback.

`.[vision]` also installs `ultralytics`, which ships a top-level `tests/` package
into site-packages. `backend/tests/__init__.py` exists to stop that shadowing
this repo's suite — do not delete it.

### The cascade

The detector answers the structural questions in ~13 ms; the VLM only writes
the sentence, so almost nothing reaches it:

| # | Stage | Drops | Cost |
|---|---|---|---|
| 0 | sample every 2nd frame (`SAMPLE_EVERY_N`) | 30 fps → ~15 fps | — |
| 1 | privacy mask (`--mask x0,y0,x1,y1`, normalised) | — | <1 ms |
| 2 | motion, MOG2 on 320×180 grey, foreground ≥ 0.8 % | ~90 % of a lived-in room | ~2 ms |
| 3 | scene, YOLO-World `yolov8s-worldv2` on MPS, 20 free-text prompts: people, food, dishes, seating in one pass. Also re-run every 5 s while she is believed present | ~30 % of what moved | **~13 ms median** live; 3.1 s once at start |
| 3p | posture, MediaPipe pose landmarks on the subject's box | — | ~14 ms, cached per box |
| 4 | keyframe rules (appear / posture / dwell / on_floor / absent), rationing the VLM only; the detector posts its own observation the moment what it sees changes | all but ~1 VLM call/min (1 per ~8 s with `--demo`) | <1 ms |
| 5 | `qwen2.5vl:3b`, **1 frame**, JSON asked for in the prompt, schema-constrained retry only on a reply that does not parse; on its own thread | — | **0.69 s warm** (1.54 s with the schema; 2.2 to 2.8 s observed when the GPU is shared) |

Every threshold is in one dict, `TUNING` in `vision/__init__.py`, most of them
env-overridable (`WORLD_PERSON_CONF`, `WORLD_CONF`, `WORLD_HOLD`, `SAMPLE_EVERY_N`,
`VLM_EVERY_N`, `MIN_GAP_S`, `ON_DWELL_S`, `YOLO_MODEL`, `YOLO_DEVICE`, `VLM_MODEL`,
`VISITOR_DETECTION`, `OPENVOCAB`). **They are not universal.** A bright kitchen
with a window behind the chair will need `motion_ratio` raised and
`world_person_conf` lowered; ten minutes with `--preview` in the actual room
beats any default in there.

### The detector is open-vocabulary, and the vocabulary is a threshold

`gate.py` runs YOLO-World, not a COCO YOLO. COCO's entire food vocabulary is
ten words, so a crisp packet, a mug of soup or a bowl of cereal has no output
neuron and no threshold or bigger model can report them; on five photographs of
real food the COCO detector reported food once and was wrong (`pizza` for a
protein bar). YOLO-World takes its class list as plain text at runtime, named
the cereal and the soup, and found eight people in a crowd shot where `yolo11n`
found zero. The bench that measured this was `testcam/` (removed in `12d53ff`,
recoverable at `56e2237`); the numbers are quoted in `VLM_PLAN.md` §3.3 and in
the comment above `gate.VOCAB`.

The list is **20 prompts** (person / 8 food words / 5 dishes / 4 seating /
2 background nouns that are never reported) and it is short on purpose:
YOLO-World's confidence is a cosine against the prompt list, so the same crisp
packet scores 0.75 alone, 0.11 among 22 food words and 0.09 in a 62-word list.
The floors in `TUNING` are calibrated to *this* list: `world_conf=0.20` for
objects (0.07 above the noise of a live room with no food) and
`world_person_conf=0.15` for people. A label already in the scene stays while
it holds 0.6 of its floor (`world_hold`), because a real packet at the floor
flickered across it four times a second and every flicker was a post. Nested
person boxes are collapsed by containment (a torso box 98 % inside a body box
has an IoU of only 0.47, so NMS leaves it), since the head count is what
present / with_visitor hangs off. Add a word and the calibration re-opens.

What got worse, honestly: soup in a mug is missed (0.14 under a 0.20 floor);
person confidence is far lower than COCO's (0.90 live, 0.19 on a hard
photograph), and the phantom-person rate in a real empty room was never
measured, so `world_person_conf` is the first knob to re-tune at an install; a
noodle bowl reads `cereal`, which is coverage rather than correctness. The label
only ever reaches `evidence` (staff/audit), never the family sentence.

Degradation, all without a crash and each pinned by a test in
`tests/test_vision_gate.py`: no ultralytics/torch → motion-only; weights that
will not download → motion-only; CLIP missing → `yolo11s.pt` if it is already on
disk (people and ten foods), else motion-only; MPS failing the warm-up probe →
CPU; a detector throwing mid-run → motion-only from that frame; no MediaPipe →
bbox posture with `wide` degraded to unknown rather than a fall.
`YOLO_MODEL=yolo11s.pt` is the one-line COCO revert.

### Flags

```
--source 0            MacBook camera. 1+ is a Continuity Camera (an iPhone on the
                      same Apple ID is a webcam for free). A path plays a video or
                      a still at real time, looped — rehearsal and stage fallback.
--source synthetic    a scripted day in a drawn living room: no webcam, no TCC
                      prompt, the real cascade downstream of perception, every
                      row posted with simulated: true. Pass --demo with it (as
                      `make vision-synthetic` does): the one-minute loop is sized
                      for the demo cadence and never goes out of view without it
--camera-id cam_mac_01
--api http://localhost:8000     --band-key ...   (sends X-Band-Key; the API ignores it)
--mask 0,0,0.25,1     black out a private doorway BEFORE motion detection
--preview             a window on the hub's own screen: subject box in green,
                      others grey, and what it currently believes in words.
                      `p` pauses the camera for two hours (her control, on her
                      hub); `q` or Esc quits. PREVIEW_SCALE=3 upscales it.
--demo                min_gap 4 s, dwell 8 s: bite to sentence inside the slot
--dry-run             print the exact POST body instead of posting it; uses a
                      local stand-in config if the API is unreachable and says so
--no-yolo             the cut path: motion only, the VLM decides presence
--config-json FILE    read /v1/camera/config's shape from a file
--model, --ollama     override VLM_MODEL and the Ollama host for one run
```

### Privacy, as mechanism rather than promise

- **No frame is written to disk, ever.** There is no `imwrite`, no `VideoWriter`,
  and the only two `open()` calls in the package read `--config-json` (text)
  and hash the CLIP checkpoint (a model file, not a frame). The last test in
  `tests/test_vision_gate.py` walks the package's AST and fails the build if
  that stops being true; a third exception has to argue its case in that test's
  docstring. Frames live in a RAM ring of at most one JPEG, freed on flush.
- **Frames cross exactly one socket:** loopback to Ollama. The API gets text.
- **Consent is checked before the camera device is opened** and on every 10 s
  config poll. A config fetch that fails means *no consent*, not "carry on".
  A config naming a `bedroom` or `bathroom` zone is refused by the worker too,
  not only by the API's 422 — a worker that would point a camera at a bedroom
  because a server said so is not a gate. A 403 from the ingest stops the camera
  until the next poll.
- **The API fails closed as well, with no auth in front of it.** `POST
  /ingest/camera` and `POST /ingest/camera/monitor` write nothing on consent
  off, a live pause, or an unknown camera (`_live_camera`). `POST
  /cameras/{id}/resume` returns 403 when she paused it herself. No family route
  returns a zone, an `evidence` sentence, a posture or a movement quality; that
  filter is server-side (`_family_item`, `rag.search(family=True)`), because a
  client-side filter is not a privacy control.
- `movement: "unsteady"` is downgraded to `"unclear"` before posting. Gait is
  staff-only and this lane has no staff surface: do not record what you will not
  show.

Check it yourself:

```bash
python -m vision --dry-run --demo --source rehearsal.mp4 --camera-id cam_mac_01
```

prints the exact `POST /v1/ingest/camera` body, which should diff clean against
`fixtures/camera_observation.json` (the fixture predates `food_visible`, which
the API accepts and defaults to false).

### The monitor channel

The hub console and the app's camera screen are fed by `POST
/v1/ingest/camera/monitor`, a tick the worker sends at most once a second
(`TUNING["monitor_s"]`): fps, person count, **normalised** box geometry, the
gate state (`idle` / `motion` / `person` / `thinking`), the model, the latency
and the same activity/spot sentence `GET /presence` already returns. No pixel,
no zone, no `evidence`, no posture, no movement quality. `MonitorIn` in
`app/routers/camera.py` is the allowlist that enforces that: a Pydantic model
drops any field it does not declare, so a worker that starts sending `evidence`
cannot leak it by accident, and a box in pixel coordinates is a 422. The
sentence goes through `rag.scrub_rooms` like every other family string.

The API keeps the last tick per camera in a module-level dict, never in Mongo
(telemetry at 1 Hz with a useful life of one second; resets on restart).
`GET /v1/cameras/{id}/monitor` returns `{camera, online, tick}`, with `tick`
null once the last one is older than `MONITOR_STALE_S = 15`: an honest empty
shape, never a fabricated tick. The same tick is broadcast on `/v1/live` as
`camera.monitor`. A family pause (`POST /cameras/{id}/pause`) drops the tick,
and the ingest for it fails closed exactly as the observation ingest does.
`GET /v1/cameras` lists cameras with a heartbeat-based `online`, stale after
`HEARTBEAT_STALE_S = 75` (two missed 30 s beats).

### Measured on this machine

M-series, 48 GB, `qwen2.5vl:3b`, 448×252, quality 70, one frame, `keep_alive: -1`,
`think: false`, `temperature 0`:

| | measured |
|---|---|
| detector `scene()` | ~13 ms median live (10 to 14 across runs); 11.5 ms median / 17 ms p90 on empty synthetic frames, re-run 2026-09-20 |
| detector warm-up (`set_classes` + MPS probe) | 3.1 s, re-run 2026-09-20 |
| VLM, no schema | 0.69 s warm |
| VLM, schema-constrained retry | 1.54 s warm |
| VLM in a full run, GPU shared with the detector | 2.2 to 2.8 s |
| observations on change | up to 1.5/s (30 in 20 s); one `meal_observed` per lunch after dedup |

The plan's `qwen3-vl:8b` numbers (2.8 s warm for three frames, 4.7 to 6.7 s
after an idle stretch) are history; that model is 7.3 s on a single frame with
the current prompt and was replaced. Warm the shipped model with `make vlm`
before the slot anyway: a cold load is ~10 s and that is the number a demo
feels.

### Known ceilings

- **`think: false` is still in the request body** and still mandatory for any
  `qwen3-vl` override: with thinking on, a call took 24 s and the chain of
  thought ate `num_predict` before any JSON appeared. Ollama 0.32.9 then puts
  the JSON in `message.thinking` and leaves `content` empty; `vlm.call()` reads
  whichever is populated. The shipped `qwen2.5vl:3b` has no thinking mode and
  is unaffected.
- **A person who sits perfectly still for ~100 s** is absorbed into MOG2's
  background and stops producing motion. The worker re-runs the detector every
  5 s while she is believed present, so "she stopped moving" never becomes "she
  left". `--no-yolo` and `--source synthetic` cannot make that check; that is
  the honest cost of the cut path, and it will report her absent if she naps in
  the armchair.
- **Single occupant by default.** `VISITOR_DETECTION` is off: the person count
  is clamped to one, so `with_visitor` and `visitor_present` never arrive from
  the camera (the simulator still produces them). In a hall it fired on every
  frame and drowned everything else. `VISITOR_DETECTION=1` restores it. There is
  no re-identification: the worker follows one subject by IoU against the last
  box, and when nothing overlaps it reports *not seen* rather than adopting
  whoever is now the biggest box. A re-entry after a long occlusion is a new
  subject, which is the safe direction.
- **`on_floor` is unverified on a real fall.** The bbox heuristic was replaced
  by pose landmarks after it called someone seated at a desk `on_floor` 20
  frames out of 20; `unclear` is now a first-class answer. Nobody has lain on the
  floor for the test, so its correctness rests on synthetic-landmark tests.
- **Two MPS consumers, one queue.** The detector and Ollama share the GPU. A VLM
  call in flight spiked the detector to 824 ms and 2.7 s at every frame, which
  is why stage 3b (COCO revert only) runs every 3rd frame and the VLM runs on
  its own thread with a queue of one, drop-oldest.
- **In-process state only.** The keyframe selector, the ring, the followed
  subject and the API's open episodes and monitor tick reset on restart.
- **Shutdown is clean, and only clean.** SIGTERM and SIGINT set a stop flag so
  the loop unwinds through `finally`: the camera is released, MediaPipe is shut
  down before interpreter teardown, and the `offline` heartbeat is sent. Before
  that fix a killed worker left the app saying *camera online* with the last
  sentence frozen, which is the worst failure mode this product has. A `kill
  -9` still does that; the console then goes stale on the heartbeat timer
  (75 s) and the tick timer (15 s), not instantly.
- **macOS camera permission is per-terminal and intermittent.** The TCC prompt
  attaches to whichever process opens the device, so the first `make vision-demo`
  must be run by hand and Allowed; a worker launched from a non-interactive shell
  gets `cannot open camera source '0'` (a one-line message, not a traceback) until
  it has been. On stage, grant it before the slot and do not change terminals, or
  use `--source synthetic`.
