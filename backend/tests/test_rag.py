"""Tests for the RAG layer, app/rag.py. No OPENAI_API_KEY is set in the test
environment (see conftest.py) -- these tests exercise the offline fallback
path exclusively, on purpose: the demo must work with no network."""

from app import rag
from app.config import OPENAI_API_KEY
from app.events import emit


def test_no_api_key_in_test_env():
    # Sanity check that we are actually exercising the offline path.
    assert not OPENAI_API_KEY


async def test_embed_is_stable_and_consistently_shaped():
    """Same text -> same vector, and every vector in a corpus is the same width.

    Width is the model's, not ours (nomic-embed-text is 768, the hash fallback
    256), so asserting a constant here would just re-break when the model
    changes. What matters is that one corpus is internally consistent.
    """
    v1 = await rag.embed(["Eleanor walked the hallway twice this morning."])
    v2 = await rag.embed(["Eleanor walked the hallway twice this morning."])
    assert v1 == v2
    v3 = await rag.embed(["Completely unrelated sentence about lunch."])
    assert v3 != v1
    assert len(v3[0]) == len(v1[0])


async def test_embed_falls_back_when_embedder_is_down(monkeypatch):
    """The demo must survive ollama not running. Point it at a dead port."""
    monkeypatch.setattr(rag, "OLLAMA_URL", "http://127.0.0.1:9")
    monkeypatch.setattr(rag, "EMBED_TIMEOUT_S", 0.3)
    vecs = await rag.embed(["hello"])
    assert isinstance(vecs[0], list)
    assert len(vecs[0]) == rag.EMBED_DIM      # fell back to the hash embedder


async def test_cosine_skips_mismatched_widths():
    """A corpus half-embedded by each backend must not raise or rank nonsense."""
    assert rag._cosine([0.1] * 768, [0.1] * 256) == -1.0
    assert rag._cosine([1.0, 0.0], [1.0, 0.0]) == 1.0


async def test_embed_batches_in_one_call():
    vecs = await rag.embed(["first text", "second text", "third text"])
    assert len(vecs) == 3
    assert len({len(v) for v in vecs}) == 1


async def test_search_ranks_matching_narrative_first(resident, db):
    # Embedding is a background task now (it is off the ingest critical path),
    # so a test that queries immediately has to wait for it.
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

    await rag.drain_embeddings()
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


async def test_a_daily_summary_is_embedded_on_its_whole_narrative(resident, db):
    """A day's vector has to be the vector of the text retrieval hands back.

    daily_narrative() embeds the full narrative itself, and the events.subscribe
    hook used to embed the 400-char embedding_text over the top of it in the
    background: whichever update_one landed second won, so a day's chunk was the
    whole story or its first two sentences depending on the network, and the
    same question could answer differently on two runs. Both paths now embed the
    same text, so the order stopped mattering. This drives the hook alone, which
    is the half that used to be wrong."""
    narrative = ("Eleanor was up early and had toast and tea at the table. " * 12
                 + "Late in the afternoon she potted geraniums on the balcony.")
    assert len(narrative) > 400, "the race only shows up past emit()'s truncation"

    await emit(resident_id=resident, source="derived", type="daily_summary",
               embedding_text=narrative[:400], payload={"narrative": narrative})
    await rag.drain_embeddings()

    doc = await db.events.find_one({"resident_id": resident, "type": "daily_summary"})
    assert doc["embedding"] == (await rag.embed([narrative]))[0]
    assert doc["embedding"] != (await rag.embed([narrative[:400]]))[0]
    # ...and the geraniums are findable, which is the whole point of the chunk.
    hits = await rag.search(resident, "geraniums balcony afternoon", k=5)
    assert hits and hits[0]["event_id"] == doc["_id"]


async def test_medical_question_is_refused(resident, db):
    result = await rag.answer(resident, "Does she have dementia or a UTI?")
    assert result["citations"] == []
    assert result["retrieved_count"] == 0
    assert "doctor" in result["answer"].lower() or "care team" in result["answer"].lower()


async def test_answer_no_data_says_so(resident, db):
    result = await rag.answer(resident, "has she been out for a walk")
    assert result["answer"] == "I don't have data for that."
    assert result["retrieved_count"] == 0


def test_template_answer_never_leaks_event_ids():
    """The app renders `answer` verbatim in a chat bubble, so anything in this
    string is something a family reads. Ids belong in `citations`, which the
    citation chips are built from — not in the prose."""
    from app.rag import _template_answer

    hits = [
        {"id": "evt_01M2YCJPFNDAH17JN659HT272R", "kind": "observed",
         "text": "Eleanor was up and moving about, 11:08 pm."},
        {"id": "fact_0007", "kind": "told", "text": "She usually has toast at 8."},
    ]
    text = _template_answer(hits)
    assert "evt_" not in text
    assert "fact_" not in text
    assert "[" not in text and "]" not in text
    # ...and it still carries both sentences, labelled by kind.
    assert "up and moving about" in text
    assert "toast" in text
