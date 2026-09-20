# API contract V3 — the camera lane (frozen; build to this, do not renegotiate)

This is `VLM_PLAN.md` §6.1, verbatim, plus the wire details three agents need in
common. Where this file and `VLM_PLAN.md` §6.1 disagree, §6.1 wins.

**No auth.** The `X-Band-Key` and `Authorization: Bearer <API_KEY>` checks that
used to sit on these routes, and `POST /auth/login`, have been removed: the API
has no authentication or authorization at all (demo build for one LAN; the
notice at the top of `backend/app/main.py` says so). The `Auth` column below
names the caller lane, device or app, and nothing checks it. Everything is
under the `/v1` prefix. Ids come back as `id`, timestamps ISO-8601.

**Consent gates are not auth, and every one of them survives.** Read this
before assuming "no auth" means "no checks". Nothing asks who the caller is;
these still ask whether the resident said yes, and they fail closed:

| Gate | Where | What it does |
|---|---|---|
| Camera ingest | `_live_camera` in `routers/camera.py`, on `/ingest/camera`, `/ingest/camera/monitor` and `/ingest/camera/frame` | `404` unknown `camera_id` or camera not registered to that `resident_id`; `403` `consent_camera` off; `403` `paused_until` in the future. Nothing is written or buffered on any of those |
| Her pause wins | `POST /cameras/{id}/resume` | `403` when `paused_by == "resident"`. The app can only lift a pause the app set, and that is ownership, not liveness: an expired pause of hers is still hers |
| A heartbeat cannot undo a pause | `POST /ingest/camera/heartbeat` | The hub reports what it is doing; it never writes `paused_until` or `paused_by` over a `family` pause. One `watching` tick used to erase a pause the app had just set and reopen the ingest gate |
| Memory needs consent | `POST /residents/{id}/profile/facts` | `403` when `consent_memory` is off; `/camera/config` withholds `appearance` and `spots_line` for the same reason |
| Deleting is deliberate | `DELETE /residents/{id}/memory` | `422` unless `confirm` equals `display_name` exactly. A confirmation, not a credential |
| The family never sees a room | `_family_item`, `rag.search(family=True)`, `rag.FAMILY_EXCLUDED_TYPES`, `rag.scrub_rooms`, `MonitorIn` | Applied server-side on `/activity`, `/presence`, `/timeline`, `GET /events/{id}`, `/chat` citations, the `event.new` socket message and the monitor tick, unconditionally, because there is no role to condition on |

