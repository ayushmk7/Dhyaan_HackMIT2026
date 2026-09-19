# dhyaan/voice — Twilio ⇄ Deepgram voice slice (lane B)

Everything here runs and is tested **offline** — no Twilio, Deepgram, or Apple
account needed until a phone actually rings. `tests/test_bridge.py` exercises the
full bridge (fake Twilio socket + fake Deepgram server): Settings gating, media
encoding both ways, barge-in, tool calls, silence default, voicemail-as-no-answer,
retry-once.

## Run it

```sh
python3 -m venv .venv-voice && source .venv-voice/bin/activate
pip install -r requirements.txt
pytest tests/test_bridge.py -q            # offline proof — must be green
uvicorn dhyaan.voice.app:app --port 8000  # the standalone voice app (+ /health)
```

## B0 — the human-only hour-0 checklist (nothing below works without it)

1. ⛔ **Twilio**: create the account, **upgrade with ~$20** (removes the 5-recipient
   trial cap AND the trial preamble), buy a voice number, and **verify every phone
   that will be dialled on stage** (Console → Phone Numbers → Verified Caller IDs —
   the signup phone is auto-verified, teammates' phones are NOT). Note
   `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_E164` into `.env`.
   Check the voice per-minute price at twilio.com/en-us/voice/pricing (B0.4).
2. ⛔ **Deepgram**: grab an API key, then `python scripts/dg_connect_test.py` —
   expect a `Welcome` frame. If it 401s, try `Bearer` before assuming the key is bad.
3. ⛔ **Hello world call** before any bridge code:
   `python -c "from dhyaan.voice.outbound import hello_world_call; hello_world_call('+1...')"`
   — a verified phone must ring and say "Hello from Dhyaan."
4. **cloudflared**: `cloudflared tunnel --url http://localhost:8000`, write the
   hostname into `.env` (`PUBLIC_HTTPS`/`PUBLIC_WSS`) and **pin it — never restart
   the tunnel after this**: a restart gets a new hostname and silently breaks every
   subsequent call (B10.3 — re-check the hostname before the demo).

## Prompt iteration without dialling anyone (B8)

```sh
bash scripts/make_test_audio.sh     # once; clips are committed in test_audio/
python scripts/replay_to_agent.py test_audio/help.wav        # expect escalate(distress)
python scripts/replay_to_agent.py test_audio/fine.wav        # expect mark_ok(fine)
python scripts/replay_to_agent.py test_audio/fell_but_up.wav # expect mark_ok(fell_but_fine)
python scripts/replay_to_agent.py test_audio/confused.wav    # expect escalate(incoherent)
python scripts/replay_to_agent.py test_audio/silence.wav     # expect escalate(silence)
```

Edit the prompt in `dhyaan/voice/settings.py`, re-run all five, confirm 5/5 tool
calls before ever touching a real phone.

## Integration seams (agree at H1, freeze at H3)

`dhyaan/voice/fsm_stub.py` is the stand-in for Ayush's FSM — same signatures:
`handle_voice_tool(alert_id, role, fn_name, args) -> {"ok": true}` (must stay
idempotent), `db_bind_call`, `append_transcript`, `emit_event`. Swap the import in
`bridge.py` (one line) at integration. `on_call_status(...)` carries the one-retry
policy; the real FSM should own that timer eventually.

## Fallback decision tree (B9.4 — print this, tape it to the demo laptop)

1. **Twilio call fails** → re-check the tunnel hostname (`.env` vs the running
   `cloudflared` output). Retry once.
2. Still dead → **play `test_audio/fallback_agent.wav`** on the laptop speakers
   (`afplay test_audio/fallback_agent.wav`) while narrating the flow.
3. Advance the demo state → open `scripts/fallback_page.html` and press
   **Acknowledge the alert** (or `curl -X POST localhost:8000/demo/force_ack
   -H 'content-type: application/json' -d '{"alert_id":"alr_demo"}'`).

## Two rules that are one `if` each — do not lose them

- **A voicemail is not an answer.** AMD `machine_*` → speak the 12-second script,
  hang up after `AgentAudioDone`, and advance the FSM exactly as `no_answer` (§5.6).
- **The final escalation step places a VOICE call + push, never SMS** — A2P 10DLC
  registration blocks SMS and will not clear in 24 hours (B10.1).
