"""RAG layer. TECHNICAL_PRD §9.

ponytail: no vector database, no LangChain, no embedding framework. Embeddings
are a plain list[float] stored on the event doc; retrieval is brute-force
cosine in numpy plus a regex keyword pass, merged with reciprocal rank fusion
(four lines, per PRD §9.5 — not worth a dependency). Ceiling: this is a full
table scan per query, fine to maybe ~50k events on a laptop. Upgrade: Mongo
Atlas Vector Search ($vectorSearch) once the corpus outgrows a scan, exactly
as the comment in app/db.py already anticipates.

Embeddings are LLM-written daily narratives, not raw event rows (§9.1) —
the narrative is the RAG chunk. Raw event embedding_text is also indexed (via
events.subscribe, so app/events.py needs no changes) for precise "when did X
happen" lookups.
"""

import asyncio
import hashlib
import logging
import os
import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
import numpy as np

from . import llm
from .db import db
from .events import emit, subscribe

log = logging.getLogger("dhyaan.rag")

# Local embedder. `ollama serve` + `ollama pull nomic-embed-text`, then it is
# offline forever. Dim is the model's, not ours — nomic-embed-text is 768.
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text")
EMBED_TIMEOUT_S = float(os.getenv("EMBED_TIMEOUT_S", "20"))

# Fallback width only. Cosine is computed within one corpus at a time, and a
# corpus embedded by a mix of the two would be nonsense — see _vec_ok().
EMBED_DIM = 256

_EMBED_WARNED = False


def _warn_embedder_down(e: Exception) -> None:
    global _EMBED_WARNED
    _EMBED_WARNED = True
    log.warning(
        "embedder unreachable at %s (%s) — falling back to hash embeddings. "
        "Retrieval ranking will be keyword-quality only. Fix: `ollama serve` "
        "and `ollama pull %s`.", OLLAMA_URL, e, EMBED_MODEL,
    )

# High-cardinality telemetry, never indexed — PRD §9.1: it would drown the index
# and nobody asks "how has she been" about band_still ticks.
NOISY_EVENT_TYPES = {"person_present", "band_motion_high", "band_still",
                     "camera_online", "camera_offline", "camera_paused"}

MEDICAL_PATTERN = re.compile(
    r"\b(diagnos\w*|medicat\w*|disease|prescri\w*|symptoms?|dosage|treatment|"
    r"cancer|dementia|alzheimer'?s?|infection|\buti\b|tumou?r|stroke|"
    r"health\s*condition|see a doctor|what'?s wrong with|is (she|he) sick)\b",
    re.I,
)


