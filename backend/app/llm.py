"""The one LLM client for the app. TECHNICAL_PRD §9.

ponytail: no LangChain, no agent framework, no prompt-template library, and no
vendor SDK. One function — `complete()` — that POSTs to OpenAI's
`/v1/chat/completions` with the `httpx` client this project already depends
on. Every call site (app/rag.py, app/summaries.py) already owns a
deterministic template fallback, so this module's only real job is to fail
closed to `None` on absolutely anything — no key, dead network, rate limit,
malformed reply — fast enough that a request never blocks on it. Ceiling: no
streaming, no tool use, no structured outputs, no multi-turn state — none of
today's call sites need them (short, single-turn completions capped well
under 1000 output tokens). Upgrade: if a call site ever needs a large
response, switch that call to `stream: true` and read SSE chunks — a large
non-streaming `max_completion_tokens` risks an HTTP timeout.

Why httpx and not the `openai` package: this is one endpoint, one JSON body,
one field read back. The package would add a dependency (not installed in
the demo venv today) to save six lines, and it would bring its own retry
and timeout defaults that this module deliberately overrides anyway. If a
call site ever needs streaming helpers, structured outputs or the Responses
API, that is the moment to add `openai` — not before.

ponytail: `httpx` is imported lazily, only once a call is actually attempted,
so a keyless box (this whole environment, right now) never even constructs a
client — the same posture the previous vendor-SDK client had. It is already a hard
dependency (rag.py uses it for Ollama), so this costs nothing and keeps the
import graph of `app.llm` empty on the no-key path.
"""

import asyncio
import logging

from .config import OPENAI_API_KEY

log = logging.getLogger("dhyaan.llm")

# Model: gpt-5.6-terra (developers.openai.com/api/docs/models, checked
# 2026-09-20 — not from training memory). It is the tier OpenAI describes as
# "balances intelligence and cost" ($2 / $12 per MTok), which is what this
# app needs: the daily narrative is prose a worried daughter reads and it
# must be right about what did NOT happen (§9.1), so the cheapest tier is the
# wrong trade; the flagship (gpt-6-astra, $10 / $50) is overkill for two-to-
# five-sentence answers over a few hundred tokens of context. It is a
# reasoning model, so `reasoning_effort` is pinned to "none" below: the
# 8-second timeout leaves no room for hidden thinking tokens, and the
# models page lists "none" as a supported effort for the 5.6 family.
MODEL = "gpt-5.6-terra"
REASONING_EFFORT = "none"
OPENAI_BASE_URL = "https://api.openai.com/v1"

# The demo runs on venue wifi and no LLM call may ever hang a request or a
# write. Short client timeout, at most one manual retry, then give up — the
# caller's template fallback is always right there.
REQUEST_TIMEOUT_S = 8.0
MAX_RETRIES = 1
_RETRY_BACKOFF_S = 0.5

# True only when a key is configured. Cheap to check per-call too (config is a
# module-level constant loaded once at process start), but tests monkeypatch
# this flag directly to exercise the "client raises" path without needing a
# real key or a network.
AVAILABLE = bool(OPENAI_API_KEY)

_client = None


def _get_client():
    """Lazily construct the httpx client. Only reached when AVAILABLE (or a
    test has forced the issue). The bearer header and timeout live on the
    client so `complete()` stays one POST; `max_retries` has no httpx
    equivalent — httpx never retries on its own, which is the posture we want
    (the one retry below is ours and explicit)."""
    global _client
    if _client is None:
        import httpx  # ponytail: see module docstring — lazy on purpose

        _client = httpx.AsyncClient(
            base_url=OPENAI_BASE_URL,
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            timeout=REQUEST_TIMEOUT_S,
        )
    return _client


def _is_retryable(exc: Exception) -> bool:
    """429 (rate limit) or 503 (overloaded / engine busy) — duck-typed on a
    `status_code` attribute (the shape tests fake) or on the `.response` of an
    `httpx.HTTPStatusError`, rather than importing httpx's exception classes,
    so this also works against a fake client with no network."""
    code = getattr(exc, "status_code", None)
    if code is None:
        code = getattr(getattr(exc, "response", None), "status_code", None)
    return code in (429, 503)


async def complete(system: str, user: str, max_tokens: int = 600) -> str | None:
    """One OpenAI call. Returns the reply text, or `None` on absolutely any
    failure — no key, timeout, rate limit, malformed response, empty reply.
    Callers must take their deterministic template fallback silently on
    `None`; this function never raises.

    ponytail: no prompt caching parameters. OpenAI caches long shared
    prefixes automatically (no opt-in field on chat completions), and every
    system prompt in this app today is a few hundred tokens — under the
    1024-token minimum for a cache hit — so there is nothing to tune here.
    """
    if not AVAILABLE:
        return None

    body = {
        "model": MODEL,
        "reasoning_effort": REASONING_EFFORT,
        # `max_completion_tokens` is the current name; `max_tokens` is
        # documented as deprecated and rejected by reasoning models.
        "max_completion_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    for attempt in range(MAX_RETRIES + 1):
        try:
            client = _get_client()
            resp = await client.post("/chat/completions", json=body)
            resp.raise_for_status()
            text = resp.json()["choices"][0]["message"]["content"]
            return text.strip() or None if isinstance(text, str) else None
        except Exception as e:  # noqa: BLE001 — an LLM hiccup must never break a caller
            if _is_retryable(e) and attempt < MAX_RETRIES:
                log.warning("llm.complete retrying after %s: %s", type(e).__name__, e)
                await asyncio.sleep(_RETRY_BACKOFF_S * (attempt + 1))
                continue
            log.warning("llm.complete giving up: %s: %s", type(e).__name__, e)
            return None
    return None  # unreachable, keeps type-checkers happy
