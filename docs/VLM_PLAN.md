# VLM presence layer — implementation plan

Dhyaan Home, camera lane. One camera in one common room of one consented resident's home,
a local vision-language model on the Mac, and an adult child's app that gets sentences.
Three agents build this in parallel from this document. Ponytail mode: the laziest thing
that actually works, with every shortcut's ceiling named. Nothing here relaxes consent,
zone rules, or validation at a trust boundary.

Binding inputs: `PRODUCT_SPEC.md` §8 (creepiness budget), `DECISIONS.md` D-001 (family never
sees a room), `TECHNICAL_PRD.md` §6 (cascade) and §12 (privacy), `docs/frontend-DESIGN.md`.
Where this plan and the original brief disagree, §1 says so.

**Status, 2026-09-20.** This document was the build plan and is now kept as the description of
what shipped. Where the code moved past the plan the section says so inline; where the plan
specified something that was never built it is marked *specified, not built* rather than deleted.
The largest deltas since the plan was written: the person gate is an open-vocabulary detector
(YOLO-World, §3.3) and it, not the VLM, answers every structural question; the VLM is
`qwen2.5vl:3b` writing one sentence from one frame (§3.1, §3.5); the cascade runs at ~15 fps and
posts the moment what it sees changes (§3.4); posture comes from pose landmarks, not a bounding
box (§3.4); visitor detection is off by default (§3.5); there is a live monitor channel (§6.1);
and the API has no authentication at all (§6.1). The seeded resident's display name is now
*Asha* (`fa81785`, display name only; ids such as `res_eleanor` and the example sentences below
are unchanged). The `testcam/` bench this plan cites was removed in `12d53ff`; every number
from it is quoted inline here and the bench itself is recoverable at commit `56e2237`.

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
| Every frame through the VLM | Waste, and 0.7 to 3 s each. | Motion gate → open-vocabulary detector → keyframe rules. The detector answers person / food / dishes / posture in ~13 ms and posts on every change; the VLM only writes the sentence, once per keyframe (every 60 s in view by default, every 8 s with `--demo`), and never when she is not in view. |

