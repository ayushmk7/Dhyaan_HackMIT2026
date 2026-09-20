"""The surveillance guard and the three-source retrieval fusion. VLM_PLAN §5.5, §6.5.

The load-bearing assertion in this file is `called["hit"] is False`: a refusal
that first retrieves the data, or first asks a model about it, has already done
the thing it is refusing to do.
"""

import pytest
import pytest_asyncio

from app import rag
from app.events import emit


@pytest.fixture
def no_llm(monkeypatch):
    """Fail loudly if anything reaches a model. Both paths: OpenAI (app/llm.py)
    and the local Ollama fallback."""
    called = {"hit": False}

    async def fake_complete(system, user, max_tokens=600):
        called["hit"] = True
        return "should never get here"

    async def fake_ollama(*a, **kw):
        called["hit"] = True
        return "should never get here"

    monkeypatch.setattr(rag.llm, "complete", fake_complete)
    monkeypatch.setattr(rag, "_ollama_answer", fake_ollama)
    return called


@pytest.fixture
def no_retrieval(monkeypatch):
    called = {"hit": False}

    async def fake_search(*a, **kw):
        called["hit"] = True
        return []

    monkeypatch.setattr(rag, "search", fake_search)
    return called


# ---------------------------------------------------------------------------
# Hard refusals. Every category, and none of them touches the data.
# ---------------------------------------------------------------------------

HARD = [
    ("speech", "What did she say to her visitor?"),
    ("speech", "What were they talking about yesterday?"),
    ("speech", "Can you hear what is going on in the room?"),
    ("private_room", "Has she been in the bathroom a lot today?"),
    ("private_room", "Is she in the bedroom?"),
    ("private_room", "Did she get out of bed yet?"),
    ("private_room", "Is she still in her pyjamas?"),
    ("imagery", "Show me the camera."),
    ("imagery", "Can I see a picture of her?"),
    ("imagery", "Send me the video footage from this morning."),
    ("imagery", "I want to watch her for a minute."),
    ("appearance", "What is she wearing today?"),
    ("appearance", "What does she look like now?"),
    ("appearance", "Has her weight changed?"),
    ("live_location", "Which room is she in?"),
    ("live_location", "Where is she?"),
    ("live_location", "Where in the house is she at the moment?"),
]


@pytest.mark.parametrize("sub,question", HARD, ids=[f"{s}:{q[:24]}" for s, q in HARD])
async def test_hard_refusal_without_llm_or_retrieval(resident, db, no_llm, no_retrieval,
                                                     sub, question):
    result = await rag.answer_family(resident, question)
    assert result["refused"] is True
    assert result["refusal_kind"] == "surveillance"
    assert result["citations"] == []
    assert result["retrieved_count"] == 0
    assert no_llm["hit"] is False, "a model saw a question we refuse to answer"
    assert no_retrieval["hit"] is False, "we retrieved data we refuse to answer from"
    assert rag.REFUSALS[sub] in result["answer"]


async def test_medical_still_refuses_first_and_hardest(resident, db, no_llm, no_retrieval):
    result = await rag.answer_family(resident, "Does she have dementia or a UTI?")
    assert result["refused"] is True and result["refusal_kind"] == "medical"
    assert no_llm["hit"] is False and no_retrieval["hit"] is False


async def test_refusing_the_speech_question_still_offers_the_useful_half(resident, db, no_llm):
    """§1: 'someone visited Tuesday for about 40 minutes' is allowed; what they
    discussed is not. The refusal says so rather than stonewalling."""
    result = await rag.answer_family(resident, "What did she say to her visitor?")
    assert "never listens" in result["answer"]
    assert "how long" in result["answer"]