def _hash_embed(text: str, dim: int = EMBED_DIM) -> list[float]:
    """Deterministic hash-based pseudo-embedding. No network, no model weights."""
    vec = np.zeros(dim, dtype=np.float64)
    for tok in re.findall(r"[a-z0-9]+", (text or "").lower()):
        h = int(hashlib.sha256(tok.encode()).hexdigest(), 16)
        vec[h % dim] += 1.0 if (h // dim) % 2 == 0 else -1.0
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.tolist()


async def embed(texts: list[str]) -> list[list[float]]:
    """Real semantic embeddings from Ollama, hash fallback when it is not there.

    `nomic-embed-text` (768d) runs locally with no API key and no internet once
    pulled, so the demo still works on venue wifi. The hash fallback keeps tests
    and a bare clone running — but it has no semantic meaning, so retrieval
    ranking is only as good as keyword overlap. If `search()` ranks badly, check
    `ollama serve` is up before blaming the retriever.

        ollama serve &
        ollama pull nomic-embed-text

    ponytail: one HTTP call against an already-present dep (httpx). No
    sentence-transformers, no torch, no vector DB.
    """
    if not texts:
        return []
    try:
        async with httpx.AsyncClient(timeout=EMBED_TIMEOUT_S) as c:
            r = await c.post(f"{OLLAMA_URL}/api/embed",
                             json={"model": EMBED_MODEL, "input": texts})
            r.raise_for_status()
            vecs = r.json()["embeddings"]
        if len(vecs) != len(texts):
            raise ValueError(f"asked for {len(texts)} embeddings, got {len(vecs)}")
        return vecs
    except Exception as e:  # noqa: BLE001
        # Never fail a write or a query because the embedder is down.
        if not _EMBED_WARNED:
            _warn_embedder_down(e)
        return [_hash_embed(t) for t in texts]


async def _embed_and_store(doc_id: str, text: str) -> None:
    try:
        vec = (await embed([text]))[0]
        await db().events.update_one({"_id": doc_id}, {"$set": {"embedding": vec}})
    except Exception as e:  # noqa: BLE001
        log.warning("embedding %s failed: %s", doc_id, e)


# Hold references: asyncio only keeps a weak reference to a running task, so a
# task nobody holds can be garbage-collected mid-flight.
_embed_tasks: set = set()


def _on_event_created(doc):
    """events.subscribe hook: embed embedding_text in the background (§9.1/§9.2).

    Deliberately NOT awaited. emit() awaits its subscribers, and embedding is an
    HTTP round-trip to the embedder — awaiting it would put ~100ms of network on
    the fall-ingest critical path, between the band POST and the alert opening.
    The embedding is for retrieval, which is eventually consistent by nature, so
    it rides a background task instead.

    ponytail: a task per event is fine at this rate (tens per minute). If the
    camera lane ever floods this, batch on a queue with a 1s window.
    """
    if doc["type"] in NOISY_EVENT_TYPES:
        return
    # A daily_summary's chunk is the full narrative in `payload`, not the
    # 400-char embedding_text the event carries for display. daily_narrative()
    # embeds it that way itself the moment emit() returns, and search() reads
    # payload.narrative back as the hit text — but this hook was embedding the
    # truncation, so the two writes raced and whichever landed second won. A
    # day's vector was the whole story or its first two sentences depending on
    # the network. Embedding the same text on both paths ends the race without
    # leaving a summary emitted from anywhere else unembedded and unfindable.
    text = (doc.get("payload") or {}).get("narrative") or doc.get("embedding_text") or ""
    t = asyncio.create_task(_embed_and_store(doc["_id"], text))
    _embed_tasks.add(t)
    t.add_done_callback(_embed_tasks.discard)


subscribe(_on_event_created)


async def drain_embeddings() -> None:
    """Wait for in-flight embedding tasks. For tests and scripted rollups that
    query immediately after writing."""
    while _embed_tasks:
        await asyncio.gather(*list(_embed_tasks), return_exceptions=True)


def _day_range_utc(tz: ZoneInfo, date_local: str) -> tuple[int, int]:
    d = date.fromisoformat(date_local)
    start_local = datetime(d.year, d.month, d.day, tzinfo=tz)
    end_local = start_local + timedelta(days=1)
    return int(start_local.astimezone(timezone.utc).timestamp()), int(end_local.astimezone(timezone.utc).timestamp())


def _template_narrative(name: str, date_local: str, docs: list[dict]) -> str:
    """The day in plain sentences, for when there is no OpenAI key.

    This is what the family reads on Her day, so it is written to be read, not
    logged: no leading date stamp, no "had 33 recorded events", no "bed exit(s)"
    or "3 meal(s)", and no em dashes (docs/frontend-DESIGN.md bans them in user-facing copy).
    It also still has to work as a retrieval chunk, which is why meals are named
    rather than counted: "she ate breakfast and dinner" is something a semantic
    search for "has she been eating" can actually match, and "3 meals observed"
    is the same sentence fifteen days running.
    """
    if not docs:
        return (f"Nothing was recorded for {name} on this day. "
                "That is more likely a gap in what Dhyaan could see than a quiet day.")

    def _join(words: list[str]) -> str:
        if len(words) <= 1:
            return "".join(words)
        return f"{', '.join(words[:-1])} and {words[-1]}"

    by_type: dict[str, list[dict]] = {}
    for d in docs:
        by_type.setdefault(d["type"], []).append(d)

    parts: list[str] = []

    if "meal_observed" in by_type:
        meals = [m for m in ("breakfast", "lunch", "dinner")
                 if any((d.get("payload") or {}).get("meal") == m for d in by_type["meal_observed"])]
        if meals:
            parts.append(f"{name} ate {_join(meals)}.")
            missed = [m for m in ("breakfast", "lunch", "dinner") if m not in meals]
            if missed:
                parts.append(f"Dhyaan did not see her have {_join(missed)}.")
        else:
            n = len(by_type["meal_observed"])
            parts.append(f"{name} ate {n} time{'' if n == 1 else 's'}.")
    else:
        parts.append(f"Dhyaan did not see {name} eat today. "
                     "That may be a gap in what it could see rather than a missed meal.")

    walks = len(by_type.get("walk_completed", []))
    if walks:
        parts.append(f"She went for {'a walk' if walks == 1 else f'{walks} walks'}.")
    else:
        parts.append("She did not go for a walk.")

    night = sum(
        1 for d in by_type.get("bed_exit", [])
        if 0 <= datetime.fromtimestamp(d["ts_epoch"], tz=timezone.utc).hour < 5
    )
    if night:
        parts.append(f"She was up {'once' if night == 1 else f'{night} times'} in the night.")

    if "fall_suspected" in by_type or "fall_confirmed" in by_type:
        parts.append("Her band flagged a possible fall during the day.")
    if "visitor_present" in by_type:
        parts.append("Someone came to see her.")
    return " ".join(parts)[:1000]


async def _baseline_context(resident_id: str) -> str:
    """One line per learned feature baseline (app/baseline.py, §8), so the
    narrative prompt can say "she normally walks three times" instead of just
    reciting today's raw count. Cold-start residents (no baselines yet) get an
    empty string, which the prompt treats as "no baseline available"."""
    rows = await db().baselines.find({"resident_id": resident_id}).to_list(length=50)
    lines = []
    for r in rows:
        feature = r["feature"].replace("_", " ")
        if r.get("cold_start"):
            continue  # too little history to call it "usual" yet
        if r.get("lam") is not None:
            lines.append(f"- usual {feature}: about {r['lam']:.1f} per day")
        elif r.get("mu") is not None:
            lines.append(f"- usual {feature}: about {r['mu']:.0f}")
    return "\n".join(lines)


_NARRATIVE_SYSTEM = (
    "You write a short daily check-in for the worried adult child of an older "
    "relative who lives independently and is monitored by in-home sensors. "
    "Write 2 to 4 plain, warm sentences covering: what she did today, and "
    "anything that was different from her normal routine (use the baseline "
    "numbers given, e.g. 'she normally walks three times a day'). Mention "
    "notable absences (no dinner recorded, no walk recorded) as observations, "
    "not conclusions. Never diagnose, interpret, speculate about health, or "
    "use alarming language — describe only what the sensors observed. No "
    "preamble, no bullet points, just the sentences."
)


async def daily_narrative(resident_id: str, date_local: str) -> str:
    """Summarize one resident-day into the RAG chunk that carries recall (§9.1).

    Stored as a daily_summary event. embedding_text is capped at 400 chars by
    events.emit(), but the narrative usually isn't — so the full text lives in
    payload.narrative and is what gets embedded/searched; the truncated
    embedding_text is just the event's own display text.
    """
    resident_doc = await db().residents.find_one({"_id": resident_id}) or {}
    tz = ZoneInfo(resident_doc.get("timezone") or "UTC")
    start_epoch, end_epoch = _day_range_utc(tz, date_local)
    docs = await db().events.find({
        "resident_id": resident_id, "ts_epoch": {"$gte": start_epoch, "$lt": end_epoch},
    }).sort("ts_epoch", 1).to_list(length=2000)

    name = resident_doc.get("display_name", "The resident")

    narrative = None
    if docs:  # nothing to summarize and nothing to spend on — template covers the gap message
        baseline_ctx = await _baseline_context(resident_id)
        lines = "\n".join(f"- {d['ts']}: {d['embedding_text']}" for d in docs[:200])
        user = (
            f"Resident: {name}\nDate: {date_local}\n\n"
            f"Her usual patterns (baseline):\n{baseline_ctx or '(not enough history yet)'}\n\n"
            f"Today's observations:\n{lines}"
        )
        narrative = await llm.complete(_NARRATIVE_SYSTEM, user, max_tokens=400)
    if not narrative:
        narrative = _template_narrative(name, date_local, docs)  # no key, API hiccup, or empty day — same safe path

    # A story about the 12th belongs on the 12th. Left at emit()'s default this
    # took `now`, so a seed wrote fifteen narratives in one instant and the
    # family timeline — which sorts by ts — opened on fifteen near-identical
    # rows all stamped a few seconds ago. `/activity` already selects these by
    # `date_local` rather than by ts, for exactly this reason; this makes the
    # timestamp itself honest so both views agree.
    end_of_day = datetime.fromtimestamp(end_epoch, tz) - timedelta(seconds=1)
    event_doc = await emit(
        resident_id=resident_id, source="derived", type="daily_summary",
        embedding_text=narrative[:400],
        ts=min(end_of_day, datetime.now(tz)),
        payload={"narrative": narrative, "date_local": date_local},
    )
    vec = (await embed([narrative]))[0]
    await db().events.update_one({"_id": event_doc["_id"]}, {"$set": {"embedding": vec}})
    return narrative


def _cosine(a, b) -> float:
    a, b = np.asarray(a), np.asarray(b)
    # A corpus embedded partly by Ollama (768d) and partly by the hash fallback
    # (256d) is a real possibility: the embedder can go down mid-run. Comparing
    # across widths is meaningless, and np.dot would raise. Skip instead.
    if a.shape != b.shape:
        return -1.0
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    return float(np.dot(a, b) / denom) if denom else 0.0




# ---------------------------------------------------------------------------
# The family filter and the surveillance guard. VLM_PLAN §5.5.
#
# Order in answer_family(): medical -> hard surveillance -> soft surveillance,
# every one of them BEFORE any retrieval and before any LLM call. A refusal
# that first reads the data has already done the thing it is refusing to do.
# ---------------------------------------------------------------------------

# Staff-and-learner telemetry. A chunk that is not in the pool cannot be cited —
# this is the real control; the answer prompt is only the backstop (§5.5.4).
FAMILY_EXCLUDED_TYPES = {
    # Whereabouts. A family screen never names a room (D-001), and retrieval is
    # a family screen the moment an answer quotes what it found.
    "zone_entered", "zone_exited", "zone_dwell", "bathroom_prolonged",
    "location_unknown", "beacon_offline",
    # Sensor chatter, not events in her day.
    "unsteady_gait", "band_motion_high", "band_still",
    "camera_online", "camera_offline", "camera_paused",
    # The machinery talking to itself. These carry `embedding_text` written for
    # a log — "[SIMULATED CALL - no telephony wired up] Called contact_final",
    # "Alert alt_01M2Y...: LOCAL_CANCEL -> CALLING_RESIDENT (cancel_timeout)" —
    # and chat was retrieving them and citing them to the family as "Dhyaan
    # saw". What the ladder did belongs on the alert screen, which reads the
    # alert document directly; it is not something she did with her day.
    "call_placed", "call_answered", "call_no_answer", "voice_response_classified",
    "escalation_started", "escalation_acknowledged", "escalation_exhausted",
    "fall_autocancelled",  # the camera guard's audit row (app/fallcheck.py)
    # Bookkeeping about the app itself.
    "feedback_given", "profile_updated", "memory_deleted",
}

PATTERN_TYPES = {"daily_summary", "baseline_deviation", "baseline_updated"}

_SPEECH = re.compile(
    r"\b(say|says|said|saying|talk|talked|talking|conversation|convo|discuss\w*|"
    r"hear|heard|hearing|audio|listen\w*|overheard|chat(?:ted|ting)? about)\b", re.I)
_PRIVATE_ROOM = re.compile(
    r"\b(bathroom|toilet|loo|shower|bedroom|bed|undress\w*|naked|pyjamas?|pajamas?)\b", re.I)
# "see her" on its own is not a request to look at her. "Has anyone come to see
# her?" is the exact question the visitor_present lane exists to answer, and it
# was earning a surveillance refusal. `watch` and `look at` still refuse bare,
# because there is no innocent reading of "can I watch her"; `see` needs a
# live-viewing word after it ("see her now", "see her live", "see her on the
# camera") before it counts as one.
_IMAGERY = re.compile(
    r"\b(photo|photograph|picture|image|video|footage|screenshot|webcam)\b|"
    r"camera\s*(feed|footage|view|stream)|live\s*camera|\bshow me\b|"
    r"\b(watch|look at)\s+(her|him|them|mum|mom|eleanor)\b|"
    r"\bsee\s+(her|him|them|mum|mom|eleanor)\s+(right\s+)?(now|live|on (the )?camera)\b", re.I)
_APPEARANCE = re.compile(
    r"\bwearing\b|\bwear(s|ing)?\s+(today|now)\b|\b(outfit|clothes|clothing)\b|"
    r"\b(she|he|they|her|him|them)\s+look(s|ed|ing)?\s+like\b|"
    r"\bwhat (does|do) (she|he|they) look like\b|\bhow (does|do) (she|he|they) look\b|"
    r"\b(her|his) (hair|weight|face|body)\b|\b(thin|skinny|fat|overweight)\b", re.I)
_LIVE_LOCATION = re.compile(
    r"\bwhich room\b|\bwhat room\b|\bwhere (is|'s|are) (she|he|they)\b|"
    r"\bwhere in the (house|home|flat|apartment)\b|\bwhere exactly\b|\bwhereabouts\b", re.I)

# Sleep and night questions with no room word in them are NOT a hard refusal —
# they route to the existing bed_exit / night_activity lanes (§5.5.2).
_SLEEP_OK = re.compile(r"\b(sleep|slept|sleeping|night|nights|overnight|rest(ed)?)\b", re.I)

# The imagery/appearance line used to end "there is no video to show — not to you,
# not to anyone". That stopped being true when the hub started relaying its
# annotated frame to the camera screen (routers/camera.py:299,313): there is a
# live view, and a refusal that denies something the family can see one tab over
# reads as a lie about everything else in the answer. What is still true, and is
# the whole point, is that nothing is recorded: the picture on that screen is
# replaced by the next one and the last one is gone, so there is no footage for
# anyone to hand over, and chat still neither holds nor describes it.
REFUSALS = {
    "appearance": (
        "Dhyaan doesn't keep or describe what she looks like, and nothing is recorded, "
        "so there is no footage to send you or anyone else. The live view on her camera "
        "screen is the only picture there is, and the next one replaces it. "
        "I can tell you what she's been doing."),
    "imagery": (
        "Dhyaan doesn't keep or describe what she looks like, and nothing is recorded, "
        "so there is no footage to send you or anyone else. The live view on her camera "
        "screen is the only picture there is, and the next one replaces it. "
        "I can tell you what she's been doing."),
    "speech": (
        "Dhyaan never listens, so there is nothing she said that I could tell you."),
    "private_room": (
        "Bedrooms and bathrooms are outside what Dhyaan notices, by design."),
    "live_location": (
        "I don't say where she is in the house. I can tell you she's at home and what "
        "she's been up to."),
}

# The useful half we keep offering after a hard refusal, per §1: "someone
# visited Tuesday for about 40 minutes" is allowed, what they discussed is not.
_VISITOR_OFFER = " I can tell you that someone visited and roughly how long for, if you ask."

_VISITOR_SOFT = re.compile(
    r"\b(visitor|visitors|visit|visited|visiting|who came|who was (there|here|over)|"
    r"guest|guests|company over)\b", re.I)
_WHEREABOUTS_SOFT = re.compile(
    r"\b(where|out|outside|went out|going out|left the house|left home|"
    r"out of the house|walk|walked|walking|errand)\b", re.I)

SOFT_PREFIX = {
    "visitor": ("Dhyaan only notes that someone visited, and for how long — never who "
                "or what was said."),
    "whereabouts": ("Dhyaan can only say whether she's at home or out of view — never "
                    "where in the house."),
}
SOFT_TYPES = {
    "visitor": ["visitor_present"],
    "whereabouts": ["room_exit", "room_entry", "left_home", "returned_home",
                    "walk_started", "walk_completed"],
}
SOFT_FACT_KEYS = {"visitor": ["visitors"], "whereabouts": None}


def hard_refusal(question: str) -> str | None:
    """The sub-kind of hard refusal this question earns, or None."""
    q = question or ""
    if _SPEECH.search(q):
        return "speech"
    if _PRIVATE_ROOM.search(q):
        # "how did she sleep" must still answer from the bed_exit lane.
        if _SLEEP_OK.search(q) and not re.search(
                r"\b(bathroom|toilet|loo|shower|bedroom|undress\w*|naked|pyjamas?|pajamas?)\b",
                q, re.I):
            return None
        return "private_room"
    if _IMAGERY.search(q):
        return "imagery"
    if _APPEARANCE.search(q):
        return "appearance"
    if _LIVE_LOCATION.search(q):
        return "live_location"
    return None


def soft_kind(question: str) -> str | None:
    q = question or ""
    if _VISITOR_SOFT.search(q):
        return "visitor"
    if _WHEREABOUTS_SOFT.search(q):
        return "whereabouts"
    return None


_ROOM_WORDS = re.compile(
    r"(?:\b(?:in|into|from|to|at|inside)\s+(?:the\s+)?)?"
    r"\b(kitchen|bedroom|bathroom|living[ _]room|hallway|hall|dining[ _]room)\b", re.I)


def scrub_rooms(text: str) -> str:
    """Last line of defence (§5.5.6). Camera events are written without a room
    name in the first place, so this should only ever fire on seeded band/RF
    history — it is logged when it does."""
    if not text:
        return text
    out = _ROOM_WORDS.sub("at home", text)
    if out != text:
        log.info("scrubbed a room name out of family-facing text")
    return out


# ---------------------------------------------------------------------------
# Time windows. Facts are timeless; observations and patterns are not (§6.5a).
# ---------------------------------------------------------------------------

def time_window(question: str, tz: ZoneInfo, now: datetime | None = None) -> tuple[int | None, int | None]:
    q = (question or "").lower()
    now = (now or datetime.now(timezone.utc)).astimezone(tz)
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)

    def ep(d):
        return int(d.astimezone(timezone.utc).timestamp())

    if re.search(r"\byesterday\b", q):
        return ep(midnight - timedelta(days=1)), ep(midnight)
    if re.search(r"\b(today|this morning|this afternoon|this evening|tonight|right now|just now)\b", q):
        return ep(midnight), None
    if re.search(r"\b(this week|past week|last week|last 7 days|recently|lately)\b", q):
        return ep(midnight - timedelta(days=7)), None
    return None, None