**The demo therefore shows:** the family home screen with nothing yet; a presenter
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
 │      ─► scene (YOLO-World, MPS) ─► keyframe rules ─► Ollama VLM (own thread)  │
 │            ~13 ms, posts on change     loopback only     qwen2.5vl:3b, 1 frame │
 │  frames: RAM ring, ≤1 JPEG (batch_size), freed on flush. No disk. No socket   │
 │  but loopback.                                                                 │
 └───────────────┬──────────────────────────────────▲────────────────────────────┘
                 │ POST /v1/ingest/camera            │ GET /v1/camera/config (consent,
                 │ {activity, spot, evidence…} JSON  │  paused_until, hints) every 10 s
                 │ POST /v1/ingest/camera/monitor    │
                 │ {fps, boxes (normalised), gate…}  │  at most 1 Hz, RAM only on the API
 ┌───────────────▼──────────────────────────────────┴────────────────────────────┐
 │  FastAPI (existing process)                                                    │
 │  routers/camera.py ─► presence.py (dedup, episodes, presence state)            │
 │                       └► events.emit()  ─► subscribers: rag embed, live WS     │
 │  memory.py: residents.appearance/usual_spots, profile_facts (embedded)         │
 │  rag.py: pool = events ∪ profile_facts, quota by kind, surveillance guard      │
 │  llm.py (OpenAI, None on failure) ─► rag falls back to Ollama text ─► template │
 └───────────────┬────────────────────────────────────────────────────────────────┘
                 │ REST + WS /v1/live  (presence.update, event.new, camera.monitor)
                 │ LAN, no auth of any kind (§6.1)
 ┌───────────────▼────────────────────────────────────────────────────────────────┐
 │  Expo app (adult child's phone): onboarding ─► Today / Her day / Ask            │
 │  / Settings. Never receives a zone, a frame, or evidence text.                  │
 └────────────────────────────────────────────────────────────────────────────────┘
       MongoDB: events, residents, profile_facts, cameras, observations (+TTL)
```

| Component | Where | Trigger | Writes | Reaches the app via |
|---|---|---|---|---|
| Capture + cascade | `backend/vision/` (own process: `python -m vision`) | Camera frames, 30 fps, every 2nd sampled (~15 fps, `SAMPLE_EVERY_N`) | Nothing on disk. RAM ring of at most `batch_size` (1) JPEG | — |
| Detector observation | `vision/gate.py` + `vlm.from_scene()` | Every sampled frame with motion, and every 5 s while she is believed present; posted when person count / food / dishes / posture band changes | An `Observation` with `model: yolov8s-worldv2` | `POST /v1/ingest/camera` |
| VLM call | `vision/vlm.py` → Ollama `/api/chat`, loopback, on a worker thread | A keyframe (see §3.4) | An `Observation` JSON (text only), YOLO's counts merged in | `POST /v1/ingest/camera` |
| Monitor tick | `vision/worker.py::monitor` | At most 1 Hz | Nothing; the API keeps the last tick in RAM | `POST /v1/ingest/camera/monitor`, `camera.monitor` on WS, `GET /cameras/{id}/monitor` |
| Config poll | `vision/worker.py` | Every 10 s | — | `GET /v1/camera/config` (fail closed) |
| Ingest + dedup | `app/routers/camera.py`, `app/presence.py` | Each observation POST; a 30 s sweeper | `observations` row, `cameras.presence`, then `events` via `emit()` | `event.new`, `presence.update` on WS; `GET /presence`, `GET /activity` |
| Memory | `app/memory.py` | Onboarding PUT/POST, settings edits, delete | `residents.{appearance, usual_spots, consent_*}`, `profile_facts` | `GET/PUT /profile`, facts routes |
| Chat | `app/rag.py` (edited) | `POST /chat` | Nothing | Existing route, extended response |
| App | `frontend/src/` | — | — | — |

**Why a separate worker process and not an asyncio task in FastAPI.** Three reasons, all cheap:
the macOS camera permission prompt attaches to the process that opens the device, and we want that
to be a terminal we control, not uvicorn's reloader; a blocking VLM call must never sit on the
API's event loop next to a fall ingest; and it makes the privacy claim structural: *the API process
never has a frame to leak*. The cost is two ingest endpoints and one config poll, all frozen below.
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

**Planned pick: `qwen3-vl:8b` (6.1 GB).** Best instruction-following of the set, multi-image
input, the PRD already chose it. Benchmarked at ~6 s per 3-frame structured call warm (§3.7a).

**Shipped: `qwen2.5vl:3b` (3.2 GB), `VLM_MODEL` in `vision/__init__.py`, env-overridable.** The
plan's model was replaced once the detector took over the structural questions (§3.3) and the
VLM was left with only the sentence to write. Measured on this machine, same live frame, same
prompt, warm, one frame:

| model | warm call | note |
|---|---|---|
| `qwen3-vl:8b` | 7.3 s | the plan's pick; a thinking model, needs `think: false` |
| `qwen3-vl:4b` | 1.95 s | spends tokens on a `<think>` preamble |
| `qwen2.5vl:3b` | **0.69 s** | clean JSON, no thinking tax, same scene right (person_count 1, sitting). Shipped. |
| `moondream` | — | returned nothing usable on this schema |

Sub-3B models were tried and are a dead end in this Ollama build (`8ede239`): moondream returns
`eval_count 1` on every prompt style, `granite3.2-vision:2b` is slower than the 3B and emits
invalid enums, and `qwen2-vl:2b` / smolvlm are not in the library. `make vlm` pulls and warms
`qwen2.5vl:3b`; `--model` on the worker CLI overrides per run. `think: false` stays in the request
body so a `qwen3-vl` override still works.

### 3.2 Capture

`cv2.VideoCapture(index, cv2.CAP_AVFOUNDATION)` in a grab-always thread exactly as PRD §6.1 (the
`Camera` class there is ~25 lines; copy it). `--source 0` is the MacBook camera (confirmed present:
"MacBook Pro Camera"). **A phone is a webcam for free:** an iPhone on the same Apple ID appears as
another AVFoundation index via Continuity Camera — no code. `--source path.mp4` plays a file at real
time, looped, for rehearsal and as the on-stage fallback. `--source synthetic` is a scripted day in a
drawn living room (`capture.SyntheticCamera`): no webcam, no permission prompt, a one-minute loop
in which she arrives, sits, eats at the table, crosses to the armchair and a visitor joins her.
Nothing reads a drawn figure as a person (yolo11s scores it 0.04), so on this source the script
supplies the perception and everything downstream of it (keyframe rules, VLM call, POST, dedup,
presence, websocket) runs for real, and every row it posts carries `simulated: true`. The loop's
timings are sized for the `--demo` cadence (a 13 s empty stretch against `absent_after_s = 12`),
and `make vision-synthetic` passes `--demo` for that reason; the worker itself does not imply it
(a comment in `test_vision_gate.py` says it does, and is wrong), so `python -m vision --source
synthetic` without `--demo` never goes out of view. Frames are downscaled to **448×252**
(`FRAME_W`, `FRAME_H`) immediately; nothing larger is kept. The plan said 640×360; the vision
encoder's cost scales with pixels and this was the single biggest latency lever left.

**Privacy mask, first thing after capture.** `--mask x0,y0,x1,y1` (normalised) blacks out a
rectangle *before* motion detection, for a doorway into a private room that is in shot. Two lines
of numpy. Set on the hub at install; the app never sees a frame, so the app never draws it.

**Preview.** `--preview` opens a cv2 window on the hub's own screen (upscaled `PREVIEW_SCALE`×,
default 3, so it is not a postage stamp on a 5K display) with the masked frame, the motion mask
inset, every person box (the followed subject in green, anyone else in grey), and four text lines:
last activity and posture, people and FOOD, DRINK/DISH and seating, worker state and cascade
status. It answers "is it seeing this?" without a log or the database. This is the only screen that
ever shows a frame. Key `p` pauses the camera for 2 h (posts a `paused` heartbeat, §6.1), the
resident's control, on her hub, per `PRODUCT_SPEC.md` §8.3; `q` or Esc quits.

### 3.3 The cascade

| # | Stage | Runs | Budget | What passes |
|---|---|---|---|---|
| 0 | Sample | every 2nd frame → ~15 fps (`SAMPLE_EVERY_N`; the plan said every 10th, and at 3 fps up to 333 ms passed before a change was even looked at, which was most of the perceived lag) | — | all |
| 1 | Privacy mask | every sampled frame | <1 ms | all |
| 2 | Motion | `cv2.createBackgroundSubtractorMOG2(history=300, varThreshold=25, detectShadows=False)` on 320×180 grey; foreground ratio ≥ 0.8 % | ~2 ms | ~10 % in a lived-in room |
| 3 | Scene | Ultralytics YOLO-World `yolov8s-worldv2.pt` with 20 free-text prompts (below), `imgsz=640`, MPS; one pass returns people, food, dishes and seating. Also re-run every 5 s while she is believed present, motion or not | **~13 ms median** live (`ea69a47`, `4e78c92`); 11.5 ms median, 17 ms p90 re-measured on 40 synthetic frames with nothing in them; **3.1 s** once at start | ~70 % of motion frames |
| 3p | Posture | MediaPipe pose landmarks on the subject's box (`posture.py`), cached per box | ~13.8 ms, once per cycle | — |
| 4 | Keyframe | rules in §3.4; they ration the VLM only. The detector's own observation is posted the moment the scene shape changes, no keyframe needed | <1 ms | ~1 VLM call/min in view by default, ~1 per 8 s with `--demo` |
| 5 | VLM | `qwen2.5vl:3b`, **1 frame**, JSON asked for in the prompt and validated with Pydantic; the schema-constrained retry only when a reply does not parse. On its own thread, queue depth 1, drop-oldest | **0.69 s** warm; +~1.4 s when the constrained retry fires; 2.2 to 2.8 s observed when Ollama shares the GPU with the detector | — |

Stage 3 is the one dependency with weight: `ultralytics` pulls torch (~1 GB of wheels; ~2 min with
uv on this machine), plus ultralytics' CLIP fork (pinned in `pyproject.toml`, because `set_classes()`
needs it and ultralytics tries to pip-install it at runtime, which fails in a uv venv) and
`mediapipe==0.10.35` (pinned: 1.0.1 hard-aborts inside a Metal helper on this machine). The weights
download by name on first start: `yolov8s-worldv2.pt` (~25 MB) plus CLIP ViT-B/32 (~340 MB) for the
text embeddings, so do the first start while online. Nothing is committed.

#### 3.3a Why YOLO-World and not a COCO YOLO

COCO's entire food vocabulary is ten words: banana, apple, sandwich, orange, broccoli, carrot, hot
dog, pizza, donut, cake. A crisp packet, a mug of soup, a bowl of cereal or a slice of toast has no
output neuron, so no threshold and no bigger COCO model can ever report them. The bench (commit
`56e2237`, `testcam/FOOD.md`, seven Wikimedia photographs downscaled to the lane's 448×252)
measured it: on five photographs of real food the COCO detector (`yolo11n`) reported food once,
and that once was wrong, `pizza` for a protein bar. YOLO-World takes its class list as free text at
runtime and named the cereal (`cereal, rice, food`) and the soup (`cup` + `soup`), and found eight
people in a downscaled crowd shot where `yolo11n` at `conf=0.35` found zero. Open vocabulary cost
about 4 ms in the bench (11.5 ms median against a 7.2 ms COCO nano baseline, live webcam,
448×252) and nothing per prompt: 7.4 ms at 1 prompt, 8.1 ms at 100, because the text embeddings
are built once in `set_classes()`. `yolov8s` is a *small* where the baseline was a *nano*, and the
extra recall is the point: a person the detector misses is a resident reported absent.

The bench's own recommendation was to keep COCO on the hot path and run YOLO-World only on
keyframes. That was built first (`a59ea65`, `openvocab.py`), then measured: keyframe-only meant
food was invisible for the seconds between keyframes, which is exactly when someone picks up a
bottle (`c923dc3`), and COCO+World on the hot path cost 25 ms against a 33 ms camera interval.
Once the hot path was paying for YOLO-World anyway, COCO was doing nothing, so YOLO-World became
stage 3 (`da6cf31`) and `openvocab.py` (stage 3b) is now off by default and only runs when a COCO
model is put back with `YOLO_MODEL=yolo11s.pt`.

#### 3.3b The vocabulary, and why it is short

`gate.VOCAB`, 20 prompts in five buckets (`gate.PROMPTS` is the flat list, `MAX_PROMPTS = 24` is
asserted by the tests):

| bucket | prompts | reported as |
|---|---|---|
| person | `person` | `person_count`, boxes |
| food | `food`, `sandwich`, `snack bag`, `cereal`, `soup`, `noodles`, `toast`, `fruit` | `scene["food"]`; the generic `food` is dropped when a specific word also fired |
| dishes | `cup`, `mug`, `bowl`, `plate`, `bottle` | `scene["dishes"]` → `plate_or_cup_present` |
| seating | `chair`, `sofa`, `dining table`, `bed` | `scene["seating"]`; `vlm.from_scene` reads `dining table` and `chair` for `spot` |
| background | `phone`, `book` | never reported |

**Short on purpose.** YOLO-World's confidence is a cosine between an image region and a text
embedding, so every score is relative to the prompt list. Same crisp packet, same weights, only
the list differing (`56e2237`):

| vocabulary | best label for the packet |
|---|---|
| `["bag"]` | `bag` 0.75 |
| `["snack bag"]` | `snack bag` 0.48 |
| 22 food words | `snack bag` 0.11 |
| a 62-word household list | `snack bag` 0.09, below any usable floor |

Ask it one question and it is sure; ask it sixty-two and the answer flattens, because the crisps
look enough like cutlery that `knife` and `fork` take the score. Adding a prompt costs nothing in
latency and costs confidence on every other prompt. Short plain nouns beat articled phrases
(`snack bag` > `a bag of crisps`), also measured. The background bucket is not decoration: with no
household nouns in the list the room has to land on a food word, and removing the distractors
measurably dropped the food scores. `test_the_vocabulary_stays_short_and_names_what_the_pipeline_reads`
pins the length, the lowercase two-word-max shape, the presence of the background bucket and the
two seating words `spot` depends on.

#### 3.3c Thresholds, calibrated to this list

Both floors live in `TUNING` and are env-overridable. They are calibrated to *this* list on this
machine (448×252 frames, `imgsz` 640, the seven bench fixtures, a flat grey frame and 20 live
webcam frames of a room with a person and no food):

```
cereal 0.64  snack bag 0.26  soup 0.14  food 0.26-0.53  cup 0.91
bowl 0.28-0.66  plate 0.62-0.76  dining table 0.21-0.55
live room, no food: highest non-person label 0.13 (a desk as "dining table");
  no food word above 0.03 in 20 frames
person: 0.90 live; 0.78-0.80 on a real photograph; 0.19 on a side profile
  under a wide hat; 0.11-0.25 on a downscaled crowd; not one false person on
  five people-free fixtures or the flat frame at a 0.01 floor
```

- `world_conf = 0.20` (`WORLD_CONF`) for objects: 0.07 above the live room's noise. Loses soup in
  a mug at 0.14 but keeps its cup at 0.91.
- `world_person_conf = 0.15` (`WORLD_PERSON_CONF`) for people: the bench's number. At 0.25 the
  crowd shot goes from 8 people to 1.
- `person_conf = 0.4` is the COCO floor and applies only when a COCO model is in use. COCO's
  closed-set logits and YOLO-World's cosines live an order of magnitude apart; inheriting the
  COCO floor returns nothing at all from YOLO-World (measured), which is why the gate picks the
  floor by the model's capability (`set_classes` present or not), never by name.

Changing the list re-opens the calibration. The numbers are in the comment above `VOCAB`.

#### 3.3d Hysteresis (`world_hold`)

A calibrated-low floor puts real objects *on* the line once the frame is compressed: a real crisp
packet on a clip with 1 px of hand-held jitter scored 0.13 to 0.28, median 0.19, over a 0.20 floor,
and crossed the line four times in a second. Every crossing was a "what I see changed" post
(§3.4). So a label reported on the previous pass stays while it scores `world_hold` (0.6,
`WORLD_HOLD`; 1.0 disables) of its floor: 0.12 for objects, 0.09 for people. It is not memory of a
stale plate: the label must still be detected on *this* frame, at a lower bar to stay than to
arrive. The model is asked at the hold, not the floor, because ultralytics applies `conf` inside
NMS and a box dropped there can never be held (asked at 0.15, a packet at 0.13 vanished and the
0.12 hold never saw it). A COCO model gets no hysteresis.

#### 3.3e Box dedupe

Ultralytics runs NMS per class at IoU 0.7, and YOLO-World hands back nested person boxes NMS leaves
alone: on `person_sandwich.jpg`, a whole body, then a torso box 98 % inside it whose IoU with the
body is only 0.47, because IoU punishes the size difference. Three "people" for one, and the head
count is what present / with_visitor hangs off. `gate.dedupe_boxes` therefore tests containment,
not IoU: a box is dropped when more than 70 % of its own area lies inside a larger kept box. Two
people side by side never contain each other; a child on a lap would merge, which is the safe
direction for a single-resident home. Returns largest first.

#### 3.3f Warm-up

`set_classes()` builds the CLIP text embeddings: **3.1 s** on this machine (re-measured; the bench
said 4.0 s cold, and 0.07 s for any later re-specification), plus the one-off ~340 MB CLIP download
on a fresh machine. It happens in `PersonGate.__init__` at worker start, never on the first frame
with a person in it, and the warm-up then runs one throwaway `predict` on a frame-sized blank so the
graph is built at the lane's own size. That pass is also the MPS probe: some ultralytics/MPS pairs
fall over on the einsum in YOLO-World's contrastive head, so the device is measured, not assumed
(`YOLO_DEVICE` overrides the probe). A half-downloaded CLIP checkpoint is the expensive failure:
ultralytics' fork verifies it by SHA256 and silently re-downloads 338 MB on every launch, so
`openvocab._clip_cache_is_sound` hashes it first and deletes a corrupt file (`59966b8`). That is
one of the two `open()` calls the no-filesystem test allows, and the test says why.

#### 3.3g Degradation ladder, all without a crash

`PersonGate` never raises out of `__init__` or `scene()`; each rung says why, once, and each is
pinned by a test in `tests/test_vision_gate.py`.

| failure | what happens |
|---|---|
| no `ultralytics` / torch installed | `enabled=False`: motion-only, the cut path below. Posture rule and the 5 s re-confirm go with it |
| weights will not download (no network, no file) | the same; `[vision] yolov8s-worldv2.pt unusable: ...` |
| CLIP missing or offline (`set_classes` raises) | `yolo11s.pt` if it is already on disk (people and COCO's ten foods, COCO floor, stage 3b back on), otherwise motion-only. Never downloaded: the reason we are here is usually that downloads do not work |
| MPS fails the warm-up probe | CPU, same model, same vocabulary |
| detector throws mid-run | `enabled=False` from that frame; the worker reads `enabled` every frame and carries on motion-only |
| no MediaPipe (posture) | bbox aspect for `tall`/`mid` only; a `wide` box degrades to `None` rather than a fall, logged once |

`YOLO_MODEL=yolo11s.pt` puts the COCO detector back in one line; the gate tells the two apart by
capability, filters COCO to the ids in `COCO_WORDS`, uses the COCO floor, and stage 3b then adds
food on keyframes as before. `OPENVOCAB=0` cuts stage 3b entirely.

#### 3.3h What got worse, honestly

- **Soup in a mug is missed.** 0.14 against a 0.20 floor. The mug (`cup` 0.91) is seen; the soup is
  not, so a mug of soup reads as a drink, not a meal.
- **Person confidence is much lower than COCO's.** 0.90 live but 0.19 on a hard photograph (side
  profile, wide hat), and the floor is 0.15. Phantom-person rates in a real empty room were never
  measured: the "not one false person" figure is from five people-free fixtures and a flat frame,
  not from an hour of an empty living room with a coat on a chair. `world_person_conf` is the
  first knob to re-tune at an install: lower if a seated resident is missed, raise if a coat
  becomes a person.
- **Coverage is not correctness.** The noodle bowl reads `cereal` (0.78 in the last local run
  against the shipped list; the fixture was gitignored, so this cannot be re-run from the repo),
  and in the bench's own vocabulary the protein bar came back `pizza` at 0.59, exactly as it did
  under COCO (`pizza` is not in the shipped list, which measured the bar as plain `food`). The
  family sentence only says *having something to eat*, and the label stays in `evidence`
  (staff/audit), so a wrong grain is a wrong audit line, not a wrong sentence. It is still wrong.
- **Still missed in the bench:** `person_sandwich` and `people_lunch`, where the food is small and
  partly occluded.
- **Two MPS consumers, one queue.** The detector and Ollama share the GPU; when a VLM call is in
  flight the detector's ~13 ms spiked to 824 ms and 2.7 s at every frame, which is why stage 3b
  was throttled to every 3rd frame and why the VLM moved to its own thread.

**Why not OpenCV's built-in HOG people detector (zero deps)?** It is trained on upright
pedestrians and reliably misses a seated older woman in an armchair, which is most of her day.
**Cut path (`--no-yolo`):** drop stage 3, let motion alone trigger keyframes and let the VLM's
`person_count: 0` mean absent. Costs VLM calls on curtains and cats; loses the posture rule and
the 5 s re-confirm, so a nap reads as *out of view* (§9 says why this is no longer the first cut).

### 3.4 Keyframe selection

Two things produce observations now, and the plan only had one of them.

**The detector posts on change.** Every sampled frame that ran stage 3 yields a *shape*
`(person_count, food?, dishes?, posture band)`. When it differs from the last one, the worker
builds an observation from the scene alone (`vlm.from_scene`, no language model: absent /
on_floor / eating / walking / sitting from the count, food and posture band, `spot` from
`dining table` / `chair`, confidence 0.75 with a person and 0.6 without) and posts it on a worker
thread (bounded queue, drop-oldest so a stalled API slows the network, not the camera). `model` on
that row is the detector's name. Measured (`ea69a47`): gaps between observations went from a
median 6 s to a median 0 s, because `min_gap_s` was the perceived lag once the detector answered
in ~13 ms.

**The keyframe selector rations the VLM only.** Values from `TUNING` (`vision/__init__.py`):

```python
min_gap_s=20,               # never two keyframes within 20 s
on_person_appear_gap_s=30,  # "appear": first person-positive frame after >=30 s of none
on_dwell_s=60,              # "dwell": while she stays in view, one keyframe a minute
aspect_tall=1.6, aspect_wide=0.8,   # bbox bands, now only the fallback (see posture below)
on_floor_confirm=2,         # consecutive wide frames before "on_floor" is believed
on_floor_cooldown_s=30,     # ...and at most one such jump-the-queue call per 30 s
batch_size=1,               # frames per VLM call (the plan said 3)
max_batch_wait_s=30,        # flush a short batch after this long (moot at batch_size 1)
absent_after_s=30,          # no person for 30 s -> one "absent" observation, no VLM call
vlm_every_n=1,              # VLM_EVERY_N: a model call on every keyframe; N>1 posts the
                            # detector's observation on the ones in between
DEMO = dict(min_gap_s=4, on_dwell_s=8, max_batch_wait_s=15, absent_after_s=12)   # --demo
                            # MIN_GAP_S and ON_DWELL_S are env knobs
```

Reasons are `appear`, `posture`, `dwell`, `on_floor`, `absent`. `on_floor` is the one that jumps
the `min_gap` queue and force-flushes the ring; `on_floor_confirm` is load-bearing, not
belt-and-braces: on a real clip the aspect flickered across the 0.8 line frame to frame and a
bare "became wide" fired on almost every frame. `--demo` was 6/15 s and is now 4/8 s because at
15 s the VLM spoke about once a minute and its sentences were drowned 45:1 by the detector's
templates across a whole run (`59966b8`).

**One frame per call, not three.** Each extra frame is another full vision encode and that
dominated the wall clock. The cost is `changed_between_frames`, which a single frame cannot judge;
`presence.py` sees movement across consecutive observations anyway, so the field was doing little
work. The plan's "three frames over 20 s with a fork moving are eating" argument is gone with it:
`eating` now comes from the detector seeing food with a person, or from the VLM's
`hand_to_mouth_observed`.

**Posture comes from the body, not the box.** The bbox-aspect rule called someone seated at a
desk `on_floor` on 20 live frames out of 20 (the chair, the lean and the crop at the waist make
the box wider than tall), and `on_floor` is the one band that jumps into the alert path. `posture.py`
asks MediaPipe's 33-point pose landmarker where the hips are relative to the shoulders and knees:
upright → `tall`, seated → `mid`, on_floor → `wide`, and `unclear` (knees under a desk, visibility
0.15) → `None`, which stops there and does *not* fall through to the bbox. Without MediaPipe the
bbox aspect still gives `tall`/`mid`, and `wide` degrades to `None` with one log line: a rectangle
alone has not earned a fall. After the change: seated at a desk `unclear` 20/20, leaned back
`upright` 20/20, `on_floor` across 60 frames 0. Not verified: a real fall. Nobody lay on the
floor, so `on_floor` being *correct* still rests on synthetic-landmark tests (`test_posture.py`).
Ceiling: `num_poses=1`, single occupant.

**One subject, followed by IoU.** `gate.pick_subject` follows the person box that overlaps the one
it was already watching (IoU ≥ 0.2) instead of the largest box each frame. Found by lying on the
floor in front of the camera and getting 60 of 60 observations saying *sitting*, because a second
person was in shot and the biggest box hopped to them. When nothing overlaps the previous subject
the worker reports *not seen* for that frame and lets `absent_after_s` decide, rather than
adopting a stranger. Ceiling: no re-identification after a long occlusion; a re-entry reads as a
new subject, which is the safe direction. The upgrade is the appearance descriptor in §4, or
`model.track(persist=True)`.

### 3.5 The VLM call and the exact prompt

`POST http://localhost:11434/api/chat`, `stream: false`, `keep_alive: -1`, `think: false`,
`options: {temperature: 0, num_predict: 150}`, one user message with `images: [b64 jpeg]`
(448×252, quality 70, ~18 KB). No `num_ctx` is set (the plan said 8192; at one small frame it
does not matter). **`format` is not sent on the first try.** Measured on the same frame and model,
warm: long prompt + schema 1.54 s, long prompt without it 0.14 s. Ollama's structured-output
constraint was ~90 % of the lane's latency, and prompt length was irrelevant (931 chars bought
nothing). So the prompt asks for JSON and enumerates every key and value, the reply is validated
with `Observation.model_validate_json` after stripping any code fence, and only a reply that does
not parse pays for a second, schema-constrained call. Fast normally, correct always. If the
constrained retry also fails, `call()` raises, the worker drops the batch and counts it in
`dropped_batches`. The VLM call runs on its own thread (queue depth 1, drop-oldest: if the model
is slower than the keyframes the only batch worth answering is the newest), so the capture loop
never blocks on a model.

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
Set food_visible true if any food or drink is visible anywhere in the frames, including food
held in a hand, a wrapper, a piece of fruit, a snack or a takeaway container - not only food on
a plate or in a cup.
"evidence" is one short clause, under 70 characters, naming only objects and actions.
Reply with a single JSON object and nothing else - no prose, no code fence. Use exactly these
keys and only these values:
  activity: one of {activities}
  ... (one line per key, with the enum spelled out and the common mistakes named:
       "seated, NOT sitting"; "stationary, NOT still"; "a boolean, NOT a sentence")
