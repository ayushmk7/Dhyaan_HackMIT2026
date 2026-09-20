"""Tests for the LLM layer, app/llm.py, and its call sites in app/rag.py and
app/summaries.py. No OPENAI_API_KEY is set in the test environment (see
conftest.py) — every test here proves the offline / failure-safe path works,
by injecting a fake client or a fake `llm.complete`, never by calling
OpenAI for real."""

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from app import alerts, llm, rag, summaries
from app.config import OPENAI_API_KEY
from app.events import emit


def test_no_api_key_in_test_env():
    assert not OPENAI_API_KEY
    assert llm.AVAILABLE is False


# ---------------------------------------------------------------------------
# llm.complete
# ---------------------------------------------------------------------------

async def test_complete_returns_none_with_no_key():
    result = await llm.complete("system prompt", "user prompt")
    assert result is None


async def test_complete_returns_none_when_client_raises(monkeypatch):
    class _FakeClient:
        async def post(self, path, **kwargs):
            raise RuntimeError("simulated transport failure")

    monkeypatch.setattr(llm, "AVAILABLE", True)
    monkeypatch.setattr(llm, "_get_client", lambda: _FakeClient())

    result = await llm.complete("system prompt", "user prompt")
    assert result is None


async def test_complete_retries_once_on_rate_limit_then_gives_up(monkeypatch):
    calls = {"n": 0}

    class _RateLimited(Exception):
        status_code = 429

    class _FakeClient:
        async def post(self, path, **kwargs):
            calls["n"] += 1
            raise _RateLimited("slow down")

    monkeypatch.setattr(llm, "AVAILABLE", True)
    monkeypatch.setattr(llm, "_get_client", lambda: _FakeClient())
    monkeypatch.setattr(llm, "_RETRY_BACKOFF_S", 0)  # don't slow the suite down

    result = await llm.complete("system prompt", "user prompt")
    assert result is None
    assert calls["n"] == llm.MAX_RETRIES + 1  # one initial attempt + one retry


async def test_complete_succeeds_with_fake_client(monkeypatch):
    """The fake mirrors OpenAI's /v1/chat/completions reply: the text lives at
    choices[0].message.content. It also pins the request body llm.py sends,
    since a wrong field name there would 400 on a real key and silently drop
    every call to the template."""
    sent = {}

    class _Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"choices": [{"message": {"role": "assistant",
                                             "content": "hello from openai"}}]}

    class _FakeClient:
        async def post(self, path, **kwargs):
            sent["path"] = path
            sent["json"] = kwargs["json"]
            return _Resp()

    monkeypatch.setattr(llm, "AVAILABLE", True)
    monkeypatch.setattr(llm, "_get_client", lambda: _FakeClient())

    result = await llm.complete("system prompt", "user prompt", max_tokens=123)
    assert result == "hello from openai"
    assert sent["path"] == "/chat/completions"
    assert sent["json"]["model"] == llm.MODEL
    assert sent["json"]["max_completion_tokens"] == 123
    assert "max_tokens" not in sent["json"]  # deprecated name, rejected by reasoning models
    assert sent["json"]["messages"] == [
        {"role": "system", "content": "system prompt"},
        {"role": "user", "content": "user prompt"},
    ]


async def test_complete_returns_none_on_empty_reply(monkeypatch):
    """An empty or null `content` must read as "no answer" so the caller takes
    its template, not an empty chat bubble."""
    class _Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"choices": [{"message": {"role": "assistant", "content": ""}}]}

    class _FakeClient:
        async def post(self, path, **kwargs):
            return _Resp()

    monkeypatch.setattr(llm, "AVAILABLE", True)
    monkeypatch.setattr(llm, "_get_client", lambda: _FakeClient())

    assert await llm.complete("system prompt", "user prompt") is None


# ---------------------------------------------------------------------------
# rag.daily_narrative
# ---------------------------------------------------------------------------

