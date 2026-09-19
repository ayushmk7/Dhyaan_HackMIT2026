# 40 candidate ideas — HackMIT 2026

Format: name — pitch | sponsors (role) | user/setting | signal (link) | banned-list note

## Finance / Office of the CFO (Maximor + Ramp)

1. **Recon Gym** — reconciliation agent that trains against a synthetic "messy ledger" generator; keeps a mistake journal (Skills files) and shows accuracy curve run-over-run; escalates low-confidence matches to a human via Ramp approval step. | Maximor (track), Ramp (demo MCP transactions + approvals add-step), OpenAI GPT-5.6 programmatic tool calling, Token Co (compress bank-statement text; cost curve on dashboard) | controllers / bookkeepers | QuickBooks "same amounts, won't match, no explanation" 69 replies https://quickbooks.intuit.com/learn-support/en-us/banking/banking-not-matching-transactions/00/138845 ; ERPNext auto-match issues open for years https://github.com/frappe/erpnext/issues/5903 | not banned

2. **Dunning Line** — AR agent that phones overdue customers, negotiates a pay date, logs the promise, and learns which scripts get paid fastest across runs (A/B by script, tracks promise-kept rate). | ElevenLabs (ElevenAgents telephony/SIP, tools), Maximor (track: self-improving), OpenAI (script mutation + eval), Ramp (payer side: bill created/paid in sandbox to close loop) | small-biz finance / AR clerks | HN "chasing overdue invoices is manual, awkward" 39 pts https://news.ycombinator.com/item?id=47638685 | not banned

