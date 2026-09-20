#!/usr/bin/env bash
# Reset Dhyaan to a clean demo state between judges. ~15 seconds.
#   ./scripts/demo_reset.sh
# What it does: acks every open alert (stops any ringing), reseeds the demo
# day (Asha + TEST_PHONE_E164 + band_unoq01), and PRESERVES the localization
# fingerprints so room tracking survives the wipe. Boards are untouched —
# they notice the quiet backend on their next poll and go idle.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

[ -f .env ] && { set -a; . ./.env; set +a; }
API="${API:-http://localhost:8000}"
PY="backend/.venv/bin/python"

echo "==> silencing any open alerts"
curl -s "$API/v1/alerts?state=open" | $PY -c "
import json, sys, subprocess
alerts = json.load(sys.stdin)
for a in alerts:
    subprocess.run(['curl','-s','-X','POST','$API/demo/force_ack',
                    '-H','Content-Type: application/json',
                    '-d', json.dumps({'alert_id': a['id'], 'by': 'judge_reset'})],
                   capture_output=True)
print(f'   acked {len(alerts)} open alert(s)')"

echo "==> reseeding (fingerprints preserved)"
$PY - <<'EOF'
import asyncio, json
from motor.motor_asyncio import AsyncIOMotorClient
async def m():
    db = AsyncIOMotorClient("mongodb://localhost:27017")["dhyaan"]
    fps = await db.fingerprints.find({}).to_list(100)
    json.dump([{k: v for k, v in f.items() if k != "_id"} for f in fps],
              open("/tmp/dhyaan_fps.json", "w"), default=str)
    print(f"   backed up {len(fps)} fingerprint(s)")
asyncio.run(m())
EOF
(cd backend && .venv/bin/python -m scripts.seed --wipe >/dev/null)
$PY - <<'EOF'
import asyncio, json
from motor.motor_asyncio import AsyncIOMotorClient
async def m():
    db = AsyncIOMotorClient("mongodb://localhost:27017")["dhyaan"]
    for f in json.load(open("/tmp/dhyaan_fps.json")):
        await db.fingerprints.update_one(
            {"resident_id": f["resident_id"], "zone": f["zone"]},
            {"$set": f}, upsert=True)
    r = await db.residents.find_one({}, {"display_name": 1, "phone_e164": 1})
    print(f"   seeded {r['display_name']} ({r['phone_e164']}), fingerprints restored")
asyncio.run(m())
EOF

echo "==> pre-judge checklist"
curl -s "$API/health" | grep -q '"ok":true' && echo "   API: ok" || echo "   API: DOWN — start it"
echo "   [ ] band heartbeat in the last 60s (watch the API log)"
echo "   [ ] box idle screen shows NO offline dot"
echo "   [ ] demo phone: ringer ON, Focus OFF"
echo "   [ ] vision worker running if the drink beat is in this run"
echo "==> clean. Run the beat sheet in DEMO_RUNBOOK.md."
