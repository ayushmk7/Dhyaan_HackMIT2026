# VLM presence layer — implementation plan

Dhyaan Home, camera lane. One camera in one common room of one consented resident's home,
a local vision-language model on the Mac, and an adult child's app that gets sentences.
Three agents build this in parallel from this document. Ponytail mode: the laziest thing
that actually works, with every shortcut's ceiling named. Nothing here relaxes consent,
zone rules, or validation at a trust boundary.

Binding inputs: `PRODUCT_SPEC.md` §8 (creepiness budget), `DECISIONS.md` D-001 (family never
sees a room), `TECHNICAL_PRD.md` §6 (cascade) and §12 (privacy), `frontend/DESIGN.md`,
`distinctive-frontend.md`. Where this plan and the original brief disagree, §1 says so.

---

## 1. The honest version

**What this can do in 24 hours, on one MacBook, with one webcam:**

- Watch **one room** (the room the family points the camera at: kitchen, living or dining room)
  and turn what it sees into a handful of plain sentences per hour: *having something to eat at
  the table*, *settled in the armchair*, *up and moving about*, *out of view since 10:12*,
  *someone is visiting*. Locally, with no frame ever leaving the process that captured it.
- Keep a **local memory of her** — what the family told us in onboarding, how the camera's
  room is laid out, a text description of what she looks like, and the spots she is usually
  found in at each time of day — and use it to condition every vision call.
- Answer **"has she eaten today", "what does she usually have for breakfast", "where does she
  spend her afternoons", "how were her nights this week"** from one fused retrieval pool
  (onboarding facts + camera observations + the existing daily narratives and baselines), with
  every citation labelled *you told us* / *Dhyaan saw* / *from her pattern*.
- Refuse the surveillance questions (*what did she say*, *who was that*, *show me the camera*,
  *which room is she in right now*, *what is she wearing*, anything bathroom, bedroom or medical)
  while still answering the useful half of them (*someone visited Tuesday for about 40 minutes*).

**What it cannot do, and what ships instead:**

| Asked for | Reality | Ships instead |
|---|---|---|
| "she's been in the **living room** since 2pm" to the family | `PRODUCT_SPEC.md` §8.2 and D-001 forbid room names on any family surface, structurally. The camera's room is static installer config, not "where she is", so the family can see *that* in Settings, but her whereabouts never carry a room name. | "**Settled in her usual spot since 2:10 pm — reading, by the look of it.**" Activity + spot, never room. The zone still rides on the event for staff and the baseline learner. |
| "she's out on her **morning walk**" | One indoor camera cannot see the front door. A walk is an inference from absence. | "**Out of view since 10:12 — around her usual walk time**", built from `room_exit` + the onboarding fact "walks around 10". Phrased as absence, never asserted as a walk. The band/beacon lanes own `walk_completed`. |
| "what she looks like" as a recognition memory | A face database is exactly the thing we promised not to build, and text descriptors do not reliably separate her from a visitor in a cardigan. | A **≤200-character text descriptor** the family types (optionally refined once from a single enrolment frame that is discarded). Used only as a *hint* when two people are in frame. Single-occupant assumption otherwise. Ceiling stated in §5. |
| "what her normal day looks like" from the camera | Needs weeks. We have 15 seeded synthetic days for the band/beacon lanes and hours of camera time. | Onboarding facts are the day-one prior; the existing baseline learner (`app/baseline.py`) ingests camera `meal_observed` events with no changes; "usual spots" are learned as counts from day one and shown as such. |
| Meals, sleep, medication, gait | Meals: good (plate + hand-to-mouth is visually unambiguous). Sleep: the camera is not in the bedroom, so sleep answers come from the existing `bed_exit`/`night_activity` lanes. Medication and gait: cut — too noisy from a webcam, and gait is staff-only per §12. | Meals live. Sleep via existing data. No medication or gait events from this lane. |
| Every frame through the VLM | Waste, and 3–4 s each. | Motion gate → person gate → keyframe batch; the VLM runs at most ~1×/minute while she is in view, and never when she is not. |

**The demo therefore shows:** a faux login; the family home screen with nothing yet; a presenter
sitting at a table with a plate, the phone updating to *having something to eat* about 30 seconds
later with no video anywhere; the presenter leaving, the phone flipping to *out of view*; three
chat questions (one contrast answer, one useful visitor answer, one refusal); and Settings →
*Forget her profile*. The deep onboarding is shown at the expo table, not in the 3-minute slot.

---

## 2. Architecture

```
  MacBook Pro M5 Pro, 48 GB — everything below runs here
 ┌───────────────────────────────────────────────────────────────────────────────┐
 │  vision worker (separate process, the ONLY process that ever holds pixels)    │
 │  webcam/Continuity Camera/phone ─► capture ─► privacy mask ─► motion (MOG2)   │
 │      ─► person (YOLO11n, MPS) ─► keyframe batch (≤3 frames) ─► Ollama VLM     │
 │                                        loopback only          qwen3-vl:8b      │
 │  frames: RAM ring, ≤3 JPEGs, freed after each POST. No disk. No other socket. │
 └───────────────┬──────────────────────────────────▲────────────────────────────┘
                 │ POST /v1/ingest/camera            │ GET /v1/camera/config (consent,
                 │ {activity, spot, evidence…} JSON  │  paused_until, hints) every 10 s
 ┌───────────────▼──────────────────────────────────┴────────────────────────────┐
 │  FastAPI (existing process)                                                    │
 │  routers/camera.py ─► presence.py (dedup, episodes, presence state)            │
 │                       └► events.emit()  ─► subscribers: rag embed, live WS     │
 │  memory.py: residents.appearance/usual_spots, profile_facts (embedded)         │
 │  rag.py: pool = events ∪ profile_facts, quota by kind, surveillance guard      │
 │  llm.py (Claude, None on failure) ─► rag falls back to Ollama text ─► template │
 └───────────────┬────────────────────────────────────────────────────────────────┘
                 │ REST + WS /v1/live  (presence.update, event.new)   LAN, Bearer key
 ┌───────────────▼────────────────────────────────────────────────────────────────┐
 │  Expo app (adult child's phone): login ─► onboarding ─► Today / Her day / Ask   │
 │  / Settings. Never receives a zone, a frame, or evidence text.                  │
 └────────────────────────────────────────────────────────────────────────────────┘
       MongoDB: events, residents, profile_facts, cameras, observations (+TTL)
```

| Component | Where | Trigger | Writes | Reaches the app via |
|---|---|---|---|---|
| Capture + cascade | `backend/vision/` (new package, own process: `python -m vision`) | Camera frames, 30 fps sampled to 3 fps | Nothing on disk. RAM ring of ≤3 JPEG keyframes | — |
| VLM call | `vision/vlm.py` → Ollama `/api/chat`, loopback | A keyframe batch (see §3.4) | An `Observation` JSON (text only) | `POST /v1/ingest/camera` |
| Config poll | `vision/worker.py` | Every 10 s | — | `GET /v1/camera/config` (fail closed) |
| Ingest + dedup | `app/routers/camera.py`, `app/presence.py` | Each observation POST; a 30 s sweeper | `observations` row, `cameras.presence`, then `events` via `emit()` | `event.new`, `presence.update` on WS; `GET /presence`, `GET /activity` |
| Memory | `app/memory.py` | Onboarding PUT/POST, settings edits, delete | `residents.{appearance, usual_spots, consent_*}`, `profile_facts` | `GET/PUT /profile`, facts routes |
| Chat | `app/rag.py` (edited) | `POST /chat` | Nothing | Existing route, extended response |
| App | `frontend/src/` | — | — | — |

**Why a separate worker process and not an asyncio task in FastAPI.** Three reasons, all cheap:
the macOS camera permission prompt attaches to the process that opens the device, and we want that
to be a terminal we control, not uvicorn's reloader; a 3 s blocking VLM call must never sit on the
API's event loop next to a fall ingest; and it makes the privacy claim structural — *the API process
never has a frame to leak*. The cost is one endpoint and one config poll, both frozen below.
Ceiling: `events.subscribe` fan-out is in-process, so the worker must POST rather than call
`emit()` directly (otherwise no websocket push, no embedding). That is the design, not a bug.

