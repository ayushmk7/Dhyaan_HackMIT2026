# HackMIT 2026 — 20 Ideas, Scouted and Attacked

Generated 2026-09-19 (hacking already underway; ends Sun 11am). Team: 4, generic full-stack + ML, optional Arduino UNO Q. Sponsor stack only: Maximor, Voloridge, Warp, OpenAI, The Token Company, ElevenLabs, Deepgram, Ramp, Meta, SpaceX AI (xAI).

## How this was made
- **Agent A (sponsor intel):** verified APIs against current docs; prize tracks taken from the official challenge doc.
- **Agent B (winner analysis):** patterns + BANNED list from TreeHacks/CalHacks/PennApps/HackPrinceton/MHacks/HackMIT 2023 galleries. HackMIT 2024/25 winner lists are not public.
- **Agent C (pain scouts):** 53 signals. **Reddit was blocked** in this environment, so evidence is GitHub issues (reaction counts), HN (points), trade forums, App Store reviews. Several forum pages 403'd; those are marked MEDIUM.
- **Agent D (newly possible):** dated launches per sponsor + hard blockers.
- **Critic:** attacked 40 candidates for duplicates, 24h feasibility, memorability, logo-stuffing, banned-list reframes. Kept 20 (two swapped in from the critic's own suggestions).
- Raw reports: `scratchpad/agentA_sponsors.md`, `agentB_winners.md`, `agentC_pain.md`, `agentD_new.md`, `candidates40.md`, `critic.md`.

## Facts that shaped everything
- **Maximor** $4k/2k/1k + top-5 fast-track; wants agents that *learn across runs* and escalate to humans. No public API — build on Ramp demo MCP data. Least crowded track with the most money.
- **Voloridge** $5k (1st only). Datasets: NOAA ISD, OpenAlex, GDELT, NYC TLC, OpenAQ, PUDL, Materials Project (`aws s3 sync --no-sign-request s3://voloridge-hack-mit-2026/src ./src`). Free GPU at booth.
- **SpaceXAI** requires Cursor + (Grok Imagine or Grok Voice) + real space data. Grok video is async, ~$1.20/15s → pre-render.
- **Meta** = Muse API (`api.meta.ai/v1`, OpenAI-compatible): Spark 1.3, Image 1.0, Voice Transcribe (diarization 20+ speakers, `wss://api.meta.ai/v1/asr/realtime`). Muse connectors need a public HTTPS MCP/OpenAPI endpoint + US account. Needs demo video + repo + write-up. Winners → Menlo Park.
- **ElevenLabs** phone numbers need Twilio/SIP (1–2h); web-widget call is the fallback. **Deepgram** just needs one API call; Flux `EagerEndOfTurn`, Flux Multilingual, Voice Agent `defer_until_eot` are the fresh bits.
- **Token Co**: `POST api.thetokencompany.com/v1/compress` (Bear-2, `aggressiveness`), `pip install the-token-company`; judged on savings *inside your product*.
- **OpenAI** credits only if you submit to their challenge; must show one concrete Codex contribution. **Ramp** Agent Cards are gated early access; demo MCP `demo-mcp.ramp.com/mcp` is zero-setup. **Warp** Oz API (`POST /agent/run`) is the only real hook; the Warp prize doesn't require Warp.

## BANNED (overdone) — do not build unless radically reframed
AI study buddy · blind-user vision assistant/smart cane · mental-health companion · expense/finance-literacy app · meeting summarizer · interview coach · recipe-from-fridge · general smart-glasses assistant · resume/networking tool · misinformation detector · language voice tutor · sign-language translator · clinical scribe · **eldercare/dementia companion (rising 2025–26)** · med-adherence scanner · webcam physio coach · social-sentiment trading · disaster dashboard · travel planner · CCTV threat detection. Full example links in `agentB_winners.md`.

---

# The 20

## Scoreboard
| # | Idea | Orig | Wow | Feas | Prize | Evid | Total |
|---|---|---|---|---|---|---|---|
| 1 | Recon Gym | 3 | 3 | 4 | 5 | 4 | 19 |
| 2 | Dunning Line | 3 | 4 | 3 | 4 | 3 | 17 |
| 3 | Exception Desk | 3 | 3 | 4 | 5 | 3 | 18 |
| 4 | Receipt Red Team | 4 | 4 | 3 | 4 | 2 | 17 |
| 5 | Token Diet | 3 | 3 | 4 | 4 | 5 | 19 |
| 6 | Pager Whisperer | 4 | 5 | 3 | 4 | 4 | 20 |
| 7 | Spray Log | 3 | 3 | 4 | 3 | 3 | 16 |
| 8 | Wrench Voice | 3 | 3 | 4 | 3 | 4 | 17 |
| 9 | Cold Chain Count | 2 | 3 | 3 | 4 | 2 | 14 |
| 10 | Rig Rider | 3 | 4 | 3 | 4 | 2 | 16 |
| 11 | Family Line | 3 | 4 | 4 | 4 | 5 | 20 |
| 12 | Sunday Dinner, Rendered | 3 | 4 | 4 | 3 | 2 | 16 |
| 13 | Overhead Tonight | 3 | 4 | 4 | 2 | 2 | 15 |
| 14 | Flight Director | 3 | 4 | 4 | 2 | 1 | 14 |
| 15 | Conjunction Caller | 3 | 3 | 3 | 2 | 3 | 14 |
| 16 | Apollo Radio Play | 5 | 5 | 3 | 4 | 2 | 19 |
| 17 | Grid Ghost | 3 | 3 | 4 | 3 | 2 | 15 |
| 18 | Orphan Materials | 4 | 3 | 3 | 3 | 1 | 14 |
| 19 | Smoke Signal | 3 | 3 | 4 | 3 | 2 | 15 |
| 20 | Hype Gap | 4 | 3 | 4 | 3 | 1 | 15 |

## Part 1 — Finance / Office of the CFO + LLM cost (ideas 1–5)

### 1. Recon Gym — a bank-reconciliation agent that trains against a messy-ledger generator and gets measurably better every run
1. **Sponsor stack**
   - **Maximor (track, load-bearing framing):** no API; the challenge *is* the product spec — multi-step tool use, learning from corrections, exception handling, measurable improvement, human review when uncertain.
   - **Ramp (load-bearing data):** demo MCP `https://demo-mcp.ramp.com/mcp` (`load_transactions`, `load_bills`, `execute_query`) is the "system of record" side of the match. Zero-setup realistic spend data. Ramp "approvals add-step" is unverified — do NOT depend on it; human review is your own queue UI.
   - **OpenAI (load-bearing brain):** `gpt-5.6-sol` with Programmatic Tool Calling (2026-07-09) for SQL/matching tools; Responses API Skills (2026-02-10) as the persistent "mistake journal" the agent reloads each run. Codex writes the synthetic-ledger generator and the eval harness → that's your Codex sentence.
   - **The Token Company (load-bearing for cost metric):** `POST https://api.thetokencompany.com/v1/compress` on statement text / bank memo blobs before each LLM call; dashboard shows tokens_saved and $/run alongside accuracy. If you drop it, the cost curve dies — so it's honest, not logo-stuffing.
2. **Who has the pain + evidence** — Bookkeepers whose matches silently fail: QuickBooks thread alive since 2017, 69 replies ("amounts are the same… they aren't matching") https://quickbooks.intuit.com/learn-support/en-us/banking/banking-not-matching-transactions/00/138845 ; matches break after bank reconnect https://quickbooks.intuit.com/learn-support/en-us/banking/bank-transactions-downloaded-not-matching-to-entered-information/00/1164248 ; ERPNext auto-matching issues open for years (15–21 comments each) https://github.com/frappe/erpnext/issues/5903. Strong, but it's all SMB, not Fortune-500 CFO — say so.
3. **Why now** — GPT-5.6 Programmatic Tool Calling + persisted reasoning (2026-07-09) and Skills-as-memory (2026-02-10) let the agent carry a learned playbook across runs without you writing a fine-tune; Ramp demo MCP (Sep 2025) gives real messy transactions in minutes; Bear-2 sign-in opened 2026-09-18.
4. **Closest existing thing** — Numeric / Ledge do reconciliation as products (https://www.numeric.io/blog/variance-reporting-guide); no Devpost near-dup found. Difference: self-play against a generator that injects *new* failure modes each round (off-by-fee, split deposits, FX drift, duplicate refs), and the on-screen learning curve.
5. **24h build plan** — h6: synthetic ledger generator (Codex-written) with 8 injected exception types + Ramp demo MCP pull; baseline agent matches with SQL tools, logs every miss. h12: eval harness scoring precision/recall per run; corrections UI (human fixes a miss → agent writes a rule to its Skills file). h18: 5+ runs recorded, curve chart, Token Co compression in the loop with $/run. h24: polish demo, freeze a "held-out" ledger the agent never saw. Fake: the ERP side (it's a CSV). Real: the improvement curve, the rules file diff, the held-out score.
6. **The demo moment** — Judge clicks "fix" on one miss; the rules file diff appears live; you re-run on the held-out ledger and the accuracy number ticks up in front of them.
7. **Special points** — *Prize stacking:* Maximor ($4k, top-5 fast-track), Ramp (save time/money), Token Co (in-product savings), OpenAI (Codex story). No general track. *Judge appeal:* Maximor judged "build process/session evidence" 25% at their own Sep hackathon — bring the run log; Ramp wants agentic finance ops; Token Co wants savings measured inside the product. *Unfair edge:* the adversarial generator means the curve is real and the demo never runs out of exceptions. *Biggest risk:* faking the learning. De-risk in first 3h: define the rule format + held-out set BEFORE writing the agent; if run 2 doesn't beat run 1 by hour 3, narrow to 3 exception types.
8. **Scores** — originality 3, demo wow 3, feasibility 4, prize-stacking 5, evidence 4.

### 2. Dunning Line — an AR agent that phones overdue customers and evolves its own collection scripts by promise-kept rate
1. **Sponsor stack**
   - **ElevenLabs (load-bearing):** ElevenAgents outbound call with server tools (`record_promise`, `offer_plan`), Experiments (A/B) per script, Eleven v3 tone tags for polite-but-firm. Telephony needs Twilio (no native numbers) — budget 1–2h, fallback = web-widget call.
   - **Maximor (track):** the self-improving loop: scripts mutate, promise-kept rate per script is the fitness; human review queue for disputes.
   - **OpenAI (load-bearing eval):** GPT-5.6 generates 20 simulated-debtor personas that answer the agent's calls (text-mode sim), scores outcomes, proposes script mutations. Codex builds the sim harness.
   - **Ramp:** critic says logo-stuffing — cut it. (Ramp is AP, not AR.)
2. **Who has the pain + evidence** — HN "chasing overdue invoices is manual, awkward, and nobody has a good system", 39 pts, 50+ comments, WhatsApp reminders done by hand https://news.ycombinator.com/item?id=47638685. Strong for SMB owners; no accountant-forum corroboration found.
3. **Why now** — ElevenAgents shipped Experiments (A/B), workflows, batch outbound calls and Twilio native integration (consolidation Mar 2026, changelog 2026-04-27); v3 Conversational ~280ms makes a live phone negotiation feel human.
4. **Closest existing thing** — Vodex https://www.vodex.ai/ and Peakflo voice AR https://peakflo.co/blog/ai-voice-agents-accounts-receivable-collection (fixed scripts). Difference: the script population evolves from simulated + real outcomes, and you show the leaderboard.
5. **24h build plan** — h6: one ElevenAgent with 3 hand-written scripts + tools writing to a promises table; sim-debtor harness in text mode. h12: 200 simulated calls, promise-kept rate per script, mutation step (LLM rewrites worst script from transcripts). h18: Twilio number live, real call to a teammate; dispute → human queue. h24: leaderboard UI, rehearse the judge call. Fake: the invoice ledger, the "payment received". Real: the live call, the script leaderboard, the mutation diff.
6. **The demo moment** — A judge's phone rings; the agent negotiates a pay date with them; the promise appears on screen with the script's running kept-rate.
7. **Special points** — *Prize stacking:* ElevenLabs (agentic depth, latency), Maximor (learning across runs), Deepgram NOT used (fine). *Judge appeal:* ElevenLabs wants agents that act + phone demos; Maximor wants measurable improvement. *Unfair edge:* simulated-debtor population lets you show 200 "runs" of learning in a day. *Biggest risk:* Twilio A2P verification stalls; de-risk: start Twilio signup at hour 0, keep widget-call fallback; if sims are all identical, force persona diversity (angry/broke/forgetful/disputing).
8. **Scores** — originality 3, demo wow 4, feasibility 3, prize-stacking 4, evidence 3.

### 3. Exception Desk — an AP agent that resolves invoice/payment exceptions on Ramp bills and turns every human decision into a reusable rule
1. **Sponsor stack**
   - **Maximor (track):** example #3 verbatim ("resolving invoice or payment exceptions"); nobody else in the field is likely to pick it.
   - **Ramp (load-bearing):** demo MCP `load_bills`, `load_vendors`, `load_transactions` + `execute_query`; exceptions are seeded on top (duplicate invoice, missing PO, amount mismatch, wrong vendor, stale bank details).
   - **OpenAI (load-bearing):** GPT-5.6 with tools; rules stored in a Skills file; uncertainty score gates auto-resolve vs queue. Codex generates the 30+ seeded exception cases and tests.
   - **Token Company (optional but cheap):** compress invoice OCR text + email threads before the LLM; report $/exception falling as rules take over (fewer LLM calls). Include — it makes the "cost improves" axis real.
2. **Who has the pain + evidence** — Same SMB reconciliation cluster as #1 (QuickBooks 69-reply thread, ERPNext issues) plus Maximor's own brief. No AP-specific forum signal was scouted — evidence is thinner than #1; flag it.
3. **Why now** — Ramp launched a procurement agent fleet 2026-04-29 (https://www.prnewswire.com/news-releases/ramp-launches-fleet-of-ai-agents-across-its-procurement-platform-302756657.html) — AP exceptions are their live battleground; demo MCP + GPT-5.6 tool calling make a credible agent a one-day build.
4. **Closest existing thing** — Ramp's own procurement agents and Stampli (industry). No Devpost near-dup. Difference: explicit rule-learning with an auto-resolve-rate curve and an uncertainty queue you can watch shrink.
5. **24h build plan** — h6: exception generator (Codex) over Ramp demo bills, 6 exception classes, 30 cases; agent classifies + proposes resolution with confidence. h12: review queue UI; human resolution → rule (`if vendor==X and delta<2% → approve`); rules reloaded next run. h18: 5 runs, auto-resolve rate chart, cost chart with Token Co. h24: held-out case set, polish. Fake: sending payments. Real: rule learning, auto-resolve curve, queue shrinking.
6. **The demo moment** — Run 1: 40% auto-resolved, 18 in queue. Judge resolves two. Run 2 replays: 70%, 6 in queue — and the two new rules are highlighted in the log.
7. **Special points** — *Prize stacking:* Maximor ($4k), Ramp, Token Co, OpenAI. *Judge appeal:* Maximor gets varied exception taxonomy (harder than matching); Ramp sees their AP data and agent narrative. *Unfair edge:* crisp taxonomy = more visible learning per round than recon. *Biggest risk:* believable exceptions; de-risk: write the 30 cases by hand in hour 1 with a teammate who has done AP, before any agent code. Build this OR #1, not both (same user).
8. **Scores** — originality 3, demo wow 3, feasibility 4, prize-stacking 5, evidence 3.

### 4. Receipt Red Team — self-play fraud detection: one agent forges receipts, another catches them, both write down what they learned
1. **Sponsor stack**
   - **OpenAI (load-bearing):** `gpt-image-2` generates forged receipts (edited totals, fake merchants, reused images); GPT-5.6 vision detector; both agents keep explicit rule files. Codex scaffolds the tournament loop.
   - **Maximor (track):** adversarial self-play is "learning from previous runs" in its purest, most visible form; human review on low-confidence.
   - **Ramp (optional, honest use only):** real receipts from demo MCP as the genuine class; nothing else. Drop the rest.
   - **Token Company:** not load-bearing; skip unless you compress OCR text and can show it.
2. **Who has the pain + evidence** — Ramp receipt matching is the real-world flow; the Maximor brief's "learning" criterion. External forum evidence: none scouted — this is a technique-driven idea. Say so.
3. **Why now** — `gpt-image-2` (2026-04-21, high-fidelity input edits, transparent bg 2026-08-20) makes plausible receipt forgeries cheap; GPT-5.6 vision + tools make a detector that writes its own checks feasible in hours.
4. **Closest existing thing** — Receipt Faker (generator only) https://devpost.com/software/receipt-faker. No adversarial-loop dup found. Difference: the loop, the explicit rules both sides read, and the precision/recall curve per round.
5. **24h build plan** — h6: 50 genuine receipts (Ramp demo + photos), generator prompt, 50 forgeries; baseline detector with OCR + LLM. h12: tournament loop — detector writes 3 new checks per round, generator reads them and adapts. h18: 6 rounds logged, P/R chart, human queue for <0.6 confidence. h24: live round in demo, gallery of "hardest forgeries". Fake: nothing needs faking. Real: the curve; enforce that improvement isn't trivial (generator must beat last round's checks).
6. **The demo moment** — Judge picks a real receipt; generator forges it on stage in ~15s; detector catches it and prints the rule that caught it.
7. **Special points** — *Prize stacking:* Maximor, OpenAI (image + vision + Codex), Ramp. *Judge appeal:* Maximor sees measurable improvement; OpenAI sees creative multi-model API use. *Unfair edge:* nobody else will show self-play on stage. *Biggest risk:* gpt-image-2 latency/cost mid-demo (pre-generate 30 forgeries; live-generate only one) and trivial "improvement" — de-risk by making rounds adversarial in hour 2 and plotting the curve early.
8. **Scores** — originality 4, demo wow 4, feasibility 3, prize-stacking 4, evidence 2.

### 5. Token Diet — an optimizer that hooks a coding agent, compresses its tool outputs, dedupes re-sent schemas, re-runs the same task and shows the $ delta
1. **Sponsor stack**
   - **The Token Company (load-bearing):** Bear-2 `POST /v1/compress` with `aggressiveness` sweep on tool outputs (file reads, grep, test logs) — the largest, lowest-signal tokens.
   - **OpenAI (load-bearing):** Codex CLI/SDK is the agent being optimized (hooks + session logs); GPT-5.6 explicit prompt caching keeps the compressed prefix cache-safe; `/responses/compact` (2025-12-11) for history. Codex story is trivially real: it's the subject.
   - **Warp:** dropped — logo-stuffing. Only add back if you ship it as a Warp Drive workflow devs actually run; otherwise skip.
2. **Who has the pain + evidence** — Strongest cluster in the whole scout: Codex "burned 20% of tokens in 2 hours" 308 reactions/630 comments https://github.com/openai/codex/issues/14593 ; per-token cost 10–20× 560 reactions https://github.com/openai/codex/issues/28879 ; Cursor "178,304 cache read tokens for a one-file change" https://forum.cursor.com/t/151439 ; system prompt + MCP schemas re-sent every turn https://github.com/anthropics/claude-code/issues/46526 ; lazy tool-result loading https://github.com/langchain-ai/langchain/issues/34130.
3. **Why now** — Bear-2 API opened to all 2026-09-18; Codex app hooks (2026-02-02) and open agent harness (2026-08-19) expose the loop; explicit prompt caching (2026-07-09) makes "compress then cache" a measurable combo.
4. **Closest existing thing** — Token Meter https://token-meter.dev/, TokenScope, tokenamun https://github.com/ctford/tokenamun, Janus proxy https://devpost.com/software/janus-u9e3cl. All profile or proxy; none re-run the same task and show an apples-to-apples cost/quality delta with compression in the loop. If you only ship a profiler, you lose.
5. **24h build plan** — h6: hook Codex session logs; per-turn breakdown (system, schemas, tool outputs, reasoning). h12: interceptor that compresses tool outputs via Bear-2 + dedupes unchanged schema blocks; fixed 5-task benchmark repo. h18: run benchmark with/without; table of tokens, $, pass rate; aggressiveness sweep chart. h24: live re-run of one task on stage. Fake: nothing. Real: the delta on identical tasks with pass/fail shown.
6. **The demo moment** — Same task runs side by side; right pane finishes with the same passing tests at 41% fewer tokens, dollar counter frozen next to it.
7. **Special points** — *Prize stacking:* Token Co ($500 + interview; this is precisely "savings in the product"), Warp Best Dev Tool (even without Warp), OpenAI. *Judge appeal:* Token Co wants creative in-product savings measured; Warp wants real DX. *Unfair edge:* the pass-rate column — everyone else shows token counts, you show quality held constant. *Biggest risk:* non-deterministic agent runs make the delta noisy; de-risk in first 3h by pinning model, temperature 0, and 5 fixed tasks; if Codex hooks fight you, wrap the OpenAI client instead.
8. **Scores** — originality 3, demo wow 3, feasibility 4, prize-stacking 4, evidence 5.
### 6. Pager Whisperer — when the pager fires at 3am, an agent investigates, then *phones you* with a hypothesis and executes "roll back" by voice.

1. **Sponsor stack**
   - **Warp (load-bearing, semi):** Oz API `POST /agent/run` with `skill_spec` + MCP config runs the investigation in a cloud sandbox against the seeded repo (recent merges via `git log`, runbook, logs); `POST .../followups` receives the engineer's voice decision ("roll back", "page the DB owner"). Oz is replaceable by a local Codex run — say so honestly if asked. Docs: https://docs.warp.dev/reference/api-and-sdk/
   - **ElevenLabs (load-bearing):** ElevenAgent makes the outbound call (Twilio integration), reads the hypothesis with v3 audio tags for urgency, and has server tools `get_findings`, `rollback(run_id)`, `snooze`. https://elevenlabs.io/docs/eleven-agents/overview
   - **OpenAI (load-bearing):** GPT-5.6 with programmatic tool calling drives the Oz agent's diagnosis (diff → hypothesis → confidence); Codex writes the seeded fault repo + tests (your Codex story).
   - Optional: Token Co bear-2 compresses log tails before the LLM (cost delta on screen for the Token Co track).
2. **Who has the pain + evidence** — on-call engineers: "not enough information in alert", "runbooks not up to date", "don't know if there were recently merged changes", must re-summarize for handoff (9 pts, 28 comments) https://news.ycombinator.com/item?id=36426851 ; 4–5 incidents/week, no time to fix root causes (68 pts, 56 comments) https://news.ycombinator.com/item?id=41610000 . STRONG and specific.
3. **Why now** — Oz API + SDKs with follow-ups/webhooks (2026-02-10) https://www.warp.dev/blog/oz-orchestration-platform-cloud-agents ; ElevenAgents Twilio native integration + server tools; GPT-5.6 programmatic tool calling (2026-07-09). A year ago the "investigate in a sandbox, then call a human" loop needed three bespoke systems.
4. **Closest existing thing** — Chronicle (Slack incident bot, no voice, no action) https://devpost.com/software/chronicle-8jkcfy ; Datadog Bits AI SRE (text investigations) https://www.datadoghq.com/blog/bits-ai-sre/ . Difference: the phone rings, the hypothesis is spoken, and the fix executes from a spoken word. Nobody phones you.
5. **24h build plan**
   - **H6:** Codex scaffolds a toy service + deploy script with a planted bug in commit 3 of 5; Oz run that reads git log/logs/runbook and writes findings JSON to a webhook. Twilio number bought + linked to an ElevenAgent (do this in hour 1; it is the gating item).
   - **H12:** Alert webhook → Oz run → findings → ElevenAgent outbound call reading the hypothesis; `rollback` tool calls Oz followup; service goes green.
   - **H18:** Confidence threshold: <0.7 the agent asks a clarifying question instead of proposing; second scripted incident (config, not code) to show it isn't hard-coded.
   - **H24:** Dashboard with timeline (alert → hypothesis → call → action → recovery time), demo video, WARP.md.
   - **Fake:** the "production" service is a local container; the pager is a button. **Real:** the Oz investigation, the phone call, the rollback that visibly fixes the health check.
6. **The demo moment** — a judge's phone rings on stage; a calm voice says "Checkout is 500ing since Priya's merge 12 minutes ago, config key `STRIPE_TIMEOUT` was dropped, 82% confident, want me to roll back?"; judge says "do it"; the red dashboard tile turns green in under 10 seconds.
7. **Special points**
   - **Prize stacking:** Warp Best Developer Tool (Keychrons), ElevenLabs (agentic depth + latency + tools), OpenAI (Codex built the fault repo), Token Co if you compress logs; no general track fit.
   - **Judge appeal:** Warp wants Oz-shaped orchestration demos; ElevenLabs judges reward agents that *act* by phone; OpenAI wants the Codex sentence in the pitch.
   - **Unfair edge:** a phone ringing in the expo hall is theatre nobody else has; the rollback is real.
   - **Biggest risk:** Twilio A2P verification or Oz auth/credits failing on the day. **De-risk in 3h:** buy the number and place one test call in hour 1; if Twilio stalls, use the ElevenLabs web-widget call (judge clicks "answer"); if Oz credits are dead, run the same agent via Codex CLI locally. Expo hall is loud: use a wired headset and pre-recorded fallback audio.
8. **Scores** — originality 4, demo wow 5, feasibility 3, prize-stacking 4, evidence 4.

### 7. Spray Log — a farmer speaks the spray record from the cab; the agent checks wind, temperature, and label limits, and refuses to log an illegal application.

1. **Sponsor stack**
   - **Deepgram (load-bearing):** Flux Multilingual (`flux-general-multi`, auto language switch, `/v2/listen`) transcribes English/Spanish crews with EagerEndOfTurn so parsing starts before the sentence ends; Voice Agent API with `defer_until_eot` on the `commit_record` function so nothing is written while the farmer is still talking; Flux TTS reads the record back. https://developers.deepgram.com/docs/flux/quickstart , https://developers.deepgram.com/changelog/2026/9/8
   - **Voloridge NOAA ISD (load-bearing for the record, not for "now"):** hourly station observations attach the *historical* wind/temp for the logged time to the compliance record (auditors want the station reading, not the farmer's guess). https://registry.opendata.aws/noaa-isd/ . For "should I spray now", use a forecast feed (NOAA/Open-Meteo); say this plainly.
   - **OpenAI (load-bearing):** GPT-5.6 structured extraction (field, product, rate, unit, nozzle) + label-rule check against a hand-encoded table of 5 products (max wind, min/max temp, REI, PHI).
2. **Who has the pain + evidence** — NewAgTalk: spray records kept in phone Notes, spreadsheets ("worked well until their computer died"), 3-ring binders; 5+ threads over a decade https://talk.newagtalk.com/forums/thread-view.asp?tid=985289&mid=8894548 (fetch 403'd; snippets only — MEDIUM). Label wind limits are legally binding in most US states; a record with station weather is the audit defense. Evidence is real but not loud; say so.
3. **Why now** — Flux Multilingual GA 2026-04-29 (code-switching in one stream) https://www.businesswire.com/news/home/20260429043418/en/ ; `defer_until_eot` + `FunctionCallCancelled` 2026-09-08. Voice spray logging existed; a voice agent that *won't* commit an out-of-label record mid-sentence did not.
4. **Closest existing thing** — VitiScribe voice capture https://vitiscribe.com/vineyard-spray-log-compliance-hub/ ; Farm Spray Pro https://farmspraypro.com/ . They transcribe; they do not gate on station weather + label limits or handle a Spanish crew mid-sentence.
5. **24h build plan**
   - **H6:** Deepgram node voice-agent starter running; JSON schema for a record; 5 product labels encoded.
   - **H12:** ISD fetch for one station (2024 sample via `fetch.py` from the Voloridge bucket) → lookup by lat/lon/hour; compliance check; readback.
   - **H18:** Spanish demo path; refusal flow ("label max 10 mph, KBOS shows 12 — log as *not applied* or override with reason?"); PDF export of the state-style record.
   - **H24:** Map of fields, history view, demo video.
   - **Fake:** the field polygons and the farm. **Real:** the live voice, the weather join, the refusal.
6. **The demo moment** — teammate says in Spanish "apliqué glifosato, campo siete, dos cuartos por acre, viento como diez"; the agent answers in English "Station shows 14 mph at 3pm — that exceeds the label's 10 mph. I did not log it. Override?" Judges hear the machine say no.
7. **Special points**
   - **Prize stacking:** Deepgram (Switches; it's a full voice agent), Voloridge (weak fit — a single-dataset join; only pitch it as secondary), Sustainability track (pesticide drift), OpenAI with a Codex story.
   - **Judge appeal:** Deepgram wants "something you'd actually use" with Flux features they just shipped; Sustainability judges get a real drift-prevention mechanism.
   - **Unfair edge:** the refusal. Every other voice logger says yes.
   - **Biggest risk:** ISD volume (~600 GB) tempts you into a data swamp; and the judge audience doesn't farm. **De-risk in 3h:** pull one station-year only; write the 5-label table by hand; record the Spanish clip on a phone in case the hall is too loud for live multilingual.
8. **Scores** — originality 3, demo wow 3, feasibility 4, prize-stacking 3, evidence 3.

### 8. Wrench Voice — the tech's Ramp card swipe at the parts counter triggers a 3-second voice ping ("which job?"), and the parts land on the right invoice before they're back in the truck.

1. **Sponsor stack**
   - **Ramp (load-bearing):** demo sandbox transactions (`demo-api.ramp.com` / demo MCP `load_transactions`) are the trigger; each new card transaction fires the ping; memo + receipt written back via the API. https://docs.ramp.com/llms-api.txt , https://github.com/ramp-public/ramp_mcp
   - **Deepgram (load-bearing):** Voice Agent API handles the ping call and the end-of-day close-out dictation (parts, labor hours, what was fixed); Flux EagerEndOfTurn keeps the ping under 3 s; Flux TTS reads the invoice total back. Truck-driver variant (BOL exceptions when Samsara image capture is down) is the same loop with a different schema.
   - **OpenAI (load-bearing):** GPT-5.6 turns dictation into invoice line items and matches the swipe to the open job by merchant, time, and job address.
2. **Who has the pain + evidence** — ServiceTitan Mobile 2.9/5 from 1.7K ratings: "spin for up to 5 min", "pages close without saving", "focusing on office and marketing… not the technician's job" https://apps.apple.com/us/app/servicetitan-mobile/id1037989976 (STRONG). Electricians: daily job logs "without making it a 3-hour daily task" https://forums.mikeholt.com/goto/post?id=1087491 (MEDIUM, 403). Truckers: "image capture is down, no way to send in paperwork" https://apps.apple.com/us/app/samsara-driver/id1106069401 (STRONG quotes, mixed sentiment).
3. **Why now** — Ramp demo MCP + sandbox (2025-09-22) gives realistic card data with zero setup https://ramp.com/blog/introducing-the-ramp-developer-community ; Flux EagerEndOfTurn (2025-10-02) makes a sub-3-second voice ping plausible.
4. **Closest existing thing** — VoiceInvoice https://alternativeto.net/software/voiceinvoice/about ; ServVox https://apps.apple.com/ca/app/servvox/id6746725503 . Both are "dictate an invoice". Nobody inverts the trigger: the *swipe* asks the question, so the record is captured at the moment of purchase, not at 9pm.
5. **24h build plan**
   - **H6:** Ramp sandbox creds + polling loop on transactions (webhooks if available, else 10-s poll); Deepgram voice-agent starter answering a browser call.
   - **H12:** Swipe → ping → "Miller furnace job" → memo + job link written to Ramp; open-job list UI.
   - **H18:** End-of-day close-out dictation → invoice draft with parts pulled from today's swipes; readback of total; PDF.
   - **H24:** Truck BOL-exception variant if time; demo video.
   - **Fake:** the swipe (create a transaction in the sandbox from a "POS" button). **Real:** the ping latency, the voice answer, the write-back visible in the Ramp sandbox UI.
6. **The demo moment** — teammate taps "swipe $84.12 Ferguson Plumbing" on a phone; within 3 seconds the judge's speaker asks "Which job is the Ferguson purchase for?"; teammate says "the Kowalski water heater"; the Ramp sandbox transaction memo updates on the projector.
7. **Special points**
   - **Prize stacking:** Ramp (exactly "save time and money", and they're recruiting), Deepgram (real voice agent), OpenAI Codex story. No general track.
   - **Judge appeal:** Ramp shipped procurement/agentic spend features in 2026 and wants agentic finance ops on their API; Deepgram wants a practical end-to-end agent.
   - **Unfair edge:** Ramp is genuinely load-bearing (rare in this list) and the demo is legible to anyone who has bought a part.
   - **Biggest risk:** sandbox transaction latency or no webhook makes the ping feel slow; and it's a modest idea — memorability 3. **De-risk in 3h:** confirm sandbox write access (memo/receipt endpoints) and measure poll-to-ping latency; if >5 s, drive the ping from your own POS event and reconcile to Ramp after.
8. **Scores** — originality 3, demo wow 3, feasibility 4, prize-stacking 3, evidence 4.

### 9. Cold Chain Count — count the walk-in by voice; a temp sensor in the cooler tells you which items sat through an excursion and what that cost.

1. **Sponsor stack**
   - **Deepgram (load-bearing):** Flux STT streams "six cases romaine, half case lemons" walking the cooler; Voice Agent API with `defer_until_eot` so a count isn't committed mid-phrase; agent learns kitchen slang ("a flat of eggs") via a corrections table injected as keyterms.
   - **Ramp (load-bearing):** demo-sandbox purchases = expected inventory; variance = purchased − counted − POS usage; loss priced from the actual card transaction.
   - **OpenAI (load-bearing):** GPT-5.6 parses counts to SKUs, computes food cost and the excursion-loss table.
   - **Arduino UNO Q (optional, Touch Grass track):** DS18B20/onboard temp logger in the cooler posts readings; excursions >41°F for >2h flag every item counted in that zone.
2. **Who has the pain + evidence** — ChefTalk: inventory count "2.5–3 hours… tedious as all hell but a necessary evil" https://www.cheftalk.com/threads/fallacy-of-food-cost-and-monthly-inventory.89189/ (MEDIUM, one thread). Cold-chain loss evidence was not scouted — thin; the excursion angle is a hunch, not a documented complaint.
3. **Why now** — Flux (2025-10-02) end-of-turn + `defer_until_eot` (2026-09-08) make hands-free counting reliable; UNO Q (Linux + MCU, on-site checkout) makes a sensor + local model trivial to stand up.
4. **Closest existing thing** — Crunchtime AI Voice Inventory Counts https://www.crunchtime.com/blog/introducing-crunchtimes-ai-powered-voice-inventory-counts-for-restaurant-teams ; Stockcount voice counting https://stockcount.io/features/voice-counting . Voice counting is shipped product. The only new piece is the sensor-excursion × count × purchase-price join. Marginal survivor.
5. **24h build plan**
   - **H6:** Deepgram starter counting into a table; SKU list of 30 items with Ramp sandbox purchases seeded.
   - **H12:** UNO Q reading temp every 30 s to a tiny HTTP endpoint (or fake with a slider if the board isn't up by H10 — hard cutoff).
   - **H18:** Variance + excursion-loss report; slang corrections persisted.
   - **H24:** Polish, video.
   - **Fake:** the walk-in (a mini fridge or a cardboard box with the board inside). **Real:** live voice count, real sensor reading, real Ramp purchase data.
6. **The demo moment** — judge drops the sensor into a cup of warm water; 20 seconds later the count sheet turns three rows red: "dairy shelf, 2h14m above 41°F — $212 at risk (Ramp: Sysco 9/17)."
7. **Special points**
   - **Prize stacking:** Deepgram, Ramp (save money), Arduino Touch Grass (2 awards), OpenAI Codex story. Sustainability track is a stretch (food waste).
   - **Judge appeal:** Arduino judges want sensor data turned into a decision, not a chart; Ramp likes real dollar savings; Deepgram likes a practical agent.
   - **Unfair edge:** the only voice-inventory demo with a physical object judges can touch (pattern #1 from past winners).
   - **Biggest risk:** hardware bring-up eats the day; Crunchtime already ships the core. **De-risk in 3h:** one person only on UNO Q with a 3-hour timebox; if no reading by then, ship a software-only build and drop the Arduino track.
8. **Scores** — originality 2, demo wow 3, feasibility 3, prize-stacking 4, evidence 2.

### 10. Rig Rider — the ambulance calls the ED itself: a medic narrates hands-on, the agent builds a timestamped intervention timeline, and five minutes out it voices the SBAR handoff to the charge nurse and answers her questions.

1. **Sponsor stack**
   - **Deepgram (load-bearing):** Flux STT with timestamps on the medic's running narration ("18 gauge left AC… 4 of Zofran… BP 92 over 60"); Voice Agent API with `defer_until_eot` for the `place_handoff_call` tool; Nova-3 medical vocabulary via keyterms. https://developers.deepgram.com/docs/voice-agent
   - **ElevenLabs (load-bearing):** ElevenAgent makes the outbound call to the ED line (Twilio), speaks the SBAR with v3 emphasis, and answers the nurse's follow-ups from the timeline via a `query_timeline` server tool. Two voice vendors are justified: Deepgram listens in the rig, ElevenLabs talks to the hospital. If a judge asks, say that.
   - **OpenAI (load-bearing):** GPT-5.6 converts narration to a NEMSIS-like timeline and the SBAR; uncertainty (unclear dose) is flagged "medic to confirm", not guessed.
2. **Who has the pain + evidence** — EMTLife: "paper PCRs are faster than ePCRs", ePCR performance complaints https://emtlife.com/threads/update-your-opinion-of-epcr-please.32921/ (MEDIUM). Handoff-quality evidence was not scouted — say so. Scribe category is BANNED (NurseNotes, WingNote, Cortex); this survives only because the *channel* is new: the rig phones ahead and holds a conversation.
3. **Why now** — Deepgram `defer_until_eot` / `FunctionCallCancelled` (2026-09-08) so a call never fires mid-sentence; ElevenAgents server tools + Twilio native integration; Scribe/Nova medical vocab. The pre-arrival call has always been a human's job; a machine that can be interrogated by the nurse is new.
4. **Closest existing thing** — AI ePCR narratives https://www.ems1.com/ems-products/ePCR-Electronic-Patient-Care-Reporting/ai-powered-narratives-return-hours-to-understaffed-crews ; EMS SOAP https://www.emssoap.com/ . Both write the report afterward. Nothing calls the ED and takes questions.
5. **24h build plan**
   - **H6:** Deepgram streaming with word timestamps → timeline JSON; Twilio number + ElevenAgent placing one test call (hour 1 — gating).
   - **H12:** SBAR generation; `query_timeline` tool; the call reads SBAR and answers "when was the last BP?".
   - **H18:** Uncertainty flags; second scenario (pediatric) to prove it isn't scripted; ED-side screen showing the timeline arriving.
   - **H24:** Polish, healthcare-track write-up on accuracy limits, video.
   - **Fake:** the ambulance (a chair and a teammate reading a realistic scenario), the ED line (a judge's phone). **Real:** live transcription, real timeline, real call, real Q&A from the data.
6. **The demo moment** — the judge's phone rings: "This is Medic 12, five minutes out. 54-year-old male, chest pain onset 40 minutes, 324 aspirin at 14:02, BP 92/60 at 14:09." Judge asks "any nitro?"; the agent answers "No — held for hypotension at 14:09." from the timeline.
7. **Special points**
   - **Prize stacking:** Healthcare general track, Deepgram (Switches), ElevenLabs (agentic depth: outbound call + tools + Q&A), OpenAI Codex story.
   - **Judge appeal:** ElevenLabs wants agents that act by phone with real logic; Deepgram wants the new EOT features used; Healthcare judges want a named user (medic, charge nurse) and visible uncertainty handling.
   - **Unfair edge:** an interrogable phone call beats every scribe on the floor; pattern #7 (agents that DO the thing) from past winners.
   - **Biggest risk:** judges attack accuracy/liability, and expo-hall noise wrecks live medical STT. **De-risk in 3h:** record two clean scenario tracks on a phone as the primary demo input (live mic as bonus); build the "medic to confirm" flag before anything else; get Twilio working or fall back to the ElevenLabs web widget on the "ED" laptop.
8. **Scores** — originality 3, demo wow 4, feasibility 3, prize-stacking 4, evidence 2.
### 11. Family Line — a phone receptionist for the parent with dementia who calls 25 times a day: it answers, triages, bridges the caregiver only when something is new, and posts a digest to the family group.
1. **Sponsor stack** — **ElevenLabs (load-bearing):** ElevenAgents inbound agent on a Twilio number (https://elevenlabs.io/docs/eleven-agents/phone-numbers/twilio-integration/native-integration); server tools `classify_call(topic, novelty, urgency)`, `bridge_to_caregiver` (Twilio call transfer), `log_call`. v3 Conversational for ~280 ms replies. **Meta (load-bearing for the Meta track):** `muse-spark-1.3` writes the evening digest ("Dad called 9×: 7 about the car keys, 1 new: knee pain") and posts it to a private Facebook group via Graph API with test users. **OpenAI (optional):** Codex to build; drop it if credits are tight. Muse connectors: do NOT depend on them (public HTTPS, US account, no docs).
2. **Who has the pain + evidence** — Adult daughter: "he will get fixated on one thing and call me over and over... I'm in a meeting, driving" (11 replies) https://alzconnected.org/discussion/75539/incessant-calling. Four separate Alzheimer's Society threads incl. "my mother calls me 20–25 times a day" https://forum.alzheimers.org.uk/threads/any-tips-for-long-distance-phone-calls-to-someone-with-alzheimers.93069/. STRONG, repeated over years.
3. **Why now** — ElevenAgents added Twilio/SIP telephony, server tools, and Scribe v2 Realtime in Agents (2025-11-12) so a phone agent can call tools mid-conversation; Muse Spark 1.3 (2026-09-02) on `api.meta.ai/v1` is OpenAI-compatible, so the digest is one call.
4. **Closest existing thing** — KindredMind answers in a *cloned caregiver voice* as a companion https://kindredmind.care/ai-companion-for-dementia; teleCalm blocks repeat dials https://www.telecalmprotects.com/repeat-dialing-feature-for-dementia-stops-compulsive-repeat-phone-calls/. Different: Family Line never impersonates, never companions, and never blocks. It is a receptionist: known topic → warm, honest, family-approved answer and a logged call; novel or urgent content → live bridge to a human within seconds. On-screen metric: interruptions avoided vs escalations. Be blunt with judges: the dementia-companion category is on the overdone list; this survives only if you say out loud what you refuse to do.
5. **24h build plan** — H6: Twilio number + ElevenAgent answering; persona from a "family fact sheet"; `log_call` to SQLite. H12: novelty/urgency classifier tool; live transfer working on a real phone. H18: Muse Spark digest → Graph API post to a test group; dashboard with the two counters. H24: rehearse the call twice, record a backup video. Fake: the family fact sheet (seed it). Real: the inbound call, the classifier, the bridge, the digest post.
6. **The demo moment** — Judge phones the number as "Dad" asking about the car keys for the third time; the agent answers calmly and the "interruptions avoided" counter ticks. Judge then says "I fell in the kitchen" and the teammate's phone rings mid-sentence with the bridge.
7. **Special points** — *Prize stacking:* ElevenLabs (agentic depth, latency, novelty), Meta (connection; needs video + repo + write-up, top 3 to Menlo Park), Healthcare track. *Judge appeal:* ElevenLabs rewards agents that act and hand off (Junction, Dealwise pattern); Meta wants AI essential to connection: the digest literally reconnects a scattered family. *Unfair edge:* the ethics stance is the pitch; nobody else will demo "what the agent refuses to do." *Biggest risk:* Twilio A2P/verification stalls, or judges hear "robot lies to grandpa." De-risk in 3 h: sign up Twilio first thing and keep the ElevenLabs web-widget call as fallback; write the "never impersonates, always bridges when uncertain" rules into the system prompt and the slide.
8. **Scores 1–5** — originality 3, demo wow 4, feasibility 4, prize-stacking 4, evidence 5.

### 12. Sunday Dinner, Rendered — the weekly family call becomes two illustrated stories by Monday morning: a comic for the kids, a picture-book for the grandparents, posted to the family group.
1. **Sponsor stack** — **Meta (load-bearing, three APIs):** `muse-voice-transcribe-1.0` realtime WebSocket `wss://api.meta.ai/v1/asr/realtime` in DIARIZATION mode captures the live 4-speaker call; `muse-spark-1.3` turns the diarized transcript into a story of the week with speaker-attributed moments and an image plan; `muse-image-1.0` `/v1/images/generations` and `/v1/images/edits` render panels in two styles from the same beats; Graph API posts both to a private test group. **ElevenLabs (optional, for "voice+video"):** Eleven v3 with audio tags narrates the picture-book as an audio version for grandparents who prefer listening. **OpenAI:** none needed; do not stuff it.
2. **Who has the pain + evidence** — Expats "shuffled to the back of the deck" by family and friends back home; time zones "always daunting" https://italicus.substack.com/p/out-of-sight-out-of-mind/comments. WEAK: blog comments, not forum threads. Long-distance carers: "no two days can be the same" over 300 miles https://forum.alzheimers.org.uk/threads/any-tips-for-long-distance-phone-calls-to-someone-with-alzheimers.93069/ (indirect). Say so on the slide; the emotional demo carries this one.
3. **Why now** — Muse Voice Transcribe 1.0 shipped 2026-09-03 with 20+ speaker diarization at $0.18/hr https://developer.meta.com/ai/resources/blog/meet-muse-voice-transcribe-streaming-speech-to-text/; Muse Image API launched 2026-07-07; Spark 1.3 on 2026-09-02. All three under the $50 credit.
4. **Closest existing thing** — Storii https://www.storii.com/ and Remento record prompted stories into a book; Multi-Tales makes children's books from prompts https://devpost.com/software/children-book. Different: no prompts, no extra work. The source is the call the family already has, the output is attributed to who said what, and the same week renders two ways for two generations.
5. **24h build plan** — H6: WebSocket client streaming a pre-recorded 4-person call (record it yourselves at H1) into diarized transcript with names mapped. H12: Spark prompt → JSON beats (who, what, quote, image prompt); Muse Image rendering 6 panels per style. H18: comic and picture-book layouts as HTML→PDF; Graph API post to test group; v3 narration. H24: 2–3 min video for Meta submission, write-up, repo. Fake: nothing on the pipeline; the call is pre-recorded. Real: diarization, story, images, post.
6. **The demo moment** — Split screen: grandma's line "I finally beat your father at Scrabble" lights up in the transcript, and eight seconds later it is panel 3 of the comic in her granddaughter's feed, with her name on the speech bubble.
7. **Special points** — *Prize stacking:* Meta (cleanest fit in the list; submission needs video + repo + write-up), Interactive Media track, ElevenLabs only if narration is real. *Judge appeal:* Meta's brief literally says "organize scattered family updates into a shared story"; using three Muse APIs the week they launched is what a Menlo Park round-2 invite looks for. *Unfair edge:* diarization is the moat; most teams will paste a transcript. *Biggest risk:* diarization confuses two similar voices and the comic misattributes a line. De-risk in 3 h: record the demo call with four clearly distinct voices, test DIARIZATION mode on it before writing any UI, keep a manual speaker-name override.
8. **Scores 1–5** — originality 3, demo wow 4, feasibility 4, prize-stacking 3, evidence 2.

### 13. Overhead Tonight — photograph your backyard, ask "when can I see the ISS?", and get a go/no-go plus a 10-second Grok Imagine video of the actual pass over your own skyline.
1. **Sponsor stack** — **xAI (load-bearing, required by the challenge):** Grok Voice agent over `wss://api.x.ai/v1/realtime` (`grok-voice-think-fast-2.0`, $0.08/min) with function tools `next_passes(lat, lon)`, `cloud_forecast`, `render_pass`; Grok Imagine `/v1/images/edits` composites the pass arc onto the backyard photo, then `/v1/videos/generations` image-to-video (async, ~$1.20 per 15 s) animates it. **Real space data:** CelesTrak GP/TLE (no login) https://celestrak.org/NORAD/elements/ + `sgp4`/`skyfield`; NASA DONKI for aurora mode https://api.nasa.gov. **Forecast:** Open-Meteo cloud cover (not a sponsor). **Voloridge:** only if you also show "how often is it clear here in September" from NOAA ISD history; otherwise leave it out, it is logo-stuffing. **Cursor:** mandatory for eligibility; keep the chat history as proof.
2. **Who has the pain + evidence** — TLE quirks make satellite data "a particularly hazardous data type" for outsiders https://arxiv.org/abs/2212.08662 (STRONG but about researchers, not backyard viewers). Space-Track is a single point of failure for tracking sites https://satellitemap.space/space-track-status (WEAK). Consumer pain is thin; this is a delight play, not a pain play. Say so.
3. **Why now** — Grok Imagine API (2026-01-28) added image-to-video with native audio and reference images; Video 1.5 (2026-05-31) https://x.ai/news/grok-imagine-video-1-5; Grok Voice Agent API (2025-12-17) with tools https://x.ai/news/grok-voice-agent-api.
4. **Closest existing thing** — NASA Spot the Station (passes + AR) https://www.nasa.gov/spot-the-station/; ISS-Tracker on Devpost https://devpost.com/software/iss_tracker. Different: it answers "will I actually see it" (clouds, elevation, sun angle) by voice and shows the pass over *your* photo, not a generic globe.
5. **24h build plan** — H6: SGP4 pass computation from CelesTrak for Cambridge; Open-Meteo cloud cover; text answer working. H12: Grok Voice agent with the three tools, browser client via ephemeral token. H18: Imagine edit + video for three pre-shot backyard photos, pre-rendered. H24: aurora mode (DONKI Kp) as a second event type; rehearse. Fake: the video is pre-rendered for the demo photo (generation takes minutes). Real: passes, forecast, voice tools, one live image edit.
6. **The demo moment** — Judge asks the agent by voice; it says "9:41 pm, west to northeast, 64 degrees, 30 % cloud, go," and the judge's own photo of the Stata Center, taken 20 minutes earlier, plays with a streak crossing it.
7. **Special points** — *Prize stacking:* SpaceXAI (top 4), Education track weakly. *Judge appeal:* uses Voice AND Imagine on real orbital data; Cursor-built. *Unfair edge:* the personalized skyline; every other space entry will show a globe. *Biggest risk:* Imagine video latency or cost blows the demo, or xAI credits are not provided (unverified). De-risk in 3 h: confirm API billing at the Cursor booth, generate the first video before touching the UI, and keep the still composite as the fallback.
8. **Scores 1–5** — originality 3, demo wow 4, feasibility 4, prize-stacking 2, evidence 2.

### 14. Flight Director — a voice flight director that narrates the next real launch off the live timeline, pulls crowd reaction from X, and renders only the phases no camera ever sees.
1. **Sponsor stack** — **xAI (load-bearing):** Grok Voice agent (`grok-voice-think-fast-2.0`) with built-in `x_search` for live public reaction and function tools over the launch timeline; Grok Imagine `/v1/videos/generations` for fairing separation, orbital insertion, and other phases with no public footage (pre-rendered). **Real space data:** Launch Library 2 https://ll.thespacedevs.com/2.2.0/ (upcoming launches, NET, pads, mission details); NASA APIs for context. **ElevenLabs (optional):** Eleven Music bed; paid-tier only, drop if blocked. **Cursor:** mandatory.
2. **Who has the pain + evidence** — Challenge text: "a literature no human can read all of." No forum pain scouted for launch viewers; this is an Interactive Media/Education delight play. Thin evidence; do not pretend otherwise.
3. **Why now** — Grok Voice Agent API with X search (2025-12-17) https://x.ai/news/grok-voice-agent-api; Imagine video with native audio (2026-01-28) https://x.ai/news/grok-imagine-api; grok-4.6 500k ctx for stuffing whole mission press kits.
4. **Closest existing thing** — No Devpost near-duplicate found (rocket sims are physics toys). Everyday Astronaut / NASASpaceflight streams are human-hosted. Different: it is interactive, per-launch, and answers "what just happened" by voice with what the crowd is saying right now.
5. **24h build plan** — H6: Launch Library 2 poll → timeline JSON for the next launch and one past one; Grok text agent answering questions. H12: Voice agent with `timeline_at(t)` and `x_search`; countdown clock UI. H18: three Imagine clips for unseen phases; replay mode for a past launch (if nothing launches in the judging window this is what you demo). H24: rehearse both modes. Fake: the "live" clock in replay mode. Real: LL2 data, voice, x_search, clips.
6. **The demo moment** — Judge asks "why did the count hold?" and the agent answers from the LL2 status field, then adds "and 4,000 people on X are posting the weather radar" in the same breath.
7. **Special points** — *Prize stacking:* SpaceXAI, Interactive Media or Education track. *Judge appeal:* x_search is Grok's differentiator and almost nobody uses it in a voice agent. *Unfair edge:* a live event during judging if the calendar cooperates (check LL2 now for Sunday 12–5 pm ET). *Biggest risk:* no launch in window and the replay feels like a montage. De-risk in 3 h: check the manifest, pick the past launch with the richest LL2 updates, and confirm x_search returns results for it before building UI.
8. **Scores 1–5** — originality 3, demo wow 4, feasibility 4, prize-stacking 2, evidence 1.

### 15. Conjunction Caller — when a close approach appears for your satellite, an agent phones you, explains it in plain words, records your go/no-go, and learns the threshold you actually act on.
1. **Sponsor stack** — **xAI (load-bearing):** Grok Voice agent with outbound call via LiveKit/Twilio SIP (Grok voice supports telephony codecs) or, simpler, the web client; tools `get_conjunction(id)`, `explain_risk`, `record_decision`, `x_search` for operator chatter on the same object; grok-4.6 for the plain-language brief. **Real space data:** CelesTrak SOCRATES conjunction reports https://celestrak.org/SOCRATES/ + GP/TLE; do not write your own screening. **OpenAI (optional):** Codex to build; not load-bearing. **Cursor:** mandatory.
2. **Who has the pain + evidence** — TLE data is hazardous for non-specialists and maneuver ground truth is "often poor quality" https://arxiv.org/abs/2212.08662 (STRONG, researchers). Space-Track outages break every downstream tool https://satellitemap.space/space-track-status (WEAK). No cubesat-operator forum signal was captured; the audience is tiny and judges may not feel it.
3. **Why now** — Grok Voice Agent API (2025-12-17) with function calling and telephony codecs in Grok TTS (~2026-04-18) https://x.ai/news/grok-stt-and-tts-apis; grok-4.6 context (2026-08-12) fits weeks of CDM history for threshold learning.
4. **Closest existing thing** — Detour already ingests TLEs, runs SGP4, and emits CDM-style events https://devpost.com/software/detour-64kpds. Different: the human loop. The screening is CelesTrak's; the product is the call, the explanation, and a learned per-operator threshold (after five decisions it stops calling for the ones you always wave off).
5. **24h build plan** — H6: SOCRATES parser, pick one university cubesat, event feed. H12: Grok Voice agent with tools; decision log; threshold model as a simple rule learned from logged decisions. H18: outbound call path (Twilio SIP) or web-call fallback; dashboard of calls avoided vs made. H24: replay of a week of events showing calls dropping as thresholds learn. Fake: the week-long history (seed from real SOCRATES archives). Real: live SOCRATES data, voice call, decision logging.
6. **The demo moment** — A judge's phone rings: "Conjunction in 41 hours, 180 meters, probability 1 in 8,000, above your 1-in-10,000 line. Maneuver or accept?" They say "accept," and the log shows the next similar event silently filed instead of called.
7. **Special points** — *Prize stacking:* SpaceXAI only; general tracks are a stretch. *Judge appeal:* voice + real orbital data + learning, the three things the brief names. *Unfair edge:* an actual phone call in the demo hall. *Biggest risk:* small audience and Twilio/SIP setup; the value is invisible if the call fails. De-risk in 3 h: prove SOCRATES parsing and a web-based Grok voice call first; add the phone only after.
8. **Scores 1–5** — originality 3, demo wow 3, feasibility 3, prize-stacking 2, evidence 3.
### 16. Apollo Radio Play — You are CAPCOM: play the Apollo 11 descent live by voice against a Grok-voiced crew constrained by the real transcript, and get scored on how far you drift from history.

1. **Sponsor stack**
   - **xAI (load-bearing, mandatory for SpaceXAI):** `grok-voice-think-fast-2.0` via the Realtime-compatible WebSocket (`wss://api.x.ai/v1/realtime`) plays Armstrong/Aldrin/Flight; the transcript window (±90 s of mission-elapsed time) is injected as ground truth; a tool `score_divergence(mission_time, said)` is called every turn. `grok-imagine-video-1.5` pre-renders 3–4 clips of phases with no public footage (LM cabin during 1202 alarm, "contact light") — async, ~$1.20/15 s, generate before the demo.
   - **ElevenLabs (load-bearing for the loop feel):** Eleven v3 with audio tags for the Quindar-tone-era CAPCOM/Flight readbacks and `[static]`, `[tense]` inflection; Sound Effects API for Quindar beeps, LM alarm tone, comm static; Eleven Music for the 30-s intro bed (paid tier — fall back to SFX-only if not unlocked).
   - **Cursor:** mandatory; log Grok Bot/Cursor planning trail for bonus points.
   - Optional: OpenAI — none needed. Do not stuff.
2. **Who has the pain + evidence** — Thin. This is an Interactive Media track play, not a pain-solver. Evidence that the format works: Apollo in Real Time is a beloved but passive replay (https://apolloinrealtime.org/11/); KSP's Mission Control mod with a voice CAPCOM has a fan base (https://spacedock.info/mod/4378/KSP%20Mission%20Control). Winning pattern from Agent B: play/multiplayer energy (kinemo, PennApps XXVI 1st) beats productivity for judge attention.
3. **Why now** — Grok Voice Agent API (2025-12-17) gives sub-second speech-to-speech with tool calls, so the crew can "answer" in character and the scorer can run mid-conversation (https://x.ai/news/grok-voice-agent-api). Grok Imagine API (2026-01-28) adds video with native audio (https://x.ai/news/grok-imagine-api). Eleven v3 GA (2026-03-14) added audio tags for emotion (https://elevenlabs.io/blog/eleven-v3).
4. **Closest existing thing** — Apollo in Real Time: you listen; here you speak, the crew reacts, and the game scores you ("you called GO for 1202 nine seconds late; Bales did it in three"). No Devpost near-duplicate found.
5. **24h build plan** — h6: parse the NASA JSC Apollo 11 air-to-ground transcript (public PDF/Apollo Flight Journal text) into (MET, speaker, line) rows for 102:38–102:46 (1201/1202 alarms through touchdown); Grok Voice hello-world with a crew persona. h12: transcript-window injection + `score_divergence` tool; Quindar/alarm SFX; CAPCOM voice via v3. h18: pre-render Imagine clips; scoring HUD (timeline with your calls vs history); one-button "restart segment". h24: rehearse 6-minute segment three times, record a backup video. **Fake:** the Imagine clips are pre-rendered; the intro music bed is pre-rendered. **Real:** live voice round-trip with Grok, live scoring, live SFX triggers.
6. **The demo moment** — Judge puts on headset, 1202 alarm blares, the crew voice says "Program alarm… it's a 1202," and the judge has 4 seconds to say "We're GO on that alarm." The HUD flashes "+3.1 s vs Steve Bales."
7. **Special points** — *Prize stacking:* SpaceXAI (top 4; Cursor + Imagine + Voice + real NASA transcript = exact fit), ElevenLabs (agentic dialogue, latency, emotion, voice+video), Interactive Media track. Not OpenAI (no Codex story). *Judge appeal:* xAI wants Voice + Imagine on real space data — this uses both and the data is literally Apollo; ElevenLabs judges get emotional inflection + SFX + multimodal in one loop. *Unfair edge:* the historical transcript is a free, perfect eval set — every other voice demo has no "correct answer." *Biggest risk:* Grok drifting out of character or answering with lines from later in the transcript. De-risk in first 3 h: build the scorer and windowing before any audio; test with text-only Grok; hard-code a fallback line per MET row if the model stalls. Second risk: live audio in a loud expo hall — use a wired headset with a directional mic.
8. **Scores** — originality 5, demo wow 5, feasibility 3, prize-stacking 4, evidence 2.

### 17. Grid Ghost — Find the hours and plants where reported US grid output contradicts the weather that was actually measured next door.

1. **Sponsor stack**
   - **Voloridge (load-bearing):** PUDL (`registry.opendata.aws/catalyst-cooperative-pudl`) for EIA-930 hourly BA generation by fuel (solar/wind) and EIA-923 monthly plant-level net generation; NOAA ISD hourly station weather (`registry.opendata.aws/noaa-isd`). Use the booth GPU/CPU box and `fetch.py` from `s3://voloridge-hack-mit-2026/src`.
   - **OpenAI (load-bearing for the demo, not the analysis):** GPT-5.6 agent with programmatic tool calling explains each ranked anomaly ("solar output in CISO at 14:00 was 2.1σ above cloud-adjusted expectation; 3 stations reported overcast") and drafts a data-quality ticket. Codex builds the join pipeline — say that sentence.
   - **Token Company (optional, cheap win):** compress the station-hour context fed to the explainer; show tokens saved per anomaly. Dropped: Warp (was logo-stuffing).
2. **Who has the pain + evidence** — Grid/energy analysts and regulators chasing misreported or stale EIA data; the Voloridge brief itself ("figure out what matters"). Direct forum evidence: none scouted — flag as thin. Analog evidence that judges reward cross-dataset joins: TerraLink (https://devpost.com/software/terralink-h5vuel), DriveWise (https://devpost.com/software/drivewise-g09s5y).
3. **Why now** — Nothing model-new; what's new is Voloridge handing both datasets pre-staged on AWS with a GPU box, and PUDL's EIA-930 hourly tables being clean parquet (https://docs.catalyst.coop/pudl/en/latest/data_sources/eia930.html).
4. **Closest existing thing** — Energy Dashboard and Anomaly Detection (https://devpost.com/software/nwl-hackathon) is single-source. Grid Ghost's residual is weather-conditioned across two independent sources, which is what makes an anomaly a *contradiction* rather than a spike.
5. **24h build plan** — h6: pull EIA-930 hourly for 3 BAs (CISO, ERCO, MISO), 2023–2024 (a few MB); ISD for ~15 stations inside those BAs, same years (ISD is ~600 GB total — pull by station ID only, tens of MB). h12: features (cloud cover, wind speed, solar zenith) → gradient-boosted expected solar/wind per BA-hour; residual z-scores; plant-month version with EIA-923 capacity factor vs monthly cloud-hours. h18: ranked anomaly table + map + agent explainer; Token Co counter. h24: polish, pick 3 anomalies with a story, backup slides. **Fake:** nothing needs faking. **Real:** the join, the model, the ranking. Do not claim "misreporting" — say "contradiction candidates."
6. **The demo moment** — Judge clicks a red hour on the map; the panel shows overcast readings at three stations next to a solar output line that didn't dip, and the agent says which is more likely wrong and why.
7. **Special points** — *Prize stacking:* Voloridge ($5k, 1st only), Sustainability track, OpenAI (Codex story), Token Co (minor). *Judge appeal:* Voloridge is a quant fund — show out-of-sample residuals, a null model, and honest granularity; that rigor is the pitch. *Unfair edge:* most teams will pick one CSV; two large independent sources with a physical prior is the "originality + technical excellence" combo they list. *Biggest risk:* BA↔station geo-join is fuzzy and ISD is huge. De-risk in first 3 h: hand-pick station IDs per BA, confirm `fetch.py` pulls by station, and get one BA's hourly plot working before any model.
8. **Scores** — originality 3, demo wow 3, feasibility 4, prize-stacking 3, evidence 2.

### 18. Orphan Materials — Rank computed materials that look great on paper but that nobody has published about.

1. **Sponsor stack**
   - **Voloridge (load-bearing):** Materials Project (`registry.opendata.aws/materials-project`) for formula, stability (energy above hull), band gap, formation energy; OpenAlex (`registry.opendata.aws/openalex`) works/concepts for literature counts per material.
   - **OpenAI (load-bearing):** GPT-5.6 generates the synonym set per formula (LiFePO4 ↔ "lithium iron phosphate" ↔ "olivine LFP") and writes a one-paragraph "why this might be interesting / why it's ignored" for the top 20. Codex writes the OpenAlex query layer — say it.
   - Optional: ElevenLabs — a 20-s spoken pitch per candidate is cute but removable; skip unless time.
2. **Who has the pain + evidence** — Materials researchers picking what to synthesize next. Direct pain evidence: none scouted (thin). Adjacent: MatNexus text-mining shows literature/property mining is an active research need (https://arxiv.org/pdf/2311.06303).
3. **Why now** — Both datasets sit in the same AWS region on the Voloridge bucket; OpenAlex snapshots are free and complete; MP has ~150k+ entries with stability flags. No model launch needed.
4. **Closest existing thing** — MatNexus (mines text for properties; the inverse direction). No Devpost near-duplicate found. Difference: the product is the *gap* score — promise minus attention — with a null model.
5. **24h build plan** — h6: MP subset via API/bucket (stable, band gap 1–2.5 eV or another property band, ~5–10k rows); OpenAlex works filtered to materials-science concepts for 2015–2025 (title/abstract inverted index) — a few GB, not the whole 400 GB snapshot. h12: matching (exact formula + synonyms + LLM-generated names) → paper counts; null model = expected count given element popularity and year; gap score. h18: explorer UI (scatter: promise vs attention; click → papers found, agent note). h24: verify top 10 by hand, write findings. **Fake:** nothing. **Real:** the match and the ranking; hand-check false "orphans" before demo.
6. **The demo moment** — Scatter plot: one dot far top-left; click; "stable, 1.6 eV gap, 0 papers since 2015; nearest studied analog has 412." Judge asks "is that real?" and you show the OpenAlex query returning zero.
7. **Special points** — *Prize stacking:* Voloridge (originality + insight), Sustainability track if you pick a photovoltaic/battery property band, OpenAI (Codex story). *Judge appeal:* Voloridge explicitly lists "combine multiple datasets to generate new insights"; this is the least-obvious pair in their list. *Unfair edge:* a null model makes the number defensible — quant judges will ask. *Biggest risk:* formula→literature matching is noisy in both directions (false orphans from naming; false hits from common formulas). De-risk in first 3 h: pick 20 known materials, measure recall of the matcher, and restrict to ternary/quaternary formulas where names are distinctive.
8. **Scores** — originality 4, demo wow 3, feasibility 3, prize-stacking 3, evidence 1.

### 19. Smoke Signal — Attribute air-quality spikes to the news events that caused them, then hide the obvious ones so only surprises remain.

1. **Sponsor stack**
   - **Voloridge (load-bearing):** OpenAQ measurements (PM2.5/NO2 by station-hour; `registry.opendata.aws/openaq`) and GDELT events/GKG (geocoded events with themes, 15-min files; `registry.opendata.aws/gdelt`).
   - **OpenAI (load-bearing):** GPT-5.6 classifies candidate events near a spike (fire, protest, industrial, traffic, fireworks), writes the attribution sentence, and powers the "surprise filter" (down-weights wildfire season, July 4, Diwali, known industrial zones). Codex writes the spatiotemporal join — say it.
   - **Token Company (optional):** compress GDELT article snippets before classification; show savings. Meta Muse Image: not needed — do not stuff.
2. **Who has the pain + evidence** — Public-health analysts and local journalists asking "why was the air bad Tuesday?" Direct evidence: none scouted (thin); the Sustainability track and Voloridge brief carry it. Prior single-source Devpost projects prove the appetite: Soteria (OpenAQ only, https://devpost.com/software/soteria-403mgo), GDELT Open Intelligence Agent (https://devpost.com/software/gdelt-open-intelligence-agent).
3. **Why now** — Both sources are pre-staged by Voloridge; GDELT GKG is too big to scan casually (the booth box solves that); LLM classification of event snippets is cheap enough to run over thousands of candidates.
4. **Closest existing thing** — The two Devpost projects above, each on one dataset. Difference: the join, plus the surprise filter that turns "wildfire → smoke" into "unlisted foundry fire → NO2 spike."
5. **24h build plan** — h6: pick 5 cities (e.g., Delhi, LA, Mexico City, Jakarta, Pittsburgh), 2 years of OpenAQ hourly (hundreds of MB); GDELT events with lat/lon within 50 km, same window (GB-scale — filter on the box, not your laptop). h12: spike detection (rolling median + MAD); candidate events within ±24 h and 50 km; LLM classify + rank. h18: map + timeline UI; surprise filter toggle; agent attribution text. h24: pick 3 surprising attributions, verify by reading the articles, backup slides. **Fake:** nothing. **Real:** spikes, joins, classification. Trap: GDELT geocoding is coarse — cap claims at "co-located, plausible."
6. **The demo moment** — Toggle "hide the obvious." Wildfire smoke blobs vanish; one lone spike remains; click; "Aug 14, 02:00, PM2.5 4× baseline — GDELT: warehouse fire 6 km upwind, 3 local reports."
7. **Special points** — *Prize stacking:* Voloridge, Sustainability track, OpenAI (Codex), Token Co. *Judge appeal:* Voloridge wants "hidden relationships" and "processing very large datasets efficiently" — GDELT is the largest thing in their list. *Unfair edge:* the surprise filter is the insight; everyone else's map just shows wildfires. *Biggest risk:* spatiotemporal alignment yields noise. De-risk in first 3 h: hand-check one known event (a documented fire) end-to-end before scaling; if GDELT geocodes are useless at 50 km, fall back to city-level and ±6 h.
8. **Scores** — originality 3, demo wow 3, feasibility 4, prize-stacking 3, evidence 2.

### 20. Hype Gap — Rank research papers by how far news coverage diverges from citations, in both directions.

1. **Sponsor stack**
   - **Voloridge (load-bearing):** OpenAlex works (DOI, title, cited_by_count, concepts, 2023–2025) × GDELT GKG (article URLs, themes, quotations) for news mentions.
   - **OpenAI (load-bearing):** GPT-5.6 matches article text to paper titles when DOIs are absent, and explains each gap ("covered by 140 outlets, 3 citations: press-release-driven; claim not replicated"). Codex writes the matcher — say it.
   - Optional: ElevenLabs for a "weekly hype report" narration — removable. Do not stuff.
2. **Who has the pain + evidence** — Science journalists, funders, and researchers deciding what to trust. Direct pain evidence: none scouted (thin). Analog: Altmetric exists as a paid product, which is evidence of demand.
3. **Why now** — OpenAlex is complete and free (Microsoft Academic's replacement) and is on the Voloridge bucket; GDELT GKG is staged too; LLM title matching makes DOI-less joins possible.
4. **Closest existing thing** — Altmetric (https://www.altmetric.com/) counts attention per paper. Difference: Hype Gap normalizes attention against citations within field and year and ranks the *residual* — both over-hyped and "cited but ignored" — with an explanation.
5. **24h build plan** — h6: OpenAlex works 2023–2024 with ≥1 citation in 3 fields (medicine, AI, climate) — a few hundred MB; GDELT GKG rows containing "study"/"research"/DOI-like patterns for the same window (filter on the box). h12: join by DOI in URL first (most reliable), then LLM title match for a sample; per-field regression of log(news) on log(citations); residual ranking. h18: two leaderboards + click-through to articles and citing papers; agent explanation. h24: verify top 10 by hand, backup. **Fake:** nothing. **Real:** join and residuals. Restrict claims to papers with DOI-bearing news links if fuzzy matching underperforms.
6. **The demo moment** — Leaderboard flips from "most hyped" to "most ignored"; a paper with 900 citations and zero news appears; the agent says why in one line; judge recognizes the topic.
7. **Special points** — *Prize stacking:* Voloridge (originality + insight), Education track (media literacy angle), OpenAI (Codex). *Judge appeal:* Voloridge rewards a "defensible number" — a field-normalized residual is exactly that. *Unfair edge:* it beats Orphan Materials on feasibility (DOI joins, no formula naming) with the same "attention vs merit" story. *Biggest risk:* GDELT-to-paper matching is fuzzy. De-risk in first 3 h: count how many GKG URLs contain `doi.org` or journal domains for one month; if <1k, switch to press-release DOIs (EurekAlert) as the news proxy.
8. **Scores** — originality 4, demo wow 3, feasibility 4, prize-stacking 3, evidence 1.

---

# Final section

## Top 5, ranked
1. **Recon Gym** — the only idea that hits the richest, least-crowded pot ($4k Maximor + Token Co + OpenAI Codex story + Ramp) with the strongest real-world evidence (QuickBooks thread with 69 replies, ERPNext issues open for years), no hardware, no audio, no telephony — nothing that can fail in a loud expo hall.
2. **Pager Whisperer** — the most memorable demo in the set (a phone rings, a calm voice briefs you, you say "roll back" and it happens); on-call pain is well-evidenced (HN 68 pts / 28-comment threads) and it stacks Warp + ElevenLabs + OpenAI.
3. **Apollo Radio Play** — highest demo-wow; real NASA transcripts satisfy SpaceXAI's "real space data" rule, ElevenLabs v3 emotion tags + SFX are load-bearing, and Interactive Media track is a natural stack.
4. **Spray Log** — a narrow named user (applicators), a hands-busy job, a compliance gate that makes the voice pipeline matter, and an honest cross-sponsor join (Deepgram Flux Multilingual + NOAA ISD wind at application time) plus Sustainability track.
5. **Smoke Signal** — best Voloridge $5k shot: a two-dataset join (GDELT × OpenAQ) with a "surprise filter" gives the "one defensible number + interactive map" that data judges rewarded (TerraLink, Dispatch pattern).

## The pick for this team (generic full-stack + ML, optional Arduino UNO Q)
**Build Recon Gym.** Why:
- Nothing in it depends on skills you don't have: it's an agent loop, a synthetic-data generator, a Postgres table, and a chart.
- Prize math: Maximor 1st $4k + top-5 fast-track; Token Co $500 (compression of statement/receipt text is genuinely inside the product); OpenAI (Codex writes the generator + eval harness — a true "Codex helped" story); Ramp "save time & money" is a free entry. Four prizes, one build.
- The winning pattern from Agent B — "show a measurable delta on screen" — is the whole demo: accuracy curve climbs run over run while cost per run falls.
- De-risk the demo boredom: let the judge type one messy transaction (typo'd vendor, split payment) and watch the agent route it to the human queue, then match it on the next run after the correction. That's the 10 seconds.
- Skip the UNO Q; it adds nothing here. If you want the Arduino track instead, switch to Cold Chain Count (#9), but you lose the finance money.

If you want the crowd-pleaser instead of the safest money: Pager Whisperer, but budget the first 2 hours for Twilio + ElevenLabs SIP and keep the web-widget call as the fallback.

## Sponsor combos: most used vs underused
**Most used across the 20**
- OpenAI + anything (in ~16 of 20 — expect every competing team to do the same; the Codex story is what differentiates).
- Maximor + Ramp demo MCP + OpenAI (+ Token Co) — 4 ideas.
- Deepgram + Ramp for field/trades workflows — 3 ideas.
- xAI Grok Imagine/Voice + ElevenLabs for media — 2 ideas.

**Underused (openings — fewer competing submissions)**
- **Warp Oz API + anything** — only Pager Whisperer uses it as load-bearing. Warp's prize is generic "best dev tool" with no Warp requirement, so a real Oz integration stands out.
- **Token Co inside a voice agent** — nobody compresses conversation history/tool results in ElevenAgents or Deepgram Voice Agent. Cheap to add to any voice idea and it is an easy Token Co entry.
- **Meta Muse Voice Transcribe (20-speaker diarization)** — a strong multi-speaker STT that only Sunday Dinner uses; it could replace Deepgram in any group-call idea and it's what Meta judges want to see.
- **Voloridge datasets as a side input to a non-data idea** — Spray Log (NOAA ISD) is the only one. GDELT or OpenAQ as context for a voice/finance agent is unclaimed territory.
- **xAI + Voloridge** — dropped from Overhead Tonight for honesty (ISD is historical). A historical-visibility use ("how often is it clear here in September") would be legitimate.
- **Meta connectors** — blocked by public-HTTPS + US-account requirements; if you can host one, you will be nearly alone.

## Blunt flags
- **Thin evidence:** Receipt Red Team, Conjunction Caller, Orphan Materials, Hype Gap, Flight Director have no first-hand user complaint behind them; they win on originality, not pain.
- **Banned-list risk:** Family Line — a shipping product (KindredMind) already does cloned-voice answering and the category is on the overdone list. The reframe (triage receptionist, never a companion) is defensible but you will spend demo time explaining ethics.
- **Logo-stuffing removed:** Warp from Token Diet/Grid Ghost, Ramp from Dunning Line/Receipt Red Team, NOAA ISD from Overhead Tonight. Do not put them back for the badge.
- **Live-demo killers:** anything with a microphone in the expo hall (use a headset + push-to-talk, pre-record a fallback); Grok video generation (pre-render everything); Twilio numbers (test at hour 2, not hour 22); Meta API is US-only (confirm account works before committing).