# ---------------------------------------------------------------------------
# Retrieval: one pool, three sources, each candidate carrying its kind.
# ---------------------------------------------------------------------------

def kind_of(doc: dict) -> str:
    if doc.get("_kind") == "told":
        return "told"
    return "pattern" if doc.get("type") in PATTERN_TYPES else "observed"


async def _fact_candidates(resident_id: str, only_keys: list[str] | None) -> list[dict]:
    q: dict = {"resident_id": resident_id, "active": True, "embedding": {"$exists": True}}
    if only_keys:
        q["key"] = {"$in": only_keys}
    rows = await db().profile_facts.find(q).to_list(length=2000)
    for r in rows:
        r["_kind"] = "told"
        r["type"] = "profile_fact"
        r["ts"] = r.get("created_at")
    return rows


async def search(resident_id: str, query: str, k: int = 6, since: int | None = None,
                 until: int | None = None, family: bool = False,
                 only_types: list[str] | None = None,
                 only_fact_keys: list[str] | None = None,
                 include_facts: bool = False, quota: bool = False) -> list[dict]:
    """Hybrid retrieval: cosine over embeddings ∪ keyword/regex, merged with
    reciprocal rank fusion, k=60 per PRD §9.5.

    `include_facts` widens the pool to `profile_facts` so onboarding answers,
    camera observations and the daily narratives compete in one ranking (§6.5).
    `family=True` drops FAMILY_EXCLUDED_TYPES before anything is scored — the
    family filter is a pool filter, not a rendering filter.
    """
    q: dict = {"resident_id": resident_id, "embedding": {"$exists": True}}
    if since is not None or until is not None:
        q["ts_epoch"] = {}
        if since is not None:
            q["ts_epoch"]["$gte"] = since
        if until is not None:
            q["ts_epoch"]["$lt"] = until
    # Both conditions, never one or the other: a soft lane (`only_types`) narrows
    # WHAT is asked about, the family filter says what a family may ever see, and
    # the second is not the first one's business to switch off. As an `elif` this
    # was safe only by accident — nothing in SOFT_TYPES happens to be excluded
    # today — and the day a whereabouts type joins both sets, the family answer
    # quietly starts citing rooms.
    type_q: dict = {}
    if only_types:
        type_q["$in"] = only_types
    if family:
        type_q["$nin"] = sorted(FAMILY_EXCLUDED_TYPES)
    if type_q:
        q["type"] = type_q
    docs = await db().events.find(q).to_list(length=50000)
    if include_facts:
        docs = docs + await _fact_candidates(resident_id, only_fact_keys)
    if not docs:
        return []

    qvec = (await embed([query]))[0]
    vec_ranked = sorted(docs, key=lambda d: _cosine(d["embedding"], qvec), reverse=True)[:30]

    words = [w for w in re.findall(r"[a-z0-9]+", query.lower()) if len(w) >= 3]
    pattern = re.compile("|".join(re.escape(w) for w in words), re.I) if words else None

    def _kw_score(d):
        if not pattern:
            return 0
        text = f"{d.get('embedding_text', '')} {(d.get('payload') or {}).get('narrative', '')}"
        return len(pattern.findall(text))

    kw_ranked = sorted((d for d in docs if _kw_score(d) > 0), key=_kw_score, reverse=True)[:30]

    RRF_K = 60
    scores: dict[str, float] = {}
    by_id: dict[str, dict] = {}
    for ranked in (vec_ranked, kw_ranked):
        for rank, d in enumerate(ranked):
            scores[d["_id"]] = scores.get(d["_id"], 0.0) + 1.0 / (RRF_K + rank)
            by_id[d["_id"]] = d

    ordered = sorted(scores, key=scores.get, reverse=True)
    top_ids = _apply_quota(ordered, by_id, k) if quota else ordered[:k]

    results = []
    for cid in top_ids:
        d = by_id[cid]
        text = (d.get("payload") or {}).get("narrative") or d.get("embedding_text", "")
        results.append({
            "id": cid, "event_id": cid, "ts": d["ts"], "type": d["type"],
            "kind": kind_of(d), "text": text, "score": scores[cid],
        })
    return results


