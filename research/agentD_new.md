# Agent D — "Newly Possible" scout report (HackMIT 2026, written 2026-09-19)

Scope: what each sponsor shipped roughly Sept 2025 – Sept 2026, verified against primary docs/blogs where possible. Every dated claim has a URL. Items marked **[UNVERIFIED]** came only from secondary/third-party coverage or could not be fetched. Items marked **[PRE-EXISTING]** are older than 12 months but load-bearing for a combo.

Challenge text used for focus: `scratchpad/challenges.txt` (Meta = Muse API; SpaceXAI = Grok Imagine or Voice + Cursor + real space data; Token Co = LLM cost savings using their compression models; Deepgram = must call a Deepgram API, $200 credit + starter repo; ElevenLabs = agentic depth, low latency, "voice + video"; OpenAI = API + show how Codex helped; Ramp = "save time and money"; Warp = best developer tool; Maximor = self-improving finance agent; Voloridge = signal in public datasets).

---

## 1. OpenAI

Primary source: API changelog https://developers.openai.com/api/docs/changelog (fetched 2026-09-19).

**Models (new in window)**
- 2025-10-06: `gpt-5-pro`, `gpt-realtime-mini`, `gpt-audio-mini`, `gpt-image-1-mini`, **`sora-2` / `sora-2-pro` video API**; Agent Builder + ChatKit announced (DevDay). https://developers.openai.com/api/docs/changelog
- 2025-10-29: `gpt-oss-safeguard-120b/20b` (open-weight safety reasoning models). Same URL.
- 2025-11-13: `gpt-5.1`, `gpt-5.1-codex`, `gpt-5.1-codex-mini`; prompt-cache retention up to 24h.
- 2025-12-04: `gpt-5.1-codex-max`. 2025-12-11: `gpt-5.2`; `/responses/compact` endpoint; `xhigh` reasoning.
- 2025-12-16/19: `gpt-image-1.5`, `chatgpt-image-latest`.
- 2026-02-23: **`gpt-realtime-1.5`, `gpt-audio-1.5`**. 2026-02-24: `gpt-5.3-codex`; `input_file` in Responses.
- 2026-03-05: **`gpt-5.4` / `gpt-5.4-pro`**, 1M context, built-in `computer` tool in Responses API, tool search (defer large tool surfaces). 2026-03-17: `gpt-5.4-mini/nano`.
- 2026-03-12: Sora 2 — reusable character references, up to 20s, 1080p, `POST /v1/videos/edits`.
- 2026-04-21: **`gpt-image-2`** (flexible sizes, high-fidelity inputs, Batch 50% off; transparent bg added 2026-08-20).
- 2026-04-24: **`gpt-5.5` / `gpt-5.5-pro`** (1M ctx, built-in computer use).
- 2026-07-09: **GPT-5.6 family `gpt-5.6-sol/terra/luna`**; Programmatic Tool Calling, explicit prompt caching, persisted reasoning, `max` effort. 2026-07-30: Fast mode (2.5x). 2026-08-13: Ultrafast tier (14x). 2026-08-21: gpt-5.6-sol price cut to $4/M in.
- 2026-07-28: **`gpt-transcribe`, `gpt-live-transcribe`** (streaming STT). 2026-08-26: whisper-1 / gpt-4o-transcribe deprecated (shutdown 2027-02-26).
- 2026-09-03: **`gpt-6-astra`** ("most capable"); Responses API gains **async tool calling** and **mid-turn steering over WebSockets**; misalignment monitoring.
- 2026-09-08: `gpt-image-2.5-sunburst/flare`; `gpt-rosalind-research` (trusted access only).
- 2026-09-10: **`gpt-live-1` GA** — full-duplex voice (listens while speaking), $0.05/min billed per second, 12 voices; **Agents API public beta** ("managed Codex harness", durable sessions). Changelog + https://openai.com/index/introducing-gpt-live/ (secondary confirmation: https://datanorth.ai/news/openai-launches-gpt-live-1-in-the-api). Note: gpt-live-1 reportedly drops image input that gpt-realtime accepted **[UNVERIFIED — from eesel/datanorth coverage]**.

