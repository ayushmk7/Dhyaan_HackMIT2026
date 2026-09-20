# FIXPLAN — Dhyaan bug-fix campaign (2026-09-20)

Source: 65 findings in the audit scratchpad (`findings.md`), sanity-checked against the
working tree at 05:39 EDT. Line numbers below are from the working tree, not from the
findings, where the two differ.

## Read this first

**The working tree is already ahead of the findings.** Another session is live on the
repo right now. Uncommitted, verified on disk:

| Already done on the working tree | Where | Findings it closes |
| --- | --- | --- |
| CAS on `_apply` (`update_one({"_id", "state": state})`, bail on `matched_count == 0`) | `backend/app/alerts.py:332-337` | A1 |
| Timer armed from `_pending_timer` *before* the action runs | `alerts.py:348-351` | A2 (main half) |
| `CLASSIFYING` has a silence timer + TABLE row; `SUSPECTED`/`VOICEMAIL`/`FELL_BUT_FINE` re-driven with 0.0 windows | `alerts.py:176, 242-254` | A4 |
| `_TwilioVoice.speak_final_escalation` exists | `voice_adapter.py:237` | (unlisted) |
| Stall → `heartbeat("offline")`, recovery → `watching`, with tests | `vision/worker.py:388-414`, `tests/test_vision_gate.py:882,902` | C3 |
| `post_async` on the quick path and the absent path | `worker.py:475, 510` | C5 |
| `ts.isoformat()` in the dry-run failure payload | `worker.py:706` | C9 |
| Survey screen calls `surveyStop` on unmount | `frontend/src/app/onboard/survey.tsx:71-76` | D5 |
| Timeline passes `residentId, date` to `api.rollup` | `(family)/timeline/index.tsx:198` | D6 |
| Chat citation chips keyed by index | `(family)/chat/index.tsx:175` | D9 (chat half) |

Do not redo these. Where a stream "owns" one of these, its job is to **add the missing
test** and keep the change.

**Files under active edit by the other session** (mtime within the last 15 minutes,
uncommitted): `backend/app/alerts.py`, `backend/app/voice_adapter.py`,
`backend/vision/worker.py`, `backend/tests/test_vision_gate.py`,
`frontend/src/app/(family)/chat/index.tsx`, `frontend/src/app/(family)/home/index.tsx`.
Plus the four the brief named (`rag.py`, `llm.py`, `chat/index.tsx`, `home/index.tsx`).
Rule for every stream: run `git status --short -- <your files>` before you start. If a
file you own has uncommitted changes you did not make, **re-read it before editing and
keep your diff to the lines named here**. If it has moved so far that a named line no
longer exists, skip that finding and say so.

**Check commands.** Backend: `cd backend && .venv/bin/python -m pytest -q <files>`
(mongo on localhost:27017; `make mongo`). 288 tests currently collect. Frontend has no
test runner: the checks are `cd frontend && npx tsc --noEmit` and
`python3 scripts/copy-audit.py` (the latter currently fails on one unrelated em dash,
`lib/copy/staff.ts:542`; stream 5 fixes it because that audit is its gate).

---

## 1. Triage table

Severity is judged by what breaks on stage or silently harms a real user.