async def test_daily_narrative_falls_back_to_template_and_writes_event(resident, db):
    await emit(
        resident_id=resident, source="camera", type="walk_completed",
        embedding_text="Eleanor walked the hallway.",
        ts=datetime(2026, 9, 1, 10, 0, tzinfo=ZoneInfo("America/New_York")),
    )

    narrative = await rag.daily_narrative(resident, "2026-09-01")
    assert narrative
    # The template used to lead with "2026-09-01 — ...", and this assertion used
    # that date stamp as proof no LLM ran. The stamp is gone on purpose: this
    # text is what the family reads on Her day, and a day's story does not open
    # by reciting its own date. Pin the template's own wording instead, which
    # proves the same thing and also pins the voice.
    assert "She went for a walk." in narrative
    assert "recorded events" not in narrative
    assert "—" not in narrative  # docs/frontend-DESIGN.md: no em dashes in user-facing copy

    stored = await db.events.find_one({"resident_id": resident, "type": "daily_summary"})
    assert stored is not None
    assert stored["payload"]["narrative"] == narrative


async def test_daily_narrative_uses_fake_llm_when_available(monkeypatch, resident, db):
    await emit(
        resident_id=resident, source="camera", type="walk_completed",
        embedding_text="Eleanor walked the hallway three times today.",
        ts=datetime(2026, 9, 2, 10, 0, tzinfo=ZoneInfo("America/New_York")),
    )

    async def fake_complete(system, user, max_tokens=600):
        return "Eleanor had a quiet day and walked more than usual."

    monkeypatch.setattr(rag.llm, "complete", fake_complete)

    narrative = await rag.daily_narrative(resident, "2026-09-02")
    assert narrative == "Eleanor had a quiet day and walked more than usual."

    stored = await db.events.find_one({
        "resident_id": resident, "type": "daily_summary", "payload.date_local": "2026-09-02",
    })
    assert stored["payload"]["narrative"] == narrative


# ---------------------------------------------------------------------------
# rag.answer
# ---------------------------------------------------------------------------

async def test_answer_refuses_medical_question_without_calling_llm(monkeypatch, resident, db):
    called = {"hit": False}

    async def fake_complete(system, user, max_tokens=600):
        called["hit"] = True
        return "should never get here"

    monkeypatch.setattr(rag.llm, "complete", fake_complete)

    result = await rag.answer(resident, "Does she have dementia or a UTI?")
    assert called["hit"] is False
    assert result["citations"] == []
    assert result["retrieved_count"] == 0
    assert "doctor" in result["answer"].lower() or "care team" in result["answer"].lower()


async def test_answer_shape_in_template_mode(resident, db):
    await rag.daily_narrative(resident, "2026-09-03")
    result = await rag.answer(resident, "how has she been this week")
    assert set(result) == {"answer", "citations", "retrieved_count"}
    assert isinstance(result["answer"], str)
    assert isinstance(result["citations"], list)
    assert isinstance(result["retrieved_count"], int)


async def test_answer_shape_with_fake_llm(monkeypatch, resident, db):
    await rag.daily_narrative(resident, "2026-09-04")

    async def fake_complete(system, user, max_tokens=600):
        return "She had a normal day [evt_fake]."

    monkeypatch.setattr(rag.llm, "complete", fake_complete)

    result = await rag.answer(resident, "how has she been this week")
    assert set(result) == {"answer", "citations", "retrieved_count"}
    assert result["answer"] == "She had a normal day [evt_fake]."
    assert isinstance(result["citations"], list)
    assert isinstance(result["retrieved_count"], int)


# ---------------------------------------------------------------------------
# summaries.alert_digest
# ---------------------------------------------------------------------------

async def test_alert_digest_template_mode_names_resident_and_kind(resident, db):
    alert = await alerts.open_alert(resident, "evt_fake1", kind="fall", severity="critical")

    digest = await summaries.alert_digest(alert["_id"])
    assert "Eleanor" in digest
    assert "fall" in digest.lower()


async def test_alert_digest_with_fake_llm_names_resident_and_kind(monkeypatch, resident, db):
    alert = await alerts.open_alert(resident, "evt_fake2", kind="fall", severity="critical")

    async def fake_complete(system, user, max_tokens=600):
        return "Eleanor, room 214 — possible fall reported a moment ago."

    monkeypatch.setattr(summaries.llm, "complete", fake_complete)

    digest = await summaries.alert_digest(alert["_id"])
    assert digest == "Eleanor, room 214 — possible fall reported a moment ago."
    assert "Eleanor" in digest
    assert "fall" in digest.lower()


async def test_alert_digest_unknown_alert_does_not_raise(db):
    digest = await summaries.alert_digest("alt_does_not_exist")
    assert digest == "Unknown alert."
