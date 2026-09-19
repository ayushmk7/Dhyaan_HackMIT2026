"""Tests for the RAG layer, app/rag.py. No ANTHROPIC_API_KEY is set in the test
environment (see conftest.py) -- these tests exercise the offline fallback
path exclusively, on purpose: the demo must work with no network."""

from app import rag
from app.config import ANTHROPIC_API_KEY
from app.events import emit


def test_no_api_key_in_test_env():
    # Sanity check that we are actually exercising the offline path.
    assert not ANTHROPIC_API_KEY


async def test_embed_is_deterministic_offline():
    v1 = await rag.embed(["Eleanor walked the hallway twice this morning."])
    v2 = await rag.embed(["Eleanor walked the hallway twice this morning."])
    assert v1 == v2
    assert len(v1[0]) == rag.EMBED_DIM
    # different text -> (almost certainly) a different vector
    v3 = await rag.embed(["Completely unrelated sentence about lunch."])
    assert v3 != v1


async def test_embed_requires_no_network_or_key(monkeypatch):
    # Even if a key were set, embed() must not explode without network/anthropic.
    monkeypatch.setattr(rag, "ANTHROPIC_API_KEY", "fake-key-not-real")
    vecs = await rag.embed(["hello"])
    assert isinstance(vecs[0], list)
    assert len(vecs[0]) == rag.EMBED_DIM


async def test_search_ranks_matching_narrative_first(resident, db):
    # Query shares real tokens with the walking narrative (walked/hallway/three/
    # times) and none with the unrelated one -- the hash embedding only carries
    # token-overlap signal, so this is what "obviously matching" means for it.
    walking_evt = await emit(
        resident_id=resident, source="derived", type="daily_summary",
        embedding_text="Eleanor walked the hallway three times today, more than usual.",
        payload={"narrative": "Eleanor walked the hallway three times today, more than usual."},
    )
    await emit(
        resident_id=resident, source="derived", type="daily_summary",
        embedding_text="Eleanor ate breakfast and lunch on schedule with no other events.",
        payload={"narrative": "Eleanor ate breakfast and lunch on schedule with no other events."},
    )

    results = await rag.search(resident, "walked hallway three times", k=5)
    assert results, "expected at least one hit"
    assert results[0]["event_id"] == walking_evt["_id"]


async def test_answer_citations_point_to_real_events(resident, db):
    narrative = await rag.daily_narrative(resident, "2026-09-01")
    assert narrative

    result = await rag.answer(resident, "how has she been this week")
    assert result["retrieved_count"] >= 1
    assert result["citations"]
    ids_in_db = {
        d["_id"] async for d in db.events.find({"resident_id": resident}, {"_id": 1})
    }
    for c in result["citations"]:
        assert c["event_id"] in ids_in_db
        assert "ts" in c and "text" in c


async def test_medical_question_is_refused(resident, db):
    result = await rag.answer(resident, "Does she have dementia or a UTI?")
    assert result["citations"] == []
    assert result["retrieved_count"] == 0
    assert "doctor" in result["answer"].lower() or "care team" in result["answer"].lower()


async def test_answer_no_data_says_so(resident, db):
    result = await rag.answer(resident, "has she been out for a walk")
    assert result["answer"] == "I don't have data for that."
    assert result["retrieved_count"] == 0