# Up to 4 observed, 2 told, 2 pattern, backfilled in score order (§6.5b). This
# is what makes the contrast answer reliable — without it a dozen meal_observed
# rows crowd out the one fact that says what breakfast is supposed to look like.
KIND_QUOTA = {"observed": 4, "told": 2, "pattern": 2}


def _apply_quota(ordered: list[str], by_id: dict[str, dict], k: int) -> list[str]:
    taken: dict[str, int] = {"observed": 0, "told": 0, "pattern": 0}
    picked, spare = [], []
    for cid in ordered:
        kind = kind_of(by_id[cid])
        if taken[kind] < KIND_QUOTA.get(kind, 0) and len(picked) < k:
            picked.append(cid)
            taken[kind] += 1
        else:
            spare.append(cid)
    for cid in spare:
        if len(picked) >= k:
            break
        picked.append(cid)
    return picked


_KIND_LABEL = {"told": "You told us", "observed": "Dhyaan saw", "pattern": "From her pattern"}

# `[evt_01M2ZFVN5Y8HHPETGG03GF9FEH]`, and the same shape for any other id we
# put in the context. The system prompt asks the model to cite every statement
# with its [id] — that instruction stays, because it is what keeps the answer
# tied to retrieved sentences instead of invented ones — but the ids are for
# US, not for her daughter. They come back in `citations`, which is what the
# chips under the answer are built from, and that is where an id belongs.
#
# `_template_answer` was fixed for this months ago. The MODEL path was not, and
# nobody saw it because the model path only runs with an OPENAI_API_KEY set: the
# moment one was configured, every answer came back full of ULIDs.
_ID_IN_PROSE = re.compile(r"\s*\[[a-z]{2,6}_[0-9A-HJKMNP-TV-Z]{26}\]")


