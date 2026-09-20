#!/usr/bin/env bash
# The demo's own switchboard: check it, reset it, drive it.
#
# `./dev.sh` brings the stack up. This drives what happens after, and every
# subcommand is safe to run twice. Written the morning of, against what
# actually broke in rehearsal — each check here is a thing that went wrong
# once, not a thing that might.
set -uo pipefail
cd "$(dirname "$0")"

API=http://localhost:8000
CAM=cam_mac_01
RESIDENT=res_eleanor
DOMAIN=subsystem-mushroom-grooving.ngrok-free.dev

ok()   { printf '  \033[32mok\033[0m    %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAILED=1; }
warn() { printf '  \033[33mwarn\033[0m  %s\n' "$1"; }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ---------------------------------------------------------------------------

check() {
  FAILED=0

  head_ "the hub"
  curl -sf -m 3 "$API/health" >/dev/null && ok "API answering on :8000" || bad "API down — run ./dev.sh"
  docker ps --format '{{.Names}}' 2>/dev/null | grep -q mongo && ok "mongo up" || bad "mongo down"
  pgrep -f "ollama serve" >/dev/null && ok "ollama up" || warn "ollama down (chat falls back, camera VLM needs it)"

  head_ "the tunnel (Twilio and the band both need it)"
  # Three tries. The free tunnel over congested venue wifi answers about four
  # times in five, in 1-5 s — measured. One timeout is not "down", and a check
  # that cries wolf gets ignored at the worst moment.
  hits=0
  for _ in 1 2 3; do curl -sf -m 10 "https://$DOMAIN/health" >/dev/null && hits=$((hits+1)); done
  if [ "$hits" -ge 2 ]; then ok "https://$DOMAIN reachable ($hits/3)"
  elif [ "$hits" = 1 ]; then warn "tunnel flaky (1/3) — it will retry, but expect slow beats"
  else bad "tunnel down — run: $0 tunnel"
  fi

  head_ "keys"
  grep -q '^OPENAI_API_KEY=.' .env 2>/dev/null \
    && ok "OPENAI_API_KEY set (backend prose + chat)" \
    || warn "no OPENAI_API_KEY in .env — chat falls back to local ollama"
  grep -q '^EXPO_PUBLIC_OPENAI_API_KEY=.' frontend/.env 2>/dev/null \
    && ok "EXPO_PUBLIC_OPENAI_API_KEY set (openers, Sunday letter)" \
    || warn "no key in frontend/.env — those beats use their mocks"
  grep -q '^TWILIO_AUTH_TOKEN=.' .env 2>/dev/null && ok "twilio creds present" || bad "no twilio creds in .env"

  head_ "the band"
  if adb devices 2>/dev/null | grep -q "device$"; then
    ssid=$(adb shell "nmcli -t -f ACTIVE,SSID dev wifi 2>/dev/null | grep '^yes' | cut -d: -f2" 2>/dev/null | tr -d '\r')
    ok "board on USB (adb), wifi: ${ssid:-unknown}"
    adb shell "curl -sf -m 8 -o /dev/null https://$DOMAIN/health" 2>/dev/null \
      && ok "board can reach the hub" \
      || bad "board cannot reach the hub — wrong wifi? see 'rooms' below"
  else
    warn "no adb (board on the power bank) — cannot re-survey from here"
  fi
  n=$(mongo_count fingerprints)
  [ "${n:-0}" -ge 2 ] && ok "$n room fingerprints stored (durable, in mongo)" \
                      || bad "only ${n:-0} fingerprints — run: $0 survey <zone>"

  head_ "the camera"
  running=$(curl -sf -m 3 "$API/v1/cameras/$CAM/worker" | python3 -c 'import sys,json;print(json.load(sys.stdin)["running"])' 2>/dev/null)
  [ "$running" = "True" ] && ok "vision worker running (models warm)" \
                          || warn "vision worker off — the app's switch starts it, ~60s cold"

  head_ "a clean slate"
  open=$(curl -sf -m 3 "$API/v1/alerts?state=open" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(len(d if isinstance(d,list) else d.get("alerts",[])))' 2>/dev/null)
  [ "${open:-0}" = "0" ] && ok "no open alerts" || bad "$open alert(s) still open — run: $0 reset"

  printf '\n'
  [ "${FAILED:-0}" = "0" ] && printf '\033[32mready\033[0m\n' || printf '\033[31mnot ready — fix the FAILs above\033[0m\n'
  return "${FAILED:-0}"
}

mongo_count() {
  docker exec dhyaan-mongo mongosh --quiet --eval \
    "db.getSiblingDB('dhyaan').$1.countDocuments({})" 2>/dev/null | tr -d '\r'
}

# ---------------------------------------------------------------------------

# Between runs. Closes anything still open so the app opens on a calm screen —
# an alert left mid-ladder keeps calling, and the takeover is the first thing a
# judge sees.
reset() {
  ids=$(curl -sf "$API/v1/alerts?state=open" | python3 -c '
import sys,json
d=json.load(sys.stdin)
for a in (d if isinstance(d,list) else d.get("alerts",[])): print(a["id"])' 2>/dev/null)
  if [ -z "$ids" ]; then echo "no open alerts"; return 0; fi
  for id in $ids; do
    curl -sf -X POST "$API/demo/force_ack" -H 'Content-Type: application/json' \
      -d "{\"alert_id\":\"$id\",\"by\":\"demo\"}" >/dev/null && echo "closed $id"
  done
}

# The fall, without the band. Use when the band is flat, the hardware sulks, or
# you want to rehearse the call. Same path a real fall takes.
fall() {
  python3 -c "
import json,datetime
d=json.load(open('backend/fixtures/band_fall.json'))
d['ts']=datetime.datetime.now(datetime.timezone.utc).isoformat()
json.dump(d,open('/tmp/fall.json','w'))"
  curl -s -X POST "$API/v1/ingest/band" -H 'X-Band-Key: band-dev-key' \
    -H 'Content-Type: application/json' -d @/tmp/fall.json
  echo
  echo "the phone rings when the cancel window lapses (30 s by default)"
}

# 35 s per room, band held where that room is. Fingerprints go to MONGO, so
# this is a one-time cost per venue — it survives restarts and reboots.
survey() {
  zone="${1:?usage: $0 survey <kitchen|living_room|bathroom|bedroom|hallway|front_door>}"
  secs="${2:-35}"
  adb devices 2>/dev/null | grep -q "device$" || { echo "no adb — plug the board into the laptop"; return 1; }
  echo "hold the band where '$zone' is for ${secs}s…"
  adb shell "docker exec fallband-app-main-1 python /app/python/survey.py $zone $secs"
}

camera() {
  case "${1:-status}" in
    on)  curl -s -X POST "$API/v1/cameras/$CAM/worker/start" ;;
    off) curl -s -X POST "$API/v1/cameras/$CAM/worker/stop" ;;
    *)   curl -s "$API/v1/cameras/$CAM/worker" ;;
  esac
  echo
}

# The tunnel, on the ONE domain the band and Twilio are both configured for.
# A random ngrok URL is the same as no tunnel.
tunnel() {
  pgrep -f "ngrok http" >/dev/null && { echo "ngrok already running"; return 0; }
  nohup ngrok http --url="$DOMAIN" 8000 >/tmp/ngrok.log 2>&1 &
  sleep 4
  curl -sf -m 8 "https://$DOMAIN/health" >/dev/null && echo "tunnel up: https://$DOMAIN" || echo "tunnel FAILED — see /tmp/ngrok.log"
}

case "${1:-check}" in
  check)   check ;;
  reset)   reset ;;
  fall)    fall ;;
  survey)  shift; survey "$@" ;;
  camera)  shift; camera "$@" ;;
  tunnel)  tunnel ;;
  *) cat <<EOF
usage: $0 <command>

  check            everything the demo needs, one line each   (run this first)
  reset            close open alerts, so the app opens calm   (run between takes)
  fall             fire a fall without the band, rings the phone
  survey <zone>    re-fingerprint a room, 35 s, needs the board on USB
  camera on|off    start/stop the vision worker from the terminal
  tunnel           start ngrok on the one domain the band is configured for
EOF
  ;;
esac
