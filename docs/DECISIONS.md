# DECISIONS — Dhyaan

A running log of design decisions that change what the specs say. Each entry records **what was
decided, why, what it replaced, and which files changed**, so anyone reading a spec can see where a
rule came from and anyone changing one can see what depends on it.

**How to use this file.** Add a new entry (next ID, today's date) whenever a decision changes a spec,
the demo, or a promise we make to judges. Never rewrite an old entry — supersede it with a new one and
mark the old one `Superseded by D-0xx`. Code follow-ups that a decision creates go in the table at the
bottom, with an owner.

---

## Where things live

| File | Owns | Wins a conflict on |
|---|---|---|
| [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md) | Product, personas, pricing, trust/consent, legal and regulatory posture, **the canonical demo script (§10)**, prize tracks | What we promise users and judges |
| [`TECHNICAL_PRD.md`](./TECHNICAL_PRD.md) | Software design: event model, alert FSM, voice, vision, localization algorithms, baseline + walking-profile learners, RAG, app, API surface | The API surface (paths, roles, what each role may see) |
| [`HARDWARE_SPEC.md`](./HARDWARE_SPEC.md) | The band, beacons, radios, power, the fall detector, calibration, test plan | Sensor configuration, detector thresholds, physical test procedure |
| [`backend/fixtures/*.json`](./backend/fixtures/) | The exact wire payloads the band sends | Payload shapes — **fixtures beat prose** in any spec |
| [`./backend-README.md`](././backend-README.md) | What the backend actually runs today | What is built (the PRD describes the original design; see its build-status block) |
| [`./HARDWARE_INTEGRATION.md`](././HARDWARE_INTEGRATION.md) | Swapping the band simulator for the real band; per-endpoint requirements | Nothing on its own — `backend/app/routers/ingest.py` and the fixtures are the contract it describes |
| `utsavtodo.md` · `ayushneedtodo.md` · `abhinavtodo.md` | Per-person task lists for the 24 h build | Who does what, and when |
| [`frontend/DESIGN.md`](./frontend-DESIGN.md) | App design system and screen rules | Visual design |
| `distinctive-frontend.md` | General (web) design guidance that `frontend/DESIGN.md` translates to React Native | Nothing directly — `frontend/DESIGN.md` is the applied version |
| **`DECISIONS.md`** (this file) | Why the specs say what they say | — |

---

## Decisions

### D-001 · Family app never shows which room the resident is in
**Date:** 2026-09-19 · **Status:** Accepted

**Context.** `PRODUCT_SPEC.md` §3.1 and §8 promise Margaret that her son "can't see where you are", and
§12.2 calls a family API that returns no room identifiers "the test" of the whole pitch. The PRD's app
spec (§10) and the built app did the opposite: a live "In the kitchen · 12 min" card, a per-day
room-time bar, room-level `location.changed` messages and a "40 minutes in the bathroom" push to family.

**Options.** (a) Keep the promise and change the family surfaces. (b) Drop the promise from the pitch.

**Decision.** (a). The family sees *home / out*, counts and deviations from her own baseline, and
nothing room-level. Staff (facility product) keep live room-level location, with access logged. The
single exception: **an emergency escalation call** — a fall the resident did not cancel or answer —
may name the room, so whoever goes to help knows where she is. That exception is now written into the
consent copy so the copy stays literally true.

**Why.** The promise is the core of the Long Lake and Meta arguments and of the consent flow, and it
costs only a few family screens and an API role check.

**Changed.** `TECHNICAL_PRD.md` §7.4, §7.6, §9.7, §10.1, §10.3–10.5, §12.4, §13 · `PRODUCT_SPEC.md`
§3.1, §8.4 · `frontend/DESIGN.md` · todo files. **Follow-ups:** F-01 – F-04.

### D-002 · No person is contacted during the cancel window
**Date:** 2026-09-19 · **Status:** Accepted

**Decision.** The band reports a confirmed fall to the hub immediately (so a band that breaks on
impact still escalates — `HARDWARE_SPEC.md` §6.7), but **nobody is notified** until the cancel window
ends. The family app shows a fall only when the ladder reaches the family (or as one quiet timeline
line if the resident resolves it herself). Staff and the demo operator screen may show the countdown.

**Why.** `PRODUCT_SPEC.md` §5.1/§5.3 ("Dan's phone does not ring… he found it because he asked") and
the consent copy depend on it. The PRD pushed "Possible fall — calling Eleanor now" to the family at T+0.

**Changed.** `TECHNICAL_PRD.md` §4.2, §10.4 · `PRODUCT_SPEC.md` §5.1. **Follow-up:** F-05.

### D-003 · Regulatory wording: "research prototype, not FDA-cleared, cannot detect all falls"
**Date:** 2026-09-19 · **Status:** Accepted

**Context.** `PRODUCT_SPEC.md` §8.7 now concludes the automatic fall-alert path is *probably* a medical
device. The demo opener, the PRD's disclaimer, the welcome screen and all three todo lists still said
"not a medical device".

**Decision.** Everywhere we speak or show a disclaimer, use: *"Dhyaan is a research prototype. It is
not FDA-cleared or approved, is not intended to diagnose or treat any condition, cannot detect all
falls, and does not call emergency services."* Product output never names a condition (e.g. the night
nurse page no longer says "possible UTI / delirium onset").

