# Dhyaan

Eldercare sensing for the adult child, not the grandparent. A band watches for
falls and phones the resident *first*; a camera turns her day into plain
sentences; everything she does becomes one event stream the family can ask
questions of.

HackMIT 2026.

## Run it

```bash
cd backend
make mongo          # MongoDB in docker
make embedder       # ollama + nomic-embed-text (once)
uv venv && uv pip install -e ".[vision]" --group dev
make seed           # Eleanor, 15 days, today deliberately anomalous
make run            # API on 0.0.0.0:8000
make test           # 208 tests

cd ../frontend
npm install
npx expo start --lan # Expo Go, or press i for the simulator
```

The camera lane is separate, and needs a webcam:

```bash
cd backend
ollama pull qwen3-vl:8b
python -m vision --source 0 --camera-id cam_mac_01 --demo
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