| ID | Verdict | Reason (WONTFIX) / note |
| --- | --- | --- |
| A1 | FIX NOW | Already on tree; add the race test. |
| A2 | FIX NOW | Timer-first already on tree; still need per-contact `try/except` in `_final_escalation` + test. |
| A3 | FIX NOW | One-line spread order; rate limiter is a no-op today. |
| A4 | FIX NOW | Already on tree; add a re-arm-from-CLASSIFYING test. |
| A5 | FIX IF CHEAP | `setup.py:175` already rejects unknown zones at survey time; only seeds/direct writes can plant one. One-line filter. |
| A6 | FIX NOW | Three features publish hard zeros for 60 days. |
| A7 | FIX NOW | Move one assignment. |
| A8 | FIX NOW | Real 3 a.m. calls about last week's fall; also every `--reload` on stage re-arms stale seeded alerts. |
| A9 | FIX NOW | Three `create_index` lines; the ladder query is on the escalation path. |
| A10 | FIX NOW | Secondary sort on `_id` (ULID); do NOT change `ts_epoch` units — every query in the app is in seconds. |
| A11 | FIX NOW | An outage becomes "she did not eat today" and poisons the window. |
| A12 | FIX IF CHEAP | Stale vector on extended episodes; retrieval-quality only. |
| A13 | FIX NOW | Closes B4 too. The band retry is the demo's own hardware. |
| A14 | WONTFIX | `tests/test_alerts.py:121-123` pins `state == CALLING_CONTACT_1` with `resolution == "fell_ok"` (PRD wording). The app dismisses on `closed_at`, which stays null until terminal (`http.ts:157,231`), so nothing user-visible is wrong. |
| B1 | FIX NOW | Verified: pause → heartbeat → ingest 201. |
| B2 | FIX NOW | Same write; plus the mirror found in review: the hub echoes a *family* pause as `state: paused` (`worker.py:148-165`) and `camera.py:273` then stamps `paused_by: "resident"`, so the family's own Resume 403s within one heartbeat. Stage-visible. |
| B3 | FIX NOW | One stalled phone blocks fall ingest for everyone. |
| B4 | FIX NOW | Closed by A13 in `open_alert`; no ingest-side change. |
| B5 | FIX IF CHEAP | Only the `see\s+her` half. The `bed` half is WONTFIX: `tests/test_rag_guard.py:56` pins "Did she get out of bed yet?" as `private_room` — it is the product rule, not a bug. `rag.py` is under concurrent edit. |
| B6 | FIX NOW | Trivial validator; the timeline button posts this route. |
| B7 | FIX NOW | Second run of the same simulate kind moves nothing on the Today tile. Stage fallback path. |
| B8 | FIX NOW | Drop `zone` and scrub the sentence on `/events/{id}` server-side; keep field names (client reads `embedding_text`, `timeline/[eventId].tsx:48-51`). |
| B9 | FIX NOW | ~480 events + 480 embedding tasks overnight. |
| B10 | FIX NOW | Two-character change + one parametrize row. |
| B11 | FIX IF CHEAP | `rag.py`/`llm.py` concurrent. Ceiling today with a key: 8 s + 0.5 s + 8 s + 25 s Ollama. |
| B12 | FIX NOW | Buffered-scan replay collapses the gap. Split across S3 (kwarg) and S2 (call site). |
| B13 | FIX IF CHEAP | `rag.py` concurrent; one line. |
| B14 | FIX IF CHEAP | `rag.py` concurrent; one line; no leak today. |
| B15 | WONTFIX | Regex guards are phrasing-dependent by construction. Upgrade: a classifier call in `hard_refusal`, not a longer regex. |
| B16 | FIX IF CHEAP | Three lines in `alerts.py`; GC hazard is real but rare. |
| B17 | WONTFIX | Noted; none reachable in the demo (`put_profile` cross-resident needs a hostile LAN client; the API has no auth at all — see `main.py:1`). |
| C1 | FIX NOW | Pure function, two lines, contradicts a real fall. |
| C2 | FIX NOW | One-frame `on_floor` from the quick path becomes a family sentence. |
| C3 | WONTFIX | Already covered: stall → offline on the tree (`worker.py:399-410`) with tests. The missing `try/except` in `capture._grab_loop` now degrades to the same stall path. |
| C4 | FIX IF CHEAP | Two lines in `keyframe.update`; trap: `test_on_floor_obeys_its_cooldown` (see notes). |
| C5 | WONTFIX | Already done; the remaining `self.post` at `worker.py:778` runs on the VLM thread, not the capture loop. |
| C6 | FIX IF CHEAP | Camera LED stays on through the privacy beat. ~8 lines; do last in the vision stream. |
| C7 | FIX NOW | One word. |
| C8 | FIX NOW | One condition. |
| C9 | WONTFIX | Already fixed (`worker.py:706-707`). |
| C10 | FIX NOW | Two lines; the lane dies instead of polling. |
| C11 | FIX NOW | `elif` → separate `if`. |
| C12 | FIX NOW | One key in `DEMO`. |
| C13 | WONTFIX | `--source photo.jpg` is rehearsal-only; the demo uses a live camera or `synthetic`. |
| C14 | FIX IF CHEAP | One call on the retry path. |
| C-note | WONTFIX | Pose-weight fetch is a one-time model download, not a frame write; `--ollama` remote is the operator's explicit choice. Upgrade: warn when the host is not loopback. |
| D1 | FIX NOW | A family phone rings the alarm and shows Call 911 for a stranger's fall. |
| D2 | WONTFIX (this build) | Nothing in the backend sends a push (`push_register` only stores the token; no `exp.host` caller anywhere). `push.ts:21` also needs a dev build + EAS project id. The demo runs the app foregrounded, where the socket + 5 s poll open the takeover. Upgrade: ~20-line Expo push POST in `alerts.open_alert`, then move `registerForPush()` after `finishOnboarding` and add `useLastNotificationResponse` in `_layout`. |
| D3 | FIX NOW | One guard; blank screen on a failed refetch. |
| D4 | FIX NOW | `catch` + one copy string; a failed ack tells nobody. |
| D5 | WONTFIX | Already fixed on tree. |
| D6 | WONTFIX | Already fixed on tree. |
| D7 | FIX IF CHEAP | Battery, not correctness. |
| D8 | FIX IF CHEAP | `chat/index.tsx` is under concurrent edit; one flag. |
| D9 | FIX NOW | Staff half only (`triage/resident/[id].tsx:341`); chat half already fixed. |
| D10 | FIX IF CHEAP | After D1 the family lane never shows a foreign alert; the session's `residentId` only changes on `reset()`. |
| D11 | WONTFIX | Two simultaneous alerts is not a demo path; the store's single `activeAlert` is a design choice. |
| D12 | FIX NOW | One string. |
| D13 | FIX IF CHEAP | "1 seconds" + English outside `lib/copy`; the copy audit does not scan `components/`. |
| D14 | WONTFIX | Server (`rag.py:433-435`) and client (`format.ts:32`) scrub the identical 7 words, and RF `ZONES` has 6 rooms; the real leak is the `zone` *field*, which B8 removes. |
| D15 | FIX NOW | A second tap re-POSTs every profile fact → duplicate facts → duplicate citations. One ternary. |
| D16 | WONTFIX | `&body=` is the iOS form and the demo phone is iOS. |
| D17 | WONTFIX | Low; a bounded 20 s loop. |
| D18 | WONTFIX | 250 ms flash. |