# ---------------------------------------------------------------------------
# The useful half still answers.
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def history(db, resident):
    """One of each kind: a fact (told), camera observations (observed), a daily
    narrative (pattern)."""
    from app import memory

    await db.residents.update_one({"_id": "res_eleanor"}, {"$set": {"consent_memory": 1}})
    await memory.add_facts("res_eleanor", [
        {"key": "breakfast", "text": "Eleanor usually has toast and tea for breakfast at about 8."},
        {"key": "visitors", "text": "Her neighbour Cheryl comes on Tuesdays, usually for an hour."},
    ], "Priya Sharma")
    await emit(resident_id="res_eleanor", source="camera", type="meal_observed",
               embedding_text="Eleanor ate breakfast at the table, 10:40-11:02.",
               payload={"meal": "breakfast"})
    await emit(resident_id="res_eleanor", source="camera", type="visitor_present",
               embedding_text="Eleanor had a visitor, 2:00 pm-2:41 pm.",
               payload={"n_people": 2})
    await emit(resident_id="res_eleanor", source="derived", type="daily_summary",
               embedding_text="Eleanor usually eats breakfast and walks three times.",
               payload={"narrative": "Eleanor usually eats breakfast and walks three times."})
    # Staff-only telemetry that must never be citable by the family.
    await emit(resident_id="res_eleanor", source="band", type="zone_entered",
               zone="bathroom", embedding_text="Eleanor moved into the bathroom.")
    await emit(resident_id="res_eleanor", source="band", type="bathroom_prolonged",
               zone="bathroom", embedding_text="Eleanor was in the bathroom for 25 minutes.")
    await rag.drain_embeddings()
    return "res_eleanor"


async def test_a_useful_visitor_question_still_answers(history, db):
    result = await rag.answer_family(history, "Did someone visit her this week?")
    assert result["refused"] is False
    assert result["retrieved_count"] > 0
    assert "only notes that someone visited" in result["answer"]
    # Restricted to the visitor lane plus the visitors fact — nothing else.
    texts = " ".join(c["text"] for c in result["citations"]).lower()
    assert "visitor" in texts or "cheryl" in texts


async def test_sleep_questions_are_not_a_private_room_refusal(history, db):
    result = await rag.answer_family(history, "How were her nights this week?")
    assert result["refused"] is False


# ---------------------------------------------------------------------------
# Three sources, one pool, each citation labelled.
# ---------------------------------------------------------------------------

async def test_retrieval_returns_all_three_kinds_with_correct_labels(history, db):
    result = await rag.answer_family(history, "has she eaten breakfast today")
    kinds = {c["kind"] for c in result["citations"]}
    assert kinds == {"told", "observed", "pattern"}, result["citations"]

    told = [c for c in result["citations"] if c["kind"] == "told"]
    observed = [c for c in result["citations"] if c["kind"] == "observed"]
    pattern = [c for c in result["citations"] if c["kind"] == "pattern"]
    assert any("toast and tea" in c["text"] for c in told)
    assert any(c["id"].startswith("fact_") for c in told)
    assert any("10:40" in c["text"] for c in observed)
    assert any("usually" in c["text"] for c in pattern)


async def test_the_kind_quota_is_enforced(history, db):
    """Up to 4 observed, 2 told, 2 pattern — a dozen meal rows must not crowd
    out the one fact that says what breakfast is supposed to look like."""
    for i in range(12):
        await emit(resident_id="res_eleanor", source="camera", type="meal_observed",
                   embedding_text=f"Eleanor ate breakfast at the table, day {i}.",
                   payload={"meal": "breakfast"})
    await rag.drain_embeddings()

    hits = await rag.search("res_eleanor", "breakfast", k=8, family=True,
                            include_facts=True, quota=True)
    counts = {k: sum(1 for h in hits if h["kind"] == k) for k in ("observed", "told", "pattern")}
    assert counts["told"] >= 1, hits
    assert counts["observed"] <= 6  # 4 by quota, backfilled only if the others are short