```

`appearance_line` = `"{name} is {appearance}."` if the family set one, else empty.
`spots_line` = `"At this time of day she is usually found: {usual_spots}."` if learned, else empty.

Schema (Pydantic in `vision/vlm.py`; `model_json_schema()` is the `format` of the retry only).
`food_visible` was added after the plan: `plate_or_cup_present` alone missed every hand-held meal.

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
    food_visible: bool          # new: held food, a wrapper, fruit, a snack
    hand_to_mouth_observed: bool
    changed_between_frames: bool
    confidence: float = Field(ge=0, le=1)
    evidence: str = Field(max_length=180)   # the prompt asks for under 70; 180 is slack
```

**Merge, then post-rules.** `vlm.merge_scene(obs, scene)` folds the detector's facts for the same
frame into the model's answer first. Counting is what a detector is for, so `person_count` is
simply overruled by YOLO's (it reported 5 people where the VLM said "two people standing").
Objects go the other way: YOLO may only *add* `food_visible` and `plate_or_cup_present`, never
zero them, because a detector that was not asked about porridge has not refuted a model that saw
it. What the detector named is appended to `evidence` in brackets. `scene` is `None` whenever no
detector ran on the frame the batch came from, and then the merge is the identity: a stale
sandwich must never reach a later observation (`test_a_stale_scene_cannot_reach_a_later_observation`).

