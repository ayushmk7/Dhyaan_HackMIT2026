# Dhyaan — backend

FastAPI + MongoDB. One process, one database, no message broker. Everything the
band, the app and the voice agent do becomes an **event**; alerts, baselines and
the chat are all readers of that one collection.

Specs: [`../TECHNICAL_PRD.md`](../TECHNICAL_PRD.md) · [`../HARDWARE_SPEC.md`](../HARDWARE_SPEC.md)

## Run it

```bash
make mongo     # docker mongo:7 on :27017
uv venv && uv pip install -e . --group dev
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
| RAG retrieval + citations + medical guardrail | Real plumbing, **weak ranking** — see below |
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

- **RAG ranking is weak offline.** Embeddings are a deterministic hash bag-of-tokens
  so tests and the demo run with no key and no wifi. Retrieval, citations and the
  medical guardrail are real; semantic ranking is not. Fix is one `ollama pull
  nomic-embed-text` and swapping `rag.embed` — do it before demoing the chat.
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
