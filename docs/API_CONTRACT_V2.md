# API contract V2 — setup, survey, ladder, demo trigger (as built)

Implemented in `backend/app/routers/setup.py`, plus the read routes in
`backend/app/routers/residents.py`. Prefix `/v1`. Ids come back as `id`, never
`_id`. Timestamps are ISO-8601 strings. Bad field -> `422`, unknown resident ->
`404`.

**No auth.** The header this file used to open with, `Authorization: Bearer
<API_KEY>`, no longer exists. `backend/app/deps.py` and `app/auth.py` were
deleted, `API_KEY` and `BAND_KEY` are gone from `config.py`, and nothing reads
a header on any route. The notice at the top of `backend/app/main.py` is the
authority: any process that can reach the port can do everything below. Demo
build for one laptop on one LAN; put real auth back before it leaves the LAN.

**Consent gates are not auth, and they all still run.** Nothing here checks who
you are; several things still check whether the resident said yes. Camera
ingest fails closed on consent off / paused / unknown camera, `POST
/cameras/{id}/resume` refuses (403) to lift a pause she set herself, `DELETE
/residents/{id}/memory` still wants her display name as `confirm`, and the
family filter still strips rooms server-side. See `API_CONTRACT_V3.md` for
those. "No auth" means no identity, not no checks.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/residents/{id}/baselines` | — | `[{feature, mu, mad, lam, n_obs, cold_start, last_value, updated_at, unit, direction}]`; sorted by `feature` |
| GET | `/residents/{id}/summaries?days=7` | — | `[{date, narrative, deviations: [{feature, severity, text}]}]`; **one story per day**, newest day first (see below) |
| GET | `/residents/{id}/location/history?date=YYYY-MM-DD` | — | `[{zone, from, to, seconds, method, confidence}]`; staff surface, names rooms |
| GET | `/events/{event_id}` | — | the event, or 404 |
| POST | `/admin/simulate` | `{resident_id, kind: "fall"\|"bathroom"\|"walk"\|"meal"\|"visitor"\|"out_of_view", script?}` | `fall`: `{event_id, alert_id}`; `bathroom`/`walk`: `{event_id}`; camera kinds: `{observation_ids, event_ids, presence}` |
| POST | `/admin/rollup` | `{resident_id, date}` (both required, `date` is resident-local `YYYY-MM-DD`) | `{resident_id, date, features, deviations, narrative}` |
| POST | `/bands/pair` | `{band_id, resident_id, force?: bool}` | `{ok, band: {id, resident_id, paired_at, ...}}`; `409` if the band is paired to someone else and `force` is not true |
| POST | `/residents/{id}/survey/start` | `{zone}` (one of `location.ZONES`, else 422) | `{survey_id, zone}` |
| POST | `/residents/{id}/survey/sample` | `{survey_id, beacons: [{uuid, major, minor, rssi}], wifi: [{bssid, rssi}]}` (at least one reading, `rssi` in -100..0) | `{survey_id, samples}` |
| POST | `/residents/{id}/survey/stop` | `{survey_id}` | `{zone, samples, stored: true}`; `422` under 3 samples and the survey stays open |
| PUT | `/residents/{id}/contacts` | `[{name, phone_e164, relationship, ladder_order}]` (non-empty; `phone_e164` is `+` and 8-15 digits) | `{ok, contacts: [...]}` with `ladder_order` renumbered densely from 1 |
| POST | `/residents/{id}/notes` | `{text (1-400 chars), author, role: "family"\|"staff"}` | the new event (`family_note` or `staff_note`, `source: "manual"`) |
| POST | `/push/register` | `{token, resident_id?, role: "family"\|"staff"}` | `{ok}` |

Notes that matter:

- **`/admin/simulate` is the demo trigger.** It produces a *real* event through
  the real ingest path so the FSM, the websocket and the app all behave exactly
  as they would for a band or a camera, and every payload carries `simulated:
  true`. `fall` calls `ingest_band()` in-process, so the resident needs a paired
  band (`422` otherwise). `meal`/`visitor`/`out_of_view` post a canned observation
  sequence through `ingest_camera()` (V3, the on-stage fallback if the webcam
  misbehaves) and need a camera on the profile (`422` otherwise). `bathroom` and
  `walk` write one event directly. `script` (`okay`, `distress`, `fell_but_fine`,
  `no_answer`, `silence`) sets which way the stubbed check-in call goes, so two
  demo runs can end differently without restarting the server; ignored once real
  telephony is installed.
- **`/admin/rollup` is the other demo button.** It runs `baseline.rollup` and
  `rag.daily_narrative` for one resident-day now instead of at 03:30 local. Every
  run *appends* a fresh `daily_summary` and a fresh `baseline_deviation` per
  feature; nothing is superseded on write. The reads compensate: `/summaries`
  groups by `payload.date_local` and keeps the newest row per day (and the
  newest deviation per feature), `/activity` (V3) does the same. Upgrade:
  supersede on write in `rag.daily_narrative`.
- **`baseline_deviation` carries two texts.** `embedding_text` is the machine
  line (value, baseline, z-score) for retrieval and staff; `payload.narrative` is
  the family sentence written by `baseline._family_text`. `/summaries`,
  `/activity` and chat citations prefer `payload.narrative` when present.
- **The survey endpoints feed `app/location.py`'s fingerprint store.** `stop`
  writes the collected RSSI vectors into the `fingerprints` collection for that
  zone, replacing any earlier survey of the same zone. That is what makes room
  classification work in a new building. In-progress surveys live in a
  process-local dict: a restart mid-survey drops them, nothing durable was
  promised.
- **`PUT /contacts` replaces the whole ladder** and renumbers `ladder_order`
  densely from 1. A gap in the ladder silently skips a person during an
  escalation. Delete-then-insert, not atomic; a crash between the two loses the
  ladder.
- **`/push/register` stores the token in a `push_tokens` collection keyed by the
  token**, not "on the contact" as the first draft said: the request carries no
  contact id and there is no staff collection to attach it to. Sending a push is
  Expo's job and is not this endpoint's business. Nothing in the backend sends a
  push yet.

The core read and alert routes (`GET /residents`, `/timeline`, `/day`,
`/location`, `/alerts...`, `WS /live`) are in `TECHNICAL_PRD.md` §10.5, which is
the route census for the whole API as built.
