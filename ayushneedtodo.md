# Ayush — backend core + perception/intelligence

Your lanes: **A (backend core)** and **C (perception + intelligence)**.
Not yours: voice and frontend are Abhinav's ([`abhinavtodo.md`](./abhinavtodo.md)), hardware is Utsav's ([`utsavtodo.md`](./utsavtodo.md)).

Source of truth: [`TECHNICAL_PRD.md`](./TECHNICAL_PRD.md) · [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md)

## Do these in the first 15 minutes

- [ ] **Z1** Start the local model downloads in the background (C1.1). Multi-GB. They will not finish at hour 18. — 5 min
- [ ] **Z2** Get an Anthropic API key working; check current model IDs with the `claude-api` skill rather than trusting memory. — 5 min
- [ ] **Z3** Create the repo skeleton and push it, so Abhinav and Utsav have somewhere to commit. — 10 min — ⛔ BLOCKER
- [ ] **Z4** Write the four interface fixtures as `.json` files in `fixtures/` (band event, ingest response, websocket alert push, RSSI scan) — even with made-up values. Both of them are blocked on the shapes, not on your code. — 20 min — ⛔ BLOCKER

**You are the blocker for two other people.** A1 (schema + `emit()`) and the fixtures gate everything they do. Do them before you touch a VLM.

## The clock

Hacking started **Saturday 11:00** and stops **Sunday 11:00**. Expo judging is **Sunday 12:00–14:30**, panel judging 14:45–16:45. Hour numbers below are hours since Saturday 11:00.

| Hour | Clock | Gate |
|---|---|---|
| H0 | Sat 11:00 | Start |
| H6 | Sat 17:00 | Hard gates on anything with an external dependency |
| H12 | Sat 23:00 | Feature freeze on anything not on the critical path |
| **H13** | **Sun 00:00** | **⛔ Plume project must exist or you cannot be judged** |
| H18 | Sun 05:00 | Integration freeze — no new code paths after this |
| H22 | Sun 09:00 | Rehearse the demo three times, on the real hardware |
| H24 | Sun 11:00 | Hacking stops |

## The critical path — all three of you sit on it

```
Utsav: band fires an event   →   Ayush: ingest + FSM   →   Abhinav: the phone rings
                                         ↓
                              Abhinav: agent classifies the answer
                                         ↓
                              Ayush: FSM escalates   →   Abhinav: family's phone lights up
```

**That chain is the demo.** A fall goes in, a phone rings, a person answers, the right human gets called. Everything else — the cameras, the room tracking, the learned baseline, the chat — makes it a product and wins the data prizes, but if that chain does not run end to end you have nothing to show a judge.

## The interface contract — agree these at H1, do not renegotiate at H14

Three people cannot integrate at hour 18 unless the seams were frozen at hour 1. Each seam has one owner who writes it down and one consumer who codes against it.

| Seam | Owner writes | Consumer codes against | Frozen by |
|---|---|---|---|
| **Band → backend** | Utsav posts the exact event JSON he will send | Ayush's `/v1/ingest/band` accepts it | **H2** |
| **Backend → app** | Ayush publishes the endpoint list + websocket payloads | Abhinav's API client + fixtures mirror them | **H2** |
| **FSM → voice** | Ayush exposes "place a call to X for alert Y" and an "agent classified it as Z" callback | Abhinav's bridge calls exactly those | **H3** |
| **Band → RF** | Utsav posts the RSSI scan payload shape | Ayush's localizer consumes it | **H4** |

The rule: **the owner writes a real example payload into the repo as a `.json` fixture file, not a message in Discord.** The consumer builds against the fixture. If the fixture changes, the owner tells the consumer out loud.

## When you are behind — cut in this order

You will be behind. Cut from the bottom up, never from the top.

| # | Cut | Lose | Still works |
|---|---|---|---|
| 1 | RAG chat | The "ask about mum" moment | Timeline still shows events |
| 2 | Camera + VLM | ADL tracking, the B2B story | B2C fall + location demo intact |
| 3 | Baseline learner | "We learn her normal" | Hard-rule alerts still fire |
| 4 | RF localization | Room-level location | Fall detection unaffected |
| 5 | Second contact in the ladder | Redundancy | Ladder still escalates once |
| 6 | The physical band | The object judges can touch | A phone posting the same JSON demos the same system |

**Never cut:** the event table, the FSM, the outbound call.

## Truth in demos

Write these on the whiteboard. Say them out loud to judges. Being the team that volunteers which parts are synthetic buys more credibility than being the team that gets caught.

- The 14 days of resident history come from a seed script. The learner running on it is real.
- The "home" is a table with three beacons taped to it.
- The band is a dev board on a strap, not a product.
- We do not dial 911, and this is not a medical device.

## Two things that are already known to be true