`vlm.post_rules`, in order:

1. `person_count == 0 and hand_to_mouth_observed` → `person_count = 1`. The model sometimes says
   nobody is there and describes a person in the same breath; a hand at a mouth is a person.
   **This used to fire on `food_visible` too.** That was harmless while COCO could name ten foods
   and rarely did, and is wrong now the detector names a bowl of cereal left on the table after
   she has gone. Food alone no longer invents a person
   (`test_food_left_on_the_table_does_not_conjure_a_person`).
2. `person_count == 0` → activity `absent`.
3. `VISITORS and person_count >= 2` → `with_visitor`. **Visitor detection is off by default.**
   `_occupants()` clamps the count to 1 unless `VISITOR_DETECTION=1`: in a real home a second
   person is the most important fact on screen, but in a hall or at a hackathon table it is true of
   every frame and *someone is visiting* fired every 20 s and drowned eating and walking
   (`4e78c92`). The detector still sees them; the product stops treating the room as the subject.
   With it off, `with_visitor` and `visitor_present` never occur from the camera; the simulator
   (`POST /admin/simulate {kind: "visitor"}`) still produces them.
4. `hand_to_mouth_observed and (food_visible or plate_or_cup_present)` → `eating`.
5. `movement == "unsteady"` → `"unclear"` before posting (gait is staff-only per §12 and this lane
   has no staff surface: do not record what you will not show).

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
event; `./dev.sh` sets it by default (`DEMO_FAST=0 ./dev.sh` for the real thresholds). Confidence
on the emitted event = `clip(mean_conf * (1 - 0.5**n), 0.05, 0.95)` (PRD §6.5). Every raw
observation is kept as a row in `observations` (text only, TTL 7 days via a BSON `expires_at`) so
the dedup is auditable and re-runnable; `derived_from` on the event lists the observation ids.

