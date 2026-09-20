# Dhyaan

Eldercare sensing for the adult child, not the grandparent. A band watches for
falls and phones the resident *first*; a camera turns her day into plain
sentences; everything she does becomes one event stream the family can ask
questions of.

HackMIT 2026.

## Run it

Prerequisites: [Docker Desktop](https://www.docker.com/products/docker-desktop/)
running, [Ollama](https://ollama.com) installed (`brew install ollama`), `uv`
(`brew install uv`) or a Python 3.11+ you trust, Node for the frontend.

First time only:

```bash
cd backend
uv venv && uv pip install -e ".[vision]" --group dev
cd ../frontend
npm install
cd ..
```

Then, one command, every time:

```bash
./dev.sh
```

It starts mongo (docker), `ollama serve` if it isn't already up, pulls
`nomic-embed-text` once, seeds Eleanor if the DB is empty, and runs the API on
`0.0.0.0:8000` — reachable from a phone on the same LAN, not just the Mac.
Re-running it is safe: it skips whatever is already running and never reseeds
a DB that has data. Ctrl-C stops whatever that run started.

It prints your Mac's LAN URL and the exact command to start Expo against that
backend — a phone in Expo Go can't resolve `localhost` to your Mac, so
`frontend/src/lib/config.ts` needs the LAN IP explicitly:

```bash
cd frontend
EXPO_PUBLIC_USE_MOCKS=false EXPO_PUBLIC_API_BASE=http://<mac-ip>:8000/v1 \
  EXPO_PUBLIC_API_KEY=dev-key-change-me npx expo start --lan
```

(`cd backend && make ip` prints `<mac-ip>` any time. The iOS Simulator, unlike
a phone, is fine with the `localhost` default — just `npx expo start` and
press `i`.) `EXPO_PUBLIC_USE_MOCKS` now defaults to `false` — the app talks to
a live backend out of the box — so that flag is printed for clarity, not
because it's required. To demo the app with no backend running at all, set
`EXPO_PUBLIC_USE_MOCKS=true` instead.

Tests don't need `dev.sh` running (they spin up their own things via
`conftest.py`), just mongo:

```bash
cd backend && make mongo && make test   # 208 tests
```

The camera lane is separate — `dev.sh` doesn't start it, because it wants a
camera or an explicit stand-in. With a webcam:

```bash
cd backend
make vlm              # pull + warm qwen2.5vl:3b, once (3.2 GB)
python -m vision --source 0 --camera-id cam_mac_01 --demo
```

Without one (synthetic frames, no camera required):

```bash
cd backend && make vision-synthetic
```

## Layout

| Path | What |
|---|---|
| `backend/app/` | FastAPI + MongoDB. Events, alerts FSM, RAG, presence, memory |
| `backend/vision/` | The camera worker. The only process that ever holds pixels |
| `frontend/` | Expo / React Native app |
| `dhyaan/voice/` | Twilio + Deepgram bridge |
| `beacons/` | ESP32 iBeacon sketch |
| `docs/` | Every spec, plan and write-up |

## Docs

Start here:

- [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) — what this is, who it is for, and where it is weak
- [`docs/TECHNICAL_PRD.md`](docs/TECHNICAL_PRD.md) — the system in detail
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — why things are the way they are
- [`docs/VLM_PLAN.md`](docs/VLM_PLAN.md) — the camera lane, including what it honestly cannot do
- [`docs/HARDWARE_SPEC.md`](docs/HARDWARE_SPEC.md) · [`docs/HARDWARE_INTEGRATION.md`](docs/HARDWARE_INTEGRATION.md) — the band, and the contract firmware must meet
- [`docs/backend-README.md`](docs/backend-README.md) — backend detail and known ceilings

Per-person task lists: [`docs/ayushneedtodo.md`](docs/ayushneedtodo.md),
[`docs/abhinavtodo.md`](docs/abhinavtodo.md), [`docs/utsavtodo.md`](docs/utsavtodo.md).

## Two things to say out loud to a judge

Eleanor's 15 days of history come from a seed script; the learner running on it
is real. And the camera never writes a frame to disk — the family sees sentences,
never a room name and never an image.