def _strip_ids(text: str) -> str:
    """Take the ids out of prose and tidy what they leave behind."""
    out = _ID_IN_PROSE.sub("", text)
    # " ." and " ," where a citation sat between a word and its punctuation.
    out = re.sub(r"\s+([.,;:!?])", r"\1", out)
    return re.sub(r"[ \t]{2,}", " ", out).strip()


def _template_answer(hits: list[dict]) -> str:
    """Cut-list item 4: when there is no OpenAI key and no local chat model, the
    answer is the retrieved sentences grouped by kind — still labelled, so the
    family can still tell observed from assumed.

    No ids in the prose. This used to append `[evt_01M2Y...]` after every
    sentence, and since the app renders `answer` verbatim into a chat bubble,
    the family read raw ULIDs out of the database. They were never needed here:
    every hit is already returned in `citations`, which is what the citation
    chips under the answer are built from, and that is where an id belongs.
    """
    if not hits:
        return "I don't have data for that."
    parts = []
    for kind in ("observed", "told", "pattern"):
        chunk = [h for h in hits if h["kind"] == kind][:3]
        if chunk:
            parts.append(f"{_KIND_LABEL[kind]}: " + " ".join(h["text"] for h in chunk))
    return " ".join(parts)


_ANSWER_RULES = (
    "Never name a room she is in — say 'at home' or 'out of view'. Never describe "
    "what she looks like or what she is wearing. Never quote or guess at speech. "
    "Say 'you told us' for a [told] chunk, 'Dhyaan saw' for an [observed] chunk and "
    "'from her pattern' for a [pattern] chunk. When a told fact and an observation "
    "cover the same thing, contrast them in one sentence and give both times."
)