**Changed.** `TECHNICAL_PRD.md` §10.1, §12.1, §13 · `PRODUCT_SPEC.md` §5.4, §10 · todo files.

### D-004 · Every call discloses recording and AI; `stop_recording` is a real tool; we store text, not audio
**Date:** 2026-09-19 · **Status:** Accepted

**Context.** `PRODUCT_SPEC.md` §8.5 makes a disclosure in the first sentence the legal safe harbour
(Massachusetts, where HackMIT is held, is the strictest all-party state). The PRD greeting, the four
agent tools and the built greetings (`dhyaan/voice/settings.py`) had no disclosure and no
`stop_recording`. The two docs also disagreed on retention.

**Decision.** Both greetings open with *"this is Dhyaan, an automated safety check… this call is
recorded for her log — say 'stop recording' any time."* A fifth client-side tool, `stop_recording`,
stops the transcript, deletes what was captured on that call, and the agent confirms out loud; the
incident is still logged as metadata. **Call audio is never stored**; transcripts are kept 7 days,
then only the classification survives.

**Changed.** `TECHNICAL_PRD.md` §4.5, §4.6, §5.2, §5.5 · `PRODUCT_SPEC.md` §8.2, §8.5. **Follow-up:** F-06.

### D-005 · Dhyaan never dials or bridges 911
**Date:** 2026-09-19 · **Status:** Accepted

**Decision.** The resident call never mentions 911. Family calls and the final ladder step give 911
guidance and the address; the app's "Call 911" button opens the phone's dialer. The product spec's
"Agent dials 911 and stays on the line" and "bridged 911 call" are removed.

**Why.** The PRD already put 911/PSAP integration out of scope; automated calls to 911 are not
something to build or demo in 24 hours.

**Changed.** `PRODUCT_SPEC.md` §4.1, §5.1, §7.3, §8.4, §8.5, §10.

### D-006 · Escalation is voice + push only — no SMS
**Date:** 2026-09-19 · **Status:** Accepted (made by the team earlier today; recorded here)

**Decision.** A2P 10DLC registration gates SMS and will not clear in 24 hours, so the ladder is voice
end to end, plus pushes. This entry finishes the change in the files that still said SMS.

**Changed.** `PRODUCT_SPEC.md` §4.1, §5.1, §7.3 · `HARDWARE_SPEC.md` §2 · `TECHNICAL_PRD.md` §4.2 reference.

### D-007 · One canonical demo script, with timings the system can actually hit
**Date:** 2026-09-19 · **Status:** Accepted

**Context.** Two different 3-minute scripts existed (`PRODUCT_SPEC.md` §10, `TECHNICAL_PRD.md` §13).
Several beats were impossible under the system's own timers: "no answer" after two seconds (the real
ladder rings 25 s, retries once), a second fall that rings the phone inside a 15 s slot (every fall
starts a new cancel window), a 20 s room-tracking beat (each committed room change takes 20–60 s), and
"31 seconds from the floor to a human" (only true on the 6×-compressed mock).

