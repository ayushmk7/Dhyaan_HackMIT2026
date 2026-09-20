# Docs — Dhyaan

If you have never seen this project: Dhyaan is a two-product eldercare sensing
platform (24 hours, HackMIT 2026) built around one event store. An arm-worn
band detects a fall and locates a resident room-by-room from ESP32 anchors; a
voice agent calls her before anyone's family does; and a camera lane on the hub
laptop (motion gate, an open-vocabulary detector, a pose model, then a local
VLM) turns frames into sentences without a pixel ever leaving the machine. The
family app has no login and shows no room; the facility app shows both. The
repo root [`README.md`](../README.md) has the pitch, the architecture diagram,
the measured numbers and the run commands; this page indexes everything under
`docs/` plus the per-lane guides that live next to their code.

## Start here

1. [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md): what we promise users and judges
2. [`TECHNICAL_PRD.md`](./TECHNICAL_PRD.md): the software design behind that promise
3. [`DECISIONS.md`](./DECISIONS.md): every place the two disagree, and why
4. [`backend-README.md`](./backend-README.md): what actually runs, and how to run it
5. [`../DEMO_RUNBOOK.md`](../DEMO_RUNBOOK.md): the beat sheet, boot order and recovery moves for the live demo

## Everything else, by role

| Doc | What it is |
|---|---|
| **Specs** | |
| [`HARDWARE_SPEC.md`](./HARDWARE_SPEC.md) | Band, beacons, radios, power, the fall detector, calibration, physical test plan |
| [`VLM_PLAN.md`](./VLM_PLAN.md) | Camera lane implementation plan: cascade, privacy mechanism, known ceilings |
| **Contracts (frozen; code implements these exactly)** | |
| [`API_CONTRACT_V2.md`](./API_CONTRACT_V2.md) | Setup/admin surface: band pairing, RF survey, contact ladder, push, `/admin/simulate` |
| [`API_CONTRACT_V3.md`](./API_CONTRACT_V3.md) | Camera lane wire contract: `/ingest/camera`, `/camera/config`, presence |
| [`HARDWARE_INTEGRATION.md`](./HARDWARE_INTEGRATION.md) | Swapping the band simulator for the real band, endpoint by endpoint |
| **Per-lane guides** | |
| [`backend-README.md`](./backend-README.md) | Run the API; the band contract; voice and camera integration seams |
| [`voice-README.md`](./voice-README.md) | Twilio/Deepgram voice slice; runs and tests fully offline |
| [`frontend-DESIGN.md`](./frontend-DESIGN.md) | App design law: blue/white/black, light only, Liquid Glass + brutalism, the six-step type scale, the primitives, the copy rules |
| [`../frontend/src/lib/copy/README.md`](../frontend/src/lib/copy/README.md) | Where every user-facing sentence in the app lives, and why none are in screens |
| **Hardware bring-up** | |
| [`../band/README.md`](../band/README.md) | Arduino UNO Q band + ESP32 beacons: layout and test commands |
| [`../band/fallband/README.md`](../band/fallband/README.md) | The App Lab app: MCU sketch + Linux Python agent |
| [`../beacons/README.md`](../beacons/README.md) | ESP32-S3 room-anchor firmware and placement |
| **Sponsor write-ups** | |
| [`DROPBOX_CHALLENGE.md`](./DROPBOX_CHALLENGE.md) | Turning a family's care-document folder into structure Claude can act on |
| [`META_CHALLENGE.md`](./META_CHALLENGE.md) | How offloading "is she okay?" gives a family their conversation back |
| [`../SUBMISSIONS.md`](../SUBMISSIONS.md) | Copy-paste blurbs for all 8 sponsor-challenge submissions |
| [`../COST.md`](../COST.md) | How the camera lane and RAG spend almost nothing on LLM calls |

The detector latency bench (`testcam/`) that chose the open-vocabulary model
was removed from the tree once the choice was made; its measurements survive
in git history (commit `56e2237`) and in the comment at the top of stage 3 in
`backend/vision/gate.py`.

## Three things worth knowing before you read further

**There is no authentication anywhere.** No login screen, no API key, no band
key, no token on the websocket (`backend/app/main.py`, first line). Any doc
that mentions a JWT, an `X-Band-Key` header or a signed-in user is describing
the original design, and `DECISIONS.md` D-021 records the change. Do not put
this build on anything but a LAN.

**`API_CONTRACT_V2` and `API_CONTRACT_V3` are not successive versions of one
API.** V2 is the setup/admin surface (pairing, survey, contacts, push, the demo
trigger); V3 is the camera lane. They cover disjoint endpoints, and neither
supersedes the other. The "V2"/"V3" naming is a hackathon artifact of the two
being written a day apart, not a version history.

**Some of these are frozen contracts; the rest are plans.** `API_CONTRACT_V2.md`,
`API_CONTRACT_V3.md`, and `HARDWARE_INTEGRATION.md` describe exactly what the
code does; a mismatch is a code bug. `TECHNICAL_PRD.md`, `VLM_PLAN.md`, and
`PRODUCT_SPEC.md` describe intent; where the build fell short or changed
course, `DECISIONS.md` and each doc's own build-status note say so.
`frontend-DESIGN.md` is a law, not a plan: where it and
`frontend/src/theme/tokens.ts` disagree, the tokens win and the doc is stale.
