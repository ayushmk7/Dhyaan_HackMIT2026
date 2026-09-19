"""One-sentence alert digests for the staff triage list. TECHNICAL_PRD §9.

ponytail: no summarization pipeline, no separate worker queue. One function,
called on demand when a triage list is rendered (not on the alert-ingest
critical path — nothing here runs from inside events.emit() or
alerts.open_alert()). Template fallback is deterministic and reads the same
facts the LLM prompt gets, so a keyless box or an API hiccup degrades to a
plain-but-correct sentence instead of no sentence.
"""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from . import llm
from .db import db

_CLASSIFICATION_NOTE = {
    "okay": "she answered and said she's okay",
    "fell_but_fine": "she said she was fine",
    "distress": "she sounded distressed on the call",
    "incoherent": "her response on the call was hard to understand",
    "silence": "she did not respond on the call",
    "no_answer": "she has not answered the phone",
}

_KIND_LABEL = {
    "fall": "possible fall",
    "fall_suspected": "possible fall",
    "fall_confirmed": "confirmed fall",
    "prolonged_inactivity": "prolonged inactivity",
    "band_offline": "band offline",
}


def _minutes_ago(iso_ts: str) -> int:
    opened = datetime.fromisoformat(iso_ts)
    if opened.tzinfo is None:
        opened = opened.replace(tzinfo=timezone.utc)
    delta = datetime.now(timezone.utc) - opened
    return max(int(delta.total_seconds() // 60), 0)


def _format_ago(minutes: int) -> str:
    if minutes <= 0:
        return "moments ago"
    if minutes == 1:
        return "1 minute ago"
    if minutes < 60:
        return f"{minutes} minutes ago"
    hours = minutes // 60
    return f"{hours} hour{'s' if hours != 1 else ''} ago"


async def _walked_today(resident_id: str, tz_name: str) -> bool:
    tz = ZoneInfo(tz_name or "UTC")
    now_local = datetime.now(tz)
    start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    start_epoch = int(start_local.astimezone(timezone.utc).timestamp())
    count = await db().events.count_documents({
        "resident_id": resident_id, "type": "walk_completed", "ts_epoch": {"$gte": start_epoch},
    })
    return count > 0


async def _latest_classification(alert_id: str) -> str | None:
    doc = await db().events.find_one(
        {"type": "voice_response_classified", "payload.alert_id": alert_id},
        sort=[("ts_epoch", -1)],
    )
    if not doc:
        return None
    trigger = (doc.get("payload") or {}).get("trigger")
    return _CLASSIFICATION_NOTE.get(trigger)


def _template_digest(name: str, room: str | None, kind: str, minutes: int,
                      classification_note: str | None, walked_today: bool) -> str:
    where = f", room {room}" if room else ""
    kind_label = _KIND_LABEL.get(kind, kind.replace("_", " "))
    parts = [f"{name}{where} — {kind_label} {_format_ago(minutes)}"]
    if classification_note:
        parts.append(classification_note)
    if not walked_today:
        parts.append("has not walked today")
    return ", ".join(parts) + "."


_DIGEST_SYSTEM = (
    "You write exactly one short sentence for a night-shift care staff triage list. "
    "Given the resident's name, room, the kind of alert, how long ago it happened, "
    "and any extra context, write one plain sentence a staff member can read in "
    "under two seconds. State facts only — never give medical advice, diagnosis, or "
    "interpretation. No preamble, no quotation marks, just the sentence."
)


async def alert_digest(alert_id: str) -> str:
    """One sentence a night nurse reads on the triage list, e.g. 'Eleanor, room
    214 — possible fall 12 minutes ago, she said she was fine but has not walked
    today.' Falls back to a deterministic template built from the same facts on
    any LLM failure or absent key."""
    alert = await db().alerts.find_one({"_id": alert_id})
    if not alert:
        return "Unknown alert."

    resident_doc = await db().residents.find_one({"_id": alert["resident_id"]}) or {}
    name = resident_doc.get("display_name", "Resident")
    room = resident_doc.get("room")

    minutes = _minutes_ago(alert["opened_at"])
    classification_note = await _latest_classification(alert_id)
    walked_today = await _walked_today(alert["resident_id"], resident_doc.get("timezone", "UTC"))

    template = _template_digest(name, room, alert["kind"], minutes, classification_note, walked_today)

    facts = [
        f"Resident: {name}",
        f"Room: {room or 'unknown'}",
        f"Alert kind: {_KIND_LABEL.get(alert['kind'], alert['kind'].replace('_', ' '))}",
        f"When: {_format_ago(minutes)}",
        f"Current state: {alert.get('state')}",
        f"Severity: {alert.get('severity')}",
    ]
    if classification_note:
        facts.append(f"Voice check-in: {classification_note}")
    facts.append(f"Walked today: {'yes' if walked_today else 'no'}")

    text = await llm.complete(_DIGEST_SYSTEM, "\n".join(facts), max_tokens=120)
    return (text or template).strip()