**Decision.** `PRODUCT_SPEC.md` §10 is the only script; the PRD section points to it and keeps the
operator notes. The stage uses a **10 s cancel window and 20 s contact steps, and we say so**. The
escalation beat is driven by the judge's *answer* (fast — no timeouts involved), not by a no-answer
timeout. Any elapsed-time figure on stage comes from the live run, never a target. The room-tracking
beat and the walking-profile before/after move to the **expo-table demos** (§10.2), where they have
room to run at real speed.

**Changed.** `PRODUCT_SPEC.md` §10 · `TECHNICAL_PRD.md` §7.8, §13 · todo files. **Follow-up:** F-07.

### D-008 · The stage fall is a 0.5 m band drop onto a firm cushion; four detector fixes
**Date:** 2026-09-19 · **Status:** Accepted

**Context.** A band dropped from 1 m is in free fall for ~450 ms, and the detector sends anything over
`FF_MAX_MS = 400` back to IDLE as "dropped, not worn" — so the planned 1 m drop could only fire through
the stricter no-free-fall path. The calibration routine also set the free-fall threshold from band
drops (which read ~0 g), which would push it to ~0.1 g — below what a real forearm fall reaches
(0.3–0.6 g). And "an unworn band must never alert" would block a band lying still after the drop.

**Decision.**
1. Stage and test drops are **0.5 m** onto a **firm** cushion stack (≈320 ms of free fall — well
   inside the window; ≈5–10 g on landing). `FF_MAX_MS` stays 400. Not a soft mattress: from 0.5 m it
   can land under the 2.8 g after-free-fall bar. (0.6 m was considered first; it left only ~50 ms of
   margin under 400 ms.)
2. **`FF_THRESHOLD_G` is not fitted from drops.** It stays at the physics value (0.40 g). Drops
   validate the pipeline and the impact thresholds only.
3. **`worn` is judged on the 10 s *before* an event**, not the stillness after it. A band that was
   moving before an impact is worn, even if it lies still afterwards.
4. **The ring buffer grows from 512 to 1024 samples** (2.46 s → 4.9 s, 6 kB), so the fall trace —
   1 s before the impact through the end of the stillness check — is still in memory when the event is
   sent. The old ±4 s trace could not fit in 2.46 s, and 3 s of post-impact data did not yet exist
   when the event went out 2.2 s after impact.

Plus: test case 8's expected signature now describes a dropped band (≈0 g for ~320 ms), not a
forearm fall.

**Changed.** `HARDWARE_SPEC.md` §5.1, §5.5, §5.7, §6.4, §6.8, §7.2, §9, §10.1, §10.2 ·
`TECHNICAL_PRD.md` §4.1, §13 · `PRODUCT_SPEC.md` §10 · `utsavtodo.md`.

### D-009 · Per-wearer walking profile: learned on the hub, applied on the band
**Date:** 2026-09-19 · **Status:** Accepted (stretch goal, ~3 h)

**Context.** Heavy steps and walk-then-stop movements produce impacts the fixed thresholds must
tolerate, which also forces those thresholds high enough to miss soft forearm falls. The Arduino track
rewards systems that turn sensor data into "intelligent experiences".

**Decision.** Workshopped choice by choice:

