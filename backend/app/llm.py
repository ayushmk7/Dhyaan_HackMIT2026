"""The one Claude client for the app. TECHNICAL_PRD §9.

ponytail: no LangChain, no agent framework, no prompt-template library. One
function — `complete()` — wrapping `anthropic.AsyncAnthropic().messages.create`.
Every call site (app/rag.py, app/summaries.py) already owns a deterministic
template fallback, so this module's only real job is to fail closed to `None`
on absolutely anything — no key, dead network, rate limit, malformed reply —
fast enough that a request never blocks on it. Ceiling: no streaming, no tool
use, no structured outputs, no multi-turn state — none of today's call sites
need them (short, single-turn completions capped well under 1000 output
tokens). Upgrade: if a call site ever needs a large response, switch that
call to `client.messages.stream(...)` + `get_final_message()` per the
claude-api skill — a large non-streaming `max_tokens` risks an HTTP timeout.

ponytail: the `anthropic` package is imported lazily, only once a call is
actually attempted, so a keyless box (this whole environment, right now)
never needs it installed — matching the existing lazy-import pattern in
rag.py's old inline Anthropic branches. It is also not listed in
pyproject.toml's dependencies; that file is outside this task's file
ownership. Upgrade: `pip install anthropic` and add it to
`[project].dependencies` before this ever runs against a real key.
"""

import asyncio
import logging

from .config import ANTHROPIC_API_KEY

log = logging.getLogger("dhyaan.llm")

# claude-api skill, current-models table (cached 2026-06-24): claude-opus-5 is
# the default model unless a caller explicitly names another. Not hardcoded
# from training memory — the skill's live table is the source of truth here.
MODEL = "claude-opus-5"

# The demo runs on venue wifi and no LLM call may ever hang a request or a
# write. Short client timeout, at most one manual retry, then give up — the
# caller's template fallback is always right there.
REQUEST_TIMEOUT_S = 8.0
MAX_RETRIES = 1
_RETRY_BACKOFF_S = 0.5

# True only when a key is configured. Cheap to check per-call too (config is a
# module-level constant loaded once at process start), but tests monkeypatch
# this flag directly to exercise the "client raises" path without needing a
# real key or the anthropic package installed.
AVAILABLE = bool(ANTHROPIC_API_KEY)

_client = None


def _get_client():
    """Lazily construct the AsyncAnthropic client. Only reached when AVAILABLE
    (or a test has forced the issue) — so `import anthropic` only has to
    succeed on a box that actually has a key."""
    global _client
    if _client is None:
        import anthropic  # ponytail: see module docstring — lazy on purpose

        _client = anthropic.AsyncAnthropic(
            api_key=ANTHROPIC_API_KEY, timeout=REQUEST_TIMEOUT_S, max_retries=0,
        )
    return _client


def _is_retryable(exc: Exception) -> bool:
    """429 (rate_limit_error) or 529 (overloaded_error) — duck-typed on
    `status_code` rather than importing anthropic's exception classes, so this
    also works against a fake client in tests with no `anthropic` install."""
    return getattr(exc, "status_code", None) in (429, 529)


async def complete(system: str, user: str, max_tokens: int = 600) -> str | None:
    """One Claude call. Returns the reply text, or `None` on absolutely any
    failure — no key, timeout, rate limit, malformed response, missing
    package. Callers must take their deterministic template fallback silently
    on `None`; this function never raises.

    ponytail: no prompt caching. Every system prompt in this app today is a
    few hundred tokens — well under the ~1024-4096 token minimum cacheable
    prefix (claude-api skill, prompt-caching reference) — so a cache_control
    breakpoint here would never actually register a hit; it would just be a
    parameter nobody benefits from. Revisit if a system prompt here grows
    past that size (e.g. a long few-shot answer prompt with static examples).
    """
    if not AVAILABLE:
        return None

    for attempt in range(MAX_RETRIES + 1):
        try:
            client = _get_client()
            resp = await client.messages.create(
                model=MODEL,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
            )
            return next((b.text for b in resp.content if b.type == "text"), None)
        except Exception as e:  # noqa: BLE001 — an LLM hiccup must never break a caller
            if _is_retryable(e) and attempt < MAX_RETRIES:
                log.warning("llm.complete retrying after %s: %s", type(e).__name__, e)
                await asyncio.sleep(_RETRY_BACKOFF_S * (attempt + 1))
                continue
            log.warning("llm.complete giving up: %s: %s", type(e).__name__, e)
            return None
    return None  # unreachable, keeps type-checkers happy