Totals: 34 FIX NOW, 14 FIX IF CHEAP, 17 WONTFIX.

---

## 2. Work streams

Six streams with disjoint file sets. Suggested order: **S3 and S4 and S5 in parallel
now; S2 after S3 lands (one dependency); S1 when the other session is off `alerts.py`
or handed to that session; S6 last and only if `rag.py`/`llm.py` are idle.**

### S1 — Ladder

Owns: `backend/app/alerts.py`, `backend/app/voice_adapter.py`,
`backend/tests/test_alerts.py`, `backend/tests/test_voice_adapter.py`.

Closes: A1, A2, A4, A8, A13 (and therefore B4), B10, B16 (cheap).

Order: (1) B10; (2) A13; (3) A8; (4) A2's `_final_escalation` loop; (5) tests for A1
and A4 against the existing tree; (6) B16.

Coordination: `alerts.py` and `voice_adapter.py` were saved by the other session at
05:30 with the CAS/timer changes uncommitted. Either hand this stream to that session,
or start only after those changes are committed. Never revert the CAS block or the
`_pending_timer` table.

Check: `cd backend && .venv/bin/python -m pytest -q tests/test_alerts.py tests/test_voice_adapter.py tests/test_api.py`

### S2 — Routers and DB

Owns: `backend/app/routers/ingest.py`, `backend/app/routers/camera.py`,
`backend/app/routers/chat.py`, `backend/app/routers/residents.py`,
`backend/app/routers/live.py`, `backend/app/db.py`, `backend/tests/test_ingest.py`,
`backend/tests/test_camera.py`, `backend/tests/test_api.py`, `backend/tests/test_reads.py`.

Closes: B1, B2 (+mirror), B3, B6, B7, B8, B9, B12 (call-site half), A9, A10.

Order: (1) A9; (2) A10; (3) B6; (4) B9; (5) B8; (6) B7; (7) B3; (8) B1+B2 together
(one edit each in heartbeat and resume, tested in both directions); (9) B12 call site —
**only after S3 has merged the `ts` kwarg**.

Cross-stream: B4 is closed by S1 — add nothing to `ingest_band`. `camera.py` had a
recent mtime (05:33) but no uncommitted diff; still re-read `:257-284` and `:588-598`
before editing.

Check: `cd backend && .venv/bin/python -m pytest -q tests/test_ingest.py tests/test_camera.py tests/test_api.py tests/test_reads.py`

### S3 — Signals (location, baseline, presence)

Owns: `backend/app/location.py`, `backend/app/baseline.py`, `backend/app/presence.py`,
`backend/tests/test_location.py`, `backend/tests/test_baseline.py`.

Closes: A3, A5 (cheap), A6, A7, A11, A12 (cheap), B12 (kwarg half).

Order: (1) A3; (2) A6; (3) A11; (4) A7; (5) B12 kwarg (`observe(resident_id, scan,
ts=None)`, default keeps every existing caller working); (6) A5; (7) A12.