**Realtime API**
- 2025-08-28 GA with `gpt-realtime`, remote MCP servers, image input, SIP phone calling. https://openai.com/index/introducing-gpt-realtime/ (just outside window but foundational). 2025-11-20: DTMF. 2026-05-12: Realtime beta removed.
- `gpt-realtime-2.1` / `-2.1-mini` exist (community announcement) https://community.openai.com/t/new-realtime-models-on-the-api-gpt-realtime-2-1-and-gpt-realtime-2-1-mini/1385896 — date not on changelog fetch **[date UNVERIFIED]**.

**Agents / AgentKit / Apps SDK**
- DevDay 2025-10-06: AgentKit (Agent Builder, ChatKit, Connector Registry, Evals) and Apps SDK preview (apps inside ChatGPT via MCP). https://developers.openai.com/cookbook/examples/agentkit/agentkit_walkthrough ; https://www.latent.space/p/devday-2025-apps-sdk-agent-kit-mcp
- **Agent Builder and Evals platform deprecated 2026-06-03** (changelog). Don't build a demo on Agent Builder.
- 2026-02-10: Skills support + Hosted Shell tool (container networking) + server-side compaction in Responses API.
- 2026-04-15 / 2026-05-06: Agents SDK gains sandbox agents + "open-source harness"; TypeScript parity.
- 2026-09-10: Agents API public beta.

**Codex (relevant to "show how Codex helped")**
- 2026-02-02 Codex app (macOS; multi-agent, worktrees, automations, hooks) https://openai.com/index/introducing-the-codex-app/ ; Windows 2026-03-04 **[secondary]** https://intuitionlabs.ai/articles/openai-codex-app-ai-coding-agents
- GPT-5.3-Codex 2026-02-05 https://openai.com/index/introducing-gpt-5-3-codex/ ; Codex-Spark low-latency variant a week later **[secondary]**.
- Surfaces now: app, CLI, IDE extension, web/cloud, plugins, skills, automations, browser/computer use, PR review **[secondary: Wikipedia/guides]**. Good demo hook: use Codex automations/PR review and cite the session.

## 2. ElevenLabs

- **Scribe v2 Realtime** STT (<150ms, 90+ languages) 2025-11-12 https://elevenlabs.io/blog/introducing-scribe-v2-realtime ; integrated in Agents https://elevenlabs.io/blog/scribe-v2-realtime-in-elevenlabs-agents ; 2026-04-27 changelog adds `keyterms` (50) and `no_verbatim`. https://elevenlabs.io/docs/changelog/2026/4/27
- **Eleven v3 GA** 2026-03-14 (expressive audio tags) **[date from secondary: inworld.ai/devx]** https://elevenlabs.io/blog/eleven-v3
- **Eleven Music API** 2025-08-20 (licensed, commercial-safe) https://elevenlabs.io/blog/eleven-music-now-available-in-the-api ; Music v2 editable **[UNVERIFIED]**.
- **ElevenAgents** (renamed from Conversational AI): workflows, tests, Experiments (A/B), hosted MCP, Twilio/SIP/Exotel telephony, batch outbound calls, CLI, React/Swift/Kotlin/RN SDKs. https://elevenlabs.io/docs/eleven-agents/overview
- 2026-04-27 changelog: `agent_response_complete` event, `pre_tool_speech` enum, MCP `response_timeout_secs`, `trust_context`, source attribution, MCP tool scoping per workflow node. https://elevenlabs.io/docs/changelog/2026/4/27
- **ElevenLabs MCP now generates voice, music, image, video, dubs, SFX** from Claude/ChatGPT/Cursor/Grokbot. https://elevenlabs.io/blog/introducing-voice-music-image-and-video-generation-in-the-elevenlabs-mcp (date not captured **[date UNVERIFIED, 2026]**)
- **ElevenLabs Image & Video** + **Avatars** (talking-head, lipsync) in ElevenCreative https://elevenlabs.io/blog/introducing-elevenlabs-image-and-video ; https://elevenlabs.io/blog/introducing-avatars (dates not captured **[2026, UNVERIFIED]**). This is the "voice + video" the challenge hints at.
- Agents accept files/documents mid-conversation ("conversation file upload" in 2026-04-27 SDK notes).