These protect the resident from the system. They do not protect the server
from the network; that is what the deleted auth did, and nothing does now.

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/ingest/camera` | device | `{camera_id, resident_id, ts, span_s, n_frames, person_count, activity, posture, movement, spot, assistive_device, plate_or_cup_present, food_visible, hand_to_mouth_observed, confidence, evidence, model, latency_ms, simulated}` (all enums as in §3.5 plus `"absent"`; `food_visible` is broader than `plate_or_cup_present`: food in a hand, a wrapper, a snack) | `201 {observation_id, presence, event_ids: []}`; `403` when consent off/paused; `404` unknown camera; `422` bad enum |
| POST | `/ingest/camera/heartbeat` | device | `{camera_id, state: "watching"\|"paused"\|"offline"\|"no_consent", paused_until?, fps, dropped_batches}` | `204` |
| GET | `/camera/config?camera_id=` | device | — | `{resident_id, name, consent_camera, paused_until, zone, zone_label, zone_hint, appearance, spots_line, demo_fast}` |
| GET | `/residents/{id}/presence` | app | — | `{status: "in_view"\|"out_of_view"\|"paused"\|"camera_off"\|"no_camera", activity, spot_is_usual, since, last_observation_at, sentence, camera: {online, consent, paused_until, paused_by}}` — **no zone, no evidence**. `paused_until` and `paused_by` are reported only while the pause is still live; `camera.online` is heartbeat-based (`HEARTBEAT_STALE_S`), not `state` alone |
| GET | `/residents/{id}/activity?date=YYYY-MM-DD` | app | — | `{date, tiles: {meals, walks, out_of_house, night_ups, in_view_minutes}, items: [{id, ts, ts_end, type, sentence, kind: "observed"\|"pattern", confidence}]}` — family filter applied, `zone` stripped |
| GET | `/residents/{id}/profile` | app | — | `{name, appearance, consent: {falls, camera, memory, signed_by, relationship, signed_at}, camera: {camera_id, zone, zone_hint, state, paused_until}, usual_spots: [string], facts: [Fact]}` |
| PUT | `/residents/{id}/profile` | app | `{name?, appearance?, consent?: {...}, camera?: {zone, zone_hint}}` | the profile; `422` for bedroom/bathroom zone, appearance > 200 chars |
| POST | `/residents/{id}/profile/facts?author=` | app | `[{key, text}]` (1–40 items, key ≤ 40, text ≤ 300); `author` query param defaults to `"the family"` and is overridden by `consent_signed_by` when set | `{facts: [Fact]}` — embedded synchronously; `403` when `consent_memory` is off |
| PUT | `/residents/{id}/profile/facts/{fact_id}` | app | `{text}` | `{fact: Fact}` (the new row; old row deactivated) |
| DELETE | `/residents/{id}/profile/facts/{fact_id}` | app | — | `{ok}` (deactivates) |
| DELETE | `/residents/{id}/memory` | app | `{scope, confirm}` | `{deleted: {profile_facts, observations, camera_events, usual_spots: bool}}`; `422` if `confirm != display_name` |
| POST | `/residents/{id}/chat` | app | `{question}` | **extended**: `{answer, citations: [{id, kind: "observed"\|"told"\|"pattern", ts, text}], retrieved_count, refused, refusal_kind}` |
| POST | `/admin/simulate` | app | **extended** `kind: "meal"\|"visitor"\|"out_of_view"` | posts a canned observation sequence through the real ingest path (the on-stage fallback if the webcam misbehaves) |

`Fact = {id, key, text, source, author, active, supersedes, superseded_by, created_at}`.

Websocket additions on `/v1/live`:
`{"t": "presence.update", "resident_id", "presence": <same as GET>}` on every
observation, every heartbeat state change, `POST /cameras/{id}/pause`,
`POST /cameras/{id}/resume` and `DELETE /memory` — but only when the presence a
person could see actually changed. A live camera posts two or three
observations a second, each one handed the app a new presence object, and the
home screen re-rendered at that rate with its hero re-mounting because it is
keyed on the sentence. `_push_presence` compares status, activity,
`spot_is_usual`, `since`, sentence and the camera block, and drops the push when
they match; `last_observation_at` is deliberately not in that comparison,
because it moves on every observation and the app's own refetch timer is the
right cadence for "noticed 4 minutes ago". `event.new` already fires. The full
message census for the socket is in V3.1 below.

---

## Enums (§3.5) — the trust boundary rejects anything else with 422

```
activity           eating drinking sitting reading watching_tv using_phone standing
                   walking exercising lying_down on_floor entering leaving
                   with_visitor unclear absent
posture            upright seated reclined on_floor unclear
movement           stationary slow normal unsteady unclear
spot               table armchair sofa doorway counter window floor other unclear
assistive_device   none cane walker wheelchair unclear
zone               kitchen living_room dining_room hallway     (bedroom/bathroom -> 422)
camera state       watching paused offline no_consent
```

`person_count` is `0..6`, `confidence` is `0..1`, `evidence` is ≤ 180 chars,
`appearance` ≤ 200 chars, fact `text` ≤ 300 chars.

## Fixtures

`fixtures/camera_observation.json` and `fixtures/camera_heartbeat.json` are the
worker's contract, exactly as the band fixtures are. They post as-is:

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d @fixtures/camera_observation.json localhost:8000/v1/ingest/camera
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H "Content-Type: application/json" \
  -d @fixtures/camera_heartbeat.json localhost:8000/v1/ingest/camera/heartbeat
```

## Environment switches

