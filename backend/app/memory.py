"""The resident memory: what the family told us, what she looks like in words,
where she usually sits — and the one call that deletes all of it. VLM_PLAN §4.

Three rules that are the product, not overhead:

* A camera zone is one of `CAMERA_ZONES`. `bedroom` and `bathroom` are rejected
  at the trust boundary with 422 and there is no admin override (§5.1).
* Facts are never edited in place. A correction inserts a new row and
  deactivates the old one, so a fact the family says was wrong today does not
  silently rewrite last week's answers (§4.2).
* `delete_memory` really deletes — rows, not flags (§4.5).
"""

import re
from datetime import datetime, timezone

from fastapi import HTTPException
from ulid import ULID

from . import presence, rag
from .db import db
from .events import emit

CAMERA_ZONES = ("kitchen", "living_room", "dining_room", "hallway")
PRIVATE_ZONES = ("bedroom", "bathroom")

MAX_APPEARANCE = 200
MAX_FACT_TEXT = 300

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def clean(text: str, limit: int, field: str) -> str:
    t = _CONTROL.sub("", (text or "")).strip()
    if not t:
        raise HTTPException(422, f"{field} cannot be empty")
    if len(t) > limit:
        raise HTTPException(422, f"{field} must be {limit} characters or fewer")
    return t


def check_zone(zone: str) -> str:
    if zone in PRIVATE_ZONES:
        raise HTTPException(422, "a camera is never pointed at a bedroom or a bathroom")
    if zone not in CAMERA_ZONES:
        raise HTTPException(422, f"zone must be one of {list(CAMERA_ZONES)}")
    return zone


def zone_label(zone: str | None) -> str:
    return (zone or "room").replace("_", " ")


async def require_resident(resident_id: str) -> dict:
    r = await db().residents.find_one({"_id": resident_id})
    if not r:
        raise HTTPException(404, "resident not found")
    return r


def ser_fact(doc: dict) -> dict:
    return {
        "id": doc["_id"], "key": doc["key"], "text": doc["text"],
        "source": doc.get("source"), "author": doc.get("author"),
        "active": bool(doc.get("active")), "supersedes": doc.get("supersedes"),
        "superseded_by": doc.get("superseded_by"), "created_at": doc.get("created_at"),
    }


# --- facts -------------------------------------------------------------------

async def active_facts(resident_id: str) -> list[dict]:
    return await db().profile_facts.find(
        {"resident_id": resident_id, "active": True}
    ).sort("created_at", 1).to_list(length=200)


async def add_facts(resident_id: str, items: list[dict], author: str,
                    source: str = "family_onboarding") -> list[dict]:
    """Bulk write at onboarding. Embedded synchronously: there are tens of these,
    once, and the very next thing the family does is ask a question."""
    from . import rag  # lazy: rag imports events, which imports db

    now = datetime.now(timezone.utc).isoformat()
    texts = [clean(i["text"], MAX_FACT_TEXT, "fact text") for i in items]
    vecs = await rag.embed(texts)
    docs = []
    for item, text, vec in zip(items, texts, vecs):
        docs.append({
            "_id": f"fact_{ULID()}", "resident_id": resident_id,
            "key": clean(item["key"], 40, "fact key"), "text": text,
            "embedding_text": text, "embedding": vec,
            "source": source, "author": author, "active": True,
            "supersedes": None, "superseded_by": None,
            "created_at": now, "superseded_at": None,
        })
    if docs:
        await db().profile_facts.insert_many(docs)
        # The appearance answer is also the VLM's only hint about her (§4.2).
        for d in docs:
            if d["key"] == "appearance":
                await db().residents.update_one(
                    {"_id": resident_id},
                    {"$set": {"appearance": d["text"][:MAX_APPEARANCE]}})
    return docs


async def supersede_fact(resident_id: str, fact_id: str, text: str, author: str) -> dict:
    old = await db().profile_facts.find_one({"_id": fact_id, "resident_id": resident_id})
    if not old or not old.get("active"):
        raise HTTPException(404, "fact not found")
    new_text = clean(text, MAX_FACT_TEXT, "fact text")
    [new] = await add_facts(resident_id, [{"key": old["key"], "text": new_text}],
                            author, source="family_edit")
    now = datetime.now(timezone.utc).isoformat()
    await db().profile_facts.update_one({"_id": new["_id"]}, {"$set": {"supersedes": fact_id}})
    await db().profile_facts.update_one({"_id": fact_id}, {"$set": {
        "active": False, "superseded_by": new["_id"], "superseded_at": now}})
    new["supersedes"] = fact_id
    # The correction itself belongs in the timeline and the retrieval pool, so
    # "you told us toast" stops being cited the day they tell us porridge.
    await emit(resident_id=resident_id, source="manual", type="profile_updated",
               embedding_text=f"{author or 'The family'} corrected: {old['key']} is now {new_text}"[:400],
               payload={"key": old["key"], "fact_id": new["_id"], "supersedes": fact_id})
    return new


async def deactivate_fact(resident_id: str, fact_id: str) -> None:
    r = await db().profile_facts.update_one(
        {"_id": fact_id, "resident_id": resident_id},
        {"$set": {"active": False, "superseded_at": datetime.now(timezone.utc).isoformat()}})
    if not r.matched_count:
        raise HTTPException(404, "fact not found")