## 3. Deepgram

- **Flux** (conversational speech recognition with model-integrated end-of-turn, ~260ms EOT, eager EOT events) launched 2025-10-02 https://www.businesswire.com/news/home/20251002758871/en/
- **Flux Multilingual** GA 2026-04-29, 10 languages, auto language detection + switching https://www.businesswire.com/news/home/20260429043418/en/
- **Flux TTS** GA on `/v2/speak` (WebSocket + REST), 36 voices, `Interrupt` with playback position, mid-call speed `Configure`, beta `expressivity` https://deepgram.com/learn/flux-tts-what-ships-at-ga (exact date not on page **[date UNVERIFIED, 2026]**).
- **Voice Agent API** (single WebSocket STT+LLM+TTS, function calling, provider swapping) https://developers.deepgram.com/docs/flux/agent ; 2026-09-08: `defer_until_eot` on functions + `FunctionCallCancelled` (don't execute irreversible tools while user is still talking) https://developers.deepgram.com/changelog/2026/9/8 ; 2026-04-30: inject agent messages into live session, multilingual Flux language hints, Aura-2 speed controls, Nova-3 Gujarati https://developers.deepgram.com/changelog/2026/4/30
- Aura-2 (enterprise TTS, `aura-2-thalia-en`) predates window **[PRE-EXISTING, Apr 2025]**.
- Starter repos: https://github.com/deepgram-starters (node-voice-agent, go/rust/ruby voice agents; Rust updated 2026-05-06, Ruby 2026-07-24). Free key: console.deepgram.com/signup. Saga / on-device: not verified in window **[UNVERIFIED]**.

## 4. Meta (challenge = Muse API + Graph API; glasses secondary)

**Meta Model API** (`https://api.meta.ai/v1`, OpenAI Chat Completions + Responses and Anthropic Messages compatible) https://dev.meta.ai/docs/overview ; models https://dev.meta.ai/docs/models
- **Muse Spark 1.1 preview** on Model API 2026-07-08: 1M ctx, tool calling, structured output, web-search grounding w/ citations, computer-use via screenshots, `reasoning_effort` minimal→xhigh, `previous_response_id`. $1.25/M in, $4.25/M out. US developers, self-serve at dev.meta.ai. https://developer.meta.com/ai/resources/blog/build-with-muse-spark/
- **Muse Spark 1.3** 2026-09-02 (agentic, coding) https://developer.meta.com/ai/models/muse-spark/ **[date from secondary]**. Inputs: text, image, video, audio, PDF.
- **Muse Image 1.0** (`muse-image-1.0`) — consumer launch 2026-07-07 https://about.fb.com/news/2026/07/introducing-muse-image-meta-ai/ ; API endpoints `/v1/images/generations` and `/v1/images/edits` (docs). Muse Video also announced https://ai.meta.com/blog/introducing-muse-image-muse-video-msl/ — video API availability **[UNVERIFIED]**.
- **Muse Voice Transcribe 1.0** 2026-09-03 (dev blog) — realtime WebSocket `wss://api.meta.ai/v1/asr/realtime`, file endpoint `/v1/asr/transcribe`, 16-bit PCM 16/24kHz, diarization (20+ speakers), endpointing, keyword biasing, 25+ languages incl. code-switching, modes PUSH_TO_TALK / ENDPOINTING / DIARIZATION, **$0.18/hour**. https://developer.meta.com/ai/resources/blog/meet-muse-voice-transcribe-streaming-speech-to-text/
- **SAM 3.1** on Model API (`sam-3.1`, text-prompted image/video segmentation; released 2026-03-27 **[secondary]**) https://dev.meta.ai/docs/models
- **Muse Glimmer** open-weight multimodal (self-host via vLLM/llama.cpp/ExecuTorch) https://dev.meta.ai/docs/models
- **Muse Code** terminal coding agent (CLI, approvals, OS sandbox) https://developer.meta.com/ai/products/muse-code/