3. **Variance Detective** — "why did OPEX jump 30% in March?" agent drills GL → Ramp transactions → receipts/memos → produces audit-ready variance explanation; stores CFO corrections as rules for next close. | Maximor (track), Ramp (transactions/receipts/memos API), OpenAI, Token Co (compress OCR'd receipts/memos before LLM; show $/close) | FP&A / controllers | FloQast reviews: no auto variance explanations from GL (secondhand) ; Maximor brief example "investigating unexpected changes" | not banned

4. **PBC Binder** — auditor sends a PBC request list; agent gathers evidence from Ramp (receipts, approvals, audit log), builds the binder, flags gaps, and learns the auditor's accepted format from prior rounds. | Maximor (track), Ramp (audit log, approvals, receipts), OpenAI | audit-season accountants | Maximor brief "gathering and validating audit support"; weak external signal | not banned

5. **Receipt Red Team** — self-play fraud detector: generator agent forges receipts/expense claims (gpt-image-2), detector agent tries to catch them, both improve; measurable precision/recall curve on screen. | Maximor (track: self-improvement), OpenAI (gpt-image-2 + GPT-5.6), Ramp (real receipt-matching flow in sandbox) | expense auditors | Ramp's own receipt matching; Maximor "learning from previous runs" | expense-tracker adjacent → reframe: adversarial self-play, not tracking

6. **Cash Call** — CFO asks by voice "cash in 30 days if we push vendor X two weeks?"; agent rebuilds cash forecast from messy Ramp bills/treasury data, remembers prior assumptions and corrections. | OpenAI gpt-live-1 (full-duplex voice), Ramp (bills/treasury API), Maximor (track) | CFO / treasury | Maximor brief "cash reports from messy source data" | not banned

7. **Ask-my-Ramp Muse connector** — employees ask their personal Muse "can I expense a $300 monitor?"; Muse calls your connector → Ramp spend-program policy + card limits → answer + one-tap request. | Meta (Muse connector), Ramp (spend programs API) | employees | Meta connectors opened Sep 18; Ramp policy engine | expense-adjacent; low wow — likely cut

## Developer tools (Warp, Token Co, OpenAI)

8. **Token Autopsy** — per-turn context profiler for coding agents: hooks Codex/Claude Code session logs, shows exactly what burns tokens (re-sent MCP schemas, giant tool outputs), auto-compresses tool outputs with Token Co bear-2, shows $ saved live. | Token Co (compress), OpenAI (Codex SDK/hooks, session logs), Warp (ships as TUI + Oz agent that runs profiler on schedule) | devs using agents | 308 reactions https://github.com/openai/codex/issues/14593 ; 560 reactions https://github.com/openai/codex/issues/28879 ; Cursor forum 178k cache-read tokens https://forum.cursor.com/t/151439 ; per-request profiler ask https://forum.cursor.com/t/152223 | not banned

9. **Pager Whisperer** — pager fires → Warp Oz agent pulls recent merges, runbook, logs, forms a hypothesis → ElevenAgent CALLS the on-call engineer and briefs them by voice; engineer says "roll back" and Oz executes. | Warp (Oz API agent run + followups), ElevenLabs (outbound call, tools → Oz), OpenAI | SREs on call | HN: alerts lack info, runbooks stale, don't know recent merges 28 comments https://news.ycombinator.com/item?id=36426851 ; 68 pts https://news.ycombinator.com/item?id=41610000 | not banned

10. **Flake Court** — Oz cron agent reruns flaky tests N times, bisects the culprit commit, opens a PR that quarantines + explains; flake-rate delta chart. | Warp (Oz scheduled agents, PR), OpenAI Codex | CI maintainers | weak: https://news.ycombinator.com/item?id=46967724 3 pts | not banned; thin evidence

11. **Talk-to-Terminal** — voice control layered on Warp Agent CLI: Deepgram Flux EagerEndOfTurn streams intent while you keep typing; "stop" cancels a running agent instantly (defer_until_eot semantics). | Deepgram (Flux, Voice Agent API), Warp (Agent CLI) | devs | https://github.com/warpdotdev/warp/issues/4339 1436 reactions is about local LLMs not voice — weak fit | not banned; evidence thin

12. **Review Radio** — for the human-review bottleneck: agent reads your PR queue, ranks by risk, and produces a 60-second spoken briefing per PR (ElevenLabs v3 audio tags for emphasis) you listen to walking to lunch; "approve / needs me" by voice. | ElevenLabs (v3 TTS + agent), OpenAI, Warp (Oz pre-review run) | tech leads | 5 Ask HNs in 2026 on review bottleneck https://news.ycombinator.com/item?id=49461811 | meeting-summarizer adjacent → cut unless mutated

13. **Context Diet Proxy** — drop-in proxy for any OpenAI-compatible agent that compresses tool results/RAG chunks with Token Co, caches prompt prefixes, and routes; dashboard of $/task before vs after on the same eval. | Token Co, OpenAI | agent builders | https://github.com/langchain-ai/langchain/issues/34130 30 reactions ; https://github.com/anthropics/claude-code/issues/46526 | generic "router" → likely cut / fold into #8

## Hands-busy voice (Deepgram, ElevenLabs)

14. **Spray Log** — farmer speaks "sprayed field 7, glyphosate 2 qt/acre, wind 8 NW"; Deepgram Flux Multilingual (Spanish crews) → compliant pesticide application record; NOAA ISD auto-attaches wind/temp for label-compliance check, reads back. | Deepgram (Flux multilingual + TTS), Voloridge (NOAA ISD weather), OpenAI | farmers / applicators | NewAgTalk threads over a decade (403'd) https://talk.newagtalk.com/forums/thread-view.asp?tid=985289 | not banned

15. **Wrench Voice** — HVAC/plumbing/electrical tech dictates job close-out while wrenching: parts, labor, photos; reads invoice total back; Ramp card parts purchases auto-attached. | Deepgram (Flux), Ramp (card transactions → job), OpenAI | field techs | ServiceTitan 2.9/5, "built for office not techs" https://apps.apple.com/us/app/servicetitan-mobile/id1037989976 ; Mike Holt job logs https://forums.mikeholt.com/goto/post?id=1087491 | not banned

16. **Walk-in Count** — restaurant inventory by voice walking the cooler: "six cases romaine, half case lemons"; agent computes food cost, flags variance vs purchases, learns kitchen slang. Optional Arduino UNO Q temp sensor in the walk-in. | Deepgram (Flux), Ramp (purchase data = expected inventory), OpenAI | kitchen managers | ChefTalk "2.5–3h, tedious as hell" https://www.cheftalk.com/threads/fallacy-of-food-cost-and-monthly-inventory.89189/ | not banned

17. **Rig Rider** — paramedic in the ambulance narrates as they work; timestamps auto-order interventions; before arrival the agent voices an SBAR handoff to the ED. | Deepgram (Flux w/ timestamps, Aura-2/Flux TTS), OpenAI | EMS | EMTLife "paper PCRs are faster" https://emtlife.com/threads/update-your-opinion-of-epcr-please.32921/ | clinical-scribe adjacent → reframe: timeline reconstruction + handoff, not notes

18. **Flowsheet Voice** — nurses enter vitals/flowsheet values by voice with range checks and readback. | Deepgram, OpenAI | nurses | 633–875 entries/shift https://pmc.ncbi.nlm.nih.gov/articles/PMC9300261 | scribe-banned; likely cut

19. **Dock Talk** — trucker voice-logs BOL exceptions/delivery issues when image capture is down; fuel-card reconciliation. | Deepgram, Ramp | drivers | Samsara reviews https://apps.apple.com/us/app/samsara-driver/id1106069401 | duplicate mechanism of #15 → merge

20. **Logbook Truth** — pilot logbook import creates phantom flights; agent reconciles roster vs voice-logged legs. | Deepgram, OpenAI | pilots | PPRuNe 10-page thread https://www.pprune.org/biz-jets-ag-flying-ga-etc/583226-best-electronic-pilot-logbook-10.html | thin sponsor fit → likely cut

## Social / family (Meta)

21. **Family Line** — caregiver-side phone agent for a parent with dementia who calls 25×/day: answers with caregiver-approved reassurance, logs each call's topic, posts a daily digest to the family group, and immediately calls the caregiver if content is new/urgent ("I fell"). | ElevenLabs (telephony agent + tools), Meta (Muse Spark digest + Graph API family group post), OpenAI | long-distance caregivers | AlzConnected "incessant calling" https://www.alzconnected.org/discussion/75539/incessant-calling ; Alzheimer's Society threads (mom calls 20–25×/day) https://forum.alzheimers.org.uk/threads/93069/ | dementia-companion is BANNED (rising) → radical reframe: not a companion for the patient; caregiver relief + escalation + family digest

22. **Sunday Dinner, Rendered** — weekly family call → Muse Voice Transcribe (diarization 20 speakers) → Spark writes the "family story of the week" → Muse Image illustrates → posted to the family Facebook group; grandparents get a picture-book PDF, kids get a comic. | Meta (Voice Transcribe, Spark, Image, Graph), ElevenLabs (narrates picture book with Eleven v3 emotion) | dispersed families | expat "out of sight out of mind" (weak) https://italicus.substack.com/p/out-of-sight-out-of-mind/comments | not banned

23. **Story Vault** — grandparent tells life stories on a call; agent asks follow-ups (real-time voice), Muse Image illustrates, grandkids submit questions via a Muse connector; produces an oral-history book. | OpenAI gpt-live-1 or ElevenAgent, Meta (Image + connector) | families | evidence thin; StoryCorps-style projects exist | crowded → mutate or cut

24. **Plan-o-matic connector** — expose group-planning tool as a Muse connector: Muse reads the family thread and proposes plans. | Meta | families | Meta's own example text | too on-the-nose (every Meta entrant will do it) → cut

25. **Two Tongues Table** — grandparents speak Cantonese, grandkids English; live interpreter on a family call using Deepgram Flux Multilingual code-switching + Flux TTS; posts bilingual recap to family group. | Deepgram (Flux multilingual), Meta (Graph + Spark) | immigrant families | none scouted | translator apps overdone → likely cut

26. **Reconnect Radar** — Graph API finds dormant friendships with a fresh shared interest; drafts a voice note. | Meta, ElevenLabs | everyone | none | networking-tool adjacent → cut

## Space (xAI + Cursor)

27. **Overhead Tonight** — "when can I see the ISS?" Grok Voice agent → CelesTrak TLE + SGP4 pass prediction; NOAA ISD cloud cover says whether you'll actually see it; Grok Imagine turns a photo of the user's backyard into a 10-s video of the pass over their real skyline. | xAI (Voice + Imagine image-to-video), Voloridge (NOAA ISD cloud/visibility), OpenAI? no | backyard skywatchers | TLE-handling hazards https://arxiv.org/abs/2212.08662 ; Space-Track SPOF https://satellitemap.space/space-track-status | not banned; Cursor required

28. **Flight Director** — pick any real mission (Launch Library 2 / NASA); Grok Imagine renders each phase as 15-s video with audio; Grok Voice narrates as flight director and, for live launches, pulls crowd reaction via x_search. | xAI (Imagine video + Voice with x_search), ElevenLabs (Music bed) | space fans / educators | "literature no human can read" (challenge text) | not banned; education/interactive-media track

29. **Conjunction Caller** — satellite ops on-call: agent screens TLE conjunctions (CelesTrak SOCRATES), explains risk in plain language and phones the operator; operator asks follow-ups by voice. | xAI (Voice w/ tools), OpenAI | small-sat operators / university cubesat teams | https://arxiv.org/abs/2212.08662 | not banned

30. **Aurora Barista** — NASA DONKI space weather + NOAA ISD clouds → voice alert "Kp 6 tonight, clear after 11pm"; Grok Imagine renders the forecast aurora over your city. | xAI (Voice + Imagine), Voloridge (NOAA ISD) | aurora chasers, HF radio ops | evidence thin | overlaps #27 mechanism → merge or cut

31. **Apollo Radio Play** — real Apollo air-to-ground transcripts → ElevenLabs v3 voices with emotion tags + SFX + Music, Grok Imagine visuals; interactive: you play CAPCOM by voice and Grok Voice answers in character using the real transcript as ground truth. | xAI (Imagine + Voice), ElevenLabs (v3, SFX, Music) | interactive media | real space data = NASA transcripts | not banned; interactive-media track

32. **Paper Pilot** — OpenAlex + ADS space literature agent by voice for aerospace researchers. | xAI (Voice), Voloridge (OpenAlex) | researchers | challenge text | "research assistant" crowded → cut unless mutated

33. **Scope Butler** — astrophotographer's dark/flat calibration frames organized by voice at the scope at 2am. | Deepgram, xAI? | astrophotographers | CloudyNights (403) | sponsor fit weak → cut

## Data (Voloridge)

34. **Grid Ghost** — PUDL plant generation × NOAA ISD weather: find plants whose reported output contradicts weather (solar on overcast days, wind at calm) → data-quality / misreporting detector with ranked anomalies and an agent that explains each. | Voloridge (PUDL + NOAA ISD), OpenAI, Warp (Oz runs the scale job on booth GPU?) | energy analysts / regulators | "signal in the noise"; Sustainability track | not banned

35. **Orphan Materials** — Materials Project × OpenAlex: materials with promising computed properties and near-zero literature → ranked "under-researched candidates" explorer. | Voloridge (two datasets joined), OpenAI | materials researchers | none scouted | not banned; unusual join

36. **Smoke Signal** — GDELT events (fires, protests, industrial accidents) × OpenAQ spikes → automatic attribution of air-quality spikes to news events; live map + agent explanation. | Voloridge (GDELT + OpenAQ), OpenAI, Meta Muse Image? no | public-health / journalists | Sustainability track | not banned

37. **Cab Pulse** — NYC TLC trip anomalies as a city-event sensor cross-labeled with GDELT/NOAA. | Voloridge | urbanists | none | taxi analyses are common → cut unless mutated

## Creators / other

38. **Foley Bot** — indie filmmakers: upload a clip, agent spots sound events and generates SFX with ElevenLabs, Music bed, v3 ADR; Grok Imagine for missing insert shots. | ElevenLabs (SFX, Music, v3), xAI (Imagine) | indie video creators | evidence not scouted | not banned

39. **Skeptic's Kitchen Timer**? placeholder — cut.

40. **Shop Floor Ear** — Arduino UNO Q at a workbench: on-device wake word → Deepgram streams "log torque 45 Nm bolt 3" into a QA record; Ramp for parts reorder. | Deepgram, Ramp | machinists / makers | none | hardware add-on only; likely cut
