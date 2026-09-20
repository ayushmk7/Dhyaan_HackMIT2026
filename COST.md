# COST.md — how Dhyaan spends almost nothing on LLMs

Token Company challenge write-up. The savings below are product-architecture
decisions, not build-time tricks.

## 1. The camera lane: 7.3 s → 18 ms, and ~500× fewer VLM calls

The naive design sends every keyframe to a vision-language model. Ours asks a
local YOLO detector the structural questions first (is anyone there, standing
or seated, how many people) and consults the VLM only when the structure
changes meaning (a meal, a visitor, a fall posture). Measured on the demo
feed, per-decision latency fell from 7.3 s to 18 ms, and VLM invocations drop
to the rare frames that matter. Marginal token cost of continuous observation:
≈ $0.

## 2. Local models where latency and volume live

- Vision: `qwen3-vl` via Ollama on the hub Mac — $0/frame, and video never
  leaves the house (the privacy story and the cost story are the same story).
- Embeddings: `nomic-embed-text` locally — the RAG index costs nothing to
  build or refresh.
- Cloud models are reserved for judgment: Claude Haiku on the voice path
  (cheapest tier, ~3 short turns per call), a frontier model only for weekly
  narrative polish and care-document extraction — single-digit calls per day.

## 3. Compress before any model sees it

Every observation is stored with a producer-written `embedding_text` capped at
400 characters. RAG retrieves sentences, not transcripts or frames; a week of
a person's life fits in a few thousand tokens of context. The voice agent's
system prompt is ~300 tokens and static (fully cacheable); tools are defined
once, verbatim.

## 4. Numbers a judge can check

| Decision | Naive cost | Ours |
|---|---|---|
| Continuous room observation | ~1 VLM call / keyframe, cloud vision pricing | YOLO local, VLM ~0.2% of frames, $0 marginal |
| A fall call (STT+LLM+TTS) | GPT-4-class agent | Haiku think-provider, ~3 turns, static cached prompt |
| Weekly RAG index | cloud embeddings per event | local embeddings, $0 |
| "Has she been eating?" | stuff transcripts into context | ≤400-char sentences, top-k only |

The system is designed so its always-on loops (vision, localization,
embedding) cost zero tokens, and paid tokens buy only moments of judgment.