Two deltas from the table above, as built: `activity_observed` episodes are keyed on the activity
too (`_episode_key`), otherwise an afternoon of reading and a five-minute walk would fold into
one episode; and `with_visitor` only arrives with `VISITOR_DETECTION=1` (§3.5). Presence goes
stale after `IN_VIEW_STALE_S = 150` without an observation, so *settled since 12:41* cannot survive
an afternoon with the camera off. The detector's on-change observations (§3.4) go through exactly
the same rules, so a run at 15 fps posting several observations a second still yields one
`meal_observed` per lunch.

`meal_skipped` stays computed (existing rollup), never observed. `person_present` is not written
per observation — it is in `NOISY_EVENT_TYPES` for a reason; the `observations` collection is
where that cardinality goes.

### 3.7 Latency and throughput, measured on this machine

**As shipped** (`qwen2.5vl:3b`, 448×252, one frame, YOLO-World on MPS, 15 fps loop):

| Quantity | Measured | Basis |
|---|---|---|
| Camera read | 33 ms (30 fps) | profiled loop, `b63af51` |
| Detector, `scene()` | **~13 ms median** live (10 to 14 ms across runs); 11.5 ms median / 17 ms p90 on empty synthetic frames, re-measured 2026-09-20 | `ea69a47`, `4e78c92`, `b63af51`; this pass |
| Detector warm-up | **3.1 s** on MPS, at start | re-measured 2026-09-20 (bench said 4.0 s cold) |
| Posture (pose landmarks) | ~13.8 ms, once per cycle, cached per box | `a59ea65` |
| Stage 3b (COCO revert only) | median 12 ms, p90 14 ms at every 3rd frame; 824 ms and 2.7 s spikes at every frame while Ollama held the GPU | `c923dc3` |
| VLM, `qwen2.5vl:3b`, 1 frame | **0.69 s** warm without the schema; 1.54 s with it; 2.2 to 2.8 s observed in full runs with the GPU shared | `vlm.py`, `59966b8` |
| Detector observations per second | up to 1.5/s on change (30 in 20 s), one `meal_observed` per lunch after dedup | `b63af51` |
| VLM calls while in view | one per keyframe: every 60 s default, every ~8 s with `--demo` | `TUNING`, `DEMO` |
| Ingest POST | ~3 ms, off the loop on a worker thread | `b63af51` |
| Memory | ~1 GB torch + YOLO-World, ~0.4 GB embedder, the 3B VLM resident in Ollama | `ollama ps` |