async def test_excluded_types_are_never_in_the_pool(history, db):
    """The real control is the pool, not the prompt: a chunk that is not
    retrieved cannot be cited."""
    hits = await rag.search("res_eleanor", "bathroom toilet how long", k=20,
                            family=True, include_facts=True)
    assert all(h["type"] not in rag.FAMILY_EXCLUDED_TYPES for h in hits)
    assert not any("bathroom" in h["text"].lower() for h in hits)


async def test_room_names_are_scrubbed_out_of_the_answer_and_citations(resident, db, no_llm):
    await emit(resident_id="res_eleanor", source="camera", type="meal_observed",
               embedding_text="Eleanor ate lunch in the kitchen at 12:30.",
               payload={"meal": "lunch"})
    await rag.drain_embeddings()
    result = await rag.answer_family("res_eleanor", "has she eaten lunch")
    blob = (result["answer"] + " ".join(c["text"] for c in result["citations"])).lower()
    for word in ("kitchen", "bedroom", "bathroom", "living room", "hallway"):
        assert word not in blob
    assert "at home" in blob


def test_scrub_rooms_reads_naturally():
    assert rag.scrub_rooms("Eleanor ate lunch in the kitchen.") == "Eleanor ate lunch at home."
    assert rag.scrub_rooms("She moved into the living room.") == "She moved at home."
    assert rag.scrub_rooms("Eleanor ate lunch at the table.") == "Eleanor ate lunch at the table."


def test_time_window_parsing():
    from zoneinfo import ZoneInfo

    tz = ZoneInfo("America/New_York")
    assert rag.time_window("has she eaten today", tz)[0] is not None
    assert rag.time_window("what did she do yesterday", tz)[1] is not None
    assert rag.time_window("how were her nights this week", tz)[0] is not None
    # A timeless question gets no window at all — facts have no date.
    assert rag.time_window("what does she usually have for breakfast", tz) == (None, None)


# ---------------------------------------------------------------------------
# The route carries the extended shape
# ---------------------------------------------------------------------------

async def test_chat_route_returns_refused_and_kinds(client, history):
    r = await client.post("/v1/residents/res_eleanor/chat",
                          json={"question": "Show me the camera."})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["refused"] is True and body["refusal_kind"] == "surveillance"
    assert body["citations"] == []

    r = await client.post("/v1/residents/res_eleanor/chat",
                          json={"question": "has she eaten breakfast today"})
    body = r.json()
    assert body["refused"] is False
    assert all(set(c) >= {"id", "kind", "ts", "text"} for c in body["citations"])


async def test_family_retrieval_never_cites_the_machinery(db, resident):
    """Chat quotes what it retrieves, so anything retrievable is something the
    family reads. The escalation ladder and the voice bridge write their
    `embedding_text` for a log file, not for a daughter."""
    from app import rag
    from app.events import emit

    noise = {
        "call_placed": "[SIMULATED CALL - no telephony wired up] Called contact_final +15551230000",
        "escalation_started": "Alert alt_01M2Y: SUSPECTED -> LOCAL_CANCEL (window_open)",
        "voice_response_classified": "Voice classified: no_answer",
        "feedback_given": "Feedback on meal_observed: expected",
        "memory_deleted": "Deleted 12 profile facts",
        "profile_updated": "Profile updated: appearance",
    }
    for etype, text in noise.items():
        await emit(resident_id=resident, source="derived", type=etype,
                   embedding_text=text, payload={})
    # One real observation, so the pool is not empty and a miss is meaningful.
    await emit(resident_id=resident, source="camera", type="meal_observed",
               embedding_text="Eleanor ate lunch at the table.", payload={})
    await rag.drain_embeddings()

    hits = await rag.search(resident, "what happened today", k=20, family=True)
    types = {h.get("type") for h in hits}
    assert types.isdisjoint(noise), f"machine log types reached family retrieval: {types & set(noise)}"
    assert any("ate lunch" in h["text"] for h in hits), "the real observation was lost too"