def _context(hits: list[dict]) -> str:
    return "\n".join(f"[{h['id']}] [{h['kind']}] ({h['ts']}) {h['text']}" for h in hits)


def _system(resident_name: str) -> str:
    return (
        f"You answer questions about {resident_name} using ONLY the observations given. "
        "Cite every factual statement with its [id]. Always give a wall-clock time "
        "or date. If the observations don't cover the question, say so plainly instead of "
        "guessing — absence of data is an answer, not the same as 'no'. Never give medical "
        "advice, diagnosis, interpretation, or prognosis; describe only what was observed. "
        "Two to five sentences, no preamble. " + _ANSWER_RULES
    )


async def _llm_answer(question: str, hits: list[dict], resident_name: str) -> str | None:
    """First link of the answer chain: the cloud model behind app/llm.py
    (OpenAI today). Returns None with no OPENAI_API_KEY or on any API hiccup,
    which is what hands the question to _ollama_answer and then
    _template_answer below — in that order, and that chain is what makes the
    demo answer with no key at all."""
    return await llm.complete(
        _system(resident_name), f"Question: {question}\n\nObservations:\n{_context(hits)}",
        max_tokens=500,
    )


# ponytail: the local chat fallback is one httpx POST at the same Ollama that
# already serves the embedder — no second client, no second dependency. Off
# unless CHAT_FALLBACK_MODEL is set, so the test suite stays offline and fast;
# dev.sh runs the demo with CHAT_FALLBACK_MODEL=qwen2.5vl:3b (called with no images).
CHAT_FALLBACK_MODEL = os.getenv("CHAT_FALLBACK_MODEL", "")
CHAT_TIMEOUT_S = float(os.getenv("CHAT_TIMEOUT_S", "25"))