---

## 3. The vision pipeline

### 3.1 Model — verified

`ollama list` on this machine shows only `nomic-embed-text`. The Ollama library (fetched
2026-09-19) offers these vision tags: `qwen3-vl:2b` 1.9 GB, `qwen3-vl:4b` 3.3 GB, **`qwen3-vl:8b`
6.1 GB**, `qwen3-vl:30b`, `qwen2.5vl:3b` 3.2 GB, `qwen2.5vl:7b` 6.0 GB, `gemma3:4b` 3.3 GB,
`llava:v1.6` 4.7 GB, `moondream:1.8b` 1.7 GB. Ollama here is 0.32.9, which supports `format`
with a full JSON schema and `images` on `/api/chat`.

**Pick: `qwen3-vl:8b` (6.1 GB).** Best instruction-following of the set at a size that leaves
~35 GB free; multi-image input; the PRD already chose it. **Fallback: `qwen3-vl:4b` (3.3 GB)** if
a 3-frame batch on real frames measures over 10 s. Not moondream (single image, weak JSON), not
llava (older, larger, worse), not gemma3 (weaker on multi-frame). `qwen3-vl:8b` **is now pulled
on this machine** and benchmarked: ~6 s per 3-frame structured call, warm. Numbers in §3.7.

### 3.2 Capture

`cv2.VideoCapture(index, cv2.CAP_AVFOUNDATION)` in a grab-always thread exactly as PRD §6.1 (the
`Camera` class there is ~25 lines; copy it). `--source 0` is the MacBook camera (confirmed present:
"MacBook Pro Camera"). **A phone is a webcam for free:** an iPhone on the same Apple ID appears as
another AVFoundation index via Continuity Camera — no code. `--source path.mp4` plays a file at real
time for rehearsal and as the on-stage fallback. Frames are downscaled to 640×360 immediately;
nothing larger is kept.

**Privacy mask, first thing after capture.** `--mask x0,y0,x1,y1` (normalised) blacks out a
rectangle *before* motion detection, for a doorway into a private room that is in shot. Two lines
of numpy. Set on the hub at install; the app never sees a frame, so the app never draws it.

**Preview.** `--preview` opens a cv2 window on the hub's own screen with the mask, motion mask,
person box and a one-line cascade status. This is the only screen that ever shows a frame. Key `p`
pauses the camera for 2 h (posts a `paused` heartbeat, §6.1) — the resident's control, on her
hub, per `PRODUCT_SPEC.md` §8.3.

### 3.3 The cascade

| # | Stage | Runs | Budget | What passes |
|---|---|---|---|---|
| 0 | Sample | every 10th frame → 3 fps | — | all |
| 1 | Privacy mask | every sampled frame | <1 ms | all |
| 2 | Motion | `cv2.createBackgroundSubtractorMOG2(history=300, varThreshold=25)` on 320×180 grey; foreground ratio > 0.8 % | ~2 ms | ~10 % in a lived-in room |
| 3 | Person | Ultralytics `YOLO("yolo11n.pt")`, `classes=[0]`, `imgsz=640`, `conf=0.4`, `device="mps"`; foot-point + bbox aspect | 15–40 ms (community M-series numbers, unverified; measure in hour 1) | ~70 % of motion frames |
| 4 | Keyframe | rules in §3.4 | <1 ms | ≤1 batch/min steady state |
| 5 | VLM | `qwen3-vl:8b`, 3 frames, JSON schema | 2–5 s | — |

Stage 3 is the one dependency with weight: `ultralytics` pulls torch (~1 GB of wheels; ~2 min with
uv on this machine; `yolo11n.pt` is a 5 MB auto-download on first run — do it in hour 1 while
online). **Why not OpenCV's built-in HOG people detector (zero deps)?** It is trained on upright
pedestrians and reliably misses a seated older woman in an armchair, which is most of her day.
**Cut path (first thing to cut, §9):** drop stage 3, let motion alone trigger keyframes and let the
VLM's `person_count: 0` mean absent. Costs VLM calls on curtains and cats; loses the posture rule.

### 3.4 Keyframe selection

Per camera (one track; a single-resident home does not need a tracker — the cut is deliberate, the
upgrade is `model.track(persist=True)` when there are two people to tell apart):

```python
KEYFRAME = dict(
    min_gap_s=20,          # never two keyframes within 20 s
    on_person_appear=True, # first person-positive frame after ≥30 s of none
    on_posture_change=True,# bbox aspect (h/w) crosses 1.6 either way, or falls below 0.8 (wide = lying/on floor)
    on_dwell_s=60,         # while a person stays in view, one keyframe a minute
    batch_size=3,          # frames spanning ≤30 s -> one VLM call
    max_batch_wait_s=30,
    absent_after_s=30,     # no person for 30 s -> send an "absent" observation, no VLM call
)
DEMO = dict(min_gap_s=6, on_dwell_s=15, max_batch_wait_s=15, absent_after_s=12)   # --demo
```

The batch is temporal context: one frame of a woman at a table is "sitting"; three frames over
20 s with a fork moving are "eating". A wide-and-stays-wide bbox is the one rule that jumps the
queue: it sends a 2-frame batch immediately (candidate `on_floor`).

### 3.5 The VLM call and the exact prompt

`POST http://localhost:11434/api/chat`, `stream: false`, `keep_alive: -1`,
`options: {temperature: 0, num_predict: 220, num_ctx: 8192}`, `format: <schema below>`, one user
message with `images: [b64 jpeg × n]` (640×360, quality 80, ~40 KB each). One 640×360 frame is
~1,100 prompt tokens (measured), so three frames plus the prompt sit around 2,500 — well inside
8k.

Prompt (conditioned by the resident memory, §4.4; braces filled by the worker from `/camera/config`):

```
You are looking at {n} still frames from one fixed camera in the {zone_label} of {name}'s home,
taken over {span_s} seconds, in this order, at {times_local}.
{zone_hint}
{name} is the only person who lives here. {appearance_line}
{spots_line}
Report only what is visible in these frames. Do not describe clothing, body, hair, race, age,
or health. Do not guess what anyone is thinking or saying. If two or more people are visible,
set person_count and use activity "with_visitor", and describe nothing about the other person.
Choose the single activity that best describes what {name} is doing across the frames. If the
frames do not support one, use "unclear" with confidence below 0.4.
"evidence" is one sentence, under 180 characters, naming only objects and actions.
```

`appearance_line` = `"{name} is {appearance}."` if the family set one, else empty.
`spots_line` = `"At this time of day she is usually found: {usual_spots}."` if learned, else empty.

Schema (Pydantic in `vision/vlm.py`, `model_json_schema()` passed as `format`):

```python
class Observation(BaseModel):
    activity: Literal["eating","drinking","sitting","reading","watching_tv","using_phone",
                      "standing","walking","exercising","lying_down","on_floor",
                      "entering","leaving","with_visitor","unclear"]
    person_count: int = Field(ge=0, le=6)
    posture: Literal["upright","seated","reclined","on_floor","unclear"]
    movement: Literal["stationary","slow","normal","unsteady","unclear"]
    spot: Literal["table","armchair","sofa","doorway","counter","window","floor","other","unclear"]
    assistive_device: Literal["none","cane","walker","wheelchair","unclear"]
    plate_or_cup_present: bool
    hand_to_mouth_observed: bool
    changed_between_frames: bool
    confidence: float = Field(ge=0, le=1)
    evidence: str = Field(max_length=180)
```

