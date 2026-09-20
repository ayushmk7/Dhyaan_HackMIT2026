# API contract V3 — the camera lane (frozen; build to this, do not renegotiate)

This is `VLM_PLAN.md` §6.1, verbatim, plus the wire details three agents need in
common. Where this file and `VLM_PLAN.md` §6.1 disagree, §6.1 wins.

Device routes take `X-Band-Key` (the existing shared device secret; ceiling: one
key for band and camera, upgrade: per-device keys). App routes take
`Authorization: Bearer <API_KEY>`. Everything is under the `/v1` prefix. Ids come
back as `id`, timestamps ISO-8601.

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
curl -s -X POST -H "X-Band-Key: band-dev-key" -H "Content-Type: application/json" \
  -d @fixtures/camera_observation.json localhost:8000/v1/ingest/camera
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "X-Band-Key: band-dev-key" \
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