# One budget over the whole chain, because each link only bounds itself: OpenAI
# is 8s plus one 0.5s-backoff retry (app/llm.py), and Ollama is another 25s
# behind it, so the worst honest case was ~41 seconds on a question a person is
# waiting on. Ten seconds is past the point where a chat bubble feels broken,
# and the deterministic template answer below is always right there — a slower
# model is not worth more than a fast true sentence.
ANSWER_BUDGET_S = 10.0


async def _ollama_answer(question: str, hits: list[dict], resident_name: str) -> str | None:
    if not CHAT_FALLBACK_MODEL:
        return None
    try:
        async with httpx.AsyncClient(timeout=CHAT_TIMEOUT_S) as c:
            r = await c.post(f"{OLLAMA_URL}/api/chat", json={
                "model": CHAT_FALLBACK_MODEL, "stream": False,
                "options": {"temperature": 0.2, "num_predict": 300},
                "messages": [
                    {"role": "system", "content": _system(resident_name)},
                    {"role": "user",
                     "content": f"Question: {question}\n\nObservations:\n{_context(hits)}"},
                ],
            })
            r.raise_for_status()
            return (r.json().get("message") or {}).get("content") or None
    except Exception as e:  # noqa: BLE001
        log.info("local chat fallback unavailable (%s) — using the template answer", e)
        return None


