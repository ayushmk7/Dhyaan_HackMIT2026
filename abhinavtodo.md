# Abhinav — voice + frontend

Your lanes: **B (Twilio + Deepgram voice)** and **D (React Native app)**.
Not yours: backend and the ML/perception stack are Ayush's ([`ayushneedtodo.md`](./ayushneedtodo.md)), hardware is Utsav's ([`utsavtodo.md`](./utsavtodo.md)).

Source of truth: [`TECHNICAL_PRD.md`](./TECHNICAL_PRD.md) (voice layer + app spec + API contract) · [`distinctive-frontend.md`](./distinctive-frontend.md) (design direction) · why they say what they say: [`DECISIONS.md`](./DECISIONS.md)

## ⚠ Changed Saturday evening — read before you continue (`DECISIONS.md`)

Follow-ups that land on you (full table at the bottom of `DECISIONS.md`):

- **F-06 · Recording + AI disclosure on every call, and a `stop_recording` tool** (D-004). Both greetings
  in `dhyaan/voice/settings.py:102-109` currently have neither. New text is in `TECHNICAL_PRD.md` §4.5;
  the tool definition is in §4.6 (five tools now). This is the one item with legal exposure on stage —
  judges are on these calls, in Massachusetts.
- **F-01 · Family Home never shows a room** (D-001): replace "In the {room} · N min" with home/out +
  activity, and drop the room-time bar from family Home and Timeline (keep it on staff S3).
  `frontend/src/app/(family)/index.tsx:111-112`, `:158`. D5.1 and D7.1 below are updated.
- **F-05 · Family alert takeover starts at `CALLING_CONTACT_1`**, not `SUSPECTED` (D-002). If Eleanor
  resolves it herself, the family gets one quiet timeline line. Staff/operator view keeps the countdown.
- **F-04 · No bathroom push to family**; that push is staff-only now (`TECHNICAL_PRD.md` §10.4).
- **F-07 · The "31 seconds" applause stat** shows the measured elapsed time from the live run — never a
  number from the 6× mock. D6.1 below is updated.
- **F-08 · Home tiles and chips** (D-010): tiles walked / up at night / out of the house / active (no
  "ate" at home); chips "Has she been out this week?", "How were her nights?", "Anything unusual this
  week?". D8.1 below is updated.
- **F-12 · Stretch — walking-profile panel** on staff S3 (impact ticker + live `impact_g_soft` readout
  with floor and ceiling) for the Arduino expo demo (`PRODUCT_SPEC.md` §10.2 A). ~30 min.
- **The demo script now lives only in `PRODUCT_SPEC.md` §10** (D-007): stage cancel window 10 s, contact
  step 20 s, escalation driven by the judge's answer.

## Do these in the first 15 minutes

- [ ] **Z1** Create the Twilio account, **upgrade it (~$20)**, buy a number, and verify every phone that will be dialled on stage. A trial account refuses unverified numbers and this kills demos. — 15 min — ⛔ BLOCKER
- [ ] **Z2** Get the Deepgram API key and confirm the auth header shape against their docs — the PRD writes it as working code while flagging it `[UNVERIFIED]`. — 10 min
- [ ] **Z3** Place one hello-world outbound call from a script, before any bridge code exists. If you cannot make a phone ring at H1, nothing later in lane B matters. — 15 min — ⛔ BLOCKER

**You own the two things judges actually see**: a phone ringing, and a screen lighting up. Both lanes are demo surface. Weight your time accordingly — a beautiful settings screen is worth nothing, the live alert screen is worth everything.

**Do not block on the backend.** D1.1 is a fixtures layer: every screen renders from local mock data from hour 1, with one flag to swap to the live API. Ayush's `fixtures/*.json` are the shapes to mirror.

## The clock

Hacking started **Saturday 11:00** and stops **Sunday 11:00**. Expo judging is **Sunday 12:00–14:30**, panel judging 14:45–16:45. Hour numbers below are hours since Saturday 11:00.

| Hour | Clock | Gate |
|---|---|---|
| H0 | Sat 11:00 | Start |
| H6 | Sat 17:00 | Hard gates on anything with an external dependency |
| H12 | Sat 23:00 | Feature freeze on anything not on the critical path |
| **H13** | **Sun 00:00** | **⛔ Plume project must exist or you cannot be judged** |
| H18 | Sun 05:00 | Integration freeze — no new code paths after this |
| H22 | Sun 09:00 | Rehearse the demo three times, on the real hardware |
| H24 | Sun 11:00 | Hacking stops |

## The critical path — all three of you sit on it

```
Utsav: band fires an event   →   Ayush: ingest + FSM   →   Abhinav: the phone rings
                                         ↓
                              Abhinav: agent classifies the answer
                                         ↓
                              Ayush: FSM escalates   →   Abhinav: family's phone lights up
```

**That chain is the demo.** A fall goes in, a phone rings, a person answers, the right human gets called. Everything else — the cameras, the room tracking, the learned baseline, the chat — makes it a product and wins the data prizes, but if that chain does not run end to end you have nothing to show a judge.

## The interface contract — agree these at H1, do not renegotiate at H14

Three people cannot integrate at hour 18 unless the seams were frozen at hour 1. Each seam has one owner who writes it down and one consumer who codes against it.

| Seam | Owner writes | Consumer codes against | Frozen by |
|---|---|---|---|
| **Band → backend** | Utsav posts the exact event JSON he will send | Ayush's `/v1/ingest/band` accepts it | **H2** |
| **Backend → app** | Ayush publishes the endpoint list + websocket payloads | Abhinav's API client + fixtures mirror them | **H2** |
| **FSM → voice** | Ayush exposes "place a call to X for alert Y" and an "agent classified it as Z" callback | Abhinav's bridge calls exactly those | **H3** |
| **Band → RF** | Utsav posts the RSSI scan payload shape | Ayush's localizer consumes it | **H4** |

The rule: **the owner writes a real example payload into the repo as a `.json` fixture file, not a message in Discord.** The consumer builds against the fixture. If the fixture changes, the owner tells the consumer out loud.

## When you are behind — cut in this order

You will be behind. Cut from the bottom up, never from the top.

| # | Cut | Lose | Still works |
|---|---|---|---|
| 1 | RAG chat | The "ask about mum" moment | Timeline still shows events |
| 2 | Camera + VLM | ADL tracking, the B2B story | B2C fall + location demo intact |
| 3 | Baseline learner | "We learn her normal" | Hard-rule alerts still fire |
| 4 | RF localization | Room-level location | Fall detection unaffected |
| 5 | Second contact in the ladder | Redundancy | Ladder still escalates once |
| 6 | The physical band | The object judges can touch — **and the Arduino track**, which requires live UNO Q + Modulino input | A phone posting the same JSON demos the same system |