**The plan's benchmark**, kept for the record (`qwen3-vl:8b`, 640×360, three frames, the schema as
`format`, `temperature 0`). Filled in from the run at the end of planning. The script it came from
was to be copied to `backend/vision/bench.py` (Appendix); that is *specified, not built*.

| Quantity | Measured / estimate | Basis |
|---|---|---|
| `qwen3-vl:8b` cold load | **2.4 s** | measured |
| 1 frame, JSON out (~111 tokens) | **6.2 s warm** (decode 2.4 s at ~46 tok/s; the other ~3.7 s is the vision encoder + fixed per-request overhead, which Ollama does not report in `prompt_eval_duration`) | measured |
| 3 frames, JSON out | **6.0–6.5 s warm**, i.e. a batch is nearly free versus one frame — prefill of 2442 image+prompt tokens took 1.9 s uncached, 0.02 s cached | measured |
| Budget per fresh 3-frame batch on real frames | **6–9 s** (warm figure + uncached prefill) | measured + margin |
| Motion gate | ~2 ms/frame at 320×180 | MOG2 is per-pixel; unverified until hour 1 |
| YOLO-World (`yolov8s-worldv2`) on MPS | 7.4 to 8.3 ms/frame median at 448×252 in the bench (1 to 20 prompts), ~13 ms in the live lane; first `set_classes()` 4.0 s in the bench, 3.1 s re-measured | the bench at `56e2237`; the as-shipped table above |
| Steady-state VLM duty while she is in view | 1 call/60 s ≈ 6–9 s busy → **~10–15 % of the GPU** | rules in §3.4 |
| Time from "takes a bite" to sentence on the phone, `--demo` + `DEMO_FAST` | **~25–40 s** (2 keyframe batches 15 s apart + one 6–9 s inference + WS push) | arithmetic on the above |
| Memory | **10 GB** VLM resident at Ollama's default 32k context (`ollama ps`); set `num_ctx: 8192` in `options` to drop that to ~7 GB. +1 GB YOLO/torch, +0.4 GB embedder | measured |

Consequences drawn at the time, and what became of them: (1) the decode is the cost we control:
`evidence` is now asked for under 70 characters and `num_predict` is 150; (2) `num_ctx: 8192`:
not set, moot at one small frame; (3) **the very first structured call returned an empty
`content` with 220 tokens generated**: `call()` validates with `Observation.model_validate_json`,
retries once with the schema, then raises and the worker drops the batch and counts it
(`dropped_batches` in the heartbeat); (4) a warm-up call at worker start: done by `make vlm`
rather than the worker, and the model stays resident with `keep_alive: -1`. The `qwen3-vl:4b`
fallback was overtaken by the switch to `qwen2.5vl:3b` (§3.1).

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
| Frames | Never. No endpoint returns image bytes; the API process never has one. The monitor tick (§6.1) carries normalised box geometry, never pixels, and `MonitorIn` rejects pixel coordinates. | At most `batch_size` (1) JPEG in RAM, freed on flush. Nothing on disk, ever. No `frames/` directory exists. |
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
one we must not build — `docs/frontend-DESIGN.md` rule 3 and `PRODUCT_SPEC.md` §8.2 both say evidence
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
  is paused, **404** for an unknown camera or a camera not registered to that resident, and writes
  nothing in either case (`_live_camera` in `routers/camera.py`). `POST /ingest/camera/monitor`
  goes through the same check: a paused camera that kept streaming its console would be the pause
  not meaning anything. A rogue or stale worker cannot create an observation or a tick. On a 403
  the worker sets itself to *no consent* and stops the camera until the next config poll says
  otherwise.
- **Consent gates are not authentication.** The API has none (§6.1): any process on the LAN can
  call every route. What these gates enforce is that the *system* cannot observe her without her
  consent, whoever asks; they protect the resident from the system, not the server from the
  network. A reader who sees "no auth" must not conclude "no checks": consent off, paused,
  unknown camera, `resume` after her own pause, and `DELETE /memory` without her name typed all
  still refuse, and `tests/test_camera.py` pins each one.