| Question | Choice |
|---|---|
| Goal | Lower the impact bar for light walkers (catch softer falls), raise it within limits for heavy walkers, cut impact-only noise, and give the pitch a real "it learns her" story |
| Where it runs | **Hub learns, band applies.** The band enforces the profile on every sample and keeps the last one offline. Wording: "personalized on-device detection" — never "on-device learning" |
| Model | Per-wearer online robust statistics (no training loop), same style as the baseline learner |
| Learns from | Steady walking windows with no alert nearby · the onboarding 20-step walk · button cancels and voice `mark_ok(status="fine")` · `impact_only` events. Never `fell_but_fine` |
| Authority | Moves **only** `IMPACT_G_SOFT` (and `IMPACT_G_AFTER_FF` = soft − 0.7). Never the angle, stillness or free-fall checks. The cancel button always works |
| Bounds | Floor **2.5 g**; ceiling **`F_min` − 0.3 g**, where `F_min` is the softest calibration drop — so every calibrated fall still fires |
| Walk-then-stop | Cancels shift the threshold within the bounds; a gait-match term enters the confidence score (routing and sort order only — it never blocks an alert) |
| Guardrails | 14-day half-life; at most ±0.1 g of change per day; fast "calibration mode" only for onboarding and demos; a >20 % shift within 7 days freezes the profile and emits a staff-only, advisory `gait_profile_shift` |
| Uplink / downlink | A walking summary rides on each heartbeat; the heartbeat response carries the current profile |
| Demo | Arduino expo-table before/after: stomp → impact ticker + demo-only chirp → 60 s calibration walk → live threshold readout rises → stomp ignored → a 0.5 m drop still fires |

**Changed.** `TECHNICAL_PRD.md` §3.2, §4.1, §8.1, new §8.7, §10.1, §10.5 · `HARDWARE_SPEC.md` §5.1,
§5.7, §6.4, §6.5, new §6.9, §7.2, §9, §10.2, §11, §13 · `PRODUCT_SPEC.md` §4.1, §5.2, §10.2, §11.
**Follow-ups:** F-10 – F-12.

### D-010 · The home product only claims what the band and beacons can sense
**Date:** 2026-09-19 · **Status:** Accepted

**Context.** The PRD's family screens offered "ate" tiles, "has she been eating?" and "how did she
sleep?" chips, and a "didn't walk" push — but the home product has no camera, so meals, sleep and
camera-detected walks are never observed.

