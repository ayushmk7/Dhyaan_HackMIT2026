# Docs — Dhyaan

If you have never seen this project: Dhyaan is a two-product eldercare sensing
platform (24 hours, HackMIT 2026) built around one event store — an arm-worn band
that detects a fall and locates a resident room-by-room, a voice agent that calls
before anyone's family does, and, on the facility side, a local vision-language
model reading hallway CCTV. The repo root [`README.md`](../README.md) has the
elevator pitch and run commands; this page indexes everything under `docs/` plus
the per-lane guides that live next to their code.

## Start here

1. [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md) — what we promise users and judges
2. [`TECHNICAL_PRD.md`](./TECHNICAL_PRD.md) — the software design behind that promise
3. [`DECISIONS.md`](./DECISIONS.md) — every place the two disagree, and why
4. [`backend-README.md`](./backend-README.md) — what actually runs, and how to run it

## Everything else, by role

| Doc | What it is |
|---|---|
| **Specs** | |
| [`HARDWARE_SPEC.md`](./HARDWARE_SPEC.md) | Band, beacons, radios, power, the fall detector, calibration, physical test plan |
| [`VLM_PLAN.md`](./VLM_PLAN.md) | Camera lane implementation plan — cascade, privacy mechanism, known ceilings |
| **Contracts (frozen — code implements these exactly)** | |
| [`API_CONTRACT_V2.md`](./API_CONTRACT_V2.md) | Setup/admin surface: band pairing, RF survey, contact ladder, push, `/admin/simulate` |
| [`API_CONTRACT_V3.md`](./API_CONTRACT_V3.md) | Camera lane wire contract: `/ingest/camera`, `/camera/config`, presence |
| [`HARDWARE_INTEGRATION.md`](./HARDWARE_INTEGRATION.md) | Swapping the band simulator for the real band, endpoint by endpoint |
| **Per-lane guides** | |
| [`backend-README.md`](./backend-README.md) | Run the API; the band contract; voice and camera integration seams |
| [`voice-README.md`](./voice-README.md) | Twilio/Deepgram voice slice — runs and tests fully offline |
| [`frontend-DESIGN.md`](./frontend-DESIGN.md) | App design law: Liquid Glass + brutalism, tokens, screen rules |
| **Hardware bring-up** | |
| [`../band/README.md`](../band/README.md) | Arduino UNO Q band + ESP32 beacons: layout and test commands |
| [`../band/fallband/README.md`](../band/fallband/README.md) | The App Lab app: MCU sketch + Linux Python agent |
| [`../beacons/README.md`](../beacons/README.md) | ESP32-S3 room-anchor firmware and placement |
| [`../testcam/README.md`](../testcam/README.md) | Detector latency bench: which vision pipeline is actually fastest |
| [`../testcam/FOOD.md`](../testcam/FOOD.md) | Why the default detector can't see food, and what fixes it |
| **Sponsor write-ups** | |
| [`DROPBOX_CHALLENGE.md`](./DROPBOX_CHALLENGE.md) | Turning a family's care-document folder into structure Claude can act on |
| [`META_CHALLENGE.md`](./META_CHALLENGE.md) | How offloading "is she okay?" gives a family their conversation back |
| [`../SUBMISSIONS.md`](../SUBMISSIONS.md) | Copy-paste blurbs for all 8 sponsor-challenge submissions |
| [`../COST.md`](../COST.md) | How the camera lane and RAG spend almost nothing on LLM calls |

## Two things worth knowing before you read further

**`API_CONTRACT_V2` and `API_CONTRACT_V3` are not successive versions of one API.**
V2 is the setup/admin surface (pairing, survey, contacts, push, the demo trigger);
V3 is the camera lane. They cover disjoint endpoints, and neither supersedes the
other — the "V2"/"V3" naming is a hackathon artifact of the two being written a day
apart, not a version history.

**Some of these are frozen contracts; the rest are plans.** `API_CONTRACT_V2.md`,
`API_CONTRACT_V3.md`, and `HARDWARE_INTEGRATION.md` describe exactly what the code
does — a mismatch is a code bug. `TECHNICAL_PRD.md`, `VLM_PLAN.md`, and
`PRODUCT_SPEC.md` describe intent; where the build fell short or changed course,
`DECISIONS.md` and each doc's own build-status note say so.
