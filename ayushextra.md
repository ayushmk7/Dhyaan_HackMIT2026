# Ayush — extra: what the band needs from the backend

From Utsav, written 2026-09-19 while implementing the band ([`band/README.md`](./band/README.md)).
These are **not** in [`ayushneedtodo.md`](./ayushneedtodo.md) — they came out of reading the band spec
against the code you already shipped.

**None of these block the fall path.** A drop → `/v1/ingest/band` → alert → call works today (one
workaround, A4). Everything under "Room tracking" blocks the room half of the demo, and I am not writing
that code until we agree the shape — tell me if you want a different one and I will conform.

Priority order: **A1, A2, A3** (room tracking is dead without them) → **A6, A7** (small, correctness) →
**A4, A5, A8, A9** (removes workarounds) → **A10** (docs).

---

## Room tracking — blocking

### A1 · Every real beacon looks identical to the localizer ⛔

[`backend/app/location.py:62`](./backend/app/location.py#L62) keys an anchor on `uuid`:

```python
key = b.get("uuid") or f"{b.get('major')}-{b.get('minor')}"
```

The fixture gets away with this because it invents a per-room UUID (`bcn-kitchen`). **Real iBeacons
don't work that way.** All four of ours advertise the *same* site UUID
`eee6331c-6ea1-4873-83ed-ae648d10e07f` and differ only in `minor` (1=kitchen, 2=bathroom, 3=bedroom,
4=front_door) — that is what the iBeacon layout is for, and it is already flashed
([`beacons/beacon.ino`](./beacons/beacon.ino)). Today all four collapse into one anchor, every
fingerprint vector becomes one number, and rooms cannot be separated at all.

**Ask:** key on the triple.

```python
def _anchor_key(b: dict) -> str:
    uuid, major, minor = b.get("uuid"), b.get("major"), b.get("minor")
    if major is not None and minor is not None:
        return f"{(uuid or '').lower()}:{major}:{minor}"   # iBeacon: uuid is the SITE, not the beacon
    return str(uuid or f"{major}-{minor}")
```

Same change ripples to: [`backend/fixtures/rf_scan.json`](./backend/fixtures/rf_scan.json) (use the real
site UUID with minors 1–4), `scripts/simulate_band.py` `rf_payload()` (~line 126) and
`_seed_fingerprint()` (~line 197), and `tests/test_location.py`. Because the survey (A2) builds
fingerprints through the *same* function, the key format can't drift between survey and live scans —
that's the point of doing it there rather than on the band.

### A2 · There is no way to get a site survey into Mongo ⛔

The only writer of `fingerprints` is the simulator's `_seed_fingerprint()`. `HARDWARE_SPEC.md` §8.4
step 6 says "push the fingerprint database to the hub" and `TECHNICAL_PRD.md` §7.2 / §10.5 specify the
endpoints — they just aren't built. Without them the walkthrough (HW §10.3 R1–R8) can't happen, because
there is nothing to classify against.

**Ask:** build PRD §7.2's two routes, hub-side. The band keeps posting `/v1/ingest/rf` exactly as it
already does; the hub labels what arrives.

```
POST /v1/residents/{id}/fingerprint/start   {"zone_id": "kitchen", "label": "Kitchen"}
  -> 200 {"survey_id": "srv_...", "expect_s": 30}
  * zone_id MUST be a key of location.ZONES (see A3). Reject anything else 422 —
    a typo'd zone silently produces a fingerprint nothing can ever match.
  * while a survey is open for this resident, each /ingest/rf scan is ALSO stored:
        fingerprints: {resident_id, zone, vectors: [ _scan_vector(scan), ... ]}
    (a re-survey of a zone replaces that zone's vectors, so I can redo one room)
  * nice-to-have: include "scan_period_s": 3 in the /ingest/rf response while a survey
    is open — the scanner honours it and speeds up automatically, so nobody has to
    remember to switch modes. Without it I'll flip a config flag by hand.

POST /v1/residents/{id}/fingerprint/stop    {"survey_id": "srv_..."}
  -> 200 {"n_scans": 10, "n_anchors": 4, "separability_db": 9.2, "warning": null}
```

`separability_db` = the gap between this zone's strongest anchor median and the next zone's. Under ~6 dB
means the two rooms are RF-indistinguishable and I should move a beacon — that number saves me an hour
of re-walking at 3 a.m. A `warning` string is enough if computing it is fiddly.

Abhinav gets these for free: [`frontend/src/lib/http.ts:364`](./frontend/src/lib/http.ts#L364)
`surveyRoom`/`surveyStop` currently throw "needs a real endpoint".

### A3 · The zone graph is a fixed 6-room house ⛔

[`backend/app/location.py:23`](./backend/app/location.py#L23) hardcodes `ZONES` with `hallway` and
`living_room`, and `front_door` is adjacent **only** to `living_room`. Two consequences for the taped-out
demo floor plan (`HARDWARE_SPEC.md` §10.4):

- A zone I never survey still has to exist in that graph for anyone to walk *through* it. `HARDWARE_SPEC.md`
  §8.4 step 5 says to label hallways `transit` — that matches no key in `ZONES`, so those vectors would
  be dead weight. **I'm surveying hallways as `hallway`** (logged as D-016); say if you'd rather add a
  `transit` zone.
- With the current graph I cannot reach `front_door` without taping out a `living_room` too, which the
  expo table has no space for.

**Ask (either is fine):** load the graph per deployment (a `zones` collection, or a dict in config), or
just agree this demo graph and I'll tape the floor to match:

```
bedroom ── hallway ── bathroom
              │
              ├── kitchen
              └── front_door ── OUTSIDE
```

Four beacons: bedroom, bathroom, kitchen, front_door. `hallway` gets no beacon of its own — it is
identified by the *pattern* (everything mid-strength), which is exactly what fingerprinting is for.

---

## Small correctness fixes

### A6 · `/v1/ingest/band/cancel` returns 500 when the window has passed

[`backend/app/alerts.py:342`](./backend/app/alerts.py#L342) raises `ValueError` when the alert isn't in
`LOCAL_CANCEL`, and [`ingest.py:153`](./backend/app/routers/ingest.py#L153) doesn't catch it → 500. The
band can't tell "you pressed too late" from "the hub fell over": the first means stop and tell the
wearer help is still coming, the second means retry. Right now it retries a permanent failure three
times and then spools it forever.

**Ask:** return **409** `{"cancelled": false, "state": "CALLING_RESIDENT"}` for the wrong-state case.
Keep 5xx for real failures. I treat 4xx as final and 5xx as retryable.

### A7 · `peak_g` is capped at 20, and a real impact can read 27.7

[`ingest.py:103`](./backend/app/routers/ingest.py#L103) is `le=20`. At ±16 g full scale the *magnitude*
of the three axes can reach √3 × 16 ≈ 27.7 g, and a hard landing on tile does clip high (HW §6.1: tile
is 8–15 g, and §10.2 case 9 deliberately tests for a value above 4 g). A 422 on the hardest fall we ever
record is the wrong failure mode.

**Ask:** `le=28`. I clamp to 20 until then, which quietly lies about the worst falls.

---

## Removes a workaround

### A4 · `battery_pct` is required and the band has none (this is F-09)

Already in `DECISIONS.md` as F-09; restating because it's the one thing I've had to fake. The band is
powered by a sealed USB power bank with no fuel gauge on any bus (D-013), so there is no number to send.
**Today I send a hardcoded `100`** on every `/band` and `/heartbeat` — which means the dashboard shows a
battery level that is pure fiction, and `band_low_battery` can never fire.

**Ask:** make it `int | None = None` on `BandEventIn` and `HeartbeatIn`, drop it from
`fixtures/band_fall.json` and `fixtures/heartbeat.json`, and skip the low-battery emit when it's absent.
I flip `compat.battery_pct_placeholder` to `false` the moment this lands.

### A5 · `impact_only` is rejected

[`ingest.py:76`](./backend/app/routers/ingest.py#L76) `BAND_EVENT_TYPES` has no `impact_only`, so posting
one is a 422. It's the event for "something hit hard but it wasn't a fall" — a slammed forearm, a heavy
step — and `TECHNICAL_PRD.md` §3 already documents it, §8.7 feeds the walking profile with it, and the
Arduino expo demo's impact ticker is literally a live count of them.

**Ask:** add `"impact_only"` to the tuple, plus optional `path` (`"FREEFALL_IMPACT"` | `"SOFT_FALL"`)
and `confidence` (float). It must **not** open an alert and should not be embedded for RAG (it is noise,
and there will be a lot of it). Until then the band logs them locally and the ticker has nothing to show.

### A8 · `seed.py --wipe` deletes the survey and the real band's pairing

[`backend/scripts/seed.py:102`](./backend/scripts/seed.py#L102) wipes `bands` and `fingerprints`. So a
reseed on demo morning silently erases a 25-minute site survey and unpairs the physical band — and the
failure shows up as a 404 on the first real fall, which is the worst possible moment to debug it.

**Ask:** (a) add the real band to the seed —
`{"_id": "band_unoq01", "resident_id": "res_eleanor", "thresholds_rev": 1, "firmware": "0.1.0"}` — and
(b) leave `fingerprints` out of the wipe list, or gate it behind `--wipe-fingerprints`. I'm using
`band_unoq01` for the physical band so the simulator's `band_a3f2` data stays distinguishable in Mongo,
per your own `HARDWARE_INTEGRATION.md` §"How to tell if it is real".

### A9 · Heartbeat cadence, and the profile reply

The band heartbeats every **30 s** (HW §5.7), your docstring says 60 s. Either is fine — just make sure
`band_offline` needs ≥ 90 s of silence (3 misses) so a single dropped POST doesn't mark a live band dead.

If the walking profile (F-11) happens, the heartbeat body and reply are in `TECHNICAL_PRD.md` §8.7: the
band sends `profile_rev` + an `activity` block and expects `200 {"profile_rev", "profile"}` when it
changed, `204` when it hasn't. I already send those fields — pydantic drops unknown keys, so it is
harmless today and works the day you read them.

---

## Docs

### A10 · Two stale paragraphs

- [`backend/HARDWARE_INTEGRATION.md:103-110`](./backend/HARDWARE_INTEGRATION.md#L103) says `simulated`
  "does not persist" and that the models don't declare it. They do now
  ([`ingest.py:99`](./backend/app/routers/ingest.py#L99)) and it is threaded into `emit(payload=...)`.
  The advice to filter on a dedicated `--band-id` is still good; the "known gap" paragraph is fixed.
- The `battery_pct` row at `HARDWARE_INTEGRATION.md:97` suggests a voltage-divider ADC read. There is
  nothing to divide — the band's 5 V comes from a sealed bank over USB-C, and its charge state is not
  exposed on any pin or bus (D-013). That row should say "not available on this hardware".
- F-13 (already in `DECISIONS.md`): line 94 cites `HARDWARE_SPEC.md` §6.9 for the free-fall detector;
  §6.9 is the walking profile now. The detector is §6.4–6.7.

---

## What I'm doing on my side

| | |
|---|---|
| Not touching | `backend/app/*`, `backend/scripts/*`, `frontend/*` |
| Building | [`band/`](./band/) — MCU sketch, App Lab agent, host-side RF scanner, calibration tools |
| Contract I code against | `backend/fixtures/*.json` + the `ingest.py` docstring, unchanged |
| Proof I'm not drifting | `make -C band test-py` asserts my payloads have the same keys and types as your fixtures |
| Design choices I made that touch your side | `DECISIONS.md` D-016 – D-020 |

Ping me the moment A1–A3 land and I'll run the survey that night.