**Decision.** Home tiles are *walked* (band steps, from D-009's step detector), *up at night*,
*out of the house*, *active*. Chips are "Has she been out this week?", "How were her nights?",
"Anything unusual this week?". Meal and camera-walk features are facility-only. A new baseline
feature, `steps_day`, comes from the band.

**Changed.** `TECHNICAL_PRD.md` §1, §8.1, §8.4, §9.1, §10.1, §10.4. **Follow-up:** F-08.

### D-011 · The PRD describes the original design; a build-status block says what runs
**Date:** 2026-09-19 · **Status:** Accepted

**Context.** The built backend is FastAPI + MongoDB (Docker), numpy brute-force search, two static
shared keys, and a `/v1/live` websocket; the band contract is `backend/fixtures/*.json`. The team is
three people, not four. The PRD still described one SQLite file with sqlite-vec, JWT auth and a
four-person plan.

**Decision.** Don't rewrite the design sections mid-hackathon. Add a build-status block at the top of
the PRD, mark superseded sections, and point to `./backend-README.md` and the fixtures.

**Changed.** `TECHNICAL_PRD.md` (top), §2, §13 · `HARDWARE_SPEC.md` §5.4, §11.

### D-012 · Facility camera features are stretch goals; identity attribution needs one band in view
**Date:** 2026-09-19 · **Status:** Accepted

**Decision.** Camera + VLM is second on the team's cut list and not built as of 17:00 Saturday. The
specs now say "stretch" instead of promising it in the demo. The "identity via the band" rule only
attributes a camera observation when **exactly one** resident's band is in that zone — matching counts
cannot tell two people apart. Plate-state and medication claims are removed or marked roadmap. The
Jetson appliance throughput is marked unverified.

**Changed.** `TECHNICAL_PRD.md` §3.1, §3.2, §7.5, §13 · `PRODUCT_SPEC.md` §4.2, §5.4, §7.3 ·
`HARDWARE_SPEC.md` §10.5, §11.

### D-013 · Hardware honesty: no battery %, no screen, no iPhone beacon scanner
**Date:** 2026-09-19 · **Status:** Accepted

**Decision.**
- The band runs from a USB power bank, which reports no charge level. `battery_pct` is dropped from
  band payloads and screens (heartbeat liveness replaces it). A voltage divider on the band's 5 V input
  cannot estimate it either — the bank outputs a regulated 5 V until the moment it cuts off.
- The band has a buzzer, three buttons with LEDs, and optional Pixels — no screen, no haptics, no
  speech. Pairing uses a code printed on the band. A "location off" control stops scanning in
  software; the radio stays on because it also carries fall alerts.
- The BLE fallback scanner is a spare ESP32 or a Mac running `bleak` — not an iPhone (iOS hides iBeacon
  adverts from Bluetooth scanning, and Safari has no Web Bluetooth).
- The MCU talks to Linux over Bridge (MessagePack RPC), never a GPIO line.

**Changed.** `TECHNICAL_PRD.md` §2, §3.2, §4.1, §10.1, §10.5, §12.4 · `HARDWARE_SPEC.md` §1.1, §11,
§12.3 · `PRODUCT_SPEC.md` §5.1, §8.3 · `utsavtodo.md`. **Follow-up:** F-09.

### D-014 · Elopement latency is stated as measured, not as a target
**Date:** 2026-09-19 · **Status:** Accepted

**Decision.** With a 20 s scan period and a two-scan commit, each room change commits 20–60 s after it
happens. The elopement journey now uses those numbers (a page about a minute after he leaves his room),
the pitch says "from the corridor, before the door", and any on-stage figure comes from the replay
capture. A production band on the elopement roster would scan faster.

**Changed.** `PRODUCT_SPEC.md` §5.6, §7.4, §10.

### D-015 · Worked baseline example corrected
**Date:** 2026-09-19 · **Status:** Accepted

**Decision.** Zero walks against λ = 3.1 gives p = e^−3.1 ≈ 0.045, surprise ≈ 1.35 — a **warn**, not
urgent. Urgent at zero needs λ ≥ ln(100) ≈ 4.6. The seed script already uses λ ≈ 4.7.

**Changed.** `TECHNICAL_PRD.md` §8.2 · `ayushneedtodo.md`.

### D-016 · Demo hallways surveyed as `hallway`, not `transit`
**Date:** 2026-09-19 · **Status:** Accepted

**Context.** `HARDWARE_SPEC.md` §8.4 step 5 says label hallways `transit`, but the hub zone graph
(`backend/app/location.py`) has `hallway` and no `transit` key. Fingerprints labelled `transit` would
never match.

**Decision.** For the taped expo floor plan, survey corridors as **`hallway`**. Four beacons stay on
kitchen / bathroom / bedroom / front_door; hallway is identified by the mid-strength pattern. Demo
adjacency (requested of Ayush as A3):

```
bedroom ── hallway ── bathroom
              │
              ├── kitchen
              └── front_door ── OUTSIDE
```

**Changed.** `ayushextra.md` · band survey docs. **Follow-up:** Ayush A3 (loadable zone graph).

### D-017 · MCU grace window follows hub `cancel_window_s`
**Date:** 2026-09-19 · **Status:** Accepted

**Decision.** On a successful `POST /v1/ingest/band` that returns `cancel_window_s`, the Linux agent
calls `Bridge.call("set_param", "grace_s", …)` so the buzzer/LED cancel window matches the hub's
independent timer. Defaults stay 30 s if the hub omits the field.

**Changed.** `band/fallband/python/main.py` · `sketch.ino` `set_param("grace_s")`.

### D-018 · Fall detector deviations from §6.7 pseudocode
**Date:** 2026-09-19 · **Status:** Accepted

**Decision.** `detector.h` implements §6.5–6.7 with four deliberate changes:
1. `g_pre` is the mean over [−1.5 s, −0.5 s] from the ring, not a running EMA (EMA drags through free-fall).
2. Stillness σ accumulates incrementally during `POST_IMPACT_STILL`.
3. `worn` is snapshotted at impact from the preceding 10 s (D-008).
4. Threshold defaults are compiled in (= §6.4) so the band still detects if Linux is down; `config.json`
   overrides at boot via Bridge.

**Changed.** `band/fallband/sketch/detector.h`.

### D-019 · Physical band identity is `band_unoq01`
**Date:** 2026-09-19 · **Status:** Accepted

**Decision.** The real UNO Q posts as `band_unoq01` so simulator traffic (`band_a3f2`) stays separable
in Mongo (`HARDWARE_INTEGRATION.md`). Seed / pair that id to `res_eleanor`. Until F-09/A4, firmware
sends `battery_pct: 100` as a documented placeholder (`config.json → compat.battery_pct_placeholder`).

**Changed.** `band/fallband/config.json` · `ayushextra.md` A8.

### D-020 · Fall FSM is header-only and laptop-testable
**Date:** 2026-09-19 · **Status:** Accepted

**Decision.** `detector.h` has no Arduino headers so `band/tests/detector_test.cpp` can regression-test
§10.2 synthetics with `make -C band test-detector` before the board exists. Sketch and tests share one
implementation.

**Changed.** `band/fallband/sketch/detector.h` · `band/tests/detector_test.cpp` · `band/Makefile`.

---

## Code follow-ups these decisions create

Docs were changed in the same commit as this file. **Code was not.** Each owner picks these up.

| ID | Owner | What | Where |
|---|---|---|---|
| F-01 | Abhinav | Family home: replace "In the {room} · N min" with home/out + activity; remove the room-time bar from family Home and Timeline (keep it on staff screens) | `frontend/src/app/(family)/index.tsx:111-112`, `:158`; family timeline |
| F-02 | Ayush | Family-role responses omit room identifiers (`/residents`, `/location`, `/location/history`, `/events` zone fields); `location.changed` websocket messages go to staff only | `backend/app/routers/residents.py`, `live.py` |
| F-03 | Ayush | Family-scoped chat: retrieval excludes room-level events and daily narratives never name a room | `backend/app/rag.py` |
| F-04 | Abhinav · Ayush | Remove the family "in the bathroom 40 minutes" push; bathroom-dwell alerts go to the resident call first, family only if the ladder escalates | push + FSM |
| F-05 | Abhinav | Family alert takeover starts at `CALLING_CONTACT_1`, not `SUSPECTED`; staff/operator view may show the countdown | `frontend/src/app/alert/[id].tsx` |
| F-06 | Abhinav | Add the recording + AI disclosure to both greetings and a `stop_recording` client-side tool | `dhyaan/voice/settings.py:102-109`, bridge tool handling |
| F-07 | Abhinav | The alert screen's "31 seconds" applause stat shows the measured elapsed time from the live run | `frontend/src/app/alert/[id].tsx` |
| F-08 | Abhinav · Ayush | Home-product chips and tiles per D-010; `steps_day` baseline feature; home-product priors drop meals. The seed currently gives Eleanor (a home resident) meals — "no lunch today" is the injected anomaly — so either drop meals from her seed and use "no walk" as the anomaly, or seed a facility resident for the meal story | chat screen, tiles, `backend/app/baseline.py`, `backend/scripts/seed.py` |
| F-09 | Ayush | Make `battery_pct` optional on `/v1/ingest/heartbeat` and `/v1/ingest/band` (currently required 0–100 — the band cannot supply it); drop it from the fixtures; fix the `battery_pct` row in the hardware integration guide (a voltage divider cannot read a power bank's charge) | `backend/app/routers/ingest.py:107`, `:167`; `backend/fixtures/*.json`; `./HARDWARE_INTEGRATION.md:17`, `:19`, `:97` |
| F-13 | Ayush | `./HARDWARE_INTEGRATION.md:94` cites `HARDWARE_SPEC.md` §6.9 for the software free-fall detector; §6.9 is now the walking profile — the free-fall detector is §6.4–6.7 | `./HARDWARE_INTEGRATION.md` |
| F-10 | Utsav | Band: step detector + walking summary on each heartbeat; calibration mode; apply pushed thresholds via `set_thresholds`; demo-only chirp on `impact_only` | sketch + `python/main.py` |
| F-11 | Ayush | Hub: walking-profile learner; heartbeat response returns `{profile_rev, profile}`; `gait_profile_updated` / `gait_profile_shift` events | backend |
| F-12 | Abhinav | Staff resident screen (or demo page): live walking-profile readout and impact ticker for the Arduino expo demo | app |
