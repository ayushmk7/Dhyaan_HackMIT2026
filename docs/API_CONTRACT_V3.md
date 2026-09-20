# API contract V3 — the camera lane (frozen; build to this, do not renegotiate)

This is `VLM_PLAN.md` §6.1, verbatim, plus the wire details three agents need in
common. Where this file and `VLM_PLAN.md` §6.1 disagree, §6.1 wins.

**No auth.** The `X-Band-Key` and `Authorization: Bearer <API_KEY>` checks that
used to sit on these routes, and `POST /auth/login`, have been removed: the API
has no authentication or authorization at all (demo build for one LAN; the
notice at the top of `backend/app/main.py` says so). The `Auth` column below
names the caller lane, device or app, and nothing checks it. Everything is
under the `/v1` prefix. Ids come back as `id`, timestamps ISO-8601.

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/ingest/camera` | device | `{camera_id, resident_id, ts, span_s, n_frames, person_count, activity, posture, movement, spot, assistive_device, plate_or_cup_present, hand_to_mouth_observed, confidence, evidence, model, latency_ms, simulated}` (all enums as in §3.5 plus `"absent"`) | `201 {observation_id, presence, event_ids: []}`; `403` when consent off/paused; `404` unknown camera; `422` bad enum |
| POST | `/ingest/camera/heartbeat` | device | `{camera_id, state: "watching"\|"paused"\|"offline"\|"no_consent", paused_until?, fps, dropped_batches}` | `204` |
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

Websocket additions on `/v1/live`:
`{"t": "presence.update", "resident_id", "presence": <same as GET>}` after every
observation and heartbeat state change. `event.new` already fires.

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
| `CHAT_FALLBACK_MODEL` | *(unset)* | When set (the demo uses `qwen3-vl:8b`), chat answers fall back to a local Ollama text call when there is no Anthropic key. Unset, the fallback is a kind-grouped template answer. |

## New event types (§6.3)

`activity_observed`, `camera_online`, `camera_offline`, `camera_paused`,
`profile_updated`, `memory_deleted`. The three `camera_*` join
`NOISY_EVENT_TYPES` in `rag.py` — they are never retrieved and never shown.

## Notes that matter

- **The family never sees a room.** `zone` rides on the event for staff and the
  baseline learner, and is stripped server-side from `/activity`, `/presence`
  and every retrieval citation. A client-side filter is not a privacy control.
- **`/ingest/camera` fails closed.** No camera doc, consent off, or paused →
  nothing is written. A rogue or stale worker cannot create an observation.
- **No endpoint returns image bytes.** The API process never holds a frame.
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

The hub worker posts one small JSON tick per cascade cycle (at most 1/s, see
`vision/__init__.py TUNING["monitor_s"]`) so the app can render a live CCTV
console. It is **telemetry, not data**: the API keeps only the latest tick per
camera, in a module-level dict, and it is gone on restart. It is never written
to MongoDB and it is never an observation.

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/ingest/camera/monitor` | device | the tick, below | `204`; `403` consent off/paused; `404` unknown camera; `422` bad box or gate |
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
 "activity": "eating", "sentence": "eating at the table", "confidence": 0.82,
 "simulated": false, "resident_id": "res_eleanor"}
```

### Why this is family-visible, and what enforces it

A tick carries counts, normalised geometry and the same activity/spot sentence
`GET /presence` already returns. It carries **no zone, no evidence, no posture,
no movement quality and no pixel** — and `MonitorIn` in `app/routers/camera.py`
is what enforces that, because a Pydantic model is an allowlist: a field it does
not declare simply vanishes at the boundary. `sentence` goes through the same
`rag.scrub_rooms` filter `/activity` uses. `POST /ingest/camera/monitor` fails
closed exactly as `/ingest/camera` does — a paused camera has no live console,
or the pause would not mean anything.

### Pausing

`paused_by` is the whole control. The app writes `"family"`; the hub's own `p`
key writes `"resident"`. `POST /resume` refuses (**403**) to lift a pause it did
not set, which is `PRODUCT_SPEC.md` §8.3 rule 1 as a status code.

## One alert shape, REST and websocket

`GET /alerts/{id}`, `POST /alerts/{id}/ack`, `POST /alerts/{id}/resolve` and the
`{"t": "alert.update"}` websocket message now all go through one shaper
(`routers/residents.py::alert_response`), so they cannot drift. Two fields the
takeover screen needs are now on **both** paths:

```jsonc
{
  "id": "alt_...", "state": "MANUALLY_RESOLVED", ...,
  "closed_at": "2026-09-20T02:40:11+00:00",   // null unless the state is terminal
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

`GET /alerts` list rows carry `closed_at` too (no `ladder`; the list does not
render one).

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
