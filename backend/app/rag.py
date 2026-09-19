"""RAG layer. TECHNICAL_PRD §9.

ponytail: no vector database, no LangChain, no embedding framework. Embeddings
are a plain list[float] stored on the event doc; retrieval is brute-force
cosine in numpy plus a regex keyword pass, merged with reciprocal rank fusion
(four lines, per PRD §9.5 — not worth a dependency). Ceiling: this is a full
table scan per query, fine to maybe ~50k events on a laptop. Upgrade: Mongo
Atlas Vector Search ($vectorSearch) once the corpus outgrows a scan, exactly
as the comment in app/db.py already anticipates.

Embeddings are Claude-written daily narratives, not raw event rows (§9.1) —
the narrative is the RAG chunk. Raw event embedding_text is also indexed (via
events.subscribe, so app/events.py needs no changes) for precise "when did X
happen" lookups.
"""

import hashlib
import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np

from .config import ANTHROPIC_API_KEY
from .db import db
from .events import emit, subscribe

EMBED_DIM = 256

# High-cardinality telemetry, never indexed — PRD §9.1: it would drown the index
# and nobody asks "how has she been" about band_still ticks.
NOISY_EVENT_TYPES = {"person_present", "band_motion_high", "band_still"}

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
    """Pluggable embedding function. Deterministic offline fallback always
    available so tests and the demo never touch the network.

    ponytail: Anthropic does not serve an embeddings endpoint, and pulling in
    a real one (Ollama nomic-embed-text per PRD §9.3, sentence-transformers,
    Voyage) is out of scope for ponytail mode. The `ANTHROPIC_API_KEY` check
    is left in as the wiring point: a real embedding call slots in here behind
    the same signature without touching any caller.
    """
    if ANTHROPIC_API_KEY:
        pass  # no first-party embedding call available; fall through
    return [_hash_embed(t) for t in texts]


async def _on_event_created(doc):
    """events.subscribe hook: embed embedding_text at insert time (§9.1/§9.2),
    without touching app/events.py.

    Must be `async def`, not a plain function returning Motor's awaitable:
    events.py only awaits a subscriber's return value when
    `asyncio.iscoroutine(r)` is true, and this Motor version's collection
    methods return `asyncio.Future`, not a coroutine -- a plain function
    handing that Future back would never actually be awaited, racing the
    write against whatever reads the event next.
    """
    if doc["type"] in NOISY_EVENT_TYPES:
        return
    vec = _hash_embed(doc.get("embedding_text") or "")
    await db().events.update_one({"_id": doc["_id"]}, {"$set": {"embedding": vec}})


subscribe(_on_event_created)


def _day_range_utc(tz: ZoneInfo, date_local: str) -> tuple[int, int]:
    d = date.fromisoformat(date_local)
    start_local = datetime(d.year, d.month, d.day, tzinfo=tz)
    end_local = start_local + timedelta(days=1)
    return int(start_local.astimezone(timezone.utc).timestamp()), int(end_local.astimezone(timezone.utc).timestamp())


def _template_narrative(name: str, date_local: str, docs: list[dict]) -> str:
    if not docs:
        return f"{date_local} — no observations were recorded for {name}. There may be a coverage gap."
    by_type: dict[str, list[dict]] = {}
    for d in docs:
        by_type.setdefault(d["type"], []).append(d)
    parts = [f"{date_local} — {name} had {len(docs)} recorded events."]
    if "meal_observed" in by_type:
        parts.append(f"{len(by_type['meal_observed'])} meal(s) observed.")
    else:
        parts.append("No meals were recorded — this may be a gap, not an absence.")
    if "walk_completed" in by_type:
        parts.append(f"Walked {len(by_type['walk_completed'])} time(s).")
    else:
        parts.append("No walks were recorded today.")
    if "bed_exit" in by_type:
        night = sum(
            1 for d in by_type["bed_exit"]
            if 0 <= datetime.fromtimestamp(d["ts_epoch"], tz=timezone.utc).hour < 5
        )
        if night:
            parts.append(f"{night} bed exit(s) overnight.")
    if "fall_suspected" in by_type or "fall_confirmed" in by_type:
        parts.append("A possible fall was flagged during the day.")
    if "visitor_present" in by_type:
        parts.append("Had a visitor.")
    return " ".join(parts)[:1000]


async def _claude_narrative(name: str, date_local: str, docs: list[dict]) -> str:
    import anthropic  # ponytail: imported lazily so an unset key never needs the package installed

    client = anthropic.AsyncAnthropic()
    lines = "\n".join(f"- {d['ts']}: {d['embedding_text']}" for d in docs[:200])
    prompt = (
        f"Write a 120-200 word plain-English paragraph summarizing {name}'s day on "
        f"{date_local} from the observations below. State what happened AND what is "
        "notably absent (e.g. no dinner recorded, no walk recorded) — absence is "
        "part of the answer. Do not diagnose, interpret, or speculate about health.\n\n"
        f"{lines}"
    )
    resp = await client.messages.create(
        model="claude-opus-5", max_tokens=600,
        messages=[{"role": "user", "content": prompt}],
    )
    return next(b.text for b in resp.content if b.type == "text")