**Muse (personal agent) + connectors**
- Muse consumer agent launched 2026-09-08 (US) https://techcrunch.com/2026/09/08/meta-debuts-its-muse-ai-agent-will-consumers-trust-it/ ; built-in connectors (Gmail, GCal, Plaid, OpenTable, Spotify...).
- Developer-built connectors opened 2026-09-18 https://runtimewire.com/article/meta-opens-muse-connectors-developers **[secondary; no official dev-doc URL found]**.
- What a connector is (per Meta Help Center via parallel.ai write-up https://parallel.ai/articles/meta-muse-custom-integrations ; help page https://www.meta.com/help/artificial-intelligence/1687253048996149/ ): the user asks Muse to build a "custom connector" against **your public REST API (OpenAPI) or a hosted streamable-HTTP MCP server**; Muse writes the MCP client on its own VM and saves it as a skill; all egress goes through a "Sentinel" permission agent; token/API-key auth; **no Meta review, no directory listing — each user adds it manually**. Safety write-up: https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse
- Practical: ship a small remote MCP server (or OpenAPI + "connector brief" markdown with base URL, auth header, calls, recipes) and demo Muse calling it. Needs a Muse account (US; TechCrunch/tech-insider mention $20/$100 tiers **[UNVERIFIED]**).
- **$50 Muse API credit terms**: only referenced in the challenge text; T&C link not found publicly **[UNVERIFIED — ask Meta booth]**. Rate limits: not published on fetched pages **[UNVERIFIED]**.
- Facebook Graph API: pre-existing; needs a Meta developer app; user-consented data requires App Review for most permissions beyond test users **[PRE-EXISTING, approval gate]**.

**Glasses (secondary)**: Wearables Device Access Toolkit — camera, mic, speakers on Ray-Ban Meta Gen1/2, Oakley HSTN/Vanguard; display + Neural Band gestures on Ray-Ban Display since 2026-05-14 https://developers.meta.com/blog/build-for-display-glasses/ ; **publishing not available in Developer Preview**, release channels to 100 testers, Mock Device Kit for non-display devices, web apps for Display glasses. https://developers.meta.com/wearables/faq/ . Blocker: needs the glasses + Wearables Developer Center access in supported country.

## 5. xAI / SpaceXAI (challenge = Cursor + Grok Imagine or Voice + real space data)

- Corporate: acquired by SpaceX Feb 2026, rebranded SpaceXAI July 2026 https://en.wikipedia.org/wiki/SpaceXAI **[secondary]**.
- **Grok Voice Agent API** 2025-12-17 — OpenAI Realtime-spec compatible WebSocket, LiveKit plugin, built-in web search + X search tools, $0.05/min https://x.ai/news/grok-voice-agent-api . Current pricing page: speech-to-speech `grok-voice-think-fast-2.0` $0.08/min audio + $0.004/text **[docs.x.ai/developers/models fetch]**; docs use `grok-voice-latest` https://docs.x.ai/developers/model-capabilities/audio/voice ; ephemeral tokens for browser clients; custom voice clone from ≤120s clip.
- **Standalone Grok STT + TTS** https://x.ai/news/grok-stt-and-tts-apis (STT `/v1/stt`, `grok-voice-transcribe-2.0`, 25 langs, diarization, word timestamps, $0.10/hr REST; TTS `/v1/tts` $15/M chars, speech tags, telephony codecs). Announced ~2026-04-18 **[date from MarkTechPost]**.
- **Grok Imagine API** 2026-01-28 https://x.ai/news/grok-imagine-api — image gen/edit, text-to-video, image-to-video, video edit, **native audio+dialogue in video**. **Video 1.5** 2026-05-31 **[secondary]** https://x.ai/news/grok-imagine-video-1-5 . Docs https://docs.x.ai/developers/model-capabilities/imagine : `POST /v1/images/generations` (≤10/req), `/v1/images/edits` (≤5 source images), `POST /v1/videos/generations` (async, poll `GET /v1/videos/{id}`, ≤15s, extend-from-last-frame, edit existing video). Pricing: `grok-imagine-image-2.0` $0.04/img, `grok-imagine-video-1.5` $0.08/sec.
- Text: `grok-4.6` (2026-08-12 **[secondary]**, 500k ctx, $2/$6), `grok-4.3` (1M ctx, $1.25/$2.50), `grok-4.20-multi-agent-0309`, `grok-build-0.1`. https://docs.x.ai/developers/models . Tool pricing (web/X search, collections) not on fetched page **[UNVERIFIED]**.
- **Grok Bot** 2026-08-11: always-on cloud agents; beta for SuperGrok and **Cursor Pro/Teams** subscribers https://x.ai/news/introducing-grok-bot — the "bonus points for planning" tool; needs a paid Cursor or SuperGrok seat.

**Space data that pairs well** (all pre-existing, stable public APIs; verify keys at build time):
- NASA APIs (APOD, NEO/asteroids, DONKI space weather, EPIC Earth imagery, Mars rover photos): https://api.nasa.gov (free key)
- NASA Image & Video Library: https://images-api.nasa.gov (no key)
- JPL Horizons ephemerides: https://ssd.jpl.nasa.gov/api/horizons.api ; Small-Body DB: https://ssd-api.jpl.nasa.gov
- CelesTrak GP/TLE (no login): https://celestrak.org/NORAD/elements/ ; Space-Track (login, TLE history/conjunctions): https://www.space-track.org
- MAST (JWST/Hubble/TESS) via astroquery: https://mast.stsci.edu ; JWST data portal https://archive.stsci.edu/missions-and-data/jwst
- SDO / Helioviewer solar imagery API: https://api.helioviewer.org ; NOAA SWPC JSON feeds https://services.swpc.noaa.gov
- NASA Exoplanet Archive TAP: https://exoplanetarchive.ipac.caltech.edu/docs/TAP/usingTAP.html
- NASA ADS literature API (token): https://ui.adsabs.harvard.edu/help/api/ ; arXiv astro-ph API https://info.arxiv.org/help/api
- Copernicus Data Space (Sentinel-1/2/3/5P): https://dataspace.copernicus.eu ; Landsat on AWS https://registry.opendata.aws/usgs-landsat/ ; NASA GIBS tiles https://wiki.earthdata.nasa.gov/display/GIBS
- Launch Library 2 (launches, pads): https://ll.thespacedevs.com/2.2.0/ ; ISS position https://wheretheiss.at/w/developer
- Gaia archive https://gea.esac.esa.int/archive/ ; SIMBAD/VizieR https://cds.unistra.fr

## 6. Ramp

- Developer API (OAuth client-credentials + auth-code): accounting, bill pay, cards, transactions, spend programs, reimbursements, vendors, bank accounts/treasury transfers, approvals (add step to existing approval instance), audit log, **AI spend / API-key spend tracking** https://docs.ramp.com/llms-api.txt ; OpenAPI https://docs.ramp.com/openapi/developer-api.json
- **Sandbox**: Ramp MCP supports `RAMP_ENV=demo|qa|prd` and "sandbox" account auth https://github.com/ramp-public/ramp_mcp ; remote MCP at `https://mcp.ramp.com/mcp` https://support.ramp.com/ramp-mcp . Tools: load_transactions/bills/reimbursements/cards/limits/vendors/spend_programs → in-memory SQL via `execute_query`.
- **Ramp MCP + Developer Community** 2025-09-22 https://ramp.com/blog/introducing-the-ramp-developer-community
- **Agent Cards** (agents.ramp.com, announced ~2026-03-11 **[secondary: stabledash]**): `POST /agent-tools/get-agent-card-creds`, SDK `agent_client.agent_tools.agent_cards.create_payment_token()`, CLI `ramp --profile agent --agent funds creds`; creds bound to merchant + amount, expire after first auth or 12h; fund-level MCC blocks/vendor allowlists. **"Standalone agents are in limited early access. Reach out to the team."** https://agents.ramp.com/cards — hard gate for 24h unless booth enables it.
- Blog explainer: https://ramp.com/blog/virtual-cards-for-ai-agents

## 7. Warp

- **Warp 2.0 ADE** 2025-06 (universal prompt/command input, multi-agent) https://www.warp.dev/blog/reimagining-coding-agentic-development-environment **[PRE-EXISTING]**
- **Warp Code** 2025-09-03: code review pane, file editor, WARP.md (compatible with AGENTS.md/CLAUDE.md), agent profiles https://www.warp.dev/blog/introducing-warp-code-prompt-to-prod
- **Oz cloud-agent orchestration** 2026-02-10 https://www.warp.dev/blog/oz-orchestration-platform-cloud-agents ; renamed "Automation Platform" (oz CLI/web keep name until 2026-10-06) https://docs.warp.dev/platform/
- **Oz API + Python/TS SDKs**: `POST /agent/run`, `GET /agent/runs`, `GET /agent/runs/{id}`, `POST .../followups`, `POST .../cancel`; configure model, base prompt, MCP servers, `skill_spec`; triggers via CLI, schedules (`oz schedule --cron`), webhooks, Slack/GitHub integrations. https://docs.warp.dev/reference/api-and-sdk/ ; https://docs.warp.dev/reference/cli/
- Warp is now open source https://github.com/warpdotdev/warp ; runs Claude Code/Codex/Gemini CLI inside. Pricing: Build/Max/Business tiers since 2025-10-30; cloud agents bill AI+compute credits (1,000 promo credits Feb 2026, may be expired).

## 8. The Token Company (YC W26)

- Product: delete-only, deterministic, cache-safe prompt compression by a small token-scoring classifier (not an LLM). Endpoint `POST https://api.thetokencompany.com/v1/compress`, bearer auth, `aggressiveness` param; `pip install the-token-company`. https://thetokencompany.com/
- Models: **Bear-2** (primary), **Bear-2-Safety** (private preview; safety classifier pipelines). Claims: 10–50% token reduction at full accuracy; CoQA 93.3→95.3% with −8.2% tokens; p95 150ms, <50ms inference. https://thetokencompany.com/ ; YC launch https://www.ycombinator.com/launches/Pb3-the-token-company-intelligent-compression-for-llm-context-bloat
- Pricing $0.05 / 1M tokens **[secondary: YC launch page / pointfive]**. Public benchmark repo (FinanceBench, LongBench v2, SQuAD v2, CoQA; bear-1.2 at aggressiveness 0.1–0.7) https://github.com/TheTokenCompany/Benchmarks
- Challenge note: sign-in unlocked for all on Fri 2026-09-18. Not an OpenAI-compatible proxy — you call compress, then call your LLM.

## 9. Maximor / Voloridge

- Maximor: "Audit-Ready Agentic Automation for the Office of the CFO"; $9M seed (CFO Dive) https://www.cfodive.com/news/startup-raises-9m-rescue-finance-teams-buried-reconciliations-agentic-ai/761444/ ; 35x revenue growth PR 2026-08-05 https://www.globenewswire.com/news-release/2026/08/05/3339475/0/en/ . No public API/dataset. Challenge wants: multi-step tool use, learning from prior runs, human review when uncertain, measurable improvement.
- Voloridge: quant fund; Ascend Program 2027 (Jan 11–14, 2027; apply by 2026-10-31) https://job-boards.greenhouse.io/voloridgeinvestmentmanagement/jobs/4328356009 . Curated dataset list is a Google Drive link in challenge text (earth observation, healthcare, transport, climate, genomics, economics). No API.

---

## 10. 15+ combos not buildable a year ago (Sept 2025)

1. **Full-duplex space-mission copilot**: `gpt-live-1` (2026-09-10) full-duplex voice + NASA DONKI/Helioviewer live solar data via async tool calling (2026-09-03). Newly possible: full-duplex model in API + async tools. Links: https://developers.openai.com/api/docs/changelog
2. **Grok Voice agent that narrates a Grok Imagine video of tonight's sky**: Grok Voice API (2025-12-17) with built-in X search + Grok Imagine video with native audio (2026-01-28), fed by JPL Horizons. Satisfies SpaceXAI challenge exactly. https://x.ai/news/grok-voice-agent-api ; https://x.ai/news/grok-imagine-api
3. **Satellite-pass "explainer reel"**: CelesTrak TLE → compute passes → `grok-imagine-image-2.0` frames → `/v1/videos/generations` image-to-video with extend-from-last-frame (Video 1.5, 2026-05-31). https://docs.x.ai/developers/model-capabilities/imagine
4. **JWST literature radio show**: ADS API + `grok-4.3` 1M ctx summarization → Grok TTS (`/v1/tts`, ~Apr 2026) with speech tags; or ElevenLabs v3 GA (2026-03-14) for expressive narration + Eleven Music bed. https://x.ai/news/grok-stt-and-tts-apis
5. **Muse connector for a group-planning app**: expose your app as a remote MCP server; Muse (2026-09-08) builds a custom connector (dev connectors opened 2026-09-18) so a family's Muse can call "propose weekend plan" from your hack. Newly possible: Muse + connectors. https://parallel.ai/articles/meta-muse-custom-integrations
6. **Live diarized family call → shared story**: Muse Voice Transcribe realtime WebSocket with diarization (2026-09-03, $0.18/hr) → Muse Spark 1.3 (2026-09-02) synthesizes a shared narrative → Muse Image (`/v1/images/edits`) illustrates it. https://developer.meta.com/ai/resources/blog/meet-muse-voice-transcribe-streaming-speech-to-text/
7. **"Who's in this photo" reunions**: SAM 3.1 text-prompted segmentation on Model API (2026-03) + Muse Spark image understanding + Graph API user-consented albums. https://dev.meta.ai/docs/models
8. **Deepgram Flux agent that never books before you finish talking**: Voice Agent API `defer_until_eot` + `FunctionCallCancelled` (2026-09-08) with Flux Multilingual auto-switching (2026-04-29) and Flux TTS `Interrupt` with playback position. https://developers.deepgram.com/changelog/2026/9/8
9. **ElevenAgents voice+video tutor**: ElevenAgents with Scribe v2 Realtime (2025-11-12), MCP tool scoping per workflow node (2026-04-27), conversation file upload, and an ElevenCreative Avatar talking-head for the "video" half. https://elevenlabs.io/docs/changelog/2026/4/27 ; https://elevenlabs.io/blog/introducing-avatars
10. **Agent-generated soundtrack per user mood**: ElevenAgents detects tone → Eleven Music API (2025-08-20, licensed) generates a track mid-conversation → SFX layered. https://elevenlabs.io/blog/eleven-music-now-available-in-the-api
11. **Self-improving reconciliation agent (Maximor) on Ramp sandbox**: Ramp MCP `load_transactions/load_bills` + `execute_query` (demo env) as the "system of record", GPT-5.6 Programmatic Tool Calling + persisted reasoning (2026-07-09), Responses API Skills (2026-02-10) to store learned playbooks between runs; human review via Ramp approvals API "add step". https://github.com/ramp-public/ramp_mcp ; https://developers.openai.com/api/docs/changelog
12. **Agent that pays for its own compute**: Ramp Agent Cards (`get-agent-card-creds`, merchant+amount bound, 12h expiry) → an OpenAI/xAI agent buys a dataset or API credit and books it to a fund. Newly possible since ~2026-03; **gated (limited early access)**. https://agents.ramp.com/cards
13. **Token-cost dashboard hack (Token Co + Ramp)**: Bear-2 compress every prompt (`aggressiveness` sweep) and show savings against Ramp's **API-key spend tracking** endpoints; OpenAI Prompt Caching dashboard/diagnostics (2026-08-20, 2026-09-08) as second signal. https://thetokencompany.com/ ; https://docs.ramp.com/llms-api.txt
14. **Warp Oz as a CI reviewer for your hack**: `POST /agent/run` with `skill_spec` + MCP servers, cron schedule to re-run tests, follow-ups to steer (Oz API 2026-02-10). Pair with Codex PR review to compare agents — "best developer tool". https://docs.warp.dev/reference/api-and-sdk/
15. **Headless voice-driven terminal**: Deepgram Flux STT → Warp Oz `agent/run` → Flux TTS reads back diff summary; end-of-turn events gate command execution. https://developers.deepgram.com/docs/flux/agent
16. **Grok Bot + Cursor planning trail**: use Grok Bot (2026-08-11, Cursor Pro beta) to run the project board and generate the SpaceXAI submission write-up; export logs as evidence for "bonus points". https://x.ai/news/introducing-grok-bot
17. **Apps-in-ChatGPT sky viewer**: Apps SDK (2025-10-06) MCP app rendering Helioviewer/APOD imagery inside ChatGPT, with gpt-image-2 transparent-background overlays (2026-08-20). https://www.latent.space/p/devday-2025-apps-sdk-agent-kit-mcp
18. **Sora 2 character-consistent mission recap** (`/v1/videos/edits`, 20s, 1080p, 2026-03-12) narrated by gpt-live-1 or ElevenLabs v3. https://developers.openai.com/api/docs/changelog
19. **Muse Code / Codex "how it helped" artefact**: run the same task in Codex app automations and Muse Code; ship transcripts as the required process evidence. https://developer.meta.com/ai/products/muse-code/ ; https://openai.com/index/introducing-the-codex-app/
20. **Glasses-first (only if a team has Ray-Ban Display + Neural Band)**: display + gesture toolkit (2026-05-14) + Muse Voice Transcribe realtime → live captions with speaker names on-lens. Blocked for most: hardware + no publishing.

## 11. Hard blockers for a 24h build

- **Ramp Agent Cards**: limited early access; need the booth to enable a sandbox business. Ramp API itself needs a Ramp developer app; MCP demo env exists.
- **Meta Muse connectors**: no dev docs URL found; Muse is US-only, likely needs a paid Muse tier; each user must manually ask Muse to build the connector; no review means fine for demo, but you need a hosted (public HTTPS) MCP/OpenAPI endpoint.
- **Meta Model API**: US developers only; $50 credit T&C unverified; rate limits unpublished. Muse Video API availability unverified.
- **Facebook Graph API**: App Review for real user permissions; use test users.
- **Meta glasses**: hardware + Wearables Developer Center access; no publishing; Display glasses have no mock kit.
- **OpenAI**: credits only for teams submitting to OpenAI challenge; `gpt-rosalind-research`/Daybreak are trusted-access; Agent Builder + Evals deprecated 2026-06-03 (avoid). gpt-live-1 no image input (unverified).
- **xAI**: Grok Bot requires SuperGrok or Cursor Pro/Teams; video gen is async (poll) and $0.08/s — budget ~$1.20 per 15s clip; Cursor is mandatory for the SpaceXAI prize.
- **Token Company**: sign-in gated until 2026-09-18 (now open per challenge); not a proxy, requires code changes; Bear-2-Safety private preview.
- **ElevenLabs**: Music API paid-tier only; telephony needs Twilio/SIP numbers; Avatars/video are ElevenCreative product features — API access for video unverified.
- **Deepgram**: pay-as-you-go concurrency 45 streams NA; Flux TTS session max 1h; $200 credit per challenge.
- **Warp Oz**: cloud agents bill AI+compute credits; promo credits from Feb 2026 likely expired; auth details not in fetched docs.
- **Space-Track** needs an account (CelesTrak does not); ADS needs a token; Copernicus needs registration.
