# Known issues, and the ones we chose not to fix

A four-way audit of this repo (backend state machines, routers and RAG, the
camera lane, the app) turned up 65 defects. 48 were fixed, each with a test
that fails without its fix. This page is the rest: what is still wrong, and
why the things we left are the right things to leave.

Written against the tree on 2026-09-20. The backend suite is 347 tests.

## Still open

| What | Where | Why it is still here |
|---|---|---|
| Retrying a failed question re-appends the question | `frontend/src/app/(family)/chat/index.tsx:54,60` | The thread shows the question twice with one answer. Cosmetic, and the file was under concurrent edit for the whole campaign. |
| `beacon_offline` has no emitter | `events.py` taxonomy, `band/fallband/config.json` | The event type, the docs and the demo prop all exist; nothing ever raises it. Unplugging a beacon degrades the room to `unknown`, which is the honest behaviour, just not the announced one. |
| `RETRY_RESIDENT` is unreachable automatically | `alerts.py` | The timer out of `CALLING_RESIDENT` is `silence` → `CALLING_CONTACT_1`. The documented "exactly one retry" only happens on an explicit `classify("no_answer")`. |
| `push_tokens` is written and never read | `routers/setup.py`, `push.ts` | See D2 below — there is no sender. |
| D-004's 7-day transcript retention is not implemented | `db.py` | `observations` is the only TTL index. Call transcripts persist until the DB is dropped. |
| `speak_final_escalation` only logs the address | `voice_adapter.py` | `alerts._final_escalation` is written as though the address and the 911 guidance are spoken. They are not. |
| `location.py` ships a 7-zone graph for a 4-beacon deployment | `location.py:24` | Harmless (unvisited zones simply never win) but the graph is not the venue. |
| Resume after a lapsed resident pause returns a bare 403 | `presence.py`, `camera.py` | `GET /presence` reports `paused_by` only while the pause is live; `resume` refuses on ownership regardless. Individually correct, together unusable. Logged as F-17 in `DECISIONS.md`. |

## Deliberately not fixed

**Push notifications (D2).** Nothing in the backend sends a push — `push_register`
stores a token and no code ever posts to `exp.host`. Registration also needs a
dev build and an EAS project id, neither of which exists. The demo runs the app
foregrounded, where the websocket and the 5 s poll open the takeover anyway.
The upgrade is a ~20-line Expo push POST in `alerts.open_alert`, then moving
`registerForPush()` after `finishOnboarding` and adding `useLastNotificationResponse`
to `_layout` — in that order, because the last two are useless without the first.

**Regex guards are phrasing-dependent (B15).** The medical guard refuses "Is she
taking her medication?" and passes "Should I take her to the doctor?". Widening
the pattern trades one kind of wrong answer for another; the honest upgrade is a
classifier call in `hard_refusal`, not a longer regex. The system prompt is the
backstop today, and we say so rather than pretending the regex is the control.

**"Did she get out of bed yet?" is refused, and stays refused.** It reads as a
bedroom question and `tests/test_rag_guard.py:56` pins it. That is the product
rule, not a bug — the `bed_exit` lane is reachable by pattern, not by name.

**`resolution: "fell_ok"` on a non-terminal alert (A14).** The PRD's wording, and
`tests/test_alerts.py:121` pins it. The app dismisses on `closed_at`, which stays
null until the alert is terminal, so nothing user-visible is wrong.

**Two simultaneous alerts (D11).** The store holds one `activeAlert` by design. A
second alert surfaces when the first takeover is dismissed. Not a demo path, and
a queue is more machinery than a one-resident home needs.

**`--source photo.jpg` freezes the lane (C13).** Rehearsal-only source; the demo
runs a live camera or `make vision-synthetic`.

**`--ollama <remote host>` ships frames off-box.** That is the operator explicitly
asking for it. Worth a loopback warning; not worth a guard that lies about being
a boundary.

**Cosmetic, measured, and left:** a 250 ms flash on the cancel ring before it
corrects itself, a bounded 20 s polling loop on the onboarding camera test, and
`sms:` deep links using the iOS `&body=` form because the demo phone is iOS.

## What the fixes covered

The 48 that landed, by area: the escalation ladder (one fall is one ladder, a
stale alert closes instead of dialling, an ack cannot be overwritten by a
firing timer, one bad contact leg cannot abort the rung), the camera pause
model (three ownership directions, each tested), the family privacy surface
(`/events/{id}` and `/timeline` shaped server-side, so the client scrub is no
longer the control), the signals (the deviation damper actually damps, room-time
features read the key the producer writes, an outage is not a day she did not
eat), the camera lane (a foreshortened body returns `unclear` instead of a
confident `seated`, one frame cannot post `on_floor`, the device closes when
consent is withdrawn), and the app (a family phone can no longer take over for
another resident's fall).

`git log` has them individually. `docs/DECISIONS.md` D-026 through D-028 records
the three that were decisions rather than repairs.