- **Submission is on Plume, not Devpost**, and the project must exist before Sunday 00:00.
- **Prior art is close.** [LifeLine](https://devpost.com/software/lifeline-5prxbs) (TerraHacks 2025) already does fall detection → automated LLM phone call. The one thing nobody has done is **call the fallen person first and let their answer choose the escalation tier**. That is the whole differentiator — point the demo at it and say so.

---

## ⛔ Spec conflicts you must resolve at H1 — before firmware locks its POST format

The two specs were written in parallel and disagree in three places. **Resolve them out loud at the H1 standup, write the decision in the repo, and do not let anyone code past it.** The resolutions below are the defaults; overrule them together if you have a reason.

| # | Conflict | Resolution |
|---|---|---|
| 1 | **Band → backend endpoint.** `HARDWARE_SPEC` §5.4–5.7 says `POST /v1/events`, rich `fallband.event.v1` schema, no auth. `TECHNICAL_PRD` §10.5 says `POST /v1/ingest/band` + `/ingest/rf` + `/ingest/band/cancel`, simpler payload, `X-Band-Key` HMAC. | **PRD wins** — it owns the API surface and the app codes against it. Utsav conforms. Drop the HMAC to a shared static header for the demo if it costs more than 20 minutes. |
| 2 | **Sensor config.** PRD §4.1 said 104 Hz / ±8 g / GPIO interrupt. `HARDWARE_SPEC` §6 says 208 Hz / ±16 g / Bridge.notify. | **Hardware spec wins** — its numbers came from reading the datasheet against library source, and the ±4 g clipping trap is real. PRD §4.1 has been corrected to match. |
| 3 | **Resolution naming.** `POST /alerts/{id}/resolve` takes `resolution: "fell_ok"`; the FSM state is `FELL_BUT_FINE`. | Pick one string, grep the repo, done in five minutes. Leave it and you will debug it at H19. |

Also flagged, lower stakes: REST auths with `Authorization: Bearer <JWT>` while the websocket takes `?token=<jwt>` in the query string. Unavoidable for WS, but query-string tokens land in server logs — fine for a hackathon, worth saying out loud if a judge asks about security.
## A. Backend core

Owner: Ayush. Scope: repo scaffold, Python env, FastAPI app, SQLite schema, `events.emit()` + bus,
ingest endpoints, alert FSM + timer wheel, REST/WS contract, auth stub, tunnel, seed scripts, dev loop.
Everything else (band firmware, RN app, voice bridge, CV/VLM, RF algorithm, baseline learner, RAG) is
owned elsewhere — this slice only stubs the surfaces those teams plug into.

### A1. Repo scaffold + Python env — ⛔ BLOCKER (gates literally everyone)

- [ ] **A1.1** Create repo skeleton and venv — 15 min — _done when:_ `python -c "import dhyaan"` exits 0
  ```bash
  mkdir -p dhyaan/{api/routers,alerts,tests} 
  cd dhyaan && uv venv --python 3.12 && source .venv/bin/activate
  uv pip install fastapi "uvicorn[standard]" pydantic python-ulid pyjwt sqlite-vec \
      apscheduler httpx pytest pytest-asyncio python-multipart pyyaml
  touch dhyaan/__init__.py dhyaan/api/__init__.py dhyaan/alerts/__init__.py
  git init && git add -A && git commit -m "scaffold"
  ```
- [ ] **A1.2** Write `taxonomy.yaml` from §3.2 (all event types, one list, grouped by producer comment) — 20 min — _done when:_ `yaml.safe_load(open("dhyaan/taxonomy.yaml"))` returns a flat list/dict with every type in §3.2 (fall_suspected, fall_confirmed, fall_cancelled, band_motion_high, band_still, prolonged_inactivity, band_offline, band_low_battery, button_pressed, zone_entered, zone_exited, zone_dwell, bathroom_prolonged, left_home, returned_home, location_unknown, beacon_offline, rf_scan, person_present, meal_observed, meal_skipped, walk_started, walk_completed, bed_exit, room_exit, room_entry, night_activity, unsteady_gait, visitor_present, medication_taken, assistance_given, call_placed, call_answered, call_no_answer, voice_response_classified, escalation_started, escalation_acknowledged, escalation_exhausted, baseline_deviation, daily_summary, baseline_updated, staff_note, family_note, feedback_given)
  - 🔁 PARALLEL-OK once whiteboarded with the other three at T+0:20 — this file is the contract everyone imports; announce in team chat the moment it's committed.
- [ ] **A1.3** `.env` / config module for secrets (Twilio SID/token, Deepgram key, Anthropic key, JWT secret, `BAND_HMAC_SECRET`) — 10 min — _done when:_ `dhyaan/config.py` exports a `Settings` (pydantic `BaseSettings`) object and `.env.example` exists with every key name (values blank), `.env` is gitignored.

### A2. SQLite schema + migrations — ⛔ BLOCKER

- [ ] **A2.1** Write `dhyaan/schema.sql` verbatim from PRD §3.3 (residents, contacts, events, alerts, calls, baselines, baseline_observations, zones, beacons, fingerprints, location_state, chunk_meta) plus indexes — 20 min — _done when:_ `sqlite3 dhyaan.db < dhyaan/schema.sql` runs with no errors and `.tables` lists all 11 tables.
- [ ] **A2.2** Add `sqlite-vec` load + `chunks_vec` / `chunks_fts` virtual tables to a `dhyaan/db.py::get_conn()` that every process calls (WAL, foreign_keys, busy_timeout, extension load) — 20 min — _done when:_
  ```python
  import sqlite3, sqlite_vec
  def get_conn(path="dhyaan.db"):
      db = sqlite3.connect(path, check_same_thread=False)
      db.enable_load_extension(True); sqlite_vec.load(db); db.enable_load_extension(False)
      db.execute("PRAGMA journal_mode=WAL"); db.execute("PRAGMA foreign_keys=ON")
      db.execute("PRAGMA busy_timeout=5000")
      return db
  ```
  `python -c "from dhyaan.db import get_conn; get_conn()"` prints no error and `PRAGMA journal_mode` reports `wal`.
- [ ] **A2.3** One-shot `init_db.py` that applies `schema.sql` if tables are missing (idempotent, no real migration framework — 24hr project) — 10 min — _done when:_ running it twice in a row does not error (`CREATE TABLE IF NOT EXISTS` or a `PRAGMA user_version` gate).
- [ ] **A2.4** Insert 1-2 fixture residents + contacts by hand for dev (`res_eleanor`, `res_harold`, a `contacts` row with `ladder_order=1`) — 10 min — _done when:_ `SELECT * FROM residents;` returns rows and `/v1/residents` (once built, A7) shows them.

### A3. `events.emit()` + in-process bus — ⛔ BLOCKER (everything downstream is a producer/consumer of this)

- [ ] **A3.1** Port §3.4 `emit()` into `dhyaan/events.py`, loading `VALID_TYPES` from `taxonomy.yaml` (not a hardcoded `_TAXONOMY`) — 25 min — _done when:_
  ```python
  # dhyaan/events.py
  import json, yaml, sqlite3
  from datetime import datetime, timezone
  from ulid import ULID
  from pathlib import Path

  VALID_TYPES = frozenset(yaml.safe_load(Path(__file__).with_name("taxonomy.yaml").read_text()))

  def emit(db, *, resident_id, source, type, ts, embedding_text, payload=None,
           source_id=None, confidence=1.0, zone=None, ts_end=None,
           derived_from=None, supersedes=None) -> str:
      assert type in VALID_TYPES, f"unknown event type {type!r}"
      assert embedding_text and len(embedding_text) <= 400
      eid = f"evt_{ULID()}"
      db.execute("""INSERT INTO events (id, resident_id, source, source_id, type, ts, ts_end,
                      ts_epoch, confidence, zone, payload, embedding_text, derived_from,
                      supersedes, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
          (eid, resident_id, source, source_id, type, ts.isoformat(),
           ts_end.isoformat() if ts_end else None, int(ts.timestamp()), confidence, zone,
           json.dumps(payload or {}), embedding_text, json.dumps(derived_from or []),
           supersedes, datetime.now(timezone.utc).isoformat()))
      db.commit()
      BUS.publish(eid, resident_id, type)
      return eid
  ```
  Calling `emit(..., type="not_a_real_type", ...)` raises `AssertionError` immediately (R11's "fails loudly at write time").
- [ ] **A3.2** `dhyaan/bus.py`: `asyncio.Queue`-based fan-out, one `Bus` singleton with `subscribe()`/`publish()` — 20 min — _done when:_
  ```python
  # dhyaan/bus.py
  import asyncio
  class Bus:
      def __init__(self): self._subs: list[asyncio.Queue] = []
      def subscribe(self) -> asyncio.Queue:
          q = asyncio.Queue(); self._subs.append(q); return q
      def publish(self, event_id, resident_id, type):
          for q in self._subs: q.put_nowait({"event_id": event_id, "resident_id": resident_id, "type": type})
  BUS = Bus()
  ```
  Two `asyncio` tasks that both `subscribe()` and one `publish()` both receive the message (write a 10-line `pytest-asyncio` test).
- [ ] **A3.3** Unit test: `emit()` writes a row AND fans out on `BUS` — 15 min — _done when:_ `pytest dhyaan/tests/test_events.py -q` passes, asserting both the DB row exists and a subscribed queue received the message.

### A4. FastAPI app skeleton + auth stub — 🔁 PARALLEL-OK with A5/A6 once A1-A3 land

- [ ] **A4.1** `dhyaan/api/main.py`: FastAPI app, CORS open (`*`, it's a hackathon), lifespan opens the shared `db` connection + starts the FSM timer loop, mounts routers — 20 min — _done when:_ `uvicorn dhyaan.api.main:app --reload` serves `GET /v1/admin/health` → `200`.
- [ ] **A4.2** JWT auth stub: `dhyaan/auth.py` issues + verifies HS256 JWTs with claims `{sub, role, resident_ids}`; a `/v1/dev/token` endpoint (dev-only, not in PRD contract but needed to test) mints one for a given resident/role; a `require_auth` FastAPI dependency extracts `resident_id` **only from the JWT claims, never from the request body** (§9.7 / R15) — 30 min — _done when:_
  ```python
  # dhyaan/auth.py
  import jwt, time
  from fastapi import Header, HTTPException
  SECRET = settings.jwt_secret
  def make_token(sub, role, resident_ids, ttl=86400):
      return jwt.encode({"sub": sub, "role": role, "resident_ids": resident_ids,
                          "exp": int(time.time()) + ttl}, SECRET, algorithm="HS256")
  def require_auth(authorization: str = Header(...)):
      token = authorization.removeprefix("Bearer ")
      try:
          return jwt.decode(token, SECRET, algorithms=["HS256"])
      except jwt.PyJWTError:
          raise HTTPException(401, {"error": {"code": "unauthorized", "message": "bad token"}})
  ```
  A request to a protected route with no header → `401`; with a valid token → handler receives `claims["resident_ids"]`; a test asserts a body-supplied `resident_id` that isn't in `claims["resident_ids"]` is rejected with `403`.
- [ ] **A4.3** Band auth stub: `X-Band-Key` HMAC check (`hmac.compare_digest(hmac.new(BAND_HMAC_SECRET, body, sha256).hexdigest(), header)`) as a separate dependency used only on `/v1/ingest/*` — 20 min — _done when:_ a POST to `/v1/ingest/band` with a wrong/missing `X-Band-Key` returns `401`, and a correctly-signed one passes through.
- [ ] **A4.4** Standard error envelope: an exception handler that turns any `HTTPException`/validation error into `{"error":{"code","message","detail"}}` — 15 min — _done when:_ hitting a bad route returns that exact shape, verified with `curl -s localhost:8000/v1/nope | jq`.

### A5. Ingest endpoints (band + RF) — ⛔ BLOCKER for hardware/RF team (C) and voice team (B)

- [ ] **A5.1** `POST /v1/ingest/band` — validate `{band_id, kind, ts, payload}`, resolve `band_id → resident_id` (fixture table for now), `emit()` a `fall_suspected` (or whichever `kind`) event, **open an `alerts` row** (`kind='fall'`, `severity` per kind, `state='SUSPECTED'`), return `{event_id, alert_id, cancel_window_s: 30}` — 30 min — _done when:_ `curl -X POST /v1/ingest/band -d '{"band_id":"band_a3f2","kind":"fall_suspected","ts":"...","payload":{...}}'` returns `201` and both an `events` row and an `alerts` row exist.
- [ ] **A5.2** `POST /v1/ingest/band/cancel` — looks up the open alert, `emit()` a `fall_cancelled` event with `supersedes=trigger_event`, sets `alerts.state='CANCELLED'`, `closed_at`, `resolution='false_positive'`, computes `latency_ms` from `opened_at` — 20 min — _done when:_ response is `{"cancelled": true, "latency_ms": N}` and the alert's `closed_at` is set; a second cancel on the same alert is idempotent (returns the same result, doesn't double-close).
- [ ] **A5.3** `POST /v1/ingest/rf` — accept the raw scan payload, `emit()` an `rf_scan` event (confidence n/a, **not embedded** per §3.2 — just store it, retention cleanup is a stretch task), and call a **stub** `localizer.classify(wifi, ble) -> (zone, confidence, method)` that the RF/localization owner (C) will replace — hardcode "return the beacon with strongest RSSI's zone" as the placeholder — 25 min — _done when:_ `POST /v1/ingest/rf` with a fake BLE map returns `200 {"zone": "...", "confidence": ..., "method": "ble", "committed": true}` and updates `location_state` for that resident.
  - 🔁 PARALLEL-OK: ship the stub classifier now so C can swap the function body later without touching the endpoint.
- [ ] **A5.4** `POST /v1/ingest/heartbeat` — update a band's `last_seen`/`battery_pct` (small `bands` side-table or reuse `residents`/a new lightweight in-memory dict if DDL doesn't have a `bands` table — **note the DDL in §3.3 has no `bands` table**, add a minimal one: `CREATE TABLE bands (id TEXT PRIMARY KEY, resident_id TEXT, last_seen TEXT, battery_pct INT, uptime_s INT)`) — 15 min — _done when:_ `204` returned and a row updates in `bands`.
  - ⚠ CONTRADICTION FLAG: §3.3's DDL has no `bands` table even though §10.5 ingest and §3.2's `band_low_battery`/`band_offline` clearly need one to resolve `band_id → resident_id` and track `last_seen`. Added it here as a gap-fill; confirm naming with whoever owns firmware pairing (`/bands/pair`).
- [ ] **A5.5** Idempotency guard on all four ingest endpoints (dedupe on `(band_id, kind, ts)` or a client-supplied idempotency key) so a flaky Wi-Fi retry from the band doesn't double-emit — 20 min — _done when:_ POSTing the identical band payload twice yields exactly one `events` row (checked via `SELECT count(*)`).

### A6. Alert FSM + timer wheel + escalation ladder — ⛔ BLOCKER for voice team (B)

- [ ] **A6.1** Define the FSM states/transitions table in `dhyaan/alerts/fsm.py` per §4.3: `IDLE, SUSPECTED, LOCAL_CANCEL, CANCELLED, CALLING_RESIDENT, RETRY_RESIDENT, VOICEMAIL, CLASSIFYING, RESOLVED_OK, FELL_BUT_FINE, SCHEDULED_CALLBACK, CALLING_CONTACT_1, CALLING_CONTACT_2, ESCALATED_FINAL, ACKNOWLEDGED, EXHAUSTED` as a dict `{(state, trigger): (next_state, action_fn)}` — 35 min — _done when:_ a pure-python unit test drives the table through `SUSPECTED → LOCAL_CANCEL → CANCELLED` and separately `SUSPECTED → ... → CALLING_CONTACT_1 → CALLING_CONTACT_2 → ESCALATED_FINAL` without touching Twilio/DB, asserting the resulting state at each step.
- [ ] **A6.2** Timer wheel: `dhyaan/alerts/timers.py`, one `asyncio.create_task(asyncio.sleep(...))` per pending timeout, cancellable when a real trigger arrives first — 30 min — _done when:_ starting a 2-second test timer and then firing the real trigger before it elapses proves the timer task is cancelled (no double transition); a timer left to expire fires the fallback transition exactly once.
- [ ] **A6.3** Wire exact timings from §4.2 as constants in one place (`dhyaan/alerts/constants.py`): `CANCEL_WINDOW_S=30`, `RESIDENT_RETRY_DELAY_S=15`, `CONTACT_STEP_S=60`, `EXHAUSTED_TIMEOUT_S=300`, `TWILIO_TIMEOUT_S=25` — 10 min — _done when:_ `fsm.py` imports these, no magic numbers inline (this is the "someone changes one constant at hour 19" requirement).
- [ ] **A6.4** Every FSM transition calls `events.emit()` for the corresponding event type (`escalation_started`, `escalation_acknowledged`, `escalation_exhausted`, etc.) and updates `alerts.state` / `state_changed_at` / `ladder_step` — 30 min — _done when:_ replaying `SELECT type FROM events WHERE resident_id=... ORDER BY ts_epoch` after a full simulated ladder shows every step as a row (the "state machine is replayable from events" requirement).
- [ ] **A6.5** Stub the actual call-placement side effect as an injectable callback (`fsm.place_call: Callable[[role, resident_id], None]`) that defaults to a no-op logger — this is the seam voice-bridge team (B) implements against — 15 min — _done when:_ running the FSM with the default stub logs `"[stub] would call resident +1..."` instead of erroring, and B can monkeypatch `fsm.place_call` in their own tests without touching this file.
  - 🔁 PARALLEL-OK: hand this seam to B as soon as A6.1 compiles — they don't need A6.2-A6.4 finished to start their side.
- [ ] **A6.6** `mark_ok` / `escalate` / `request_callback` trigger handlers exposed as plain functions the voice-bridge will call on `FunctionCallRequest` (§4.6) — `dhyaan/alerts/tools.py` — 25 min — _done when:_ calling `tools.mark_ok(alert_id, status="fine")` transitions the FSM to `RESOLVED_OK` and emits `voice_response_classified`.

### A7. REST API — residents / alerts / admin (per §10.5 contract) — 🔁 PARALLEL-OK against A6 (different files)

- [ ] **A7.1** `GET /v1/residents` and `GET /v1/residents/{id}` returning the exact shape in §10.5 (state, last_seen, battery, location, open_alerts, baseline_ready) — stub `baseline_ready`/ADL tiles as static placeholders since baseline learner is out of scope — 30 min — _done when:_ response matches the documented JSON keys exactly (frontend team is coding against this shape).
- [ ] **A7.2** `GET /v1/residents/{id}/location` + `/location/history` reading `location_state` (live) and a naive segment-builder over `zone_entered`/`zone_exited` events (history) — 30 min — _done when:_ after a couple of manually-inserted `zone_entered` events, `/location/history?date=...` returns non-overlapping `segments`.
- [ ] **A7.3** `GET /v1/residents/{id}/events` with `from/to/types/limit/cursor` (ULID-based cursor pagination — `WHERE id > ? ORDER BY id LIMIT ?` works for free since ULIDs sort by time) — 25 min — _done when:_ paginating through 50 seeded events with `limit=10` returns 5 pages with no duplicates/gaps.
- [ ] **A7.4** `POST /v1/residents/{id}/contacts` (insert into `contacts`, enforce unique `ladder_order`) — 15 min.
- [ ] **A7.5** Alerts endpoints: `GET /v1/alerts?state=open`, `GET /v1/alerts/{id}` (with ladder + calls join — `calls` table can be empty/stubbed until B lands), `POST /v1/alerts/{id}/ack`, `/resolve`, `/escalate_now` — 40 min — _done when:_ `ack` halts the FSM timer (calls into A6's `Bus`/FSM to cancel pending timers) and flips `state='ACKNOWLEDGED'`; `escalate_now` jumps straight to the next ladder step, matching the staff "skip the timer" button.
- [ ] **A7.6** Admin endpoints: `GET /v1/admin/health` (report camera/VLM/beacon/Ollama/tunnel/Twilio as `"unknown"` placeholders you don't own, but DO wire the tunnel-URL self-check from R12: compare configured public URL constant to what's reachable), `POST /v1/admin/simulate` (kind: fall|bathroom|deviation → directly calls `events.emit()` + FSM to fake a real trigger, no hardware needed), `POST /v1/admin/rollup` (stub — calls into baseline-learner's entrypoint once that exists; no-op today) — 30 min — _done when:_ `POST /v1/admin/simulate {"kind":"fall","resident_id":"res_eleanor"}` produces the exact same DB/FSM effects as a real `/ingest/band` POST — this is the demo's safety net (§13).
- [ ] **A7.7** `POST /bands/pair` (generate `band_id` + a random `band_key`, store in the `bands` table from A5.4) and `POST /devices/push-token` (store on `contacts.push_token`) — 20 min.

### A8. WebSocket — 🔁 PARALLEL-OK, needed by RN app (D) starting ~T+3:00

- [ ] **A8.1** `wss://.../v1/ws?token=<jwt>` endpoint: authenticate via query-param JWT, subscribe to `BUS`, filter to events relevant to `claims["resident_ids"]`, forward `{"t":"event.new",...}` / `{"t":"alert.opened"/"alert.ladder"/"alert.closed",...}` / `{"t":"location.changed"/"location.dwell",...}` per the message shapes in §10.5 — 40 min — _done when:_ a `websocat wss://localhost:8000/v1/ws?token=...` session prints a JSON line within 1s of a `POST /admin/simulate` call in another terminal.
- [ ] **A8.2** Throttle `location.changed` to one message per resident per 10s (§10.5 explicit requirement — "first thing we throttle") — 15 min — _done when:_ firing 20 rapid `/ingest/rf` calls for the same resident produces at most 2-3 `location.changed` WS messages, not 20.
- [ ] **A8.3** Server-side ping/pong bookkeeping: drop/reap a socket that hasn't sent `{"t":"ping"}` in >60s — 15 min — _done when:_ killing a client without closing cleanly is detected and the subscriber queue is unsubscribed from `BUS` (no memory leak of dead queues after 10 min of a running server — check with a quick loop test).

### A9. Cloudflare tunnel — ⛔ BLOCKER (Twilio callbacks + RN app both need a public URL)

- [ ] **A9.1** Install and pin `cloudflared` tunnel to a fixed hostname at T+0:20 (do this **immediately**, in parallel with A1, since it has zero code dependency) — 10 min — _done when:_
  ```bash
  brew install cloudflared
  cloudflared tunnel login
  cloudflared tunnel create dhyaan-demo
  cloudflared tunnel route dns dhyaan-demo dhyaan-demo.<your-domain>
  cloudflared tunnel run dhyaan-demo --url http://localhost:8000
  ```
  `curl https://dhyaan-demo.<domain>/v1/admin/health` returns `200` from an outside network (phone hotspot, not venue Wi-Fi per R1).
- [ ] **A9.2** Bake the pinned public URL into `/v1/admin/health`'s self-check (R12: silent tunnel-hostname drift) — 10 min — _done when:_ restarting `cloudflared` with a different hostname makes `/admin/health` report a mismatch instead of silently breaking Twilio callbacks.

### A10. Seed / synthetic-data scripts — 🔁 PARALLEL-OK (start at T+0, needed by hour 12 for baseline/RAG teams, but useful for A's own testing immediately)

- [ ] **A10.1** `seed_history.py`: generate 14 days of plausible events (wake/meal/walk/zone events, a couple of `baseline_deviation`-worthy days) for 2-3 fixture residents, calling `events.emit()` for every row so it exercises the real write path — 35 min — _done when:_ `python seed_history.py --resident res_eleanor --days 14` inserts >100 events and `SELECT count(*) FROM events WHERE resident_id='res_eleanor'` confirms it; re-running is safe (either wipes+reseeds or is additive by design — pick one and document it).
- [ ] **A10.2** `reset_demo.py`: truncate `alerts`/`calls`/open-state, reset `location_state`, re-run `seed_history.py`'s last day, all in <5s (§13 explicit hour-18 requirement, do the skeleton now so it evolves instead of getting written from scratch at hour 20) — 20 min — _done when:_ `time python reset_demo.py` completes in under 5 seconds and `/v1/alerts?state=open` is empty afterward.

### A11. Local dev/test loop

- [ ] **A11.1** `Makefile` or `justfile` with `run`, `test`, `seed`, `reset`, `tunnel` targets so every teammate uses the same commands — 15 min — _done when:_ `make run` starts uvicorn with reload, `make test` runs pytest.
- [ ] **A11.2** `pytest` smoke suite: emit→bus, FSM happy path, FSM full escalation, one ingest endpoint round-trip, one auth-rejection case — 30 min — _done when:_ `pytest -q` is green and runs in under 10s (fast enough to run before every commit).
- [ ] **A11.3** A `docs/api_smoketest.http` or `curl` script hitting every §10.5 endpoint once against a running server, for manual sanity checks before the demo — 20 min — _done when:_ running the script top to bottom against a fresh `reset_demo.py` state produces no `5xx`.

### A-checkpoints

| Hour | What must be working | How to prove it in one command |
|---|---|---|
| 0.5 | Tunnel is up, public URL reachable | `curl https://dhyaan-demo.<domain>/v1/admin/health` from a phone hotspot → `200` |
| 1 | DB schema applied, `events.emit()` writes + fans out | `pytest dhyaan/tests/test_events.py -q` green |
| 2 | Ingest band endpoint creates event + alert; taxonomy frozen | `curl -XPOST .../v1/ingest/band -d '{...fall_suspected...}'` → `201` with `event_id`+`alert_id`; `taxonomy.yaml` committed and untouched since |
| 3 | Auth stub + `/v1/residents` real data; **T+3:00 hard checkpoint from PRD** | `curl -H "Authorization: Bearer $(token)" .../v1/residents` returns seeded residents |
| 4 | Full FSM transition table + timer wheel pass unit tests standalone | `pytest dhyaan/tests/test_fsm.py -q` green, covering cancel path and full ladder-to-exhausted path |
| 6 | `/admin/simulate fall` drives the FSM through the whole ladder and closes on `ack`, WS broadcasts every step; **T+6:00 spine checkpoint** | `curl -XPOST .../admin/simulate -d '{"kind":"fall","resident_id":"res_eleanor"}'` then watch `wss://.../v1/ws` print `alert.opened`→`alert.ladder`(×N) and `POST /alerts/{id}/ack` prints `alert.closed` |
| 12 | Ingest idempotency, all §10.5 REST routes return contract-shaped JSON, seed data (14 days) present | `docs/api_smoketest.http` run produces zero `5xx`; `SELECT count(*) FROM events` > 1000 |
| 20 | `reset_demo.py` restores clean state in <5s, `/admin/health` catches tunnel drift | `time python reset_demo.py` < 5s; killing/restarting cloudflared with wrong hostname flips `/admin/health` to unhealthy |

---

**Contradictions / gaps found in the PRD (relayed as requested):**
1. §3.3's DDL has no `bands` table, but §3.2 (`band_offline`, `band_low_battery`) and §10.5 (`/ingest/heartbeat`, `/bands/pair`) both require resolving `band_id → resident_id` and tracking `last_seen`/`battery_pct` somewhere. Added a minimal `bands` table (task A5.4) — flag to the team at the T+2:00 schema freeze.
2. §4.3's state diagram has no explicit `EXHAUSTED`-from-`ESCALATED_FINAL` timeout value in the table view of §4.2, only in the diagram (300s) — used the diagram's number (`EXHAUSTED_TIMEOUT_S=300`) since it's more complete than the table.
## C. Perception + intelligence

### C1. Local model + runtime setup (M5 Pro, 48 GB)

- [ ] **C1.1** ⛔ BLOCKER Start every multi-GB model download NOW, in the background, before writing any code — 5 min hands-on — _done when:_ `ollama list` shows `qwen3-vl:8b` and `nomic-embed-text` fully pulled (background job may still be finishing larger optional models)
  ```
  ollama pull qwen3-vl:8b            # ~4.9 GB, primary VLM
  ollama pull nomic-embed-text       # ~274 MB, embeddings
  ollama pull qwen3-vl:30b-a3b       # optional MoE overflow model, pull in background too — big, start it now or never (§6.7 headroom option)
  curl -L -o /tmp/yolo11n.pt https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.pt &   # small but fetch now, flaky wifi at venues
  ```
- [ ] **C1.2** 🔁 PARALLEL-OK Set up the Python env while downloads run — 10 min — _done when:_ `python -c "import cv2, ultralytics, mlx_vlm, sqlite_vec, pydantic, httpx, anthropic"` exits 0
  ```
  uv venv && uv pip install ultralytics opencv-python-headless mlx-vlm==0.7.1 \
      sqlite-vec==0.1.9 pydantic httpx anthropic python-ulid pyyaml
  ```
- [ ] **C1.3** ⛔ BLOCKER Verify Ollama structured-output + resident-memory behavior on this exact machine — 10 min — _done when:_ a `curl localhost:11434/api/chat` with `format: <json schema>` and `keep_alive: -1` returns valid JSON matching the schema, and `ollama ps` still shows the model resident 5 min later
  ```
  ollama run qwen3-vl:8b --keepalive -1 "warm"
  ```
- [ ] **C1.4** 🔁 PARALLEL-OK Confirm YOLO runs on MPS, not silently falling back to CPU — 5 min — _done when:_ `model.predict(img, device="mps")` logs `device=mps` and single-frame latency is <40 ms at imgsz=640

### C2. VLM benchmark + decision gate

- [ ] **C2.1** ⛔ BLOCKER Measure real tok/s and end-to-end latency of the 4-frame VLM batch call on the actual M5 Pro — no published M5 benchmark exists (§6.7) — 30 min — _done when:_ a script sends 5 real 4-image batches through `/api/chat`, records vision-encode / prefill / decode / total wall-clock, and the numbers are written into a `bench_vlm.md` next to this doc, replacing the "UNVERIFIED" table in PRD §6.7
  ```python
  # scratchpad/bench_vlm.py — time.perf_counter() around httpx.post, 5 runs, report p50/p95
  ```
- [ ] **C2.2** Apply the decision gate from the measured numbers — 10 min — _done when:_ one of these is written as the committed config, with the reason logged:
  - if end-to-end < 4 s/batch and sustained ≥15 batches/min → keep `qwen3-vl:8b`, `batch_size=4`
  - if slower → drop to a smaller model (`qwen3-vl:2b` or similar) **or** keep `qwen3-vl:8b` but cut `batch_size` to 2 / `min_gap_s` to 30 (fixed keyframe budget) — pick whichever preserves demo cameras (3–4) at real-time
  - either way, set `VLM_BACKEND=ollama` (mlx path stays a documented one-line env-var swap, not built unless C2.1 shows Ollama is the bottleneck)

### C3. CV cascade — motion → person detect → track → keyframe batch
_🔁 PARALLEL-OK with C4/C5/C6 once C1 finishes; feeds C4._

- [ ] **C3.1** Implement `Camera` ingest with grab-always thread (never serve stale RTSP frames) — 20 min — _done when:_ `latest()` timestamp is always <200 ms old while streaming from the webcam, and a `camera_offline` event fires within 10 s of unplugging it
  ```python
  # dhyaan/vision/ingest.py — CAP_AVFOUNDATION for the demo webcam, daemon _pump thread, watchdog: now-ts>10s -> events.emit(type="camera_offline")
  ```
- [ ] **C3.2** Motion stage: MOG2 background subtraction at 640×360 grey, foreground-pixel ratio > 0.8% — 15 min — _done when:_ single-threaded throughput is measured and logged (PRD flags this as unmeasured; must be >300 fps or "something is wrong with your build")
- [ ] **C3.3** Person detect on motion-positive frames: `yolo11n.pt`, `device="mps"`, `classes=[0]`, `conf=0.4`, `imgsz=640` — 20 min — _done when:_ end-to-end stage latency <40 ms/frame on this Mac (measured, not assumed)
- [ ] **C3.4** Track: `model.track(persist=True, tracker="bytetrack.yaml")` for a stable `track_id` — 15 min — _done when:_ walking across frame keeps one `track_id` for the full traversal (no ID churn) in a 30 s test clip
- [ ] **C3.5** Keyframe selector per `(camera, track_id)` — 30 min — _done when:_ a 25-min synthetic "sitting at table" test track produces exactly the frames the rules predict (one every `on_dwell_s`, plus start/end/zone/posture triggers), not 4,500 frames
  ```python
  KEYFRAME_RULES = dict(min_gap_s=20, on_zone_change=True, on_posture_change=True,
                         on_dwell_s=90, on_track_start=True, on_track_end=True,
                         batch_size=4, max_batch_wait_s=60)
  ```
- [ ] **C3.6** `fall_suspected` fast path: bbox aspect-ratio flip (tall→wide, stays wide) jumps the VLM queue with `n=2` frames, high priority — 15 min — _done when:_ simulating a "lying down" bbox sequence produces a high-priority batch that preempts the normal queue in a queue-ordering test

### C4. VLM structured-JSON prompting + observation → event dedup
_Depends on C1–C3._

- [ ] **C4.1** Implement `ADLObservation` Pydantic schema + zone-conditioned prompt builder exactly per §6.4 (closed vocab, "unclear" escape hatch, evidence ≤180 chars) — 20 min — _done when:_ `ADLObservation.model_json_schema()` validates and a hand-built 4-frame test batch returns a parseable observation
- [ ] **C4.2** `observe()` call to Ollama `/api/chat` with `format=schema`, `keep_alive=-1`, `options.temperature=0`, `num_ctx=8192` — 15 min — _done when:_ 10 consecutive calls all return schema-valid JSON (constrained decoding actually holds)
- [ ] **C4.3** ⛔ BLOCKER (gates multi-camera) Single VLM worker process, one `asyncio.Queue(maxsize=32)`, backpressure — 25 min — _done when:_ pushing 40 batches in under a second results in exactly 32 processed + 8 counted drops (lowest-priority dropped, metric incremented), never a blocked camera thread
- [ ] **C4.4** Dedup interval accumulator (`dedup.py`) — 30 min — _done when:_ feeding it 15 synthetic `eating` observations spanning 25 min produces exactly one `meal_observed` event with `n_observations=15`, correct `ts`/`ts_end`, and calibrated confidence `clip(mean_conf·(1−0.5^n), 0.05, 0.95)`
  ```python
  GAP_S = {"eating": 600, "walking": 120, "sleeping": 1800, "_default": 300}
  MIN_DURATION_S = {"eating": 240, "walking": 20, "_default": 0}
  MIN_OBS = {"eating": 3, "walking": 2, "_default": 1}
  ```
- [ ] **C4.5** Zone loader + foot-point-in-polygon test (use `x_center, y_bottom`, not centroid) — 10 min — _done when:_ a standing-person bbox near the back wall of a zone is correctly assigned to that zone, not rejected because its centroid is outside the polygon

### C5. RF indoor localization — server-side algorithm only
_🔁 PARALLEL-OK with C3/C4. Server consumes `POST /v1/ingest/rf` payloads `{wifi:{bssid:dbm}, ble:{beacon_id:dbm}}` — beacon hardware/firmware is another agent's task; assume the payload arrives._

- [ ] **C5.1** Fingerprint store: persist site-survey scans into `fingerprints` (§3.3), one row per scan during `/fingerprint/start`..`/fingerprint/stop` — 15 min — _done when:_ 30 s of synthetic scans for one zone produces ~10 rows with correct `vector` JSON and `n_anchors`
- [ ] **C5.2** Weighted k-NN in signal space (Layer 1) with the symmetric-difference penalty — this is the part people skip and then can't separate rooms — 30 min
  ```
  d(s,f) = sqrt( Σ_common (s[a]-f[a])² + Σ_sym_diff PENALTY² ) / sqrt(|s ∪ f|)   PENALTY=20
  w_i = 1/(d_i+1.0); L(zone) = Σ_{top3,zone match} w_i / Σ_{top3} w_i
  ```
  _done when:_ a synthetic vector matching room A's fingerprints exactly returns `L(A)≈1.0`, and one matching A minus its strongest anchor still favors A over B by the penalty term
- [ ] **C5.3** BLE path-loss sanity channel + nearest-beacon hysteresis (Layer 2), `n=3.0`, ≥6 dB to switch incumbent — 20 min — _done when:_ a beacon estimated >8 m away is correctly flagged out-of-room, and a debug string like "≈2 m from kitchen beacon" renders
- [ ] **C5.4** ⛔ BLOCKER (gates demo split-screen) Discrete Bayes filter / HMM over the zone adjacency graph (Layer 3) — 45 min
  ```python
  # dhyaan/location/hmm.py — ZETA=1e-4, BETA=1.5, ETA=0.02
  # per-zone-kind p_stay: bedroom .95, living .90, bathroom .85, hallway .50
  # commit: challenger holds argmax 2 ticks AND posterior>=0.6; unknown: <0.45 for 3 ticks
  ```
  _done when:_ feeding a flapping raw sequence (kitchen,kitchen,living,kitchen,kitchen) through `step()` yields a stable committed zone that does not flap on every tick, matching §7.3's worked example
- [ ] **C5.5** `left_home` / `returned_home` rule + auto-learned home-AP allowlist (BSSID seen in ≥80% of scans over first 24h) — 15 min — _done when:_ a synthetic 130 s gap with no beacons and no allowlisted BSSID emits `left_home`; reappearance emits `returned_home`
- [ ] **C5.6** Camera–RF fusion (`fuse()`): RF wins identity, camera wins activity, ≥0.75 RF confidence reassigns/drops the camera track — 20 min — _done when:_ a synthetic case where RF says bedroom and camera says dining room (RF conf 0.8) results in the camera observation being dropped, not misattributed
- [ ] **C5.7** 🔁 PARALLEL-OK Build a synthetic RF scan generator for testing k-NN/HMM without real beacons (separate from the physical demo table another agent builds) — 20 min — _done when:_ a script produces a walk-sequence (bedroom→hallway→bathroom) of noisy scan vectors that drives C5.4's demo split-screen behavior end-to-end with no hardware attached

### C6. Per-resident baseline learner

- [ ] **C6.1** ⛔ BLOCKER (nothing to score without this) Seed synthetic history via `scripts/seed_history.py`: 14 days of plausible per-resident events with one known injected anomaly on "today" — 30 min — _done when:_ `baseline_observations` has ≥14 rows per feature per resident and the injected anomaly (e.g. zero walks today vs λ≈3) is visibly present in the raw data
  - **Honest note to keep in the demo script: the history is synthetic, the learner is real.**
- [ ] **C6.2** `rollup.py`: nightly 03:30 job + `POST /admin/rollup` on-demand, computing every feature in §8.1 from `events` — 40 min — _done when:_ running it against seeded data populates all ~22 features (continuous + count) in `baselines` with no exceptions
- [ ] **C6.3** Weighted median/MAD with recency decay + circular unwrap for `wake_time_min`/`sleep_time_min`/`first_walk_min` — 30 min
  ```
  age_i=(today-date_i)days; w̃_i=w_i·0.97^age_i; μ=weighted_median; σ̂=max(1.4826·MAD, floor_f)
  ```
  _done when:_ unit test reproduces §8.2's worked numbers and a midnight-crossing wake time does not wrongly compute a huge MAD
- [ ] **C6.4** Poisson EWMA rate (`α=0.15`) + two-tailed surprise score, `score_today()` — 25 min — _done when:_ feeding the injected "0 walks" anomaly from C6.1 against λ≈3.1 returns `severity="urgent"` (surprise ≥2.0)
- [ ] **C6.5** Cold start: `baseline/priors.yaml` (κ=4 pseudo-count blend) + P0/P1/P2 phase logic — 20 min — _done when:_ a resident with `n_obs=1` produces zero deviation alerts (P0), `n_obs=5` only fires on `urgent`-level deviations (P1), `n_obs=10` uses pure personal baseline (P2)
- [ ] **C6.6** Threshold/direction table (§8.5) + the two real-time checks (`longest_inactivity_s` every 60 s vs μ+3σ̂, `bathroom_dwell_s` live vs §7.6's rule) + global damper (max 2 alerts/resident/24h, 1/feature/day, suppressed ones still logged as `severity:info`) — 30 min — _done when:_ a burst of 5 simultaneous deviations on one resident yields only 2 `baseline_deviation` alerts, with the other 3 present in `events` at `info` severity
- [ ] **C6.7** Feedback endpoint logic: `expected` → weight 0.2 + 7-day cooldown (urgent-only) + repeated-3x-in-14-days → `baseline_updated`; `false_positive` → weight 0.0 — 25 min — _done when:_ POSTing `{"verdict":"expected"}` three times in a test harness for the same feature flips a `baseline_updated` event with `reason:"repeated_expected"` and resets weights to 1.0

### C7. RAG layer

- [ ] **C7.1** 🔁 PARALLEL-OK Load the `claude-api` skill and confirm current model IDs before writing any Claude call — do not hardcode `claude-opus-5`/`claude-sonnet-5` from memory, the PRD's names may drift — 5 min — _done when:_ the model ID(s) used in C7.2/C7.5/C7.7 are copy-pasted from the skill's current reference, not typed from recall
- [ ] **C7.2** ⛔ BLOCKER (nothing to embed without narratives) Daily narrative generation job — explicit: one Claude call per resident per local day, reading **all** that day's events + baseline state, writing a 120–200 word narrative that states both what happened and what did not (absences) — 30 min
  ```python
  # dhyaan/rag/daily_summary.py — system prompt enforces absence-reporting per §9.1's worked example
  # store as chunk_meta(kind="daily_summary") + push through embed() -> chunks_vec
  ```
  _done when:_ running it on C6.1's seeded 14 days produces 14 narratives per resident, at least one of which explicitly names a missing meal/activity rather than staying silent about it
- [ ] **C7.3** 🔁 PARALLEL-OK `embed.py` via Ollama `/api/embed`, batch the whole backlog — 15 min — _done when:_ embedding all seeded narratives + indexed event `embedding_text` rows returns 768-dim vectors in one batched call, no per-text round trip
- [ ] **C7.4** ⛔ BLOCKER sqlite-vec setup: load extension into the same `dhyaan.db` connection, pin `0.1.9`, `distance_metric=cosine`, `resident_id` as partition key — 20 min — _done when:_ `chunks_vec` and `chunks_fts` (fts5, `porter unicode61`) both populate from C7.2/C7.3's output and a manual `MATCH` query with a literal `k=12` (never a bound `?`, per the sqlite-vec landmine) returns results
- [ ] **C7.5** Hybrid retrieval: `plan()` (Claude structured output → `RetrievalPlan`) + vector KNN ∪ FTS5 BM25 merged by RRF (`k=60`) — 35 min — _done when:_ the query "has she been eating this week" returns a plan with a resolved absolute date window and a merged, deduplicated top-12 chunk list combining both retrieval paths
  - **Watch for this exact bug class:** keep the `RetrievalPlan` field names and the SQL param names consistent (the PRD's own snippet defines `t0_iso`/`t1_iso` on the plan but reads `p.t0`/`p.t1` in `retrieve()`) — pick one naming and use it everywhere
- [ ] **C7.6** Deterministic aggregate channel: run plain SQL `GROUP BY` for any `needs_aggregate` question instead of letting the LLM count chunks — 15 min — _done when:_ "how many times did she walk last week" produces a number sourced from `COUNT(*)`, verifiable against raw `events`, never from vector search
- [ ] **C7.7** Answer prompt + citation guardrail — 25 min — _done when:_ (a) every factual sentence in a test answer carries a `[chunk_id]`, (b) a post-hoc regex catches any sentence with a digit/day-name and no citation and appends the "can't source that" caveat, (c) a medical-sounding test question ("is this a UTI?") short-circuits via `refuses:true` before retrieval runs

### C-checkpoints

| Hour | What must work | One-command proof |
|---|---|---|
| 0 | Model downloads running in background; env installed | `ollama list \| grep -E "qwen3-vl|nomic-embed"` |
| 3 | RF k-NN + HMM pass unit tests on synthetic scan sequences (no hardware needed yet) | `pytest dhyaan/location/test_hmm.py -q` |
| 6 | VLM benchmark numbers written; decision gate applied; MOG2 fps measured | `cat bench_vlm.md` shows real ms/batch, not "UNVERIFIED" |
| 8 | Full CV cascade runs end-to-end on the demo webcam and produces a keyframe batch | `python -m dhyaan.vision.run_demo --camera 0` logs a 4-frame batch dispatched to the VLM queue |
| 10 | VLM dedup produces exactly one `meal_observed` event from a synthetic 25-min observation stream | `pytest dhyaan/vision/test_dedup.py -q` |
| 12 | Baseline learner scores the seeded synthetic history and flags the injected anomaly | `python -m dhyaan.baseline.rollup --resident res_eleanor --backfill` then check `alerts` table for the injected day |
| 14 | RF fusion correctly reassigns/drops a mismatched camera track in a synthetic disagreement case | `pytest dhyaan/location/test_fusion.py -q` |
| 16 | Daily narratives generated for all seeded days and embedded into sqlite-vec/FTS5 | `sqlite3 dhyaan.db "select count(*) from chunk_meta where kind='daily_summary'"` |
| 18 | Hybrid RAG answers "has she been eating this week" with citations and correct absence-reporting | `python -m dhyaan.rag.ask --resident res_eleanor --q "has she been eating this week"` |
| 20 | Full stack demo dry run: RF split-screen flap-vs-HMM beat + a RAG question in the same session | manual dry run per §7.8's demo beat script |

---

## Open spec questions in your lanes

- `RetrievalPlan` defines `t0_iso`/`t1_iso` but `retrieve()` reads `p.t0`/`p.t1`. Pick one at schema freeze.
- The exhausted-timeout (300 s) appears only in the §4.3 state diagram, never in the §4.2 timing table. The diagram value is what the TODO assumes — confirm it.
- §6.7 VLM latency and §7.4 RF accuracy are both self-flagged `[UNVERIFIED]` by the PRD. They are measurement tasks, not errors: measure on the real machine and write the numbers back into the doc.
