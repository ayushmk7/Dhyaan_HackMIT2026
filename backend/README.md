# Dhyaan — backend

FastAPI + MongoDB. One process, one database, no message broker. Everything the
band, the app and the voice agent do becomes an **event**; alerts, baselines and
the chat are all readers of that one collection.

Specs: [`../TECHNICAL_PRD.md`](../TECHNICAL_PRD.md) · [`../HARDWARE_SPEC.md`](../HARDWARE_SPEC.md)

## Run it

```bash
make mongo     # docker mongo:7 on :27017
uv venv && uv pip install -e . --group dev
make embedder  # ollama serve + pull nomic-embed-text (once)
make seed      # Eleanor + 15 days of history, today deliberately anomalous
make run       # 0.0.0.0:8000
make test      # 45 tests
make ip        # the URL to paste into the React Native app
```

Config is env vars, all with working defaults — see `.env.example`. Nothing here
needs an API key: with no `ANTHROPIC_API_KEY` the narrative and chat layers fall
back to templates, and the whole demo runs offline.

## What works right now

```
band POST → event → alert opens → 30s cancel window → call placed
          → classified → escalates to contact 1 → contact 2 → final
```

Verified end to end against a live server. The voice calls are a stub that logs
and emits `call_placed`; swapping in real Twilio does not touch the FSM.

| Area | State |
|---|---|
| Event store, alerts FSM, escalation ladder | Real |
| Band ingest, RF room localization (k-NN + hysteresis) | Real |
| REST API + websocket for React Native | Real |
| Baseline learner (robust z + Poisson) | Real |
| RAG retrieval + citations + medical guardrail | Real, semantic (`nomic-embed-text` via Ollama) |
| Telephony (Twilio + Deepgram) | **Stub, fill in — `app/voice.py`** |
| Camera / VLM | Not built (out of backend scope) |

## For Utsav — the band contract

Endpoints are `POST /v1/ingest/{band,band/cancel,heartbeat,rf}`, all requiring
the header `X-Band-Key: <BAND_KEY>`. **The JSON your firmware must send is in
`fixtures/`** — those files are the contract, not the prose in the PRD:

| File | Endpoint |
|---|---|
| `fixtures/band_fall.json` | `POST /v1/ingest/band` |
| `fixtures/heartbeat.json` | `POST /v1/ingest/heartbeat` |
| `fixtures/rf_scan.json` | `POST /v1/ingest/rf` |

Test your firmware payload against a running server before you trust it:

```bash
curl -X POST http://<mac-ip>:8000/v1/ingest/band \
  -H "X-Band-Key: band-dev-key" -H "Content-Type: application/json" \
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

**App API.** `Authorization: Bearer <API_KEY>` on every route. Websocket is
`ws://<host>/v1/live?token=<API_KEY>&resident_id=<id>` (query param, because RN
websockets cannot set headers). Mongo `_id` is always serialised as `id`, and
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
- Auth is two static shared secrets, not JWT. One tenant exists.
- Room-localization HMM state is process-local, so it resets on restart.
- `/alerts/{id}` reconstructs its call log from `source="voice"` events; there is
  no separate `calls` collection yet.
- Camera fusion for localization is unimplemented — no camera input exists here.

## Seeded demo data

`make seed` writes 15 days for Eleanor in **her local timezone**, not UTC. Today
is deliberately anomalous: no walk, no lunch. After running the rollup the
learner flags it on its own:

> walk count was 0, versus a usual rate of about 4.7 (surprise 2.06)
> longest inactivity 15240s (baseline 8160s, z=3.93)

The history is synthetic. The learner running on it is real. Say that to judges.

Two things worth knowing about that number. `TECHNICAL_PRD` §8.2's worked example
(λ=3.1, zero walks → urgent) does not clear its own threshold: `-log10(e^-3.1)`
is 1.28, under the 1.3 warn cutoff. Eleanor is seeded to walk 4–6×/day so zero is
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

Proved by `tests/test_voice_adapter.py` (10 tests): tool calls drive real state
transitions, replays are idempotent, transcripts and call bindings persist, and
a tool call the FSM refuses returns `{"ok": false}` instead of raising into the
websocket and killing a live call.

## Camera lane

One camera in one room, a local vision-language model, and a sentence. The
worker is a separate process (`backend/vision/`, `python -m vision`) — not an
asyncio task in the API — for three reasons: the macOS camera prompt attaches to
the process that opens the device, a 3-second blocking VLM call must never sit on
the event loop next to a fall ingest, and it makes the privacy claim structural:
**the API process never has a frame to leak.**