Cross-stream: S2 consumes the B12 kwarg. A12's check is a `presence.record` sequence
and presence tests live in `tests/test_camera.py` (S2's file), so add that one test
there *only after S2 is done*, or drop A12 (it is FIX IF CHEAP).

Check: `cd backend && .venv/bin/python -m pytest -q tests/test_location.py tests/test_baseline.py tests/test_camera.py tests/test_ingest.py`

### S4 — Vision lane

Owns: `backend/vision/posture.py`, `backend/vision/keyframe.py`, `backend/vision/vlm.py`,
`backend/vision/worker.py`, `backend/vision/__init__.py`, `backend/tests/test_posture.py`.

Closes: C1, C2, C4 (cheap), C6 (cheap, last), C7, C8, C10, C11, C12, C14 (cheap).

Order: (1) C7; (2) C8; (3) C12; (4) C11; (5) C10; (6) C1; (7) C2 (exposes a property on
`KeyframeSelector`, worker consumes it); (8) C14; (9) C4; (10) C6.

Coordination: `worker.py` (05:30) and `tests/test_vision_gate.py` (05:39) are under
active edit. **Put every new vision test in `tests/test_posture.py`** (it already imports
`vision.keyframe` and `vision.posture`; add `from vision import vlm, worker`), never in
`test_vision_gate.py`. Keep `worker.py` edits to the three named spots.

Check: `cd backend && .venv/bin/python -m pytest -q tests/test_posture.py tests/test_vision_gate.py tests/test_openvocab.py`

### S5 — App

Owns: `frontend/src/store/live.ts`, `frontend/src/app/_layout.tsx`,
`frontend/src/app/(staff)/rounds/index.tsx`, `frontend/src/app/(staff)/triage/index.tsx`,
`frontend/src/app/(staff)/triage/resident/[id].tsx`, `frontend/src/lib/copy/family.ts`,
`frontend/src/lib/copy/staff.ts`, `frontend/src/app/onboard/done.tsx`,
`frontend/src/lib/hooks.ts`, `frontend/src/components/alert-extras.tsx`,
`frontend/src/app/(family)/camera/index.tsx`.

Closes: D1, D3, D4, D9 (staff half), D12, D15, and if cheap D7, D10, D13. Also the one
em dash at `lib/copy/staff.ts:542` so the copy audit is green (it is this stream's gate).

Order: (1) D12; (2) D3; (3) D9; (4) D15; (5) D4; (6) D1; (7) staff.ts:542; (8) D10;
(9) D13; (10) D7. D8 is an optional tail: touch `(family)/chat/index.tsx` only if its
mtime is older than 30 minutes, and only lines 54-70 and 211.

Never touch `(family)/home/index.tsx` or `(family)/chat/index.tsx` otherwise.

Check: `cd frontend && npx tsc --noEmit && python3 scripts/copy-audit.py`

### S6 — RAG (conditional)

Owns: `backend/app/rag.py`, `backend/app/llm.py`, `backend/tests/test_rag_guard.py`,
`backend/tests/test_rag.py`, `backend/tests/test_llm.py`.

Closes: B5 (`see her` half), B11, B13, B14 — all FIX IF CHEAP.

Gate: `git status --short backend/app/rag.py backend/app/llm.py` must be empty and both
mtimes older than 30 minutes. Otherwise skip the whole stream; none of these break the
demo.

Order: (1) B13; (2) B14; (3) B5; (4) B11.

Check: `cd backend && .venv/bin/python -m pytest -q tests/test_rag_guard.py tests/test_rag.py tests/test_llm.py`

### Final gate (after all streams)

`cd backend && make test` (all files, one process) and
`cd frontend && npx tsc --noEmit && python3 scripts/copy-audit.py`. Then rehearse the
four stage beats in §4.

---

## 3. Per-finding fix notes (FIX NOW, plus the FIX IF CHEAP ones a stream lists)

### S1 — Ladder

**A1** — Defect: non-atomic read-modify-write in `_apply`; a family ack racing the
contact timer was overwritten. Change: none (CAS at `alerts.py:332-337` is on the tree).
Check: new test in `test_alerts.py` — open an alert (CANCEL_WINDOW_S=5), then
`await asyncio.gather(alerts._apply(id, "ack", ...), alerts._apply(id, "cancel_timeout"))`;
assert final state `ACKNOWLEDGED` and `resident_call_attempts == 0`, and that exactly
one `escalation_*` event was written for that step. Trap: `_apply` returns the current
doc on the losing side rather than raising — assert on state, not on exceptions.

**A2** — Defect: a raising `place_call` used to skip `_schedule`; now the timer is armed
first (on tree), but `_final_escalation` still aborts the whole contact loop on the first
bad leg. Change: wrap the two `await voice.*` calls inside the `for contact` loop at
`alerts.py:107-111` in `try/except Exception` that logs and `continue`s. Check: test —
monkeypatch `voice.place_call` to raise for the first contact only; drive to
`ESCALATED_FINAL`; assert the second contact was still dialled (inspect `db.calls` or
the `call_placed` events, whichever the stub writes) and that `EXHAUSTED` is reached
after `EXHAUSTED_AFTER_S` (monkeypatch to 0.05). Trap: the stub's `place_call` writes to
`db().calls`; look at `tests/test_alerts.py::_call_events` for the existing helper.

**A4** — Defect: `_rearm_pending` skipped states with no clock. Change: none (on tree).
Check: test — insert an alert doc directly in state `CLASSIFYING` with `updated_at` =
now; `alerts.start_timers()`; with `RESIDENT_RESPONSE_TIMEOUT_S` monkeypatched to 0.05
assert it reaches `CALLING_CONTACT_1`. Trap: monkeypatch the *module attribute*
`alerts.RESIDENT_RESPONSE_TIMEOUT_S`, as `test_silence_escalates` does; `_pending_timer`
reads it at call time.

**A8** — Defect: any non-terminal alert, however old, is re-armed on every restart and
fires at once. Change: in `_rearm_pending` (`alerts.py:273-286`), before re-arming, if
`now - since > 3600` (module constant `STALE_ALERT_S = 3600`, no env, no config), write
`{"state": "EXHAUSTED", "resolution": "exhausted", "updated_at": now}` directly and log;
do not go through TABLE (there is no trigger for it) and do not dial. Check: test —
insert a `LOCAL_CANCEL` alert with `updated_at` two days ago; `start_timers()`; await
a short sleep; assert state `EXHAUSTED` and no call rows. Trap:
`test_restart_rearms_an_in_flight_ladder` uses a fresh `updated_at`; keep the cap well
above any test window. `EXHAUSTED` is already in the app's `TERMINAL_ALERT_STATES`
(`http.ts:157`), so the takeover closes with no UI change.

**A13 / B4** — Defect: two `fall_suspected` posts open two alerts and two ladders; the
band's cancel carries one id. Change: at the top of `open_alert` (`alerts.py:388`),
`find_one({"resident_id": rid, "kind": kind, "state": {"$nin": TERMINAL}, "opened_at": {"$gte": now-STALE_ALERT_S}})`;
if found, return it. Check: test — `open_alert` twice for the same resident; assert the
same `_id` and exactly one `escalation_started` event. Trap: the `opened_at` bound is
load-bearing — without it a stale stuck alert would swallow every new fall forever (A8
also guards this, but only at restart). `opened_at` is an ISO string; compare as ISO
strings, which sort correctly for UTC `isoformat()`. The staff "Simulate a fall" pressed
twice now returns the same alert — intended.

**B10** — Defect: `_TOOL_TO_CLASSIFICATION[("mark_ok", status)]` KeyErrors on an invented
status; only `ValueError` is caught. Change: `.get((...), "incoherent")` at
`voice_adapter.py:64`. Check: add a row to the existing parametrized
`test_every_escalate_reason_escalates` style — `mark_ok` with `status: "banana"` reaches
`CALLING_CONTACT_1`. Trap: the `except ValueError` at `:90` stays; the `.get` makes the
KeyError impossible rather than widening the except.

**B16 (cheap)** — Change: `_rearm_task = asyncio.get_running_loop().create_task(...)`
held on the module; `stop_timers()` cancels it. No test (three lines).

### S2 — Routers and DB

**A9** — Change in `db.ensure_indexes`: `events` on `[("payload.alert_id", 1), ("ts_epoch", 1)]`;
`calls` on `[("alert_id", 1), ("started_at", 1)]`; `fingerprints` on `resident_id`.
No test (index creation is idempotent and exercised by every `connect()`).

**A10** — Defect: whole-second `ts_epoch` ties leave the ladder replay in unspecified
order. Change: `residents.py:580-582` sort becomes `[("ts_epoch", 1), ("_id", 1)]`
(ULIDs are ms-ordered). Do the same for the `call_rows` fallback at `:571-574`. No test
needed beyond the existing `test_the_escalation_ladder_replays_in_order`. Do NOT change
`events.py:82` to milliseconds — baseline, residents, rag and the tests all query
`ts_epoch` in seconds.

**B6** — Change: `field_validator("date")` on `RollupRequest` in `chat.py:24-26` calling
`date.fromisoformat` and raising `ValueError` → FastAPI 422. Check: test in
`test_api.py` — POST `/v1/admin/rollup` with `"2026-9-1"` → 422.

**B9** — Defect: `band_low_battery` emitted on every heartbeat under 15%. Change:
`ingest.py:181` becomes `if body.battery_pct < LOW and (prev.get("battery_pct") is None or prev["battery_pct"] >= LOW)`.
Check: test — two heartbeats at 10% → exactly one `band_low_battery` event. Trap:
`test_heartbeat_low_battery_emits_event` seeds the band at 88, so it still passes.

**B8** — Defect: `/events/{id}` returns the raw doc with `zone`. Change in
`residents.py:437-444`: `ev.pop("zone", None)`, `ev.pop("derived_from", None)`, and
`ev["embedding_text"] = rag.scrub_rooms(ev.get("embedding_text", ""))` (`rag` is
already imported for `FAMILY_EXCLUDED_TYPES`; widen that import). Keep every other key
— the client reads `embedding_text`, not `sentence`. Check: test in `test_reads.py` —
emit an event with `zone="bathroom"` and text "Eleanor moved into the bathroom"; GET;
assert `"zone" not in body` and `"bathroom" not in body["embedding_text"]`. Trap:
`test_get_event_by_id` asserts `id`, `type` and no `_id` — unchanged.

**B7** — Defect: `/admin/simulate` leaves `presence._OPEN` intervals open, so a second
run of the same kind extends the old episode and emits nothing. Change: first line of
`simulate_camera` (`camera.py:640`): pop every `presence._OPEN` key whose `[0] ==
resident_id`. Check: test — simulate `meal` twice; assert two `meal_observed` events.
Trap: `test_simulate_out_of_view_flips_presence_and_writes_one_exit` runs `meal` then
`out_of_view` and still expects one `room_exit` — popping the meal interval does not
change that.

**B3** — Defect: `broadcast` awaits each socket serially with no timeout. Change in
`live.py:45-50`: collect `_send` coroutines and `await asyncio.gather(*[asyncio.wait_for(c, 2.0) ...], return_exceptions=True)`;
on `TimeoutError` pop the socket from `_connections` (mirror the dead-socket branch in
`_send`). Check: test in `test_api.py` — insert a fake socket whose `send_json` sleeps
5 s into `live._connections` (the pattern at `test_camera.py:498-503`), time
`broadcast`, assert it returns under 3 s and the socket is gone. Trap: `_send` takes the
per-socket lock; the timeout must wrap the whole `_send`, not just `send_json`.

**B1 + B2 (+mirror)** — Defects: (a) a `watching` heartbeat writes `paused_until: None`,
erasing a family pause; (b) `resume` is keyed on `_is_paused and paused_by == "resident"`;
(c) a `paused` heartbeat stamps `paused_by: "resident"` even when the pause it is echoing
was the family's, so Resume 403s one heartbeat after Pause. Change in
`camera.py:264-274`: build `sets` without `paused_until`/`paused_by`; then
`if body.state == "paused": sets["paused_until"] = ...; sets.setdefault-style: only set paused_by="resident" if camera.get("paused_by") != "family"`;
`elif body.state == "watching" and camera.get("paused_by") != "family": sets["paused_until"] = None; sets["paused_by"] = None`.
In `resume_camera` (`:593`): guard becomes `camera.get("paused_by") == "resident"` alone.
Check: three tests — family pause → `watching` heartbeat → ingest still 403; family
pause → `paused` heartbeat → resume 200; resident pause (heartbeat) → `watching`
heartbeat → ingest 201. Trap: `test_the_app_cannot_undo_a_pause_she_set_on_her_own_hub`
and `test_pause_from_the_app_stops_the_ingest_and_resume_starts_it` must stay green;
`_is_paused` still gates ingest (`:150`), so an expired resident pause clears on the
next `watching` heartbeat, not by time alone — that is the intended ownership rule.

**B12 (call site)** — Change: `ingest.py:220` → `location.observe(resident_id, scan, ts=body.ts)`
(tz-normalise as `ingest_band` does at `:118`). Check: test in `test_ingest.py` — with
bathroom fingerprints seeded and `LOC_COMMIT_TICKS` default 2, post the same bathroom
scan twice at `ts=T` (commits), then once at `ts=T+BATHROOM_THRESHOLD_S+1`; assert one
`bathroom_prolonged` event. Requires S3's kwarg.

### S3 — Signals

**A3** — Defect: `**result` is spread last in `_emit_deviation` (`baseline.py:360-366`)
and re-clobbers the damped `severity`, so the rate limiter never damps. Change: move
`**result` to the first line of the dict. Check: test — seed 10 days of `meal_count=3`
via `update_feature`, then call `_emit_deviation` twice for the same feature/date; assert
the second event's `payload.severity == "info"` and `payload.raw_severity` is the
original. Trap: none in tests; see §4 for the demo consequence.

**A6** — Defect: reads `payload.duration_s`, `location.py:239` writes `dwell_s`. Change
`baseline.py:416`: `.get("dwell_s", p.get("duration_s", 0))`. Check: test —
`_derive_features([{type: "zone_dwell", zone: "kitchen", payload: {dwell_s: 600}, ts_epoch: ...}], tz)`
→ `time_in_kitchen_s == 600`.

**A11** — Defect: an empty day writes `meal_count=0` and scores as a warn. Change in
`rollup` (`baseline.py:449`): `if not docs: return {}` before deriving features. Check:
test — `rollup` on a date with no events writes no `baseline_observations` row. Trap:
`/admin/rollup` still calls `rag.daily_narrative` afterwards, which handles an empty day
via the template — unchanged.

**A7** — Change: move `_STATE[resident_id] = new_state` (`location.py:242`) to
immediately after `step()` at `:193` (same dict object; later mutations still land). No
test (ordering only).

**B12 (kwarg)** — Change: `async def observe(resident_id, scan, ts: datetime | None = None)`;
`now = ts or datetime.now(timezone.utc)`. Existing callers unchanged. Test lives in S2.

**A5 (cheap)** — Change: `_fingerprints_for` (`location.py:182`) adds `if d["zone"] in ZONES`.
Check: extend `test_classify_*` in `test_location.py` — a `dining_room` fingerprint is
ignored by `step()` rather than freezing the posterior. Trap: `scripts/simulate_band.py:197`
writes fingerprints straight to Mongo with whatever zone it is given.

**A12 (cheap)** — Change: in `presence._flush` update branch (`:259-265`), after the
`update_one`, `asyncio.create_task(rag._embed_and_store(iv["event_id"], text))` with a
lazy `from . import rag`. Check (only if S2 is done, in `test_camera.py`): after a
fourth eating observation extends the meal, `rag.drain_embeddings()`, assert the stored
`embedding` equals `rag._hash_embed(new_text)` under the `no_llm`/hash fallback. Trap:
`rag` imports `presence`? It does not, but `camera.py` imports both — keep the import
lazy.

### S4 — Vision

**C7** — Change `vlm.py:199`: `"walking"` → `"standing"` (already in `ACTIVITIES` and
`presence._ACTIVITY_WORD`). Check: assert in `test_posture.py`: `from_scene(scene_with_one_person, "tall")["activity"] == "standing"`.
Trap: `test_the_scripted_day_contains_the_three_episodes_the_dedup_needs` asserts
"walking" appears in the *synthetic script*, which is not `from_scene` — untouched.

**C8** — Defect: any food + a person = `eating` from YOLO alone. Change `vlm.py:196`:
`elif scene["food"] and posture != "upright":`. Check: `from_scene(food_scene, "tall")["activity"] != "eating"`
and `from_scene(food_scene, "mid")["activity"] == "eating"`. Trap:
`test_openvocab.py:108` and `test_vision_gate.py:666` pass `"mid"` — still eating; `:683`
passes `None` with zero people — still absent. Do not require `dishes`: at a table the
knees are occluded and posture is `"unclear"`, and the meal beat must still fire.

**C12** — Change `vision/__init__.py:118-120`: add `on_person_appear_gap_s=12` to `DEMO`.
Check: one assertion `DEMO["on_person_appear_gap_s"] == DEMO["absent_after_s"]`. Trap:
`test_demo_tuning_only_changes_the_numbers` checks values, not the key set.

**C11** — Change `worker.py:491-496`: the `elif reason and reason != "absent"` becomes an
independent `if` (guarded so the pass does not run twice on a frame that met both). No
test (one keyword); `test_the_worker_skips_the_open_vocab_pass_when_the_flag_is_off`
covers `_openvocab` itself.

**C10** — Defect: a 200 with a non-dict body reaches `cfg.get()`. Change
`worker.py:121-134`: after `_fetch_config`, `if not isinstance(cfg, dict): log(...); self.cfg = dict(NO_CONSENT); return`.
Check: test in `test_posture.py` — monkeypatch `w._fetch_config` to return `"<html>"`;
`w._refresh_config()`; assert `w.cfg == worker.NO_CONSENT`.

**C1** — Defect: a body along the optical axis reads tilt≈0 and knee-above-hip →
`seated` at full confidence. Change `posture.py:194-202`: compute
`shoulder_w = |pt(L_SHOULDER) - pt(R_SHOULDER)|`; `if torso_len < shoulder_w: return ("unclear", torso_vis)`
before the tilt test. Check: test in `test_posture.py` using the file's landmark
helpers — shoulders 0.30 apart, hips 0.05 below shoulders, knees visible above hips →
`"unclear"`. Trap: `test_a_genuinely_horizontal_body_is_on_floor` builds a torso
lying sideways, where `torso_len` is large — unaffected; check the helper's default
shoulder width so `test_standing_is_upright` still has `torso_len > shoulder_w`.

**C2** — Defect: the quick scene-changed path (`worker.py:444-478`) posts `on_floor`
from one wide frame; `on_floor_confirm` only governs the VLM lane. Change: add a
read-only property `KeyframeSelector.floor_confirmed` = `self.wide_run >= self.t["on_floor_confirm"]`;
in the quick path, compute `band = posture_band(box, self.tuning)` once and
`if band == "wide" and not selector.floor_confirmed: band = None` before it enters
`shape` and `from_scene`. Check: pure test in `test_posture.py` — `floor_confirmed` is
False after one `BOX_FLOOR` update and True after two. Trap: the quick block runs one
line *before* `selector.update` (`:480`), so `wide_run` lags one frame — acceptable; do
not move `selector.update` above the quick block (it changes `reason` timing).

**C14 (cheap)** — Change `vlm.py:162`: `Observation.model_validate_json(_strip_fence(raw))`.
Check: monkeypatch `_post` to return a fenced reply on both calls; `call()` succeeds.

**C4 (cheap)** — Defect: a real fall inside a prior false `on_floor`'s 30 s cooldown is
delayed until the cooldown or `min_gap_s` expires. Change `keyframe.py:65-66`:
`cooled = ... or self.wide_run >= 2 * T["on_floor_confirm"]`. Check: test — fire
`on_floor` at t=3, seated at t=4, wide from t=10..13 → `"on_floor"` at t=13. Trap:
`test_on_floor_obeys_its_cooldown` uses a 2-of-3 wide pattern where `wide_run` never
exceeds 2, so a bypass at 4 keeps it green; `test_on_floor_does_not_spam_when_the_bbox_oscillates`
resets the run every frame — unaffected.

**C6 (cheap, last)** — Defect: the device stays open (LED on) through `no_consent`/
`paused`. Change in the `st != "watching"` branch (`worker.py:367-385`): `if cam is not None: cam.close(); cam = self.cam = None`;
at the top of the watching path, `if cam is None: cam = self.cam = SyntheticCamera() if self.synthetic else Camera(self.source)`.
`cam.close()` in `finally` must tolerate `None`. Check: extend
`test_a_paused_camera_stops_saying_what_it_last_saw` — no, that file is off-limits;
write the same harness call in `test_posture.py` and assert the frozen camera's
`.closed` is True at the moment the monkeypatched `monitor` fires. Trap: `Camera()`
raises `CameraUnavailable` on reopen failure — catch it, log, and keep polling rather
than let it out of `run()`.

### S5 — App

**D12** — Change `lib/copy/family.ts:455`: `has been in one place a long time.` (the
kind label at `:449` "Long bathroom stay" is also a room name — change to "A long stay
in one place"). No new screen, card or badge. Check: `tsc` + copy audit.

**D3** — Change `(staff)/rounds/index.tsx:83`: `{!!data && (`. Trivial, no test.

**D9** — Change `(staff)/triage/resident/[id].tsx:341`: `key={`${c.id}_${i}`}` with the
map index. Trivial.

**D15** — Change `onboard/done.tsx:110`: `onPress={saved ? () => router.replace(<wherever save() navigates>) : save}`
— read `save()`'s tail (`:95-100`) for the route it already uses. One ternary; no new
state.

**D4** — Change `(staff)/triage/index.tsx:194-202`: add `catch { setDemoNote(copy.demo.backendError); }`
— reuse the existing string; `demoNote` already renders on that screen. If a dedicated
string reads better, add exactly one key `ackFailed` under the same object in
`lib/copy/staff.ts`. Do not add a card.

**D1** — Defect: family client is unscoped and the poll takes `open[0]` facility-wide.
Change (a) `store/live.ts:102`: `const { role, residentId } = useSession.getState(); new LiveClient(role === 'staff' ? undefined : residentId, ...)`;
(b) `app/_layout.tsx:89-96`: `const mine = role === 'staff' ? open : open.filter((a) => a.resident_id === residentId)` and use `mine[0]`.
Read `role`/`residentId` via `useSession.getState()` inside the callback so the effect
deps stay as they are. Also delete the stale comment at `:84-88` (the backend does
broadcast on every transition now). Check: `tsc`; rehearse the fall on the family phone
(§4). Trap: `connect()` is guarded by `if (unsubscribe) return`, so a role chosen
*after* the first connect keeps the unscoped socket — call `unsubscribe` and reconnect
in `setRole`, or accept that the 5 s poll filter alone protects the family lane (it
does; the socket only pushes `alert.update`, which `applyEvent` also stores as
`activeAlert` — so the socket path needs the filter too: in `applyEvent` `alert.update`,
ignore alerts whose `resident_id` is not the session's when role is family. One `if`.)

**D10 (cheap)** — Change `lib/hooks.ts:32-39`: add `useSession((s) => s.residentId)` to
each of the three query keys. Three one-liners.

**D13 (cheap)** — Move the two English strings in `components/alert-extras.tsx:44,94-96`
to `lib/copy/family.ts` under `alert` and pluralise with the existing pattern the copy
file uses elsewhere. No new component.

**D7 (cheap)** — `useCameraMonitor` gets `enabled: !!cameraId && useIsFocused()`; the two
1 s timers in `(family)/camera/index.tsx` get an `isFocused` guard in their effects.

**D8 (optional tail)** — In `chat/index.tsx:54`, `send(question, { retry = false } = {})`;
skip the `setMessages` append at `:60` when `retry`; `:211` passes `{ retry: true }`.
Skip entirely if the file's mtime is under 30 minutes old.

### S6 — RAG (only if idle)

**B13** — `rag.py:139`: `if doc["type"] in NOISY_EVENT_TYPES or doc["type"] == "daily_summary": return`.
Check: in `test_rag.py`, after `daily_narrative`, `drain_embeddings()`, assert the stored
vector equals `embed([full_narrative])`.

**B14** — `rag.py:513-516`: apply `$in` and, when `family`, `$nin` as two independent
conditions (`{"$in": [...], "$nin": [...]}` on the same key). Check: `search(...,
family=True, only_types=["zone_entered"])` returns nothing.

**B5** — Narrow `_IMAGERY`'s last alternative (`rag.py:348`) to
`\b(watch|look at)\s+(her|...)\b|\bsee\s+(her|him|them|mum|mom)\s+(now|live|right now|on (the )?camera)\b`.
Check: add "Has anyone come to see her?" to the not-refused list in `test_rag_guard.py`
and keep `"I want to watch her for a minute."` refused. Leave `_PRIVATE_ROOM` alone.

**B11** — Wrap `rag.py:717-719` in `asyncio.wait_for(..., 10.0)` with `except
asyncio.TimeoutError: text = _template_answer(hits)`. Check: monkeypatch `_llm_answer`
to sleep 20 s; `answer_family` returns in under 11 s with the template answer.

---

## 4. Risk list — what a wrong fix does to the live demo

1. **A13 dedup swallowing new falls.** If the `opened_at` bound is forgotten, one stuck
   alert makes every later "Simulate a fall" return the old id and nothing new opens on
   stage. Keep the 1 h bound; rehearse: simulate, cancel, simulate again → a new id.
2. **A8 stale-close on startup.** Runs on every `uvicorn --reload`. If the cap is too
   low it closes the alert you are demoing after a hot reload. 1 h is far above any
   ladder; never lower it for "snappiness".
3. **B1/B2 heartbeat ownership.** Wrong direction → the hub can never clear a resident
   pause (camera stuck paused; ingest 403 → worker flips to NO_CONSENT) or the family can
   never resume. Do this fix last in S2 and rehearse the privacy beat both ways:
   family Pause → Resume in the app; hub `p` → wait for expiry → watching. This is the
   one backend change worth reverting wholesale if the beat misbehaves.
4. **A3 real damping.** After the fix, running "Write this day's story" twice for the
   same day downgrades the second run's deviations to `info` (one per feature per day,
   two per 24 h). If the demo script rolls up the same date repeatedly and expects a
   "Change in routine" row each time, it will not get one. Rehearse the rollup beat once,
   from a clean seed.
5. **C8/C2 tightening the quick path.** The meal tile could appear a beat later if the
   detector's posture band reads `tall` at the table; `mid`/`unclear` still say eating.
   Rehearse the meal beat with the real camera and the real table before accepting C8.
6. **C6 camera reopen.** A reopen that raises inside `run()` would end the lane; the
   note says catch it, but this is the change most likely to misbehave on a different
   Mac. Do it last, rehearse pause → resume on the hub, and revert if the LED/reopen is
   flaky — the eight lines are self-contained.
7. **D1 scoping.** If the session's `residentId` is not the alert's (reseeded database,
   renamed resident), the family phone silently never shows the takeover. Rehearse the
   fall on the family phone after seeding; staff lane is unchanged.
8. **B3 socket timeouts.** A phone on bad venue wifi gets dropped after 2 s and
   reconnects via `LiveClient`'s backoff; between drop and reconnect the 5 s poll covers
   alerts, presence refetches at 15 s. Acceptable; do not shorten the timeout below 2 s.
9. **Concurrent edits.** `alerts.py`, `voice_adapter.py`, `worker.py`,
   `test_vision_gate.py`, `chat/index.tsx`, `home/index.tsx` are moving. S1 and the
   `worker.py` lines of S4 are the streams that can collide; both are planned last and
   with minimal line ranges. S6 is skipped outright unless `rag.py`/`llm.py` go quiet.
10. **Nothing here needs an env flag.** Every change is either a pure-function
    correction, a guard, or a one-line condition; the rollback unit is the stream's
    commit. Order of landing for safety: S3 → S2 (B1/B2 last) → S4 (C6 last) → S5 →
    S1 → S6.
