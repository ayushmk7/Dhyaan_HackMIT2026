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

import asyncio
import hashlib
import logging
import os
import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
import numpy as np

from .config import ANTHROPIC_API_KEY
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
    t = asyncio.create_task(_embed_and_store(doc["_id"], doc.get("embedding_text") or ""))
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
    if not docs:
        return f"{date_local} — no observations were recorded for {name}. There may be a coverage gap."
    by_type: dict[str, list[dict]] = {}
    for d in docs:
        by_type.setdefault(d["type"], []).append(d)
    parts = [f"{date_local} — {name} had {len(docs)} recorded events."]
    # Name the meals actually eaten, not just a count. Every day's narrative is a
    # retrieval chunk, and "3 meal(s) observed" is the same sentence 15 days
    # running — nothing for a semantic search of "has she been eating" to grab.
    if "meal_observed" in by_type:
        meals = [m for m in ("breakfast", "lunch", "dinner")
                 if any((d.get("payload") or {}).get("meal") == m for d in by_type["meal_observed"])]
        eaten = ", ".join(meals) if meals else f"{len(by_type['meal_observed'])} meals"
        missed = [m for m in ("breakfast", "lunch", "dinner") if m not in meals]
        parts.append(f"{name} ate {eaten}.")
        if missed:
            parts.append(f"No {' or '.join(missed)} was observed — she skipped {' and '.join(missed)}.")
    else:
        parts.append(f"{name} was not seen eating at all today — this may be a gap, not an absence.")
    if "walk_completed" in by_type:
        parts.append(f"She walked {len(by_type['walk_completed'])} time(s).")
    else:
        parts.append("She did not walk at all today.")
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
    # A corpus embedded partly by Ollama (768d) and partly by the hash fallback
    # (256d) is a real possibility: the embedder can go down mid-run. Comparing
    # across widths is meaningless, and np.dot would raise. Skip instead.
    if a.shape != b.shape:
        return -1.0
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