**Never cut:** the event table, the FSM, the outbound call.

## Truth in demos

Write these on the whiteboard. Say them out loud to judges. Being the team that volunteers which parts are synthetic buys more credibility than being the team that gets caught.

- The 14 days of resident history come from a seed script. The learner running on it is real.
- The "home" is a taped-out floor plan with four beacons 3–8 m apart at chest height.
- The band is a dev board on a strap, not a product.
- We do not dial 911. This is a research prototype — not FDA-cleared, and it cannot detect all falls. (Don't say "not a medical device" — `PRODUCT_SPEC.md` §8.7, D-003.)

## Two things that are already known to be true

- **Submission is on Plume, not Devpost**, and the project must exist before Sunday 00:00.
- **Prior art is close.** [LifeLine](https://devpost.com/software/lifeline-5prxbs) (TerraHacks 2025) already does fall detection → automated LLM phone call. The one thing nobody has done is **call the fallen person first and let their answer choose the escalation tier**. That is the whole differentiator — point the demo at it and say so.

---

## ⛔ Spec conflicts you must resolve at H1 — before firmware locks its POST format

The two specs were written in parallel and disagree in three places. **Resolve them out loud at the H1 standup, write the decision in the repo, and do not let anyone code past it.** The resolutions below are the defaults; overrule them together if you have a reason.

| # | Conflict | Resolution |
|---|---|---|
| 1 | **Band → backend endpoint.** `HARDWARE_SPEC` §5.4–5.7 says `POST /v1/events`, rich `fallband.event.v1` schema, no auth. `TECHNICAL_PRD` §10.5 says `POST /v1/ingest/band` + `/ingest/rf` + `/ingest/band/cancel`, simpler payload, `X-Band-Key` HMAC. | **PRD wins** — it owns the API surface and the app codes against it. Utsav conforms. Drop the HMAC to a shared static header for the demo if it costs more than 20 minutes. |
| 2 | **Sensor config.** PRD §4.1 said 104 Hz / ±8 g / GPIO interrupt. `HARDWARE_SPEC` §6 says 208 Hz / ±16 g / Bridge.notify. | **Hardware spec wins** — its numbers came from reading the datasheet against library source, and the ±4 g clipping trap is real. PRD §4.1 has been corrected to match. |
| 3 | **Resolution naming.** `POST /alerts/{id}/resolve` takes `resolution: "fell_ok"`; the FSM state is `FELL_BUT_FINE`. | Pick one string, grep the repo, done in five minutes. Leave it and you will debug it at H19. |

Also flagged, lower stakes: REST auths with `Authorization: Bearer <JWT>` while the websocket takes `?token=<jwt>` in the query string. Unavoidable for WS, but query-string tokens land in server logs — fine for a hackathon, worth saying out loud if a judge asks about security.
## B. Voice (Twilio + Deepgram)

### B0. ⛔ HOUR-0: accounts, verification, and one "hello world" call — DO THIS BEFORE ANY BRIDGE CODE

- [ ] **B0.1** ⛔ BLOCKER Create Twilio account, buy/confirm a voice-capable number, and note `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_E164` — 5 min — _done when:_ `twilio api:core:accounts:fetch` (or console) shows the account SID and the number appears under Phone Numbers.
- [ ] **B0.2** ⛔ BLOCKER Verify all team + resident-role test phones as Caller IDs (trial accounts can ONLY call verified numbers, max 5 recipients) — 10 min — _done when:_ Console → Phone Numbers → Verified Caller IDs lists 4+ numbers, each confirmed via SMS/voice PIN.
  - Trap: the trial signup number is auto-verified but everyone else's phone is not — verify teammates' phones immediately, not "later."
- [ ] **B0.3** 🔁 PARALLEL-OK Upgrade the Twilio account with ~$20 credit — 5 min — _done when:_ account shows "Pay as you go", removing the 5-recipient cap and the trial voice preamble (PRD flags the exact preamble wording as `[UNVERIFIED]` — just upgrade, don't investigate it).
- [ ] **B0.4** ⛔ BLOCKER Confirm Twilio outbound voice per-minute pricing + number rental cost — PRD marks this `[UNVERIFIED]` — 3 min — _done when:_ you've looked at twilio.com/en-us/voice/pricing and written the $/min figure into the budget doc.
- [ ] **B0.5** Sign up for Deepgram, grab `DEEPGRAM_API_KEY` — 3 min — _done when:_ key is in env.
- [ ] **B0.6** ⛔ BLOCKER PRD flags this `[UNVERIFIED]`: write a 10-line standalone script that opens `wss://agent.deepgram.com/v1/agent/converse` with header `Authorization: Token <DEEPGRAM_API_KEY>` and confirms you get a `Welcome` frame back, not a 401/403 — 10 min — _done when:_ script prints `Welcome`. If it 401s, try `Bearer` before assuming Token is wrong.
    ```python
    import asyncio, websockets, os
    async def main():
        async with websockets.connect(
            "wss://agent.deepgram.com/v1/agent/converse",
            additional_headers={"Authorization": f"Token {os.environ['DEEPGRAM_API_KEY']}"},
        ) as ws:
            print(await ws.recv())  # expect Welcome
    asyncio.run(main())
    ```
- [ ] **B0.7** ⛔ BLOCKER PRD flags this `[UNVERIFIED]`: confirm the Python Twilio SDK call shape — read the code tabs on the Call resource docs page and check `client.calls.create(to=, from_=, twiml=, timeout=, machine_detection=, async_amd=, ...)` actually matches current SDK version installed — 10 min — _done when:_ `pip show twilio` version matches docs tab you read, and a throwaway script successfully creates a call object (see B0.8).
- [ ] **B0.8** ⛔ BLOCKER "Hello world" outbound call, no bridge, no Deepgram — just prove Twilio + your account can ring a verified phone with static TwiML (`<Say>`) — 10 min — _done when:_ a verified team phone actually rings and plays "hello from dhyaan."
    ```python
    from twilio.rest import Client
    c = Client(SID, TOKEN)
    c.calls.create(to="+1...", from_=FROM_E164, twiml="<Response><Say>Hello from Dhyaan.</Say></Response>")
    ```
- [ ] **B0.9** Set up `cloudflared tunnel --url http://localhost:8000` and PIN the hostname (write it to `.env` as `PUBLIC_WSS`/`PUBLIC_HTTPS`) — 5 min — _done when:_ hitting the tunneled HTTPS URL from a phone browser (off wifi) returns a response. **Do not restart the tunnel after this point** — a new tunnel run gets a new hostname and silently breaks every call made after that.

### B1. Backend contract with the FSM (what this engineer calls, doesn't own)

- [ ] **B1.1** Confirm/import the FSM entry points you depend on, do not reimplement: `events.emit(...)` (dhyaan/events.py) for writing `fall_suspected`, `call_answered`, `escalate_acknowledged` etc., and `FSM.handle_voice_tool(alert_id, role, fn_name, args)` which the bridge calls on every `FunctionCallRequest` — 10 min — _done when:_ you can import both and call `FSM.handle_voice_tool` against a fake alert_id in a REPL without exception.
- [ ] **B1.2** Confirm the alert-row helper functions your bridge needs but does not own: `db_bind_call(call_id, call_sid, stream_sid)` and `append_transcript(call_id, role, content)` — 5 min — _done when:_ both are importable and you've seen their signature (backend/DB engineer owns implementation).
- [ ] **B1.3** 🔁 PARALLEL-OK Agree with the FSM owner on the exact JSON shape `handle_voice_tool` returns (goes back to Deepgram as `FunctionCallResponse.content`) — 10 min — _done when:_ a written example dict exists in a shared doc/slack, e.g. `{"ok": true}`.

### B2. Outbound call placement (`dhyaan/voice/outbound.py`)

- [ ] **B2.1** Implement `place_call(to_e164, alert_id, role, call_id, attempt=1)` exactly per §5.3: inline TwiML with `<Connect><Stream>` (bidirectional — NOT `<Start><Stream>`, which is receive-only) carrying `<Parameter>` for `alert_id`, `call_id`, `role` — 20 min — _done when:_ calling `place_call` rings a verified phone and the TwiML XML validates (no escaping bugs — use `xml.sax.saxutils.escape` on all interpolated values).
- [ ] **B2.2** Wire `timeout=25`, `machine_detection="Enable"`, `async_amd="true"`, `async_amd_status_callback`, `status_callback` + `status_callback_event=["initiated","ringing","answered","completed"]` — 10 min — _done when:_ a test call's Twilio console log shows all 4 status callback events hit your `/twilio/status` endpoint.
- [ ] **B2.3** Implement `/twilio/status` and `/twilio/amd` receiver stubs that just log the payload for now (real AMD handling comes in B6) — 10 min — _done when:_ curl-replaying a sample Twilio AMD POST body against the endpoint returns 200 and logs `AnsweredBy`.
- [ ] **B2.4** 🔁 PARALLEL-OK Implement the retry-once-then-escalate caller: attempt 2 fifteen seconds after attempt 1 ends on `no-answer`/`busy`/`failed`, then hand off to contact ladder — 15 min — _done when:_ a unit test with a mocked Twilio client shows exactly one retry and no third attempt.

### B3. Media Streams bridge (`dhyaan/voice/bridge.py`) — the core of this slice

- [ ] **B3.1** ⛔ BLOCKER Stand up the FastAPI websocket route `/twilio/stream`, accept the connection, and on Twilio's `start` event capture `streamSid`, `callSid`, and `customParameters` (`alert_id`, `call_id`, `role`) — 20 min — _done when:_ logging the `start` message from a real test call shows all three custom params present.
- [ ] **B3.2** ⛔ BLOCKER Open the Deepgram socket, send the `Settings` message (§5.2, built via `build_settings(ctx)` keyed on `role`), and **wait for `SettingsApplied` before relaying any audio** — 20 min — _done when:_ logs show `SettingsApplied` received before the first `media` frame is forwarded.
- [ ] **B3.3** Implement `twilio_to_deepgram()`: on `media` event, base64-decode Twilio's payload and send the **raw bytes as a binary websocket frame** to Deepgram — do NOT re-wrap in JSON — 15 min — _done when:_ a packet capture / debug log confirms outgoing DG frames are binary, not `{"type":"Media",...}` JSON.
- [ ] **B3.4** Implement `deepgram_to_twilio()`: on binary message from DG, base64-encode and wrap as `{"event":"media","streamSid":...,"media":{"payload":...}}` back to Twilio — 15 min — _done when:_ agent's TTS audibly plays on the test call.
- [ ] **B3.5** No resampling, anywhere. Both sides are `mulaw`/8000 by explicit Settings config — the only transform in the pipe is base64 decode/encode — 5 min — _done when:_ a grep of the bridge file for `audioop|resample|scipy` returns nothing.
- [ ] **B3.6** Implement the `KeepAlive` loop: send `{"type":"KeepAlive"}` to Deepgram every 8s, running concurrently via `asyncio.gather` alongside both directional loops — 10 min — _done when:_ a call left "quiet" (no speech either side) for 30s does not drop the DG socket.
- [ ] **B3.7** Handle `stop` event from Twilio by breaking the loop and closing the DG socket cleanly — 10 min — _done when:_ hanging up the test call does not leave an orphaned DG websocket (check DG dashboard/connection count).

### B4. Barge-in

- [ ] **B4.1** ⛔ BLOCKER On `UserStartedSpeaking` from Deepgram, immediately send `{"event":"clear","streamSid":...}` to Twilio — this flushes Twilio's playback buffer and IS the entire barge-in implementation — 10 min — _done when:_ interrupting the agent mid-sentence on a live test call stops the audio within ~200ms instead of finishing the sentence.
  - Note: PRD flags `[UNVERIFIED]` whether Deepgram also halts TTS generation server-side on `UserStartedSpeaking` — assume it does NOT and always send `clear` regardless.
- [ ] **B4.2** Confirm `streamSid` is attached to every single outbound Twilio frame, not just `media` — including `clear` and `mark` — 5 min — _done when:_ grep of all `tw.send_text` calls shows `streamSid` in every payload.

### B5. Function calling / escalation ladder execution

- [ ] **B5.1** Wire `FunctionCallRequest` handling: parse `fn["arguments"]` JSON, call `FSM.handle_voice_tool(alert_id, role, fn["name"], args)`, send back `FunctionCallResponse` with `id`, `name`, `content` — 20 min — _done when:_ a scripted fake `mark_ok` FunctionCallRequest produces a `FunctionCallResponse` echoed to a mock DG socket.
- [ ] **B5.2** Load the 5 tool defs (`mark_ok`, `escalate`, `request_callback`, `stop_recording`, `end_call`) verbatim from §4.6 into `agent.think.functions` in Settings — 10 min — _done when:_ Settings JSON round-trips through a JSON validator and matches PRD schema exactly, including `end_call`'s `defer_until_eot: true`.
- [ ] **B5.3** Do NOT defer `mark_ok`, `escalate`, `request_callback` — only `end_call` gets `defer_until_eot: true` — 5 min — _done when:_ code review confirms only one function object has that key.
- [ ] **B5.4** Handle `FunctionCallCancelled` as a no-op (FSM actions must already be idempotent — confirm this property with whoever owns `handle_voice_tool`, don't assume) — 5 min — _done when:_ calling `handle_voice_tool` twice with the same args does not double-fire escalation (e.g. does not place two contact calls).
- [ ] **B5.5** On `AgentAudioDone`, check `ctx["pending_hangup"]` and hang up the Twilio call via the REST API if set (this is how `end_call`'s deferred execution actually closes the phone line after the farewell line finishes) — 15 min — _done when:_ a test call ending in `end_call` closes the call only after the goodbye audio is heard, not before.
- [ ] **B5.6** Silence-escalates-by-default: if the call ends with no tool call, default classification to `incoherent` and escalate — 15 min — _done when:_ a test call where the agent talks but nobody calls a tool (e.g. hang up before deciding) results in an `escalate(reason="incoherent")`-equivalent FSM transition, not a silent drop.
- [ ] **B5.7** 🔁 PARALLEL-OK Implement the 20s-silence-after-greeting timer client-side in the bridge (repeat greeting once via `InjectAgentMessage`, then escalate reason="silence" if still nothing) — 15 min — _done when:_ a test call where you say nothing after the greeting triggers exactly one repeated greeting then an escalate call at ~20s.

### B6. Voicemail / AMD handling

- [ ] **B6.1** ⛔ Implement `/twilio/amd` receiver: on `AnsweredBy` ∈ `{machine_start, machine_end_beep, machine_end_silence, machine_end_other, fax}`, write `call_answered` event with `answered_by`, set `calls.classification="voicemail"` — 15 min — _done when:_ calling your own cell with voicemail on and letting it go to voicemail produces this event in the DB.
- [ ] **B6.2** Send `InjectAgentMessage` with the 12-second voicemail script (verbatim from §5.6) so Aura speaks it into the voicemail — 10 min — _done when:_ replaying a recorded voicemail-answered call shows the injected message text spoken, not the normal greeting.
- [ ] **B6.3** On `AgentAudioDone` after the voicemail injection, hang up the Twilio call — 5 min — _done when:_ the call ends automatically right after the voicemail script finishes, no dead air.
- [ ] **B6.4** ⛔ Advance the FSM exactly as if `no_answer` occurred — a voicemail is NOT an answer, must not classify as resident contact — one `if` statement, get it right — 10 min — _done when:_ a voicemail-classified call still triggers the same next-state transition (`RETRY_RESIDENT` or `CALLING_CONTACT_1`) as a true no-answer.
- [ ] **B6.5** On `AnsweredBy = unknown` (AMD timed out), treat as human and let the agent talk normally — 5 min — _done when:_ code path shows `unknown` falls through to the normal live-agent branch, not the voicemail branch.

### B7. Call logging / transcripts

- [ ] **B7.1** 🔁 PARALLEL-OK On every `ConversationText` event from Deepgram, call `append_transcript(call_id, role, content)` — 10 min — _done when:_ after a test call, the DB/log has a full turn-by-turn transcript with correct roles.
- [ ] **B7.2** 🔁 PARALLEL-OK Log `Error`/`Warning` frames from Deepgram with code+description — 5 min — _done when:_ forcing a bad Settings message (e.g. typo a field) produces a visible error log line, not a silent hang.
- [ ] **B7.3** Bind `call_sid` + `stream_sid` to `alert_id`/`call_id` at `start` time via `db_bind_call` so transcripts and status callbacks can be joined later — 10 min — _done when:_ querying by `alert_id` after a test call returns the transcript, the AMD verdict, and the final classification in one place.

### B8. Local test harness — iterate on prompts without dialing anyone

- [ ] **B8.1** 🔁 PARALLEL-OK Record 5-10 short caller audio clips (mulaw/8k WAV) covering each classification branch: "I'm fine", "I fell but I'm up", "help I can't get up", confused/slurred rambling, silence — 15 min — _done when:_ files exist in `test_audio/` at correct format (`ffmpeg -i in.wav -ar 8000 -ac 1 -c:a pcm_mulaw out.wav`).
- [ ] **B8.2** ⛔ Write `scripts/replay_to_agent.py`: opens a Deepgram Voice Agent socket directly (same Settings as bridge, resident role), streams a recorded WAV's raw mulaw bytes in ~20ms chunks (simulate real-time pacing) instead of live mic/Twilio audio, and prints `ConversationText` + `FunctionCallRequest` events to stdout — 30 min — _done when:_ running it against the "help I can't get up" clip prints an `escalate(reason="distress")` function call with no phone involved.
    ```python
    # scripts/replay_to_agent.py — sketch
    import asyncio, websockets, json, os, wave, time
    async def replay(wav_path, role="resident"):
        async with websockets.connect(DG_URL, additional_headers=DG_HDRS) as dg:
            await dg.send(json.dumps(build_settings({"role": role})))
            assert json.loads(await dg.recv())["type"] == "SettingsApplied"
            async def sender():
                with wave.open(wav_path, "rb") as w:
                    chunk = w.readframes(160)  # ~20ms @ 8000Hz mulaw
                    while chunk:
                        await dg.send(chunk)
                        await asyncio.sleep(0.02)
                        chunk = w.readframes(160)
            async def receiver():
                async for msg in dg:
                    if not isinstance(msg, bytes):
                        print(json.loads(msg))
            await asyncio.gather(sender(), receiver())
    ```
- [ ] **B8.3** Use B8.2 as the default prompt-iteration loop: change `agent.think.prompt`, rerun against all clips in `test_audio/`, confirm expected tool call fires each time, before ever touching a real phone — 10 min (ongoing) — _done when:_ all 5 clips map to their expected classification with zero live calls placed.
- [ ] **B8.4** 🔁 PARALLEL-OK Write a bridge-level integration test using a fake Twilio websocket client (asyncio, sends synthetic `start`/`media`/`stop` frames from a recorded clip) that exercises the FULL bridge including barge-in `clear` messages and FSM calls, mocking only the real Twilio REST call — 25 min — _done when:_ this test passes in CI/locally without any Twilio account interaction.

### B9. Fallback ladder if telephony dies mid-demo

- [ ] **B9.1** 🔁 PARALLEL-OK Build a browser-based WebRTC fallback call path (e.g. a minimal page that opens a mic-enabled websocket straight to the same Deepgram agent bridge, bypassing Twilio entirely) — 30 min — _done when:_ opening the page on a laptop and speaking triggers the same escalate/mark_ok flow as a phone call.
- [ ] **B9.2** 🔁 PARALLEL-OK Pre-record a fallback "agent" audio clip (the greeting + a canned escalation line) to play if BOTH Twilio and Deepgram are unreachable at demo time — 10 min — _done when:_ an mp3/wav exists and a one-line script can play it on cue.
- [ ] **B9.3** Document and rehearse the last-resort path: "judge/teammate manually presses an 'Acknowledge' button in a laptop UI" to fake a human answering and advance the FSM state for demo purposes — 10 min — _done when:_ a button exists (even a curl command to a `/demo/force_ack` endpoint) that transitions the alert to `ACKNOWLEDGED` without any live audio.
- [ ] **B9.4** Write the fallback decision tree as a one-pager next to the demo laptop: "Twilio call fails → try WebRTC page → try pre-recorded clip → press the laptop button" — 5 min — _done when:_ it's printed/visible and every team member has read it once.

### B10. Hour-0 friction sweep (re-verify from §5.7 / Appendix A before demo day)

- [ ] **B10.1** Confirm A2P 10DLC does NOT block outbound voice (it's SMS/MMS-only) — but if the final escalation step (§4.2 `ESCALATED_FINAL`) uses SMS, that leg DOES need 10DLC, which will not clear in 24 hours. Change the B2C final step to a voice call to contact 3 + push, not SMS — 10 min — _done when:_ code path for `ESCALATED_FINAL` places a call, not `messages.create(...)`.
- [ ] **B10.2** Reconfirm the trial 10-minute call cap is moot (calls are ~45s) and the trial preamble is gone post-upgrade (B0.3) — 5 min — _done when:_ a live test call has no Twilio-injected preamble audio before your TwiML starts.
- [ ] **B10.3** Re-verify the `cloudflared` tunnel hostname has not changed since B0.9 — a tunnel restart mid-demo silently breaks every call — 2 min — _done when:_ `PUBLIC_WSS` env var matches the currently running tunnel's printed hostname.

### B-checkpoints

| hour | what must work | one-command proof |
|---|---|---|
| 0 | Twilio account upgraded, 4+ phones verified, Deepgram key works, static-TwiML call rings a real phone | `python -c "from dhyaan.voice.outbound import hello_world_call; hello_world_call('+1...')"` and phone rings with `<Say>` audio |
| 1 | DG websocket auth confirmed, Twilio SDK call shape confirmed, cloudflared tunnel pinned | `python scripts/dg_connect_test.py` prints `Welcome`; `curl -s $PUBLIC_HTTPS/health` returns 200 |
| 3-4 | Full bridge live: place_call → Media Stream → DG Settings → agent speaks greeting → barge-in works | Call a verified phone via `place_call(...)`, interrupt the greeting out loud, confirm audio stops within ~200ms |
| 6-8 | All 4 tool calls fire correctly end-to-end on real calls; voicemail path classifies as `no_answer` | Run `scripts/replay_to_agent.py` against all 5 `test_audio/` clips — 5/5 correct tool calls, zero live calls |
| 10-12 | Escalation ladder executes against real FSM: resident no-answer → retry → contact 1 → contact 2 → final | `curl -X POST localhost:8000/debug/simulate_fall` and watch `alerts` row walk every state within ~4 min via `sqlite3 dhyaan.db "select state from alerts order by state_changed_at"` |
| 20-22 | Fallback ladder rehearsed; transcripts/logging complete for any real call made in testing | Open the WebRTC fallback page, speak "help", confirm same escalate event as a phone call; `sqlite3 dhyaan.db "select * from calls where call_id=?"` shows full transcript |

## D. Frontend (React Native)

**Owner: Abhinav.** Ships one Expo binary that is both the B2C family app and the B2B staff app
(`role` claim in the JWT flips the root layout — §10.1). Rule zero from the PRD: the `Event` schema
(§3) and API contract (§10.5) freeze at T+2:00 — after that, do not renegotiate response shapes, adapt
in the client.

### D1. Project bootstrap + mock-data layer

⛔ BLOCKER — everything else in this slice depends on D1.

- [ ] **D1.1** ⛔ BLOCKER Build the mock-data layer FIRST, before the API client exists — 45 min — _done when:_ every screen below can render real-looking content with zero network calls, driven by one flag.
      This is the single most important task in the slice: the backend does not exist yet and must never block the frontend.
      Create `lib/mock/fixtures.ts` with hand-written JSON matching the §10.5 response shapes exactly:
      `residents[]` (GET /residents), one full `resident` detail + `location` + `summary`, a day of
      `events[]` (timeline), an `alert` object with a `ladder[]` and `calls[]` (GET /alerts/{id}), and a
      canned `/chat` response with `citations`/`counts`.
      Create `lib/mock/server.ts`: a fake async client with the same function signatures the real API
      client will have (`getResidents()`, `getAlert(id)`, `postAck(id)`, `postChat(...)`, etc.), each
      resolving from fixtures with a small `setTimeout` to feel real.
      Create `lib/mock/wsSimulator.ts`: emits the same `WsEnvelope` messages a real socket would
      (`alert.opened` → `alert.ladder` × N → `alert.closed`, `location.changed`) on a `setInterval`
      script, so the alert screen can be built and demoed with the backend never running.
      Single switch: `lib/config.ts` exports `const USE_MOCKS = true` (env-overridable via
      `EXPO_PUBLIC_USE_MOCKS`). Every data-consuming hook imports from `lib/api/index.ts`, which
      re-exports either `lib/mock/server.ts` or `lib/api/client.ts` based on that flag — screens never
      import mock or live directly.
      🔁 Nobody else's work is blocked by whether the flag is true or false — that is the point.

- [ ] **D1.2** ⛔ BLOCKER `npx create-expo-app dhyaan-app --template default@sdk-57` (Expo SDK 57 / RN 0.86, NOT 58) — 15 min — _done when:_ `npx expo start` boots the default app in Expo Go.
      ```
      npx create-expo-app@latest dhyaan-app -e with-router
      cd dhyaan-app
      npx expo install expo-router expo-notifications expo-audio expo-linear-gradient expo-font expo-haptics
      npm install zustand @tanstack/react-query
      ```
      Confirm New Architecture is on (default in SDK 57) and `expo-router` is the nav library — no
      React Navigation boilerplate.

- [ ] **D1.3** ⛔ BLOCKER Kick off the EAS development build immediately, in parallel with D1.2 — 25 min wall clock, ~5 min hands-on — _done when:_ a `.ipa`/dev-client build is installed on a real iPhone via EAS or TestFlight-internal, and it is NOT Expo Go.
      Push notifications do not work in Expo Go on either platform — this is documented, not a bug you'll
      hit later. Build now because iOS builds take 15–25 min and you cannot discover that at hour 20.
      ```
      npx eas login
      npx eas build:configure
      npx eas build --profile development --platform ios
      ```
      Needs an Apple dev account + APNs key registered in EAS credentials — do this now, not when you
      first need push.

- [ ] **D1.4** 🔁 PARALLEL-OK Set up the design-token file per the team's distinctive-frontend direction — 20 min — _done when:_ `theme/tokens.ts` exports fonts/colors/spacing and one screen visibly uses them (no default system font, no purple/blue gradient).
      Load 1-2 Google Fonts via `expo-font` (`useFonts`) — e.g. a display face at weight 900 for
      headers/alert screen, a body face at weight 300-400 for everything else. Avoid Inter/Roboto as the
      *display* face; a heavier, more distinctive pairing (e.g. `SpaceGrotesk_900Black` +
      `Inter_300Light`) is fine per the skill's own recommendation. Pick ONE cohesive dark theme with a
      clear accent used for "ok" (calm) and a hot, unmissable red/orange reserved ONLY for the alert
      screen — the entire rest of the app should look calm so the alert screen's color is a genuine
      shock. Use `expo-linear-gradient` for backgrounds instead of flat fills; respect
      `prefers-reduced-motion`-equivalent (`AccessibilityInfo.isReduceMotionEnabled`) before firing
      heavy entrance animations.

### D2. Navigation skeleton

🔁 depends on D1.2 only.

- [ ] **D2.1** Stub every route from the nav map in `app/` — 30 min — _done when:_ `expo-router` renders a placeholder for every route below with no crashes.
      ```
      app/_layout.tsx                 # root: auth gate stub, WS provider stub, notif handler, <AlertTakeover/>
      app/onboard/{welcome,consent,baseline,pair,survey,contacts}.tsx
      app/(family)/_layout.tsx        # tabs: Home · Timeline · Ask · Settings
      app/(family)/index.tsx
      app/(family)/timeline/index.tsx
      app/(family)/timeline/[eventId].tsx
      app/(family)/chat.tsx
      app/(family)/settings.tsx
      app/(staff)/_layout.tsx         # tabs: Triage · Floor · Rounds
      app/(staff)/index.tsx
      app/(staff)/floor.tsx
      app/(staff)/rounds.tsx
      app/(staff)/resident/[id].tsx
      app/alert/[id].tsx              # presentation: 'fullScreenModal'
      ```
- [ ] **D2.2** Wire `alert/[id]` as a root-level `fullScreenModal`, reachable from any state — 15 min — _done when:_ navigating to `/alert/test123` from Home, from Chat, and via a cold deep link (`npx uri-scheme open dhyaan://alert/test123 --ios`) all land on the same full-screen route.
- [ ] **D2.3** 🔁 PARALLEL-OK Role-based root switch: decode `role` from the (mocked) JWT and route to `(family)` vs `(staff)` layout group — 20 min — _done when:_ toggling a mock `role` value in dev tools flips the whole app's tab bar.

### D3. State layer & API client (mock/live switch)

⛔ depends on D1.1 (fixtures/shapes already defined there).

- [ ] **D3.1** Build `store/live.ts` (Zustand) exactly per §10.3 — 30 min — _done when:_ `status`, `residents`, `activeAlert`, `ladder` are readable from any screen and `applyEvent(wsEnvelope)` mutates them correctly for all 5 WS message types (`alert.opened`, `alert.ladder`, `alert.voice`, `alert.closed`, `location.changed`, `location.dwell`, `event.new`, `resident.state`).
      Keep the rule from the PRD literally: TanStack Query owns `/timeline`, `/summary`, `/contacts` —
      anything cacheable; Zustand owns anything the websocket mutates; **the two never share a key.**
- [ ] **D3.2** Build the real `lib/api/client.ts` with one function per §10.5 endpoint, same signatures as `lib/mock/server.ts` — 45 min — _done when:_ flipping `USE_MOCKS = false` compiles with zero call-site changes anywhere in the app.
      Base `https://<tunnel>/v1`, `Authorization: Bearer <JWT>` on every call. Cover: `/residents`,
      `/residents/{id}`, `/residents/{id}/location`, `/residents/{id}/location/history`,
      `/residents/{id}/events`, `/residents/{id}/summary`, `/residents/{id}/contacts`,
      `/residents/{id}/fingerprint/{start,stop}`, `/residents/{id}/zones`, `/alerts?state=open`,
      `/alerts/{id}`, `/alerts/{id}/{ack,resolve,feedback,escalate_now}`, `/chat`, `/chat/{session_id}`,
      `/bands/pair`, `/devices/push-token`, `/admin/simulate` (yes, the demo trigger belongs in the
      client too — a hidden settings-screen button that calls it is worth 10 minutes).
      Parse the `{"error":{"code","message","detail"}}` error envelope centrally, once.
- [ ] **D3.3** 🔁 PARALLEL-OK WebSocket provider: connect `wss://<tunnel>/v1/ws?token=<jwt>`, ping `{"t":"ping"}` every 25s, route every inbound message into `store/live.ts.applyEvent` — 30 min — _done when:_ toggling `USE_MOCKS` swaps this for `lib/mock/wsSimulator.ts` with no component changes, and killing the mock socket + reopening replays correctly.
      On `AppState → 'active'`: `focusManager.setFocused(true)`, force a reconnect, AND call
      `GET /v1/alerts?state=open` — the socket was dead the whole time the app was backgrounded, assume
      you missed every message. Note for your own sanity: **a websocket cannot stay alive in the iOS
      background** — this isn't a bug to chase, it's documented Apple/RN behavior. Foreground = socket,
      background = push, resync on resume. Don't spend time trying to keep it alive in the background.

### D4. Onboarding & band pairing (B2C)

🔁 PARALLEL-OK once D1 + D2 land — no dependency on D3 being "live" since it's mock-driven.

- [ ] **D4.1** `/onboard/welcome` + `/onboard/consent` — 30 min — _done when:_ consent screen requires the resident's name typed in (not the family member's) before "Continue" enables, and cannot be skipped/back-navigated past.
- [ ] **D4.2** `/onboard/baseline` — cold-start prior form (wake time, meals/day, walks/day, goes outside?, mobility) — 25 min — _done when:_ submitting posts (mock or real) a shape matching what §8.4 baseline expects and advances to pairing.
- [ ] **D4.3** `/onboard/pair` — 6-digit code entry + live RSSI bar — 30 min — _done when:_ typing a code calls `POST /v1/bands/pair` (mocked) and an animated bar reacts to a fake fluctuating RSSI value on a timer, proving the "band is talking" feel without hardware.
- [ ] **D4.4** `/onboard/survey` — per-room fingerprint capture cards — 30 min — _done when:_ Start/Stop calls `fingerprint/start` + `fingerprint/stop` (mocked), shows a live anchor count and a "too close" merge prompt when two rooms' mocked `separability_db` < 6.
- [ ] **D4.5** `/onboard/contacts` — drag-to-reorder escalation ladder, min 1 required, nudge for 2 — 30 min — _done when:_ reordering persists to `POST /v1/residents/{id}/contacts` shape and the Continue button is disabled below 1 contact.

### D5. Home / status screen

🔁 depends on D3.1 (store) + D1.1 (fixtures).

- [ ] **D5.1** `/` (family home) — big status card (name, "OK", **home/out + activity — never a room**, last-seen, band last seen — no battery, D-001/D-013) + 4 tiles (walked/up-at-night/out-of-the-house/active — no "ate" at home, D-010) in green/amber/grey — 45 min — _done when:_ pull-to-refresh re-fetches `/residents/{id}` + `/residents/{id}/location` and tiles reflect mocked `summary.tiles` states.
      Location card should read from the live `store.residents[id].location`, not a query — it's
      websocket-owned per §10.3. This card is what "location.changed" pushes make feel alive; wire it to
      the store, not to polling.

### D6. LIVE ALERT screen — the demo — its own phase, disproportionate effort

⛔ This screen is what a judge watches. Budget real time here even if other screens stay rough.

- [ ] **D6.1** ⛔ BLOCKER Build `app/alert/[id].tsx` as a full-screen red takeover with explicit phases, not a generic list — 90 min — _done when:_ opening it via mock WS events visibly transitions through every phase below with distinct full-screen treatment for each (not just a text label change).
      Phases, driven off `alert.ladder` step + `alert.closed`, matching FSM §4.2/4.3:
      - **SUSPECTED** — red pulse, resident's name huge, "Possible fall — calling Eleanor now.", live
        countdown ring for the 30s cancel window.
      - **CALLING_RESIDENT / RETRY_RESIDENT** — phone-ringing visual (animated waveform or pulsing
        avatar), "Calling Eleanor…", live transcript lines streaming in from `alert.voice` messages
        (speaker: agent | resident) as they arrive.
      - **CALLING_CONTACT_1 / CALLING_CONTACT_2** — "Calling you…" / "Calling Priya & Marcus" (parallel,
        per §4.2 — show both names, not a serial queue), ladder step history visible above as a
        completed checklist (*"Eleanor — no answer ✓"*).
      - **ESCALATED_FINAL** — max-urgency treatment, screen edge strobe or heavier red, explicit
        "we do not dial 911 for you" microcopy near the Call 911 button so nobody assumes auto-dial.
      - **ACKNOWLEDGED** — the ladder timeline freezes in place, big checkmark, elapsed time stat
        ("N seconds from the fall to a human being told") — this is the applause line, make it visible.
        **N is measured from the alert record of the live run** — never a hard-coded "31", and never a
        number from the 6× mock (D-007, F-07).
      - **Family role:** the takeover opens at CALLING_CONTACT_1, not SUSPECTED (D-002, F-05).
      Buttons on every phase: **"I've got her"** (huge, primary, calls `POST /alerts/{id}/ack`), "Call
      Eleanor" (opens native dialer, does not auto-dial), "Call 911" (same — dials, never auto-dials).
      Live step timeline renders directly off `store.ladder` (websocket-appended array per §10.3) — do
      not re-derive it from polling.
- [ ] **D6.2** Ringtone loop with `expo-audio` (NOT `expo-av` — removed in SDK 55, will not install) — 20 min — _done when:_ the alert screen loops a loud custom sound while SUSPECTED/CALLING phases are active and stops cleanly on ACKNOWLEDGED/unmount.
- [ ] **D6.3** 🔁 PARALLEL-OK Haptics + entrance choreography for the takeover (per distinctive-frontend motion direction: staggered, intentional, not a fade) — 20 min — _done when:_ the screen's entrance is a deliberate sequence (e.g. flash → name scales in → ladder slides up), not a plain opacity fade, and `expo-haptics` fires a heavy impact on mount and on ack.
- [ ] **D6.4** Wire cold-start deep link + push-tap + WS-triggered navigation all to this same screen — 20 min — _done when:_ force-quitting the app, tapping a mock/local push notification, and re-opening lands directly on `/alert/[id]` with correct state (not a blank shell).

### D7. Timeline & event detail

🔁 PARALLEL-OK, depends on D3.2 (TanStack Query reads) or D1.1 fixtures alone.

- [ ] **D7.1** `/timeline` — reverse-chron day sections, amber ring on deviation rows; **no room-time bar and no room names for the family** (that bar moves to staff S3 — D-001) — 45 min — _done when:_ scrolling renders mocked `events[]` grouped by day with the `location/history` segments rendered as a proportional stacked bar per day.
- [ ] **D7.2** `/timeline/[eventId]` — event detail (what/when/sensor/confidence/evidence sentence, feedback verdict buttons) — 30 min — _done when:_ tapping a timeline row navigates here with the right event's mocked data and "This was expected" posts a feedback shape matching `/alerts/{id}/feedback` semantics (§10.5). **Never render an image or thumbnail here** — the PRD is explicit that no such endpoint exists; don't build a UI slot for one.

### D8. RAG chat

🔁 PARALLEL-OK, depends on D3.2 or D1.1.

- [ ] **D8.1** `/chat` — suggested chips ("Has she been out this week?", "How were her nights?", "Anything unusual this week?" — questions the band can answer, D-010), message list, citation chips that deep-link to `/timeline/[eventId]` — 40 min — _done when:_ sending a question calls `POST /chat` (mocked response with `answer`/`citations`/`counts`), citation chips render tappable and route correctly, and a `refused: true` mocked response renders a distinct "can't answer that" state instead of crashing.

### D9. Settings & escalation

🔁 PARALLEL-OK.

- [ ] **D9.1** `/settings` — contacts (reuse D4.5 component), quiet hours, per-alert-type toggles, consent review/revoke, export, delete (`DELETE /v1/residents/{id}` — this cascades everything, treat it as real, not a stub with a confirm-twice dialog) — 40 min — _done when:_ every listed control is present and wired to a (mocked) call; nothing is a dead button.
- [ ] **D9.2** 🔁 PARALLEL-OK "What Priya can see" screen mirroring the consent list — 15 min — _done when:_ it renders the same capability list as `/onboard/consent`.

### D10. Push notifications

⛔ D10.1/D10.2 block a real demo of D6; D1.3's dev build is a prerequisite for all of D10.

- [ ] **D10.1** ⛔ BLOCKER Register for push + persist token — 20 min — _done when:_ `Notifications.getExpoPushTokenAsync({projectId})` returns a real `ExponentPushToken[...]` on the physical dev-build device and it's POSTed to `/devices/push-token` (mocked ok for now).
      ```ts
      const token = (await Notifications.getExpoPushTokenAsync({ projectId: EXPO_PROJECT_ID })).data;
      ```
      **Skip iOS critical-alerts entirely.** `interruptionLevel: "critical"` needs Apple's
      `usernotifications.critical-alerts` entitlement, which is manually reviewed over days-to-weeks —
      not obtainable in this hackathon window. Do not file the entitlement request, do not build UI that
      assumes it. Ship `interruptionLevel: "timeSensitive"` + a loud custom sound + the full-screen
      in-app takeover from D6, and treat the actual phone call as the real escalation channel — that's
      the PRD's explicit fallback, not a compromise to revisit.
- [ ] **D10.2** Notification handler + category actions — 25 min — _done when:_ receiving a mocked "fall" push in foreground shows a banner per the handler logic below, and tapping it (or its `dhyaan_alert` category actions) opens `/alert/[id]` with the right id from `data.alert_id`.
      ```ts
      Notifications.setNotificationHandler({
        handleNotification: async (n) => ({
          shouldShowBanner: n.request.content.data?.kind !== 'ladder',
          shouldShowList: true,
          shouldPlaySound: n.request.content.data?.severity === 'critical',
          shouldSetBadge: true,
        }),
      });
      ```
      Cover all 4 payload kinds from §10.4: `alert` (fall, full takeover), `deviation` (quiet,
      next-morning, deep-links to timeline), `ladder` (silent, `_contentAvailable`, updates an
      already-open alert screen only — should NOT show a banner), `alert` severity `warn` (bathroom).
- [ ] **D10.3** 🔁 PARALLEL-OK Build a local "send test push" dev-only button that hits `exp.host/--/api/v2/push/send` directly with the FALL payload from §10.4 — 15 min — _done when:_ tapping it on the physical device makes the phone light up for real, end to end, without waiting on the backend team.

### D11. B2B staff dashboard variant

🔁 PARALLEL-OK after D2.3 (role switch) + D1.1 (fixtures need staff-shaped mock data too — add to D1.1 fixtures: multiple residents, triage reasons, floor/room grid).

- [ ] **D11.1** `/staff` (S1) Triage — ranked list (not a grid): name, room, one-line reason, signal age — 30 min — _done when:_ mocked residents render sorted by a `needScore` you compute client-side from `open_alerts`/`state`/staleness (backend may not sort this for you yet — check with backend once contract finalizes, but ship a client-side ranking so this isn't blocked).
- [ ] **D11.2** `/staff/floor` (S2) — room tiles by floor, color = state, RF-located resident per room — 30 min — _done when:_ mocked room/zone data renders a grid with correct color-coding per resident state.
- [ ] **D11.3** `/staff/resident/[id]` (S3) — today + 14-day ADL sparklines, baseline μ/σ, timeline, chat scoped to resident — 35 min — _done when:_ sparklines render off mocked `summary` history and the chat panel reuses D8.1's component with `resident_id` pinned.
- [ ] **D11.4** `/staff/alert/[id]` (S4) — reuse D6.1's phase component, add staff-only actions "Assign to me" / "Resolved — checked" / "False alarm" — 25 min — _done when:_ the alert takeover renders identically to the family version plus these three buttons, each calling `/alerts/{id}/resolve` with the right `resolution` value.
- [ ] **D11.5** `/staff/rounds` (S5) — dark-UI night mode, only residents with night deviations, sorted by severity — 25 min — _done when:_ a manual "simulate 23:00" dev toggle switches the whole screen to the filtered dark view against mocked data.

### D12. Real-device / LAN testing

⛔ BLOCKER-in-spirit — do this by hour 2-3, don't wait until "it's done."

- [ ] **D12.1** ⛔ Test the dev build on a real phone over the Mac's LAN early — 20 min — _done when:_ `npx expo start --dev-client` on the Mac, phone on the same Wi-Fi, connects via the Mac's LAN IP (`ipconfig getifaddr en0` or shown in the Expo CLI QR) and hot-reloads a code change live.
      "Works in the simulator" is not a demo — the simulator can't receive real push tokens meaningfully
      and can't show what a judge will actually watch (a physical phone lighting up). Do this pairing
      test in the first 2-3 hours, not the last one.
- [ ] **D12.2** ⛔ BLOCKER-for-demo-day Stand up `cloudflared` tunnel as the standing fallback, never rely on venue LAN alone — 15 min — _done when:_ `cloudflared tunnel --url http://localhost:8000` (or equivalent) gives a public URL the app can hit, and `EXPO_PUBLIC_API_BASE` / the WS URL can be pointed at it with one env change.
      Venue Wi-Fi with AP isolation is the PRD's named failure mode for LAN mode with 1000+ phones on
      2.4GHz. Do not discover this at hour 20.

### D13. Demo polish

🔁 PARALLEL-OK, last, time-permitting.

- [ ] **D13.1** Dark mode pass across all screens — 30 min — _done when:_ toggling system dark mode doesn't produce any unstyled/white-flash screen.
- [ ] **D13.2** Screen-record a full successful mock-driven run (SUSPECTED → ACKNOWLEDGED) as the demo backup video — 15 min — _done when:_ an `.mp4` exists showing the whole D6 phase sequence end to end, in case the live demo fails.

### D-checkpoints

| Hour | What must be working | One-command proof |
|---|---|---|
| 0:30 | Expo project boots; EAS dev build kicked off; mock-data flag exists | `npx expo start` renders `app/(family)/index.tsx` with `USE_MOCKS=true` fixture data |
| 2:00 | Dev build installed on a real phone over LAN; every route stubbed | Open the dev-client app on a physical iPhone on the venue/home Wi-Fi, navigate to `/timeline` and back with no crash |
| 6:00 | Onboarding flow completable end to end (mocked); Home screen renders live-looking status | Tap through `/onboard/welcome` → `/onboard/contacts` → land on `/` with populated status card, all against mocks |
| 12:00 | LIVE ALERT screen plays all 5 phases via the mock WS simulator; push token registered on device | Trigger `lib/mock/wsSimulator.ts`'s fall script and watch `/alert/[id]` progress SUSPECTED → ACKNOWLEDGED unaided |
| 18:00 | Real push delivers to the physical phone and opens the alert screen cold; chat + timeline screens render mocked data with citations | Fire D10.3's test-push button while the app is force-quit; app opens directly to `/alert/[id]` |
| 22:00 | Staff dashboard variant (S1-S5) renders against mocks; API client compiles against real backend contract with `USE_MOCKS=false` | Flip `USE_MOCKS=false`, point at the tunnel URL, confirm `/residents` list renders from the real API without code changes |
| 24:00 | Full demo run recorded as backup; dark mode + haptics polish done | Play the `.mp4` from D13.2 start to finish |

---

## Open spec questions in your lanes

- The Deepgram auth header and the Twilio `calls.create` binding are written as working code while self-flagged `[UNVERIFIED]`. B0 verifies both before any bridge code exists.
- Whether Deepgram halts TTS server-side on `UserStartedSpeaking` is unverified. Always sending `clear` is the right mitigation either way.
- `POST /alerts/{id}/resolve` takes `resolution: "fell_ok"` while the FSM state is `FELL_BUT_FINE`. Agree one string with Ayush at H1.