| Var | Default | Effect |
|---|---|---|
| `DEMO_FAST` | off | Scales every dedup gap and minimum duration to a tenth, so a 30-second stage lunch becomes one `meal_observed`. Reported back to the worker as `demo_fast` on `/camera/config`. |
| `CHAT_FALLBACK_MODEL` | *(unset)* | When set (`dev.sh` defaults it to `qwen2.5vl:3b`, the camera lane's model called with no images), chat answers fall back to a local Ollama chat call when there is no OpenAI key. Unset, the fallback is a kind-grouped template answer. |
| `VISION_STREAM` | on | The worker's annotated-frame push (`POST /ingest/camera/frame`). `VISION_STREAM=0` turns it off and the app's camera screen shows no picture; everything else is unchanged. |

## New event types (§6.3)

`activity_observed`, `camera_online`, `camera_offline`, `camera_paused`,
`profile_updated`, `memory_deleted`. The three `camera_*` join
`NOISY_EVENT_TYPES` in `rag.py` — they are never retrieved and never shown.

## Notes that matter

- **The family never sees a room.** `zone` rides on the event for staff and the
  baseline learner, and is stripped server-side from `/activity`, `/presence`,
  `/timeline`, `GET /events/{id}`, the `event.new` socket message and every
  retrieval citation. A client-side filter is not a privacy control: the app's
  own `scrubRooms` only ever knew seven room names, and the raw record was
  reaching the phone either way.
- **`/ingest/camera` fails closed.** No camera doc, consent off, or paused →
  nothing is written. A rogue or stale worker cannot create an observation.
- **No endpoint returns image bytes** — **relaxed for the demo in V3.1.** The
  rule held until the app grew a camera screen: `POST /ingest/camera/frame` and
  `GET /cameras/{id}/frame` now carry one annotated JPEG per camera, in RAM,
  5 s old at most. Nothing else changed — no frame is written to disk on either
  side, nothing goes to Mongo, the ingest fails closed on consent and the pause
  like every other device route, and a `POST /pause` drops the buffered frame.
  What the relaxation costs is stated where the routes are, under *The picture
  channel*.
- **Dedup lives in `app/presence.py`, not the worker.** The same lunch must not
  become six events: observations fold into one interval per
  `(resident_id, event_type)`, closed by a 30 s sweeper.
- **`DELETE /memory` really deletes**: `profile_facts` rows, `observations`,
  every `source: "camera"` event, `residents.appearance` and `usual_spots`.
- **Chat citations carry `kind`** so the app can render *You told us* /
  *Dhyaan saw* / *From her pattern*. A family must always be able to tell what
  was observed from what was assumed.

---

# V3.1 — the live monitor, the camera list, and one alert shape

Added after the first end-to-end run. Nothing above changed; everything below is
new surface. Same rules as above: no auth on anything, the `Auth` column is
the caller lane only, everything is under `/v1`.

## The monitor tick

The hub worker posts one small JSON tick per cascade cycle (about 3/s — see
`vision/__init__.py TUNING["monitor_s"]`, default 0.33 s, `MONITOR_S` to
override) so the app can render a live CCTV console. One a second was a
readable rate for a log and a visibly laggy one next to a 5 fps picture: the
words trailed the frame they described. It is **telemetry, not data**: the API
keeps only the latest tick per camera, in a module-level dict, and it is gone on
restart. It is never written to MongoDB and it is never an observation.

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/ingest/camera/monitor` | device | the tick, below | `204`; `403` consent off/paused; `404` unknown camera; `422` bad box or gate |
| POST | `/ingest/camera/frame?camera_id=` | device | one JPEG, `Content-Type: image/jpeg` | `204`; `400` empty body; `413` over `FRAME_MAX_BYTES` (512 KB); `403` consent off/paused; `404` unknown camera |
| GET | `/cameras/{camera_id}/frame` | app | — | `image/jpeg`, `Cache-Control: no-store`; `404` when there is no frame or the last one is older than `FRAME_STALE_S` (5 s) |
| GET | `/cameras` | app | — (optional `?resident_id=`) | `[{id, resident_id, state, consent, paused_until, last_heartbeat_at, online}]` |
| GET | `/cameras/{camera_id}/monitor` | app | — | `{camera, online, tick}` — see below; `404` unknown camera |
| POST | `/cameras/{camera_id}/pause` | app | `{hours: float}` (0 < h ≤ 24, default 2) | `{paused_until, paused_by: "family", presence}` |
| POST | `/cameras/{camera_id}/resume` | app | — | `{paused_until: null, presence}`; **`403` if she paused it herself** |

```jsonc
// POST /v1/ingest/camera/monitor   — the tick, exactly
{
  "camera_id": "cam_mac_01",
  "ts": "2026-09-20T02:55:47.883016+00:00",
  "fps": 3.1,
  "person_count": 1,                       // 0..6
  "boxes": [[0.31, 0.34, 0.75, 0.99]],     // NORMALISED 0..1 x0,y0,x1,y1 — never pixels, max 6
  "gate": "person",                        // "idle" | "motion" | "person" | "thinking"
  "model": "qwen2.5vl:3b",
  "latency_ms": 690,                       // of the last VLM call
  "batch_frames": 1,
  "activity": "eating",                    // the §3.5 enum, or null before the first observation
  "posture": "seated",                     // console only — see below; or null
  "food": ["cereal"],                      // what the open-vocabulary pass named, ≤ 8 words of ≤ 24 chars
  "dishes": ["bowl"],
  "seating": ["dining chair"],
  "sentence": "eating at the table",       // activity + spot, scrubbed; "" before the first one
  "confidence": 0.82,                      // or null
  "simulated": false                       // true on --source synthetic
}
```

```jsonc
// GET /v1/cameras/{camera_id}/monitor   — live
{
  "camera": {"id": "cam_mac_01", "resident_id": "res_eleanor", "state": "watching",
             "consent": true, "paused_until": null,
             "last_heartbeat_at": "2026-09-20T02:55:44+00:00", "online": true},
  "online": true,
  "tick": { ...the tick above, plus "resident_id" }
}

// GET /v1/cameras/{camera_id}/monitor   — nothing heard, or heard too long ago
{"camera": {...}, "online": false, "tick": null}
```

Two different `online`s, on purpose: `camera.online` is the 30 s heartbeat ("is
the worker running"), the top-level `online` is a tick newer than 15 s ("is the
console live"). **`tick` is `null` rather than a stale or invented one** — a
console that makes up a frame count is worse than one that admits it has not
heard anything.

Websocket, on the existing `/v1/live`, fired on every tick:

```jsonc
{"t": "camera.monitor", "camera_id": "cam_mac_01", "ts": "...", "fps": 3.1,
 "person_count": 1, "boxes": [[0.31, 0.34, 0.75, 0.99]], "gate": "person",
 "model": "qwen2.5vl:3b", "latency_ms": 690, "batch_frames": 1,
 "activity": "eating", "posture": "seated", "food": ["cereal"],
 "dishes": ["bowl"], "seating": ["dining chair"],
 "sentence": "eating at the table", "confidence": 0.82,
 "simulated": false, "resident_id": "res_eleanor"}
```

### Why this is family-visible, and what enforces it

A tick carries counts, normalised geometry, the posture and the structural words
the detector is working from, and the same activity/spot sentence `GET /presence`
already returns. It carries **no zone, no evidence, no movement quality and no
pixel** — and `MonitorIn` in `app/routers/camera.py` is what enforces that,
because a Pydantic model is an allowlist: a field it does not declare simply
vanishes at the boundary. `sentence` goes through the same `rag.scrub_rooms`
filter `/activity` uses. `POST /ingest/camera/monitor` fails closed exactly as
`/ingest/camera` does — a paused camera has no live console, or the pause would
not mean anything.

`posture`, `food`, `dishes` and `seating` are on the console and nowhere else.
They used to stop at the hub, and a family screen got *"she is sitting at the
table"* with nothing under it; the console is the one screen whose whole job is
to show what the camera is working from, and *why did it decide that?* is
unanswerable without them. Every other surface is untouched: `_family_item` and
`rag.search(family=True)` are unchanged, so no observation, no timeline row and
no chat answer carries a posture. Adding a field here is therefore a decision to
show it to the family, which is why this paragraph sits next to the model.

### The picture channel

The app's camera screen shows the same annotated picture the hub's `--preview`
window shows: subject box in green, everyone else grey. The worker encodes one
JPEG in memory at about 5 fps (quality 60, dropped rather than queued when the
network is slow) and POSTs it to `/ingest/camera/frame`; the API holds exactly
one frame per camera in a module-level dict and hands it to
`GET /cameras/{id}/frame`, which 404s rather than serve one older than five
seconds. A picture that is quietly thirty seconds old is the one failure this
screen must not have — shorter than the tick's fifteen, because a stale sentence
is merely old and a stale picture is actively wrong about the room right now.

This is a **demo-only relaxation** of the camera lane's oldest rule, and it is
worth being blunt in the place someone will read it: until V3.1 nothing but the
hub's own window ever saw a pixel, and the app got geometry and a sentence. What
has not changed: no frame is written to disk on either side (the AST test in
`tests/test_vision_gate.py` still forbids `imwrite`/`VideoWriter`, and this path
encodes to memory), nothing reaches MongoDB, the buffer is overwritten several
times a second, consent off, paused or unknown camera means the worker cannot
post at all, and `POST /cameras/{id}/pause` drops the buffered frame along with
the tick. What it costs: on this build there is no auth on any route,
so anything on the same LAN can pull the frame. `VISION_STREAM=0` turns the
push off. Before this is ever more than a demo, the route goes behind auth and
behind the resident's consent record, and the family screen asks for the stream
rather than receiving it by default.

### Pausing

`paused_by` is the whole control, and it records **who owns the pause**, not who
is currently looking. The app writes `"family"` (`POST /cameras/{id}/pause`);
the hub's own `p` key writes `"resident"`, via the `state: "paused"` heartbeat.
Three rules, and they are three because each one was a separate way to lose a
pause:

1. **A heartbeat can never erase a pause the server set.** The heartbeat reports
   what the hub is doing. It writes `paused_until` only on a `paused` tick, and
   it writes `paused_by: "resident"` only when the camera is not already owned by
   `"family"`. Before that, one `watching` tick erased a pause the app had just
   set and reopened the fail-closed ingest gate, and one `paused` tick relabelled
   the family's own pause as hers, so their Resume started returning `403` a
   heartbeat later.
2. **A resident-owned pause cannot be lifted by the family.** `POST /resume`
   returns **403** whenever `paused_by == "resident"` — on ownership, not on
   liveness. An expired pause of hers is still hers to lift, so `/resume` checks
   `paused_by` alone and does not also test whether `paused_until` is still in
   the future. This is `PRODUCT_SPEC.md` §8.3 rule 1 as a status code.
3. **A resident-owned pause is lifted by her hub looking again.** A `watching`
   heartbeat clears `paused_until` and `paused_by` when the camera is not
   family-owned. That is the only thing that clears hers; `POST /resume` is the
   only thing that clears the family's.

One consequence worth knowing before it surprises someone: `GET /presence`
reports `camera.paused_by` only while the pause is live, so after a resident
pause expires the app sees `paused_by: null` and `/resume` still answers `403`.
The rule above is the contract; the presence shape is the thing that does not
say enough (`DECISIONS.md` F-17).

## One alert shape, REST and websocket

`GET /alerts/{id}`, `POST /alerts/{id}/ack`, `POST /alerts/{id}/resolve` and the
`{"t": "alert.update"}` websocket message now all go through one shaper
(`routers/residents.py::alert_response`), so they cannot drift. Two fields the
takeover screen needs are now on **both** paths:

```jsonc
{
  "id": "alt_...", "state": "MANUALLY_RESOLVED", ...,
  "closed_at": "2026-09-20T02:40:11+00:00",   // null unless the state is terminal
  "cancel_window_s": 30,                      // config.CANCEL_WINDOW_S; the takeover's countdown ring
  "ladder": [
    {"step": "suspected",       "at": "...", "detail": "A fall was suspected.",
     "outcome": null, "from_state": null, "state": null},
    {"step": "cancel_window",   "at": "...", "detail": "Waiting half a minute, in case it was nothing.",
     "outcome": "window_open", "from_state": "SUSPECTED", "state": "LOCAL_CANCEL"},
    {"step": "acknowledged",    "at": "...", "detail": "Priya is on it. The ladder has stopped.",
     "outcome": "ack", "from_state": "LOCAL_CANCEL", "state": "ACKNOWLEDGED"}
  ],
  "calls": [...], "trigger_event": {...}
}
```

`step` is the app's vocabulary, not the FSM's: `suspected`, `cancel_window`,
`calling_resident`, `no_answer`, `calling_contact_1`, `calling_contact_2`,
`escalated_final`, `acknowledged`, `cancelled`, `exhausted`, `resolved`. The FSM
has more states than the screen has phases on purpose — the family does not need
the difference between `RETRY_RESIDENT` and `VOICEMAIL`, both of which mean "she
hasn't picked up". `detail` is the sentence the timeline prints. Nothing is
stored for this: it is projected on read from the transition events
`alerts.py::_apply` already writes (TECHNICAL_PRD §4.3). `closed_at` is
`resolved_at ?? updated_at` when the state is terminal, else `null` — the app
must stop computing it client-side.

`cancel_window_s` is on the shape because the app used to hardcode 30 while the
server read `CANCEL_WINDOW_S` from the environment; a stage run with a shortened
window had the ring counting down to a call that had already been placed.

`GET /alerts` list rows carry `closed_at`, `resident_name` and `room` (no
`ladder`, no `calls`, no `cancel_window_s`; the list does not render them).
`GET /residents` rows carry `phone_e164` (her own line, so "Call Eleanor" is not a
hardcoded number) and `open_alert` as the raw alert doc, without the projection.

## Every message on `WS /v1/live`

`/v1/live?resident_id=` scopes the socket to one resident; without it the socket
gets everything for everyone. No token. Server to client only; the server sends
`{"t": "ping"}` after 25 s of client silence, and whatever the client sends is
read and discarded.

| `t` | Fired by | Shape |
|---|---|---|
| `event.new` | every `events.emit()` whose type is not in `rag.FAMILY_EXCLUDED_TYPES` | `{t, event: {id, ts, ts_end, type, sentence, kind, confidence, resident_id}}` — the same `_family_item` shape `/activity` and `/timeline` return, plus `resident_id` so a client can route on it |
| `alert.update` | every FSM transition, ack, resolve | `{t, alert: <alert_response>}`, identical to `GET /alerts/{id}` |
| `presence.update` | observation, heartbeat state change, pause, resume, memory delete — and only when the presence changed | `{t, resident_id, presence: <GET /presence>}` |
| `camera.monitor` | every monitor tick | the tick, **flat**: fields spread into the envelope next to `t`, plus `resident_id` |
| `ping` | 25 s idle | `{t}` |

`event.new` used to be the one message that was not family-safe: it pushed the
raw Mongo doc, so `zone` and the raw `embedding_text` ("Asha moved into the
bathroom") reached every client on the LAN — the same D-001 leak `/timeline`
had. It now goes through the same `_family_item` shaper as `/activity` and
`/timeline`, so a row cannot be safe on one path and not the other, and the
whole categories in `FAMILY_EXCLUDED_TYPES` (`zone_entered`, ladder chatter) are
dropped before the fan-out rather than sent and hidden. (The `evidence` sentence
never reaches an event at all; it stays on the `observations` row.) There is
still no role on the socket: one shape goes to everyone, and it is the family
one. A staff socket that carries rooms is specified in `TECHNICAL_PRD.md` §10.5
and not built.

`broadcast` fans out in parallel with a **2 s per-socket deadline**, and a
socket that misses it is dropped and left to reconnect on its own backoff.
`events.emit()` awaits its subscribers, so this sits on the fall-ingest path:
one phone on bad venue wifi that never finished its send used to block every
other client's event and, behind the per-socket lock, queue the next one behind
it. Two seconds is long enough for a slow phone and short enough that the ladder
does not wait for it.

## `--source synthetic`: the lane with no webcam

```bash
DEMO_FAST=1 make run                       # or: DEMO_FAST=1 uvicorn app.main:app
python -m vision --source synthetic --camera-id cam_mac_01
```

A one-minute scripted day in a drawn living room: empty room (long enough to go
out of view) → she walks in → sits → eats at the table with a plate → crosses to
the armchair → a visitor joins her. One minute of it puts a **meal, a visitor and
a spell of moving about** on `/activity`, and leaves `/cameras/{id}/monitor`
returning a live tick with real boxes.

Everything downstream of perception is the real thing — keyframe rules, the
Ollama call (`qwen2.5vl:3b`), `POST /ingest/camera`, the dedup, presence, the
events, both websocket messages. What is scripted is **who is in the room**: no
detector and no 3B model reads a drawn figure as a person (measured: yolo11s
scores it 0.04, i.e. noise). Every row it produces carries `simulated: true`,
which is what makes that an admission rather than a lie. Without `DEMO_FAST=1`
it still works, it just needs a few minutes for the dedup's real thresholds.