MEDICAL_REFUSAL = (
    "I can only tell you what was observed. For anything about her health, "
    "please talk to her doctor or the care team."
)


async def answer_family(resident_id: str, question: str) -> dict:
    """The family's chat answer, with the guard in front of it. §5.5, §6.5."""
    q = question or ""

    if MEDICAL_PATTERN.search(q):
        return {"answer": MEDICAL_REFUSAL, "citations": [], "retrieved_count": 0,
                "refused": True, "refusal_kind": "medical"}

    hard = hard_refusal(q)
    if hard:
        # No retrieval, no LLM, no exceptions. The refusal is the whole answer.
        text = REFUSALS[hard]
        if _VISITOR_SOFT.search(q):
            text += _VISITOR_OFFER
        return {"answer": text, "citations": [], "retrieved_count": 0,
                "refused": True, "refusal_kind": "surveillance"}

    resident_doc = await db().residents.find_one({"_id": resident_id}) or {}
    name = resident_doc.get("display_name", "the resident")
    tz = ZoneInfo(resident_doc.get("timezone") or "UTC")
    since, until = time_window(q, tz)

    soft = soft_kind(q)
    hits = await search(
        resident_id, q, k=8, since=since, until=until, family=True,
        only_types=SOFT_TYPES.get(soft) if soft else None,
        only_fact_keys=SOFT_FACT_KEYS.get(soft) if soft else None,
        include_facts=True, quota=True,
    )
    if not hits and (since is not None or soft):
        # A narrow window or a soft restriction found nothing — widen once
        # rather than telling the family "no data" when there is plenty.
        hits = await search(resident_id, q, k=8, family=True, include_facts=True, quota=True)
    if not hits:
        return {"answer": "I don't have data for that.", "citations": [],
                "retrieved_count": 0, "refused": False, "refusal_kind": None}

    for h in hits:
        h["text"] = scrub_rooms(h["text"])

    async def _chain():
        return (await _llm_answer(q, hits, name)
                or await _ollama_answer(q, hits, name)
                or _template_answer(hits))

    try:
        text = await asyncio.wait_for(_chain(), ANSWER_BUDGET_S)
    except asyncio.TimeoutError:
        log.info("the answer chain ran past %.0fs — answering from the template", ANSWER_BUDGET_S)
        text = _template_answer(hits)
    text = scrub_rooms(_strip_ids(text))
    if soft:
        text = f"{SOFT_PREFIX[soft]} {text}"

    citations = [{"id": h["id"], "event_id": h["event_id"], "kind": h["kind"],
                  "ts": h["ts"], "text": h["text"]} for h in hits]
    return {"answer": text, "citations": citations, "retrieved_count": len(hits),
            "refused": False, "refusal_kind": None}


async def answer(resident_id: str, question: str) -> dict:
    """Backwards-compatible three-key shape. `tests/test_llm.py` pins it with a
    strict `set(result) == {...}`, and that file is another agent's; the
    extended contract (§6.1) lives on answer_family() and routers/chat.py."""
    r = await answer_family(resident_id, question)
    return {k: r[k] for k in ("answer", "citations", "retrieved_count")}