# --- profile -----------------------------------------------------------------

async def get_profile(resident_id: str) -> dict:
    r = await require_resident(resident_id)
    cam = await db().cameras.find_one({"resident_id": resident_id})
    facts = await active_facts(resident_id)
    line = presence.spots_line(r)
    return {
        "name": r.get("display_name"),
        "appearance": r.get("appearance"),
        "consent": {
            "falls": bool(r.get("consent_falls", 1)),
            "camera": bool(r.get("consent_camera")),
            "memory": bool(r.get("consent_memory")),
            "signed_by": r.get("consent_signed_by"),
            "relationship": r.get("consent_relationship"),
            "signed_at": r.get("consent_signed_at"),
        },
        "camera": {
            "camera_id": cam["_id"], "zone": cam.get("zone"),
            "zone_hint": cam.get("zone_hint"), "state": cam.get("state"),
            "paused_until": cam.get("paused_until"),
        } if cam else None,
        "usual_spots": [p.strip() for p in line.split(";") if p.strip()],
        "facts": [ser_fact(f) for f in facts],
    }


async def update_profile(resident_id: str, body: dict) -> dict:
    r = await require_resident(resident_id)
    sets: dict = {}
    if body.get("name"):
        sets["display_name"] = clean(body["name"], 80, "name")
    if "appearance" in body and body["appearance"] is not None:
        sets["appearance"] = clean(body["appearance"], MAX_APPEARANCE, "appearance")

    consent = body.get("consent") or {}
    drop_memory = False
    for k, field in (("falls", "consent_falls"), ("camera", "consent_camera"),
                     ("memory", "consent_memory")):
        if k in consent:
            sets[field] = 1 if consent[k] else 0
            if k == "memory" and not consent[k]:
                drop_memory = True
    if consent.get("signed_by"):
        sets["consent_signed_by"] = clean(consent["signed_by"], 120, "signed_by")
    if "relationship" in consent:
        # A signature with no stated relationship is not a consent record.
        sets["consent_relationship"] = clean(consent["relationship"], 60, "relationship")
    if consent:
        sets["consent_signed_at"] = datetime.now(timezone.utc).isoformat()

    if sets:
        await db().residents.update_one({"_id": resident_id}, {"$set": sets})

    cam = body.get("camera")
    if cam:
        zone = check_zone(cam.get("zone") or "")
        hint = clean(cam.get("zone_hint") or zone_label(zone), 300, "zone_hint")
        existing = await db().cameras.find_one({"resident_id": resident_id})
        cam_id = cam.get("camera_id") or (existing or {}).get("_id") or "cam_mac_01"
        await db().cameras.update_one({"_id": cam_id}, {"$set": {
            "resident_id": resident_id, "zone": zone, "zone_hint": hint,
        }, "$setOnInsert": {"state": "offline", "paused_until": None,
                            "paused_by": None, "presence": {}}}, upsert=True)

    if drop_memory:
        # §4.5: consent_memory: 0 is the same code path as Forget her profile.
        await delete_memory(resident_id, "profile", r.get("display_name") or "", checked=True)
    return await get_profile(resident_id)


# --- the delete --------------------------------------------------------------

async def delete_memory(resident_id: str, scope: str, confirm: str,
                        checked: bool = False) -> dict:
    """Really delete. Rows, not flags — this is the promise that makes the rest
    of the camera lane defensible."""
    r = await require_resident(resident_id)
    if scope not in ("profile", "camera", "all"):
        raise HTTPException(422, "scope must be profile, camera or all")
    if not checked and (confirm or "").strip() != (r.get("display_name") or ""):
        # Typo protection at the trust boundary: this is irreversible.
        raise HTTPException(422, "confirm must be the resident's name exactly")

    d = db()
    out = {"profile_facts": 0, "observations": 0, "camera_events": 0, "usual_spots": False}

    if scope in ("profile", "all"):
        out["profile_facts"] = (await d.profile_facts.delete_many(
            {"resident_id": resident_id})).deleted_count
        had = bool(r.get("usual_spots"))
        await d.residents.update_one({"_id": resident_id},
                                     {"$unset": {"appearance": "", "usual_spots": ""}})
        out["usual_spots"] = had

    if scope in ("camera", "all"):
        out["observations"] = (await d.observations.delete_many(
            {"resident_id": resident_id})).deleted_count
        # Not just source=="camera": the rollups derived FROM the camera carry
        # the same narrative and its embedding, so deleting only the raw rows
        # left `daily_summary` telling chat about a day the family had just
        # asked us to forget. Alert/ladder rows are also source=="derived" and
        # are deliberately kept — they are the call record, not the memory.
        out["camera_events"] = (await d.events.delete_many(
            {"resident_id": resident_id,
             "$or": [{"source": "camera"},
                     {"type": {"$in": sorted(rag.PATTERN_TYPES)}}]})).deleted_count
        await d.cameras.update_many({"resident_id": resident_id},
                                    {"$set": {"presence": {}}})
        presence.reset()

    await emit(resident_id=resident_id, source="manual", type="memory_deleted",
               embedding_text=f"The family deleted Dhyaan's memory ({scope}).",
               payload={"scope": scope, **out})
    return out