- Family app: `Settings → Camera → Stop the camera` sets `consent_camera: 0`; the worker stops
  within 10 s, and there is no way to turn it back on from the app.
- The Camera console can also pause for two hours (`POST /cameras/{id}/pause`, recorded as
  `paused_by: "family"`). This sentence used to read "there is no family-side *pause*"; the console
  made that false, so it is corrected here rather than left as a contradiction a reader has to
  resolve. **The rule that matters is untouched**: `PRODUCT_SPEC.md` §8.3 rule 1 forbids a
  family-side override of *a resident control*, and `POST /cameras/{id}/resume` returns **403**
  when `paused_by == "resident"`. Dan can stop the camera and he can pause it; he cannot undo
  Margaret's pause, and `p` on the hub preview still wins. A pause only ever removes observation,
  so it cannot leak anything — the asymmetry to protect is the *un*-pause, and that is enforced
  in code, with a test.

---

## 6. Backend work

### 6.1 Endpoints, frozen contract (`./API_CONTRACT_V3.md` is the authority; this table follows it)

**No auth, anywhere.** The `X-Band-Key` and `Authorization: Bearer <API_KEY>` checks, `POST
/auth/login`, the `users` collection and the websocket token were all removed after this plan was
written (`da6cf31`; 21 auth tests went with them). The API has no authentication or authorization
of any kind: anything that can reach the port can read every resident's history, post observations
as any camera, pause and resume cameras, and delete a resident's memory (the DELETE still asks for
her name, which is a confirmation, not a credential). CORS is wide open. Demo build for one laptop
on one LAN; the notice at the top of `backend/app/main.py` says so. The worker still sends
`X-Band-Key` (`--band-key`, default `band-dev-key`) and the server ignores it. The `Auth` column
below names the caller lane and nothing checks it. The consent gates in §5.6 are unaffected and
still fail closed. Ids come back as `id`, timestamps ISO-8601.

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/ingest/camera` | device | `{camera_id, resident_id, ts, span_s, n_frames, person_count, activity, posture, movement, spot, assistive_device, plate_or_cup_present, food_visible, hand_to_mouth_observed, confidence, evidence, model, latency_ms, simulated}` (all enums as in §3.5 plus `"absent"`; `food_visible` added after the plan and silently dropped by the API until `ObservationIn` declared it) | `201 {observation_id, presence, event_ids: []}`; `403` when consent off/paused; `404` unknown camera; `422` bad enum |
| POST | `/ingest/camera/heartbeat` | device | `{camera_id, state: "watching"\|"paused"\|"offline"\|"no_consent", paused_until?, fps, dropped_batches}` | `204`; a state change emits `camera_online` / `camera_paused` / `camera_offline` and a `paused` heartbeat records `paused_by: "resident"` |
| POST | `/ingest/camera/monitor` | device | `MonitorIn`, below | `204`; `403` consent off/paused; `404` unknown camera; `422` a box outside 0..1 or a bad `gate` |
| GET | `/cameras?resident_id=` | app | — | `[{id, resident_id, state, consent, paused_until, last_heartbeat_at, online}]`; `online` is heartbeat-based (stale after `HEARTBEAT_STALE_S = 75`, two missed 30 s beats) |
| GET | `/cameras/{id}/monitor` | app | — | `{camera, online, tick}`; `tick` is the last one received, or `null` when none has arrived or the last is older than `MONITOR_STALE_S = 15`; never a fabricated tick |
| POST | `/cameras/{id}/pause` | app | `{hours}` (0 < h ≤ 24, default 2) | `{paused_until, paused_by: "family", presence}`; drops the live tick |
| POST | `/cameras/{id}/resume` | app | — | `{paused_until: null, presence}`; **403** when `paused_by == "resident"` |
| GET | `/camera/config?camera_id=` | device | — | `{resident_id, name, consent_camera, paused_until, zone, zone_label, zone_hint, appearance, spots_line, demo_fast}` |
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

**The monitor channel** (`API_CONTRACT_V3.md` "V3.1"). A live console for the hub and the app,
built after the plan. The worker posts a tick at most once a second (`TUNING["monitor_s"]`):

```
MonitorIn = {camera_id, ts, fps, person_count (0..6), boxes: [[x0,y0,x1,y1] × ≤6, each 0..1],
             gate: "idle"|"motion"|"person"|"thinking", model, latency_ms, batch_frames,
             activity?, sentence? (≤180), confidence?, simulated}
