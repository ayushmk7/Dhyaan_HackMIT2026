#!/usr/bin/env bash
# One command, whole stack: mongo -> ollama -> seed (if empty) -> API.
#
# A script instead of a root Makefile: backend/Makefile already owns the
# granular targets (mongo, seed, run, vlm, vision...) and dev.sh's only job
# is to sequence a subset of them with progress output, a health wait, and a
# LAN banner a plain `make` target can't print well. No framework, no deps.
#
# Usage:  ./dev.sh
# Idempotent: safe to re-run — skips what's already up, reseeds nothing.
# Ctrl-C stops whatever THIS run started (mongo and an already-running API
# it found are left alone).

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

BACKEND="backend"
VENV="$BACKEND/.venv/bin"
PIDS=()

# Live voice: the API mounts the Twilio bridge only when these creds are in its
# environment (backend/app/main.py). Gitignored .env at the repo root holds them.
if [ -f .env ]; then set -a; . ./.env; set +a; fi

info() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$1"; }
die()  { printf '\033[1;31mxx\033[0m %s\n' "$1" >&2; exit 1; }

cleanup() {
  if [ "${#PIDS[@]}" -gt 0 ]; then
    echo
    info "stopping what this run started"
    kill "${PIDS[@]}" 2>/dev/null || true
    wait "${PIDS[@]}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# --- prerequisites -----------------------------------------------------------
command -v docker >/dev/null 2>&1 || die "docker not found. Install Docker Desktop and open it."
docker info >/dev/null 2>&1 || die "docker daemon not running. Open Docker Desktop."
command -v ollama >/dev/null 2>&1 || die "ollama not found. brew install ollama"
[ -x "$VENV/python" ] || die "backend/.venv missing. Run: cd backend && uv venv && uv pip install -e \".[vision]\" --group dev"
[ -x "$VENV/uvicorn" ] || die "uvicorn missing from backend/.venv. Run: cd backend && uv pip install -e \".[vision]\" --group dev"

# --- 1. mongo ------------------------------------------------------------
info "mongo"
docker start dhyaan-mongo >/dev/null 2>&1 \
  || docker run -d --name dhyaan-mongo -p 27017:27017 mongo:7 >/dev/null
for i in $(seq 1 30); do
  docker exec dhyaan-mongo mongosh --quiet --eval "db.runCommand('ping')" >/dev/null 2>&1 && break
  [ "$i" -eq 30 ] && die "mongo never came up (docker logs dhyaan-mongo)"
  sleep 1
done

# --- 2. ollama serve -------------------------------------------------------
if curl -s http://localhost:11434/api/tags >/dev/null 2>&1; then
  info "ollama already serving"
else
  info "starting ollama serve"
  ollama serve > /tmp/ollama.log 2>&1 &
  PIDS+=($!)
  for i in $(seq 1 15); do
    curl -s http://localhost:11434/api/tags >/dev/null 2>&1 && break
    [ "$i" -eq 15 ] && die "ollama serve never came up (see /tmp/ollama.log)"
    sleep 1
  done
fi

# Read the model list ONCE into a variable and grep that. Do NOT "simplify" this
# back into `ollama list | grep -q ...`: this script runs under `set -euo
# pipefail`, and `grep -q` exits the moment it matches. qwen2.5vl:3b is the FIRST
# data row, so ollama still has rows to write, gets SIGPIPE, exits 141 — and
# pipefail turns the whole pipeline into a failure even though grep MATCHED. That
# is what made dev.sh warn that a model you have pulled is not pulled. (The
# nomic-embed-text row is last, so that check happened to get away with it.)
# A here-string has no writer process left to kill.
OLLAMA_MODELS="$(ollama list 2>/dev/null || true)"

if grep -q '^nomic-embed-text' <<<"$OLLAMA_MODELS"; then
  : # already pulled
else
  warn "pulling nomic-embed-text (one-time, ~270MB — used for semantic recall)"
  ollama pull nomic-embed-text
fi

if ! grep -q '^qwen2\.5vl:3b' <<<"$OLLAMA_MODELS"; then
  warn "qwen2.5vl:3b (camera-lane VLM) not pulled — run 'cd backend && make vlm' before using the camera lane"
fi

# --- 3. seed, only if the DB is empty --------------------------------------
info "checking seed data"
SEEDED="$(docker exec dhyaan-mongo mongosh dhyaan --quiet --eval 'db.residents.countDocuments({})' 2>/dev/null | tail -1 | tr -d '[:space:]')"
SEEDED="${SEEDED:-0}"
if [ "$SEEDED" = "0" ]; then
  info "DB is empty — seeding Asha (14 days + today)"
  (cd "$BACKEND" && .venv/bin/python -m scripts.seed --wipe)
else
  info "DB already has $SEEDED resident(s) — skipping seed (cd backend && make seed to force a reseed)"
fi

# --- 4. the API --------------------------------------------------------------
if curl -s http://localhost:8000/health 2>/dev/null | grep -q '"ok":true'; then
  info "API already running on :8000 — leaving it alone"
  API_PID=""
else
  info "starting API on 0.0.0.0:8000"
  # DEMO_FAST shrinks presence.py's dedup gaps and durations to a tenth, so a
  # camera run puts meals and visits on the timeline inside a two-minute loop
  # instead of needing real minutes of eating. This is the dev script, and a
  # demo nobody can watch happen is not a demo. Override it in the environment
  # to exercise the real thresholds: DEMO_FAST=0 ./dev.sh
  # CHAT_FALLBACK_MODEL turns Ask from a template into an answer. With no
  # OPENAI_API_KEY set, rag.py falls back to stitching the retrieved
  # sentences together; pointing it at the vision model (already pulled, and
  # kept warm for the camera lane) gets real prose out of the same Ollama for
  # no extra download. Measured: "Yes, she has eaten today. She had dinner at
  # the table around 7:10 pm..." instead of a labelled list.
  # location.py's dwell notices get the same 10x treatment (90 s in the
  # bathroom instead of 15 real minutes) — same override to restore them.
  if [ "${DEMO_FAST:-1}" != "0" ]; then
    : "${BATHROOM_THRESHOLD_S:=90}"
    : "${ZONE_DWELL_THRESHOLD_S:=180}"
  fi
  (cd "$BACKEND" \
    && DEMO_FAST="${DEMO_FAST:-1}" \
       CHAT_FALLBACK_MODEL="${CHAT_FALLBACK_MODEL:-qwen2.5vl:3b}" \
       BATHROOM_THRESHOLD_S="${BATHROOM_THRESHOLD_S:-900}" \
       ZONE_DWELL_THRESHOLD_S="${ZONE_DWELL_THRESHOLD_S:-1800}" \
       exec .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000) &
  API_PID=$!
  PIDS+=("$API_PID")
  for i in $(seq 1 30); do
    curl -s http://localhost:8000/health 2>/dev/null | grep -q '"ok":true' && break
    [ "$i" -eq 30 ] && die "API never answered /health — check the uvicorn output above"
    sleep 1
  done
fi

# --- banner ------------------------------------------------------------------
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || echo '<run: cd backend && make ip>')"
echo
info "backend up: http://localhost:8000  (LAN: http://$LAN_IP:8000)"
echo
echo "Point a real phone (Expo Go) at this backend instead of localhost:"
echo "  cd frontend && EXPO_PUBLIC_USE_MOCKS=false \\"
echo "    EXPO_PUBLIC_API_BASE=http://$LAN_IP:8000/v1 \\"
echo "    npx expo start --lan"
echo
echo "NO AUTH: this API has no login, no key and no token. Anyone on the LAN who"
echo "can reach :8000 can read and write everything. Demo build; see app/main.py."
echo

if [ -n "$API_PID" ]; then
  info "Ctrl-C to stop everything this run started"
  wait "$API_PID"
else
  info "nothing new to keep running — exiting (the API you found is still up)"
fi