Worker post-rules (5 lines, not the model's job): `person_count == 0` → activity `absent`;
`hand_to_mouth_observed and plate_or_cup_present` → activity `eating` regardless; `person_count >= 2`
→ `with_visitor`; `movement == "unsteady"` is dropped to `"unclear"` before posting (gait is
staff-only per §12 and this lane has no staff surface — do not record what you will not show).

### 3.6 Observation → events (dedup)

Lives in `app/presence.py`, API side, so it is testable with a fixture and no camera. An in-process
dict of open intervals keyed `(resident_id, event_type)`, the same shortcut `location.py` takes
(ceiling: resets on restart; upgrade: persist on the `cameras` doc). A 30 s asyncio sweeper closes
intervals whose `last_ts` is older than their gap, because nobody sends an observation when she
simply stops.

| Activity | Event type (existing unless marked new) | GAP_S | MIN_OBS | MIN_DUR_S | Payload / embedding_text |
|---|---|---|---|---|---|
| eating | `meal_observed` | 600 | 2 | 120 | `meal` from local hour (<11 breakfast, 11–15 lunch, ≥17 dinner, else snack), `n_observations`, `spot`. *"Eleanor ate lunch at the table, 12:41–13:05."* |
| drinking alone | none | — | — | — | Too noisy to be a meal. Updates presence only. |
| sitting / reading / watching_tv / using_phone / standing | `activity_observed` (new) | 900 | 3 | 600 | `activity`, `spot`. *"Eleanor was settled in the armchair, reading, 14:10–15:02."* |
| walking / exercising | `activity_observed` (new) | 120 | 2 | 0 | *"Eleanor was up and moving about, 09:58–10:03."* |
| lying_down | `activity_observed` (new) | 900 | 2 | 300 | *"Eleanor was resting on the sofa, 15:10–15:48."* |
| on_floor (×2 consecutive, conf ≥ 0.7) | `activity_observed` with `payload.flag: "on_floor"` now; stretch: `alerts.open_alert(kind="fall", severity="urgent")` | immediate | 2 | 0 | *"Eleanor appeared to be on the floor at 15:12."* Stretch only — §9. |
| with_visitor | `visitor_present` | 900 | 2 | 0 | `n_people` only. *"Eleanor had a visitor, 14:00–14:41."* Nothing else about the visitor is stored. |
| entering / first appearance | `room_entry` | debounce 60 s | 1 | 0 | zone = camera zone (staff/learner only). *"Eleanor came into view at 08:02."* |
| leaving / absent | `room_exit` | debounce 60 s | 1 | 0 | *"Eleanor went out of view at 10:12."* |
| unclear | none | — | — | — | Presence "in view" refreshes. |

`DEMO_FAST=1` on the API scales every GAP/MIN_DUR by 0.1 so a 30-second stage lunch becomes one
event. Confidence on the emitted event = `clip(mean_conf * (1 - 0.5**n), 0.05, 0.95)` (PRD §6.5).
Every raw observation is kept as a row in `observations` (text only, TTL 7 days) so the dedup is
auditable and re-runnable; `derived_from` on the event lists the observation ids.

`meal_skipped` stays computed (existing rollup), never observed. `person_present` is not written
per observation — it is in `NOISY_EVENT_TYPES` for a reason; the `observations` collection is
where that cardinality goes.

### 3.7 Latency and throughput — measured on this machine

Filled in from the benchmark run at the end of planning (`scratchpad/bench.py`, 640×360 frames,
the schema above, `temperature 0`):

| Quantity | Measured / estimate | Basis |
|---|---|---|
| `qwen3-vl:8b` cold load | **2.4 s** | measured |
| 1 frame, JSON out (~111 tokens) | **6.2 s warm** (decode 2.4 s at ~46 tok/s; the other ~3.7 s is the vision encoder + fixed per-request overhead, which Ollama does not report in `prompt_eval_duration`) | measured |
| 3 frames, JSON out | **6.0–6.5 s warm**, i.e. a batch is nearly free versus one frame — prefill of 2442 image+prompt tokens took 1.9 s uncached, 0.02 s cached | measured |
| Budget per fresh 3-frame batch on real frames | **6–9 s** (warm figure + uncached prefill) | measured + margin |
| Motion gate | ~2 ms/frame at 320×180 | MOG2 is per-pixel; unverified until hour 1 |
| YOLO11n on MPS | 15–40 ms/frame | community M-series reports, unverified; measure hour 1 |
| Steady-state VLM duty while she is in view | 1 call/60 s ≈ 6–9 s busy → **~10–15 % of the GPU** | rules in §3.4 |
| Time from "takes a bite" to sentence on the phone, `--demo` + `DEMO_FAST` | **~25–40 s** (2 keyframe batches 15 s apart + one 6–9 s inference + WS push) | arithmetic on the above |
| Memory | **10 GB** VLM resident at Ollama's default 32k context (`ollama ps`); set `num_ctx: 8192` in `options` to drop that to ~7 GB. +1 GB YOLO/torch, +0.4 GB embedder | measured |

Consequences for Agent A, all cheap: (1) the decode is the cost we control — the ~115-token JSON
is dominated by `evidence`; keep it under 180 chars and drop nothing else from the schema, it is
already tight; (2) `num_ctx: 8192`; (3) **the very first structured call returned an empty
`content` with 220 tokens generated** — validate with `Observation.model_validate_json`, retry once
on failure, then drop the batch and count it (`dropped_batches` in the heartbeat); (4) send a
1-token warm-up call at worker start so the 2.4 s load never lands on the first real keyframe.
The `qwen3-vl:4b` fallback is only for a measured batch over 10 s on real frames; at 6–9 s the
8b holds at one call per minute.

#### 3.7a Benchmark output

`scratchpad/bench.py`, `qwen3-vl:8b`, Ollama 0.32.9, M5 Pro 48 GB, 640×360 synthetic JPEGs
(17 KB and 5 KB), the §3.5 schema as `format`, `temperature 0`, `num_predict 220`:

```
run 0 imgs=1 wall=10.67s load=2.39s prompt_tok=1384 prompt_s=0.03 gen_tok=111 gen_s=2.43
run 1 imgs=1 wall=6.36s  load=0.09s prompt_tok=1384 prompt_s=0.03 gen_tok=111 gen_s=2.46
run 2 imgs=1 wall=6.21s  load=0.09s prompt_tok=1384 prompt_s=0.03 gen_tok=111 gen_s=2.41
run 0 imgs=3 wall=6.53s  load=0.08s prompt_tok=2282 prompt_s=1.93 gen_tok=220 gen_s=4.46  <- empty content, see (3)
run 1 imgs=3 wall=6.04s  load=0.08s prompt_tok=2442 prompt_s=0.02 gen_tok=115 gen_s=2.53
run 2 imgs=3 wall=6.14s  load=0.09s prompt_tok=2442 prompt_s=0.03 gen_tok=115 gen_s=2.55
ollama ps: qwen3-vl:8b  10 GB  100% GPU  CONTEXT 32768
```

Every valid reply was schema-conformant JSON (`activity: "unclear", person_count: 0`, evidence
"No person visible in the frame"), which is the correct answer for test-pattern frames.

---

## 4. The resident memory

Three stores, all in the existing MongoDB, all scoped by `resident_id`, all deletable by one call.

### 4.1 `residents` (existing doc, new fields)

```json
{
  "_id": "res_eleanor", "display_name": "Eleanor", "timezone": "America/New_York",
  "consent_camera": 1, "consent_voice": 1,
  "consent_memory": 1,                       // new: profile + facts may be kept
  "consent_signed_by": "Priya Sharma", "consent_relationship": "daughter",
  "consent_signed_at": "2026-09-19T15:02:11-04:00",
  "appearance": "short grey hair, glasses, usually a blue cardigan",   // new, ≤200 chars, text only
  "usual_spots": {"08": {"table": 14}, "14": {"armchair": 22, "sofa": 3}, "...": {}}  // new, learned
}
```

`usual_spots` is a `{hour_bucket: {spot: count}}` dict incremented by `presence.py` on every
observation with `person_count == 1` and `confidence >= 0.5`. The top spot per 2-hour bucket with
≥5 counts becomes the `spots_line` in the prompt and the *"her usual spot"* wording in the app.
That is the whole "where she usually sits" model. Ceiling: no decay, no day-of-week. Upgrade: the
baseline learner's exponential window.

### 4.2 `profile_facts` (new) — what the family told us, one fact per row, retrievable

```json
{
  "_id": "fact_01J...", "resident_id": "res_eleanor",
  "key": "breakfast",                          // free slug from the onboarding question
  "text": "Eleanor usually has toast and tea for breakfast at about 8.",
  "embedding_text": "Eleanor usually has toast and tea for breakfast at about 8.",
  "embedding": [768 floats],                   // nomic-embed-text, written synchronously
  "source": "family_onboarding" | "family_edit",
  "author": "Priya Sharma",
  "active": true, "supersedes": null, "superseded_by": null,
  "created_at": "...", "superseded_at": null
}
```

Written by `POST /residents/{id}/profile/facts` (bulk, at onboarding) and `PUT
/residents/{id}/profile/facts/{fact_id}` (a correction). **Supersession:** the PUT inserts a new
row with `supersedes: old_id`, sets the old row `active: false, superseded_by: new_id,
superseded_at: now`, and emits a `profile_updated` event (`embedding_text`: *"Priya corrected:
breakfast is now usually porridge, not toast."*) so the change itself is in the timeline and the
retrieval pool. Retrieval scans `active: true` only. Nothing is ever edited in place — a fact the
family later says was wrong should not silently rewrite last week's answers. Index:
`(resident_id, active)`.

Onboarding questions that become facts (each answer → one row; the app writes the sentence, the
API validates length ≤ 300 and strips control characters):

| key | Question in the app | Example fact |
|---|---|---|
| `wake` | When is she usually up? | "Eleanor is usually up around 6:30." |
| `breakfast` | What does breakfast usually look like? | "Toast and tea, about 8." |
| `lunch` / `dinner` | same | "Lunch is usually soup around 12:30." |
| `walk` | Does she go out most days? When? | "She walks to the shops around 10 most mornings." |
| `mobility` | Getting around | "Uses a cane outdoors, steady indoors." |
| `afternoon` | Where does she usually spend her afternoons? | "In the armchair by the window, reading." |
| `visitors` | Who visits, and when? | "Her neighbour Cheryl comes on Tuesdays." |
| `appearance` | How would you describe her to someone meeting her? | also written to `residents.appearance` |
| `private` | Anything Dhyaan should never note? | "Never note bathroom trips." → also sets the chat guard's hard list; stored as a fact so the chatbot can *say* it was asked not to |

### 4.3 `cameras` (new) — installer config and live presence

```json
{
  "_id": "cam_mac_01", "resident_id": "res_eleanor",
  "zone": "living_room",                       // never bedroom/bathroom — 422 at the trust boundary
  "zone_hint": "Living room. The dining table is on the left, her armchair by the window on the right.",
  "state": "watching" | "paused" | "offline" | "no_consent",
  "paused_until": null, "paused_by": "resident",
  "last_heartbeat_at": "...", "fps": 3.0, "dropped_batches": 0,
  "presence": { "status": "in_view", "activity": "eating", "posture": "seated", "spot": "table",
                "since": "...", "last_observation_at": "..." }
}
```

### 4.4 How memory conditions the VLM

`GET /v1/camera/config` returns `zone`, `zone_hint`, `appearance`, the current `usual_spots`
line, and the consent/pause state. The worker polls every 10 s and rebuilds the prompt strings.
Facts are **not** sent to the VLM — they would bias it toward seeing what the family expects
("she eats at 8" must not make an empty table into breakfast). Only the layout hint, the appearance
hint and the learned spots go in; the facts are for the chatbot's *contrast*, after the fact.

### 4.5 Deleting it

`DELETE /v1/residents/{id}/memory` with `{"scope": "profile" | "camera" | "all", "confirm":
"<display_name>"}`. `confirm` must equal the resident's name (typo protection at the trust
boundary — this is irreversible). `profile` hard-deletes every `profile_facts` row and unsets
`appearance` and `usual_spots`; `camera` deletes `observations`, every `source: "camera"` event, and
resets `cameras.presence`; `all` does both. Returns the counts. Emits one `memory_deleted` event
with counts only. This is *Settings → Forget her profile* in the app, and it is a real button.
`consent_memory: 0` in `PUT /profile` calls the same code with `scope: profile`.

Retention without deletion: `observations` has a Mongo TTL index (`expires_at`, 7 days) — one
`create_index` line in `db.py`, zero code. Events keep forever in the demo (PRD says 90 days; add a
TTL when it matters).

---

## 5. Privacy design

This is the part that makes the product defensible, so it is stated as rules with the mechanism
next to each one.

### 5.1 Zones

- The camera's zone is chosen once at install from `{kitchen, living_room, dining_room, hallway}`.
  `PUT /residents/{id}/camera` returns **422** for `bedroom` or `bathroom`; the onboarding picker
  does not offer them. There is no admin override.
- A private doorway in shot is masked on the hub (`--mask`), before motion detection, so the pixels
  never reach the detector, let alone the VLM.
- The chat guard treats *bathroom / toilet / shower / bedroom / bed / pyjamas / undressed / naked*
  as a hard refusal regardless of what the data could answer (§5.5).

### 5.2 What the family sees vs what is retained

| | Family app | Retained on the hub |
|---|---|---|
| Frames | Never. No endpoint returns image bytes; the API process never has one. | ≤3 JPEGs in RAM per batch, freed on POST. Nothing on disk, ever. No `frames/` directory exists. |
| Room | Never for *her* location (D-001). The camera's own room appears once in Settings as installer config. | `zone` on camera events, for staff and the learner. |
| Observations (`evidence` sentence, posture, movement) | Never. Family gets the templated sentence only. | `observations`, text only, TTL 7 days. |
| Activity episodes | Yes, as sentences via `/activity` and `/presence`. | `events`, sentence + structured payload. |
| Visitors | Count and duration only. | `visitor_present` with `n_people`. Nothing about who. |
| Appearance | Only what they typed, in Settings, editable. | `residents.appearance` text. No embeddings of faces, no reference images. |
| Audio | None exists. The worker never opens a microphone (`cv2.VideoCapture` is video-only). | None. |

### 5.3 Frame retention: none, argued

Keeping frames buys three things: re-running the VLM after a prompt fix, a human review queue for
false positives, and "show me why" for the family. The first two are real and we forgo them
knowingly; the observations rows (sentences) are the review queue we can afford. The third is the
one we must not build — `frontend/DESIGN.md` rule 3 and `PRODUCT_SPEC.md` §8.2 both say evidence
is a sentence, never a picture. So: **no frames retained, structurally** — no disk write in the
worker (grep the package for `imwrite`/`open(` in review), frames cross exactly one socket
(loopback to Ollama), and the API cannot return what it never receives. The upgrade, if a review
queue is ever needed, is a *separate* opt-in with its own consent grant, not a flag on this one.

### 5.4 Consent copy (verbatim in the app; three separate grants)

Screen 1 — the person, and who is agreeing:
> **Dhyaan looks out for one person.** She — or the person legally able to decide with her —
> agrees to each part separately. You can say yes to one and no to another, and change any of
> them later. Nothing here can be switched back on by family without her.

Grant A — fall detection (existing band copy, unchanged).

Grant B — camera presence:
> **A camera in one room, and a description instead of a video.**
> One camera in the room she spends her day in — never a bedroom or bathroom. It notices whether
> she is up, whether she has eaten, whether she is settled or moving about, and whether someone is
> visiting. It turns that into a sentence, on the computer in her home, and throws the picture
> away. No video is stored. No video is ever shown to family, and there is no way to turn that on.
> It cannot hear anything. If someone else is alone in the room, Dhyaan may mistake them for her.
> She can pause it for two hours from the computer, and pausing never affects fall detection.
> [ Yes ] [ No ]

Grant C — keeping a memory of her:
> **Notes about her, kept at home, deleted when you say.**
> To make sense of what it sees, Dhyaan keeps what you tell us about her routine, a few words
> describing her, and where she usually sits at different times of day. None of this leaves her
> home, none of it is a face or a photograph, and *Forget her profile* in Settings removes all of
> it at once.
> [ Yes ] [ No ]

Signature line: *Your full name, and how you are related to her* — two required fields; the API
rejects an empty relationship.

### 5.5 The chatbot: refusing surveillance while staying useful

Order of checks in `rag.answer()`, each before any retrieval:

1. **Medical** — existing `MEDICAL_PATTERN`, existing copy. Unchanged.
2. **Hard surveillance** — `SURVEILLANCE_HARD`, one regex: speech (*say, said, talk, conversation,
   discuss, hear, audio*), private rooms (*bathroom, toilet, shower, bedroom, bed, sleep(ing)? in*,
   *undress, naked, pyjama*), imagery (*photo, picture, image, video, footage, camera feed, show me,
   watch her, look at her, screenshot*), appearance (*wearing, look(s)? like, hair, weight, thin,
   fat*), live location (*right now, at the moment, which room, where is she*). Reply, no retrieval,
   `refused: true, refusal_kind: "surveillance"`, one of four fixed sentences by sub-kind, e.g.
   *"Dhyaan doesn't keep or describe what she looks like, and there is no video to show — not to
   you, not to anyone. I can tell you what she's been doing."* / *"Dhyaan never listens, so there
   is nothing she said that I could tell you."* / *"Bedrooms and bathrooms are outside what Dhyaan
   notices, by design."* / *"I don't say where she is in the house. I can tell you she's at home
   and what she's been up to."*
   Exception that keeps it useful: *sleep/night* questions without a room word ("how did she
   sleep") are **not** hard — they route to the existing `bed_exit`/`night_activity` data.
3. **Soft surveillance** — `SURVEILLANCE_SOFT`: *visitor, visit, who came, who was there, guest,
   company* → retrieval restricted to `visitor_present` + facts with key `visitors`, answer
   prefixed *"Dhyaan only notes that someone visited, and for how long — never who or what was
   said."*; *where, out, went out, left* → restricted to `room_exit`, `room_entry`, `left_home`,
   `returned_home`, `walk_*` + facts, and the answer prompt is told it may say *home / out of view /
   out* and nothing finer.
4. **Family exclusion list on every retrieval** (`FAMILY_EXCLUDED_TYPES`): `zone_entered`,
   `zone_exited`, `zone_dwell`, `bathroom_prolonged`, `location_unknown`, `beacon_offline`,
   `unsteady_gait`, `band_motion_high`, `band_still`, `camera_online`, `camera_offline`,
   `camera_paused`. A chunk that is not in the pool cannot be cited. This is the real control;
   the prompt is the backstop.
5. **Answer prompt rules** (added): never name a room; never describe appearance; never quote
   speech; say *you told us* for `[told]` chunks and *Dhyaan saw* for `[observed]`, *from her
   pattern* for `[pattern]`; when a told fact and an observation cover the same thing, contrast
   them in one sentence with both times.
6. **Post-hoc scrub**: `_scrub_rooms()` replaces `kitchen|bedroom|bathroom|living room|hallway|
   dining room` in the final answer with *at home* (6 lines). Camera events are *written* without
   room names in `embedding_text` in the first place, so this should never fire; it is logged
   when it does.

What still works, by design: eating (meals from camera, band, seeded history), sleeping (existing
night lanes), activity (settled/moving episodes, out-of-view stretches), routine (facts vs
observations), visitors (count/duration), *"is she OK"* (presence + open alerts), and every
*"what does she usually…"* question straight from the facts.

### 5.6 Consent gates in code (belt and braces)

- Worker: top of the keyframe handler — `if not cfg.consent_camera or cfg.paused: drop frames`.
  Config fetch failure = no consent (fail closed). No VLM call, no POST, no log line with pixels.
- API: `POST /ingest/camera` returns **403** when `residents.consent_camera` is 0 or the camera
  is paused, and writes nothing. A rogue or stale worker cannot create an observation.
- Family app: `Settings → Camera → Stop the camera` sets `consent_camera: 0`; the worker stops
  within 10 s. There is no family-side *pause* (that is her control on the hub) and no way to
  re-enable from the app once she has paused — matches `PRODUCT_SPEC.md` §8.3 rule 1.

---

## 6. Backend work

### 6.1 Endpoints — frozen contract (`backend/API_CONTRACT_V3.md` is this table, verbatim)

Device routes take `X-Band-Key` (the existing shared device secret; ceiling: one key for band and
camera, upgrade: per-device keys). App routes take `Authorization: Bearer <API_KEY>`. Ids come back
as `id`, timestamps ISO-8601.

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/ingest/camera` | device | `{camera_id, resident_id, ts, span_s, n_frames, person_count, activity, posture, movement, spot, assistive_device, plate_or_cup_present, hand_to_mouth_observed, confidence, evidence, model, latency_ms, simulated}` (all enums as in §3.5 plus `"absent"`) | `201 {observation_id, presence, event_ids: []}`; `403` when consent off/paused; `404` unknown camera; `422` bad enum |
| POST | `/ingest/camera/heartbeat` | device | `{camera_id, state: "watching"\|"paused"\|"offline"\|"no_consent", paused_until?, fps, dropped_batches}` | `204` |
| GET | `/camera/config?camera_id=` | device | — | `{resident_id, name, consent_camera, paused_until, zone, zone_label, zone_hint, appearance, spots_line, demo_fast}` |
| POST | `/auth/login` | none | `{email, password}` | `{ok, token, user: {name, email}, resident_id}` — faux; validates email shape and non-empty password, returns the static key; `401` otherwise |
| GET | `/residents/{id}/presence` | app | — | `{status: "in_view"\|"out_of_view"\|"paused"\|"camera_off"\|"no_camera", activity, spot_is_usual, since, last_observation_at, sentence, camera: {online, consent, paused_until, paused_by}}` — **no zone, no evidence** |
| GET | `/residents/{id}/activity?date=YYYY-MM-DD` | app | — | `{date, tiles: {meals, walks, out_of_house, night_ups, in_view_minutes}, items: [{id, ts, ts_end, type, sentence, kind: "observed"\|"pattern", confidence}]}` — family filter applied, `zone` stripped |
| GET | `/residents/{id}/profile` | app | — | `{name, appearance, consent: {falls, camera, memory, signed_by, relationship, signed_at}, camera: {camera_id, zone, zone_hint, state, paused_until}, usual_spots: [string], facts: [Fact]}` |
| PUT | `/residents/{id}/profile` | app | `{name?, appearance?, consent?: {...}, camera?: {zone, zone_hint}}` | the profile; `422` for bedroom/bathroom zone, appearance > 200 chars |
| POST | `/residents/{id}/profile/facts` | app | `[{key, text}]` (1–40 items, text ≤ 300) | `{facts: [Fact]}` — embedded synchronously |
| PUT | `/residents/{id}/profile/facts/{fact_id}` | app | `{text}` | `{fact: Fact}` (the new row; old row deactivated) |
| DELETE | `/residents/{id}/profile/facts/{fact_id}` | app | — | `{ok}` (deactivates) |
| DELETE | `/residents/{id}/memory` | app | `{scope, confirm}` | `{deleted: {profile_facts, observations, camera_events, usual_spots: bool}}`; `422` if `confirm != display_name` |
| POST | `/residents/{id}/chat` | app | `{question}` | **extended**: `{answer, citations: [{id, kind: "observed"\|"told"\|"pattern", ts, text}], retrieved_count, refused, refusal_kind}` |
| POST | `/admin/simulate` | app | **extended** `kind: "meal"\|"visitor"\|"out_of_view"` | posts a canned observation sequence through the real ingest path (the on-stage fallback if the webcam misbehaves) |

`Fact = {id, key, text, source, author, active, supersedes, superseded_by, created_at}`.

Websocket additions on `/v1/live`: `{"t": "presence.update", "resident_id", "presence": <same as GET>}`
after every observation and heartbeat state change. `event.new` already fires.

### 6.2 New collections and indexes (`app/db.py`)

`profile_facts (resident_id, active)`, `cameras (resident_id)`, `observations (resident_id, ts_epoch)`
+ TTL on `expires_at`.

### 6.3 New event types (`app/events.py`)

`activity_observed`, `camera_online`, `camera_offline`, `camera_paused`, `profile_updated`,
`memory_deleted`. The three `camera_*` join `NOISY_EVENT_TYPES` in `rag.py`.

### 6.4 Files that change (Agent B's list — see §8)

- `app/routers/camera.py` **new** — everything in §6.1 except chat and login-less routes.
- `app/presence.py` **new** — dedup table, sweeper, presence state, usual-spots increment, family sentence templates.
- `app/memory.py` **new** — profile read/write, facts write/supersede/deactivate, delete cascade, validation.
- `app/rag.py` **edit** — pool widening to `profile_facts`, kind tagging, quota, time-window parsing, surveillance guard, prompt rules, scrub, Ollama text fallback (`CHAT_FALLBACK_MODEL=qwen3-vl:8b`, called with no images; `llm.py` is untouched because `tests/test_llm.py` pins its None-without-key behaviour).
- `app/events.py` **edit** — six new types. `app/db.py` **edit** — indexes. `app/main.py` **edit** — include router, start/stop sweeper. `app/routers/live.py` **edit** — expose `broadcast(msg, resident_id)` (rename of the private `_broadcast`, one line). `app/routers/chat.py` **edit** — `ChatResponse` gains `refused`, `refusal_kind`. `app/routers/setup.py` **edit** — three new `simulate` kinds.
- `scripts/seed.py` **edit** — Eleanor's 12 facts (§4.2 examples), `cam_mac_01`, `appearance`, `consent_memory`.
- `tests/test_camera.py`, `tests/test_memory.py`, `tests/test_rag_guard.py` **new**.
- `fixtures/camera_observation.json`, `fixtures/camera_heartbeat.json` **new** — the worker's contract, as with the band.
- `API_CONTRACT_V3.md` **new**.

### 6.5 Retrieval plan (the three sources, fused)

Pool = `events` with an embedding, minus `FAMILY_EXCLUDED_TYPES` ∪ `profile_facts` where
`active: true`. Each candidate is tagged `kind`: `told` (a fact), `pattern` (`daily_summary`,
`baseline_deviation`, `baseline_updated`), `observed` (everything else). Ranking is the existing
RRF over cosine + keyword, on the combined pool, plus two additions: (a) a time window parsed
from the question (*today / this morning / tonight* → since local midnight; *yesterday* → that
day; *this week* → 7 days) applied to `observed` and `pattern` only — facts are timeless; (b) a
**kind quota** on the final k=8: up to 4 observed, up to 2 told, up to 2 pattern, backfilled in
score order so a question with no matching facts still gets 8 observations. The quota is what
makes contrast answers ("you told us toast at 8; today Dhyaan saw her eat at 10:40") reliable —
without it a dozen `meal_observed` rows crowd the one fact out. Ceiling: still a full scan;
`profile_facts` adds tens of rows, not thousands.

Citations render by kind in the app: *You told us · Tue* / *Dhyaan saw · 10:40 today* /
*From her pattern · last 14 days*. A family must always be able to tell observed from assumed.

---

## 7. Frontend work

Aesthetic, documented per `distinctive-frontend.md` and kept from `frontend/DESIGN.md`: *a
letter from her kitchen table* — warm paper, ink, slate for touch, vermilion only for alerts.
The redesign pushes the four vectors harder without new dependencies:

- **Type extremes.** `Fraunces_900Black` for the one sentence per screen at 40–44 px; body in
  `Fraunces_300Light` 17 px (the package ships 100–900; no new font dependency); labels
  `Fraunces_600SemiBold` 13 px. Drop the system sans for body text. Tokens gain `font.light`,
  `type.hero`.
- **Colour.** Existing palette, plus one new `amber` wash for *observed just now*. No purple, no
  gradient buttons.
- **Motion.** The existing `Entrance` stagger on Home and the chat answer; the presence hero
  cross-fades its sentence on `presence.update` (Reanimated is installed). Nothing else moves.
- **Background.** Home and Login get a two-stop warm radial wash via `expo-linear-gradient` plus
  a faint grain: a tiny 64×64 noise PNG at 4 % opacity tiled with `expo-image` (added to
  `assets/images/grain.png`, generated by the agent with a 6-line script). Other screens stay flat.
- **No emojis anywhere.** The two Unicode glyphs in the tree (`✕` in `onboard/contacts.tsx`, `☏`
  in `components/alert-extras.tsx`) become SF Symbols (`xmark`, `phone.fill`). CI check: a grep
  for `[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]` over `src/` must return nothing.

Screens, in the order a new user meets them. Every screen's empty state is stated.

| Route | What it shows | Empty / no-data state |
|---|---|---|
| `app/login.tsx` **new** | Wordmark in Fraunces 900, one line *"Someone is looking out for her."*, email + password, *Sign in*, a quiet *Use the demo account* link that prefills `priya@dhyaan.demo` / any password. Calls `api.login()`; 600 ms spinner; inline errors (bad email shape, empty password, server unreachable). Session holds `user` in memory (ponytail: no persistence — reload = sign in again, which reads as real). | — |
| `app/index.tsx` **edit** | Routing: no user → `/login`; user and not onboarded → `/onboard/welcome`; else `/(family)`. Staff route unchanged. | — |
| `onboard/welcome.tsx` **edit** | What Dhyaan is, the disclaimer card (unchanged wording), *Set up Dhyaan*. Bottom, small, monospace-flavoured caption: **`Skip setup (dev)`** — sets `onboarded: true`, seeds the session with Eleanor's defaults, writes nothing to the server. Hidden unless `__DEV__` or a 5-tap on the wordmark. | — |
| `onboard/consent.tsx` **edit** | The §5.4 copy: her name, three grant cards each with its own Yes/No, signer name + relationship. *Continue* disabled until name, signer, relationship are filled and at least one grant is Yes. Writes `PUT /profile {consent}` (or session-only in mock). | — |
| `onboard/about.tsx` **new** (replaces `baseline.tsx`, which is deleted) | The nine questions of §4.2 as chips + a short free-text line each, one question per card, next/back. Appearance question has the note *"a few words, never a photo"*. *Save* → `POST /profile/facts` + `PUT /profile {appearance}`. | Skippable per question; unanswered = no fact. |
| `onboard/camera.tsx` **new** | Room picker (kitchen / living room / dining room / hallway — nothing else), one-line layout hint, a checklist (*it cannot see into a bedroom or bathroom, even through a doorway; if a private door is in view, mask it on the computer*), then **Test** → polls `GET /presence` for 20 s and shows *Camera online — nothing in view yet* / *Camera online — someone in view* / *Not reachable*. Never a preview. Writes `PUT /profile {camera}`. | If no camera doc: *"Start the camera on her computer, then tap Test."* |
| `onboard/contacts.tsx` **edit** | Existing ladder logic, restyled; glyph fix. | existing |
| `onboard/done.tsx` **new** | *"That's everything. Dhyaan will get to know her over the next week."* Three lines on what to expect, *Open the app*. | — |
| `(family)/index.tsx` **rewrite** — **Today** | Hero sentence from `/presence.sentence` (e.g. *Eleanor is having something to eat*, *Eleanor has been settled in her usual spot since 2:10 pm*, *Eleanor has been out of view since 10:12*, *Eleanor paused the camera until 5:40 pm*); a one-line sub (*camera on · last noticed 3 min ago*); four tiles from `/activity.tiles` (Ate / Moved about / Up at night / Out of the house); *Last noticed* row. **No room-time bar, no room, no band battery** (moved to Settings). | Hero: *"Nothing yet today."* Sub: *"The camera came on at 3:38 pm."* or *"The camera is off."* Tiles: *No meals noticed yet* etc. |
| `(family)/timeline/index.tsx` **rewrite** — **Her day** | Day sections from `/activity` + `/summaries`; each item a sentence with a small kind tag (*Dhyaan saw*, *From her pattern*); a day narrative card on top when a summary exists. Filters: All / Meals / Visitors / Out and about / Nights. | *"No activity noticed yet today. Dhyaan writes the day's story each evening."* |
| `(family)/chat.tsx` **rewrite** — **Ask** | Suggestion chips (*Has she eaten today?*, *What does she usually have for breakfast?*, *Where does she spend her afternoons?*, *How were her nights this week?*); answers in Fraunces 300; citations as chips with the kind prefix and time; a refusal renders quietly with a small `hand.raised` symbol and the fixed sentence — never red. | The chips. |
| `(family)/settings.tsx` **rewrite** | *About her*: the facts list, tap to edit (supersede), add; appearance line. *Camera*: room (static config), state, *Stop the camera* (consent off, confirm). *Memory*: *Forget her profile* → type her name → `DELETE /memory scope=all`. *Who Dhyaan calls*: existing ladder. *Band*: existing pair/survey entry points. *Sign out*. Debug panel kept, long-press. | Facts: *"Nothing told to Dhyaan yet — add what you know."* |
| `(family)/_layout.tsx` **edit** | Tabs: Today · Her day · Ask · Settings. | — |

Files Agent C owns beyond screens: `lib/types.ts` (Presence, ActivityDay, Profile, Fact,
ChatMessage.kind, `WsEnvelope` + `presence.update`), `lib/api.ts` + `lib/http.ts` (login, presence,
activity, profile, facts, memory, extended chat), `lib/hooks.ts` (`usePresence` with 15 s
refetch, `useActivity`, `useProfile`), `lib/mock/*` (mock presence that cycles through a scripted
day so the app is demoable with `USE_MOCKS=true`), `store/session.ts` (user, grants, facts draft),
`store/live.ts` (`presence.update` → `presence[residentId]`), `theme/tokens.ts`, `components/*`
(new `PresenceHero`, `FactRow`, `KindTag`, `CitationChip`; `RoomTimeBar` stays for staff).
Staff screens and `alert/[id].tsx` are not touched except where token renames force a one-word
change.

---

## 8. Parallel split — three agents, non-overlapping files

Anything two agents need is frozen here: the wire shapes in §6.1, the enums in §3.5, the
event types in §6.3, the fixtures' exact JSON (Agent B writes them in hour 1 from §6.1; Agent A
reads them; if they disagree, §6.1 wins). No agent edits another's files. Cross-agent needs go in
a note at the top of `VLM_PLAN.md`'s "Integration notes" section (appended, never rewritten).

### Agent A — vision worker (`backend/vision/`, new package)

Owns: `backend/vision/__init__.py`, `__main__.py` (CLI: `--source`, `--camera-id`, `--api`,
`--mask`, `--preview`, `--demo`, `--dry-run`, `--no-yolo`), `capture.py`, `gate.py` (motion +
person + posture), `keyframe.py`, `vlm.py` (schema, prompt, Ollama call, post-rules),
`worker.py` (loop, config poll, consent gate, heartbeat, POST with retry, RAM ring),
`backend/tests/test_vision_gate.py` (motion/keyframe rules on synthetic arrays, no camera),
`backend/pyproject.toml` (adds `opencv-python`, `ultralytics` under a `vision` optional group),
`backend/Makefile` (adds `vision`, `vision-demo`, `vlm` targets), `backend/README.md` (a "Camera
lane" section only, appended).
Builds against: `fixtures/camera_observation.json` (posts it in `--dry-run` to stdout) and
`GET /camera/config`'s frozen shape (a `--config-json` flag substitutes a local file until B is up).
Must not touch: anything under `backend/app/`, `frontend/`.

### Agent B — backend API (`backend/app/`)

Owns: `app/routers/camera.py`, `app/presence.py`, `app/memory.py`, `app/rag.py`,
`app/events.py`, `app/db.py`, `app/main.py`, `app/routers/live.py`, `app/routers/chat.py`,
`app/routers/setup.py`, `scripts/seed.py`, `fixtures/camera_observation.json`,
`fixtures/camera_heartbeat.json`, `tests/test_camera.py`, `tests/test_memory.py`,
`tests/test_rag_guard.py`, `API_CONTRACT_V3.md`.
Builds against: curl with the fixtures; `make test` stays green (the 45 existing tests are the
regression net; `tests/test_llm.py` pins `llm.py`, hence the Ollama fallback lives in `rag.py`).
Must not touch: `backend/vision/`, `pyproject.toml`, `Makefile`, `frontend/`, `app/llm.py`,
`app/alerts.py`, `app/baseline.py`, `app/location.py`, `app/routers/ingest.py`,
`app/routers/residents.py`.

### Agent C — app (`frontend/`)

Owns: everything under `frontend/src/`, `frontend/assets/images/grain.png`, `frontend/DESIGN.md`
(update the aesthetic section), `frontend/package.json` only if a dependency is truly needed (the
plan needs none).
Builds against: the mock facade first (`USE_MOCKS=true`, extended in `lib/mock/`), then
`EXPO_PUBLIC_USE_MOCKS=false` at the hour-8 checkpoint. Shapes from §6.1 are typed verbatim in
`lib/types.ts`.
Must not touch: `backend/`.

---

## 9. Build order, estimates, and what to cut first

Hour 0 is when the three agents start reading this file. Times are per agent, in parallel.

| Hour | Agent A (vision) | Agent B (API) | Agent C (app) |
|---|---|---|---|
| 0–1 | `uv pip install -e ".[vision]"`; `qwen3-vl:8b` is already pulled — download `yolo11n.pt`; re-run `bench.py` on a real webcam frame and note any drift from §3.7a | Fixtures + `API_CONTRACT_V3.md`; stub every §6.1 route returning fixture data so C can hit them | Tokens (extremes, grain), `login.tsx`, routing in `index.tsx`, session store |
| 1–3 | `capture.py` + mask + preview; `gate.py` motion + YOLO + posture; measure fps | `db.py` indexes; `memory.py` + profile/facts/delete routes + tests; `seed.py` facts | `onboard/welcome`, `consent`, `about` |
| 3–5 | `keyframe.py`; `vlm.py` with schema + prompt + post-rules; `--dry-run` prints observations from the webcam | `presence.py` dedup + sweeper + sentences; `POST /ingest/camera`, heartbeat, config, presence, WS `presence.update`; tests | `onboard/camera`, `contacts` restyle, `done`; mock presence day |
| 5–7 | `worker.py`: config poll, consent gate, heartbeat, POST, ring; `--demo`; `--source file.mp4` | `GET /activity` with family filter; `rag.py` pool + kinds + quota + time window | **Today** home + `PresenceHero`; `Her day` |
| 7–8 | **Checkpoint: A→B end to end on the webcam.** Fix enums/timestamps. | Checkpoint with A; `DEMO_FAST` | **Checkpoint: flip `USE_MOCKS=false`**; fix shapes |
| 8–11 | Tune keyframe rules on a real sit-eat-leave loop; `--no-yolo` cut path verified; test file | `rag.py` guard (hard/soft), prompt rules, scrub, Ollama text fallback; `chat.py` response; `test_rag_guard.py` | **Ask** with kind citations + refusal treatment; **Settings** facts/camera/forget |
| 11–13 | `simulate` fallback verified with B; README section | `simulate` kinds; `login`; seed polish; `make test` green | Polish: entrance choreography, empty states, emoji grep, DESIGN.md |
| 13–14 | **Feature freeze.** Full run: login → onboarding → sit/eat/leave → chat → forget. Each agent fixes only their own files. | | |
| 14–18 | Rehearse the §10 script six times. Record the fallback clip (`--source` file). Tune `DEMO_FAST` and `--demo` so bite→sentence is under 35 s. | | |
| 18–22 | Slack for what broke. Sleep in shifts. | | |
| 22–24 | Demo setup (§10.0). | | |

**Cut list, in order — CORRECTED after the real webcam run.** ~~1) YOLO person gate →
`--no-yolo`~~ **Do not cut this first.** Measured on the actual camera: MOG2 absorbs a still
person into the background in about 100 seconds, so motion alone reports a resident who has
fallen asleep in her chair as *absent*. The person gate is what re-confirms presence every 5 s
while she is believed to be in view. Cutting it turns a nap into "out of view since 2:10", which
is the one wrong answer this product must not give. If the gate has to go, raise the VLM cadence
to cover it and say so on stage. New first cut: 2) Usual-spots learning → static `afternoon` fact only. 3) `on_floor` → alert (already stretch).
4) Ollama text fallback for chat → template answers grouped by kind. 5) Onboarding *Test* button
→ static instructions. 6) Fact editing in Settings → read-only list (API keeps supersede).
7) `done.tsx` → merge its three lines into the contacts screen. Never cut: consent gates (both),
family filter on `/activity` and retrieval, the surveillance guard, `DELETE /memory`, input
validation on zone/appearance/facts/confirm.

---

## 10. The demo script

### 10.0 Setup, before the slot

- `make run` (API, `DEMO_FAST=1`), `make embedder`, `make seed`, `make vision-demo`
  (`python -m vision --source 0 --demo --preview --camera-id cam_mac_01`). Confirm
  `GET /presence` says `camera_off` → `out_of_view` within 15 s.
- Laptop on the table, lid open, webcam facing a chair and a small table with a **plate, a fork
  and a mug**. Laptop screen (the hub preview) mirrored to the projector **only for beat 2**.
- Phone on a stand, Expo Go, `USE_MOCKS=false`, LAN hotspot from the bag (not venue wifi),
  signed out. Phone mirrored via QuickTime for beats 1 and 3–6.
- Fallback: `POST /admin/simulate {kind: "meal"}` on a second phone; `--source demo.mp4` if the
  camera device fails. Never debug on stage.

### 10.1 On screen, in order (about 2:40)

| Beat | On screen | Said |
|---|---|---|
| 1 · 0:00–0:20 | Phone: login. Presenter signs in as `priya@dhyaan.demo`. Home: **"Nothing yet today."** *The camera came on at 3:38 pm.* Four empty tiles. | *"This is Priya's app. Her mother Eleanor lives alone. The only thing running is one camera in her living room and this laptop. Nothing has happened yet."* |
| 2 · 0:20–0:45 | **Projector switches to the hub preview**: the presenter walks into frame; motion mask flickers, the person box appears, status line reads `motion → person → keyframe 1/3`, then `VLM 3.1 s`. | *"Every frame is dropped unless something moved. If something moved, a 5 MB detector asks 'is that a person'. Only then do three frames, twenty seconds apart, go to a vision model on this laptop — over loopback, and nowhere else. This screen is the last place a picture exists."* |
| 3 · 0:45–1:15 | **Projector switches to the phone.** Presenter sits, picks up the fork, eats. Preview stays on the laptop only. The phone hero cross-fades: **"Eleanor is having something to eat at the table."** *Dhyaan saw · 3:41 pm.* The *Ate* tile becomes *1 meal so far*. | **The ten seconds that land it — say nothing until the sentence appears, then:** *"No video left that laptop. Her daughter got a sentence."* |
| 4 · 1:15–1:35 | Presenter stands, walks out of frame. ~15 s later: **"Eleanor has been out of view since 3:43 pm."** *Around her usual walk time.* | *"It doesn't say she went for a walk — it can't see the door. It says she's out of view, and that Priya told us she usually walks about now."* |
| 5 · 1:35–2:20 | **Ask** tab. Chip: *Has she eaten today?* → *"Yes — Dhyaan saw her eat at 3:41 pm today. You told us she usually has toast and tea around 8, so this was later and lighter than usual."* Citations: **You told us · breakfast**, **Dhyaan saw · 3:41 pm**. Typed: *What did she say to her visitor?* → **"Dhyaan never listens, so there is nothing she said that I could tell you. Someone visited on Tuesday for about 40 minutes."** Typed: *Show me the camera.* → **"There is no video to show — not to you, not to anyone. I can tell you what she's been doing."** | *"Three sources, always labelled: what you told us, what the camera saw, what her pattern is. And the questions it won't answer, it won't answer for anyone."* |
| 6 · 2:20–2:40 | **Settings → Forget her profile** → type *Eleanor* → confirm. Home returns to **"Nothing yet today."**; Settings shows *Nothing told to Dhyaan yet*. | *"And when she says stop, it's gone — the notes, the description, the observations. There was never a picture to delete."* |

Fallback ladder: webcam fails → `simulate meal` (beat 3 shows the same sentence, say *"the camera
is being shy — here's the same observation from the simulator"*); VLM slow → beat 3 runs on the
recorded `demo.mp4` through the real pipeline; API key absent → chat answers come from the Ollama
text fallback or, failing that, the kind-grouped template — both rehearsed.

---

## Integration notes

(Agents append below; never rewrite above this line.)

### Agent B → A and C, hour 1 (backend API)

`backend/API_CONTRACT_V3.md`, `fixtures/camera_observation.json` and
`fixtures/camera_heartbeat.json` are on disk and frozen. Both fixtures are
validated against the real Pydantic models by `tests/test_simulator.py`, so a
drift fails there rather than as a 422 on stage.

Deltas from §6 that did not survive contact with the existing code:

* `rag.answer()` keeps its three-key shape (`tests/test_llm.py` pins it with a
  strict `set(result) == {...}` and that file is not mine). The extended §6.1
  shape — `refused`, `refusal_kind`, `citations[].kind` — is on the new
  `rag.answer_family()`, which is what `POST /chat` calls. Agent C reads the
  route, so nothing changes for the app.
* A hard refusal does **no** retrieval and makes **no** model call, so the demo
  beat-5 answer *"…there is nothing she said. Someone visited Tuesday for about
  40 minutes."* ships as *"…there is nothing she said that I could tell you. I
  can tell you that someone visited and roughly how long for, if you ask."*
  Asking the visitor question on its own then answers it for real.
* `right now` / `at the moment` alone are no longer hard refusals — only an
  actual whereabouts phrase is (`which room`, `where is she`, `where in the
  house`). Otherwise *"is she okay right now"* refused, which is the question
  the home screen exists to answer.
* `POST /profile/facts` returns **403** without `consent_memory` (§5.4 grant C).
  Agent C: write the consent PUT before the facts POST in onboarding.
* The local chat fallback is env-gated: `CHAT_FALLBACK_MODEL=qwen3-vl:8b` turns
  it on. Unset (the default) the chat falls back to kind-grouped templates, so
  the test suite stays offline.
* `POST /admin/simulate {kind: "out_of_view"}` posts one `absent` observation,
  not a leaving+absent pair — two of them a step apart is two `room_exit`
  events by the debounce rule.
* `routers/live.py`'s `_broadcast` is now `broadcast` (public). Nothing else
  referenced it.


---

## Appendix — benchmark script

The numbers in §3.7a came from a 40-line script (`bench.py`) that posts 1 or 3 JPEGs with the
§3.5 schema to `/api/chat` three times and prints Ollama's timing fields. Agent A should copy it
into `backend/vision/bench.py` as the hour-0 sanity check; it is also the fastest way to confirm
structured output still works after any Ollama upgrade.

### Agent C → Agent B (frontend, hour ~6)

The app is built and green against the §6.1 contract, running on the mock facade
(`EXPO_PUBLIC_USE_MOCKS=true` — flipped in `frontend/.env` so the app is demoable
now; flip it back to `false` at the hour-8 checkpoint). Shapes are typed verbatim
in `frontend/src/lib/types.ts` and the real client is written in `lib/http.ts`.

What the app needs from B, in the order it breaks without them:

1. `POST /auth/login` — nothing else gates the app. Until it exists,
   `USE_MOCKS=false` cannot get past the sign-in screen.
2. `GET /residents/{id}/presence` and `GET /residents/{id}/activity?date=` — both
   degrade to an honest empty state on a 404 today (Today shows "Nothing yet
   today · No camera is set up for her yet"), so the app is not blocked, just empty.
3. `GET/PUT /residents/{id}/profile`, the three facts routes, and
   `DELETE /residents/{id}/memory` — Settings and the end of onboarding surface a
   real error until these land, and *Forget her profile* is a no-op.
4. `POST /chat` extended fields. The app reads `citations[].kind` and
   `refused`/`refusal_kind` defensively: a missing `kind` falls back to
   `observed` rather than inventing a `told`/`pattern` label, and `refused`
   falls back to `retrieved_count === 0`. Sending the real `kind` per citation is
   what makes the three-source labelling in the demo true rather than plausible.
5. `POST /admin/simulate` with `kind: "meal"|"visitor"|"out_of_view"` — wired to
   the debug panel (long-press the Settings title) as the on-stage fallback.
6. WS `presence.update` — handled in `store/live.ts`; the 15 s `GET /presence`
   refetch is the belt under it, so it is a latency win, not a correctness one.

Two contract notes: `citations[].id` is read as `id` with a fallback to the older
`event_id`, and a `told` citation is rendered with no tap target (a fact has no
event behind it). Nothing on a family screen has anywhere to put a zone —
`Presence` and `ActivityItem` have no such field — so stripping it server-side
and never sending it are both still required, but a leak cannot render.