### Install and run

```bash
uv pip install -e ".[vision]"     # opencv + ultralytics (torch, ~1 GB, ~2 min)
make vlm                          # pull + warm qwen3-vl:8b (6.1 GB, stays resident)
make vision                       # against the local API
make vision-demo                  # on-stage: fast rules + preview window
```

`.[vision]` also installs `ultralytics`, which ships a top-level `tests/` package
into site-packages. `backend/tests/__init__.py` exists to stop that shadowing
this repo's suite — do not delete it.

### The cascade

Every frame that reaches the VLM costs 3–5 seconds, so almost none do:

| # | Stage | Drops | Cost |
|---|---|---|---|
| 0 | sample every 10th frame | 30 fps → ~3 fps | — |
| 1 | privacy mask (`--mask x0,y0,x1,y1`, normalised) | — | <1 ms |
| 2 | motion, MOG2 on 320×180 grey, foreground > 0.8 % | ~90 % of a lived-in room | ~2 ms |
| 3 | person, YOLO11n on MPS, class 0 only | ~30 % of what moved | ~25 ms |
| 4 | keyframe rules (appear / posture / dwell / on_floor) | all but ~1 batch/min | <1 ms |
| 5 | `qwen3-vl:8b`, 1–3 frames, JSON schema | — | 2.9–6.1 s measured |

Every threshold is in one dict, `TUNING` in `vision/__init__.py`. **They are not
universal.** A bright kitchen with a window behind the chair will need
`motion_ratio` raised and `person_conf` lowered; ten minutes with `--preview` in
the actual room beats any default in there.

### Flags

```
--source 0            MacBook camera. 1+ is a Continuity Camera (an iPhone on the
                      same Apple ID is a webcam for free). A path plays a video or
                      a still at real time, looped — rehearsal and stage fallback.
--camera-id cam_mac_01
--api http://localhost:8000     --band-key ...   (X-Band-Key, as the band lane)
--mask 0,0,0.25,1     black out a private doorway BEFORE motion detection
--preview             a window on the hub's own screen. `p` pauses the camera for
                      two hours (her control, on her hub); `q` quits.
--demo                min_gap 6 s, dwell 15 s — bite to sentence inside the slot
--dry-run             print the exact POST body instead of posting it
--no-yolo             the cut path: motion only, the VLM decides presence
--config-json FILE    read /v1/camera/config's shape from a file
```

### Privacy, as mechanism rather than promise

- **No frame is written to disk, ever.** There is no `imwrite`, no `VideoWriter`,
  and the only `open()` in the package reads `--config-json`. The last test in
  `tests/test_vision_gate.py` walks the package's AST and fails the build if that
  stops being true. Frames live in a RAM ring of at most three JPEGs, freed on POST.
- **Frames cross exactly one socket:** loopback to Ollama. The API gets text.
- **Consent is checked before the camera device is opened** and on every 10 s
  config poll. A config fetch that fails means *no consent*, not "carry on".
  A config naming a `bedroom` or `bathroom` zone is refused by the worker too,
  not only by the API's 422 — a worker that would point a camera at a bedroom
  because a server said so is not a gate.
- `movement: "unsteady"` is downgraded to `"unclear"` before posting. Gait is
  staff-only and this lane has no staff surface: do not record what you will not
  show.

Check it yourself:

```bash
python -m vision --dry-run --demo --source rehearsal.mp4 --camera-id cam_mac_01
```

prints the exact `POST /v1/ingest/camera` body, which should diff clean against
`fixtures/camera_observation.json`.

### Known ceilings

- **`think: false` is mandatory.** `qwen3-vl` is a thinking model; with thinking
  on, a 3-frame call takes 24 s and the chain of thought eats `num_predict`
  before any JSON appears. With it off the call is 2.5–4.5 s — but Ollama 0.32.9
  then puts the schema-constrained JSON in `message.thinking` and leaves
  `message.content` empty. `vlm.call()` reads whichever is populated. Revisit
  when Ollama fixes the routing.
- **A person who sits perfectly still for ~100 s** is absorbed into MOG2's
  background and stops producing motion. The worker re-runs the person gate every
  5 s while she is believed present, so "she stopped moving" never becomes "she
  left". `--no-yolo` cannot make that check — that is the honest cost of the cut
  path, and it will report her absent if she naps in the armchair.
- **One camera, one track, single-occupant assumption.** No tracker, no
  re-identification. Two people in frame become `with_visitor` and nothing is
  recorded about the second. Upgrade is `model.track(persist=True)`.
- **In-process state only.** The keyframe selector and the ring reset on restart.