```

It is family-visible by decision: counts, normalised box geometry and the same activity/spot
sentence `GET /presence` already returns. It carries no zone, no `evidence`, no posture, no
movement quality and no pixel, and **`MonitorIn` is what enforces that**: a Pydantic model is an
allowlist, a field it does not declare simply vanishes, so a worker that started sending
`evidence` could not leak it by accident; someone would have to add the field, next to the
paragraph that says not to. Boxes are normalised 0..1 and a pixel coordinate is a 422, because a
box in a 448×252 buffer is one step closer to reconstructing a frame than a fraction is.
`sentence` goes through `rag.scrub_rooms` like every other family string. The tick is kept in a
module-level dict on the API, never in Mongo: telemetry at 1 Hz with a useful life of one second.
Ceiling: resets on restart, per API worker. It is broadcast on `/v1/live` as
`{"t": "camera.monitor", ...tick, resident_id}`. Six tests in `tests/test_camera.py` cover it,
including that it fails closed exactly as the ingest does and that zone / evidence / posture /
movement cannot ride on it.

Websocket messages on `/v1/live`: `event.new` (every event), `presence.update`
(`{"t": "presence.update", "resident_id", "presence": <same as GET>}` after every observation,
heartbeat state change, pause, resume and memory delete), `camera.monitor` (above), `alert.update`.

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
- `app/rag.py` **edit** — pool widening to `profile_facts`, kind tagging, quota, time-window parsing, surveillance guard, prompt rules, `scrub_rooms` (public, not `_scrub_rooms`), Ollama text fallback (`CHAT_FALLBACK_MODEL`, called with no images; `./dev.sh` defaults it to `qwen2.5vl:3b`, the model already resident for the camera lane, so Ask gets real prose with no key and no extra download; unset, the fallback is the kind-grouped template; `llm.py` is untouched because `tests/test_llm.py` pins its None-without-key behaviour).
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

**Family-facing wording for pattern rows, added after the plan.** A `baseline_deviation`'s
`embedding_text` is written for retrieval and staff and carries the raw value, the baseline and
the z-score (*"longest inactivity s was 14340 (baseline 8040.0, z=3.50)"*). That is a debug line,
so `baseline.py::_family_text` also writes `payload.narrative`, one plain sentence with no
feature slug, no z-score and no number a daughter would have to convert out of seconds (*"Asha
went about 4 hours without moving. She usually settles for about 2 hours."*), and `/activity`,
`/summaries` and chat citations all prefer `payload.narrative` over `embedding_text`. The daily
narrative template (`rag._template_narrative`, used with no OpenAI key) is prose: no leading date
stamp, no *"had 33 recorded events"*, no *"3 meal(s)"*; meals are named rather than counted
because *"she ate breakfast and dinner"* is something a search for *has she been eating* can
match. Both are written without em dashes, which `docs/frontend-DESIGN.md` bans in user-facing
copy. `/activity` and `/summaries` also collapse repeated rollups to the newest row per day and
per feature, so a day rolled up twice does not show the same fact two ways.

---

## 7. Frontend work

Aesthetic, documented in `docs/frontend-DESIGN.md`: *a
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
| `app/login.tsx` **deleted since: there is no login** (was:) | Wordmark in Fraunces 900, one line *"Someone is looking out for her."*, email + password, *Sign in*, a quiet *Use the demo account* link that prefills `priya@dhyaan.demo` / any password. Calls `api.login()`; 600 ms spinner; inline errors (bad email shape, empty password, server unreachable). Session holds `user` in memory (ponytail: no persistence — reload = sign in again, which reads as real). | — |
| `app/index.tsx` **edit** | Routing: not onboarded → `/onboard/welcome`; else `/(family)`. No sign-in gate. Staff route unchanged. | — |
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
`backend/Makefile` (adds `vision`, `vision-demo`, `vlm` targets), `./backend-README.md` (a "Camera
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

Owns: everything under `frontend/src/`, `frontend/assets/images/grain.png`, `docs/frontend-DESIGN.md`
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
| 11–13 | `simulate` fallback verified with B; README section | `simulate` kinds; `login`; seed polish; `make test` green | Polish: entrance choreography, empty states, emoji grep, docs/frontend-DESIGN.md |
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

- `./dev.sh` (mongo, ollama, seed if empty, API with `DEMO_FAST=1` and
  `CHAT_FALLBACK_MODEL=qwen2.5vl:3b` by default), `make vlm` once, then `make vision-demo`
  (`python -m vision --source 0 --demo --preview --camera-id cam_mac_01`); `make vision-synthetic`
  if there is no webcam. Confirm `GET /presence` says `camera_off` → `out_of_view` within 15 s.
- Laptop on the table, lid open, webcam facing a chair and a small table with a **plate, a fork
  and a mug**. Laptop screen (the hub preview) mirrored to the projector **only for beat 2**.
- Phone on a stand, Expo Go, `USE_MOCKS=false`, LAN hotspot from the bag (not venue wifi),
  signed out. Phone mirrored via QuickTime for beats 1 and 3–6.
- Fallback: `POST /admin/simulate {kind: "meal"}` on a second phone; `--source demo.mp4` if the
  camera device fails. Never debug on stage.

### 10.1 On screen, in order (about 2:40)

| Beat | On screen | Said |
|---|---|---|
| 1 · 0:00–0:20 | Phone: opens straight to Home, there is no login. Home: **"Nothing yet today."** *The camera came on at 3:38 pm.* Four empty tiles. | *"This is Priya's app. Her mother Eleanor lives alone. The only thing running is one camera in her living room and this laptop. Nothing has happened yet."* |
| 2 · 0:20–0:45 | **Projector switches to the hub preview**: the presenter walks into frame; motion mask flickers, the green subject box appears, the text lines read `people 1  FOOD -`, then `FOOD sandwich` when the plate comes into view, and the status line shows the keyframe reason and `VLM queued`. | *"Every frame is dropped unless something moved. If something moved, a 25 MB detector that takes its vocabulary as plain words asks 'is that a person, is that food'. Only a keyframe goes to a vision model on this laptop, over loopback and nowhere else, and only to write the sentence. This screen is the last place a picture exists."* |
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

`./API_CONTRACT_V3.md`, `fixtures/camera_observation.json` and
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
§3.5 schema to `/api/chat` three times and prints Ollama's timing fields. Agent A was to copy it
into `backend/vision/bench.py` as the hour-0 sanity check. **Specified, not built:** no such file
exists in the repo. The detector bench that did the measuring for §3.3 lived in `testcam/`
(`bench.py`, seven backends, `README.md`, `FOOD.md`), was removed in `12d53ff` once its four
findings were in the shipped code, and is recoverable in full at `56e2237`. Its fixtures were
gitignored, so the per-photograph numbers quoted in §3.3 cannot be re-run from the repo; the
live-webcam and synthetic-frame numbers can, and were.

### Agent C → Agent B (frontend, hour ~6)

The app is built and green against the §6.1 contract, running on the mock facade
(`EXPO_PUBLIC_USE_MOCKS=true` — flipped in `frontend/.env` so the app is demoable
now; flip it back to `false` at the hour-8 checkpoint). Shapes are typed verbatim
in `frontend/src/lib/types.ts` and the real client is written in `lib/http.ts`.

What the app needs from B, in the order it breaks without them:

1. ~~`POST /auth/login`~~ — gone. Nothing gates the app; there is no auth
   (see `backend/app/main.py`).
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

### Docs pass, 2026-09-20 (camera lane and backend README)

Sections above the line were brought back in line with the code rather than
appended to, because a plan that describes a COCO detector and a 3-frame
`qwen3-vl:8b` call is not a plan anyone can build from. What changed: §3.1
(model shipped is `qwen2.5vl:3b`), §3.2 (448×252, `--source synthetic`,
preview), §3.3 (YOLO-World: vocabulary, thresholds, hysteresis, dedupe, warm-up,
degradation ladder, what got worse), §3.4 (post on change, one frame per call,
landmark posture, subject following), §3.5 (no schema on the first try,
`food_visible`, merge then post-rules, visitor detection off), §3.6 (episode
key, stale presence), §3.7 (as-shipped numbers; the plan's benchmark kept as
history), §5.2/§5.6 (monitor fails closed; consent is not auth), §6.1 (no auth,
the V3.1 routes and `MonitorIn`), §6.4/§6.5 (`CHAT_FALLBACK_MODEL` default,
family-facing wording), §10 (`dev.sh`, beat 2), Appendix (`bench.py` never
built; `testcam/` removed). Re-measured on this machine for this pass: detector
warm-up 3.1 s on MPS, `scene()` 11.5 ms median on empty synthetic frames.
Carried over from commits and the removed bench, not re-run: every
per-photograph score, the ~13 ms live median, the VLM timings.