async def daily_narrative(resident_id: str, date_local: str) -> str:
    """Summarize one resident-day into the RAG chunk that carries recall (§9.1).

    Stored as a daily_summary event. embedding_text is capped at 400 chars by
    events.emit(), but a 120-200 word narrative usually isn't — so the full
    text lives in payload.narrative and is what gets embedded/searched; the
    truncated embedding_text is just the event's own display text.
    """
    resident_doc = await db().residents.find_one({"_id": resident_id}) or {}
    tz = ZoneInfo(resident_doc.get("timezone") or "UTC")
    start_epoch, end_epoch = _day_range_utc(tz, date_local)
    docs = await db().events.find({
        "resident_id": resident_id, "ts_epoch": {"$gte": start_epoch, "$lt": end_epoch},
    }).sort("ts_epoch", 1).to_list(length=2000)

    name = resident_doc.get("display_name", "The resident")
    if ANTHROPIC_API_KEY:
        try:
            narrative = await _claude_narrative(name, date_local, docs)
        except Exception:
            narrative = _template_narrative(name, date_local, docs)  # ponytail: any API hiccup falls back silently
    else:
        narrative = _template_narrative(name, date_local, docs)

    event_doc = await emit(
        resident_id=resident_id, source="derived", type="daily_summary",
        embedding_text=narrative[:400],
        payload={"narrative": narrative, "date_local": date_local},
    )
    vec = (await embed([narrative]))[0]
    await db().events.update_one({"_id": event_doc["_id"]}, {"$set": {"embedding": vec}})
    return narrative


def _cosine(a, b) -> float:
    a, b = np.asarray(a), np.asarray(b)
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    return float(np.dot(a, b) / denom) if denom else 0.0


async def search(resident_id: str, query: str, k: int = 6, since: int | None = None) -> list[dict]:
    """Hybrid retrieval: cosine over embeddings ∪ keyword/regex, merged with
    reciprocal rank fusion, k=60 per PRD §9.5."""
    q: dict = {"resident_id": resident_id, "embedding": {"$exists": True}}
    if since is not None:
        q["ts_epoch"] = {"$gte": since}
    docs = await db().events.find(q).to_list(length=50000)
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
    for rank, d in enumerate(vec_ranked):
        scores[d["_id"]] = scores.get(d["_id"], 0.0) + 1.0 / (RRF_K + rank)
        by_id[d["_id"]] = d
    for rank, d in enumerate(kw_ranked):
        scores[d["_id"]] = scores.get(d["_id"], 0.0) + 1.0 / (RRF_K + rank)
        by_id[d["_id"]] = d

    top_ids = sorted(scores, key=scores.get, reverse=True)[:k]
    results = []
    for cid in top_ids:
        d = by_id[cid]
        text = (d.get("payload") or {}).get("narrative") or d.get("embedding_text", "")
        results.append({
            "event_id": d["_id"], "ts": d["ts"], "type": d["type"],
            "text": text, "score": scores[cid],
        })
    return results


def _template_answer(hits: list[dict]) -> str:
    if not hits:
        return "I don't have data for that."
    return " ".join(f"{h['text']} [{h['event_id']}]" for h in hits[:4])


async def _claude_answer(question: str, hits: list[dict], resident_name: str) -> str:
    import anthropic

    client = anthropic.AsyncAnthropic()
    ctx = "\n".join(f"[{h['event_id']}] ({h['ts']}) {h['text']}" for h in hits)
    system = (
        f"You answer questions about {resident_name} using ONLY the observations given. "
        "Cite every factual statement with its [event_id]. Always give a wall-clock time "
        "or date. If the observations don't cover the question, say so plainly instead of "
        "guessing — absence of data is an answer, not the same as 'no'. Never give medical "
        "advice, diagnosis, interpretation, or prognosis; describe only what was observed. "
        "Two to five sentences, no preamble."
    )
    resp = await client.messages.create(
        model="claude-opus-5", max_tokens=500, system=system,
        messages=[{"role": "user", "content": f"Question: {question}\n\nObservations:\n{ctx}"}],
    )
    return next(b.text for b in resp.content if b.type == "text")


async def answer(resident_id: str, question: str) -> dict:
    """Retrieve, answer with citations, refuse medical questions. §9.6-9.7."""
    if MEDICAL_PATTERN.search(question or ""):
        return {
            "answer": (
                "I can only tell you what was observed. For anything about her health, "
                "please talk to her doctor or the care team."
            ),
            "citations": [], "retrieved_count": 0,
        }

    hits = await search(resident_id, question, k=6)
    if not hits:
        return {"answer": "I don't have data for that.", "citations": [], "retrieved_count": 0}

    resident_doc = await db().residents.find_one({"_id": resident_id}) or {}
    name = resident_doc.get("display_name", "the resident")

    text = _template_answer(hits)
    if ANTHROPIC_API_KEY:
        try:
            text = await _claude_answer(question, hits, name)
        except Exception:
            text = _template_answer(hits)  # ponytail: API hiccup -> deterministic template, never a hard failure

    citations = [{"event_id": h["event_id"], "ts": h["ts"], "text": h["text"]} for h in hits]
    return {"answer": text, "citations": citations, "retrieved_count": len(hits)}
