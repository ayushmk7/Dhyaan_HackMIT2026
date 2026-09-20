"""Seed a demo resident with 14 days of plausible history plus today's anomaly.

    uv run python -m scripts.seed          # Asha, 14 days, today she never walked
    uv run python -m scripts.seed --wipe   # drop everything first

The history is synthetic. The learner that runs on it is real. Say that to judges.
"""

import argparse
import asyncio
import os
import random
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

# Times below are wall-clock in the resident's own timezone, not UTC. Get this
# wrong and every night-time bathroom trip lands in the previous evening, which
# poisons wake_time_min and makes the learner emit nonsense.
TZ = ZoneInfo("America/New_York")

from app import db as dbmod
# Import for its side effect: app.rag registers the embedding hook via
# events.subscribe() at import time. Import it late (or not at all) and every
# seeded event is written with no embedding and retrieval returns nothing.
from app import rag  # noqa: F401
from app.events import emit

# Live-call demos: point Asha (and the first ladder contact) at a phone that
# actually rings. Falls back to the fixture numbers when no .env is loaded.
_TEST_PHONE = os.getenv("TEST_PHONE_E164", "").strip()

RESIDENT = {
    "_id": "res_eleanor",
    "display_name": "Asha",
    "room": "214",
    "timezone": "America/New_York",
    "phone_e164": _TEST_PHONE or "+15551230000",
    "consent_camera": 1,
    "consent_voice": 1,
    "consent_memory": 1,
    "consent_signed_by": "Priya Sharma",
    "consent_relationship": "daughter",
    "consent_signed_at": "2026-09-19T15:02:11-04:00",
    "appearance": "short grey hair, glasses, usually a blue cardigan",
    "prior_profile": "independent_senior",
}

CAMERA = {
    "_id": "cam_mac_01", "resident_id": "res_eleanor",
    "zone": "living_room",
    "zone_hint": ("Living room. The dining table is on the left, her armchair by the "
                  "window on the right."),
    "state": "offline", "paused_until": None, "paused_by": None,
    "fps": 0.0, "dropped_batches": 0, "presence": {},
}

# VLM_PLAN §4.2: what the family told us at onboarding. These are the `told`
# half of the three-source retrieval pool — without them the chat has nothing to
# contrast an observation against and every answer is just "Dhyaan saw ...".
FACTS = [
    ("wake", "Asha is usually up around 6:30."),
    ("breakfast", "Asha usually has toast and tea for breakfast at about 8."),
    ("lunch", "Lunch is usually soup and bread around 12:30."),
    ("dinner", "Dinner is early, usually around 5:30, and she cooks it herself."),
    ("walk", "She walks to the shops around 10 most mornings."),
    ("mobility", "Uses a cane outdoors, steady indoors."),
    ("afternoon", "She spends her afternoons in the armchair by the window, reading."),
    ("evening", "She watches television in the evening, usually until about 9."),
    ("visitors", "Her neighbour Cheryl comes on Tuesdays, usually for an hour."),
    ("appearance", "Short grey hair, glasses, usually a blue cardigan."),
    ("private", "Never note bathroom trips."),
    ("nights", "She sleeps lightly and is often up once in the night."),
]

CONTACTS = [
    {"_id": "con_priya", "resident_id": "res_eleanor", "name": "Priya",
     "phone_e164": _TEST_PHONE or "+15551231111", "relationship": "daughter", "ladder_order": 1},
    {"_id": "con_sam", "resident_id": "res_eleanor", "name": "Sam",
     "phone_e164": "+15551232222", "relationship": "son", "ladder_order": 2},
]

# The REAL band too (band/fallband/config.json's band_id): without this row a
# reseed at the venue 404s every POST from the physical UNO Q until someone
# remembers to re-pair it by hand.
BAND_UNOQ = {"_id": "band_unoq01", "resident_id": "res_eleanor", "battery_pct": 100,
             "thresholds_rev": 1, "firmware": "0.1.0"}

BAND = {"_id": "band_a3f2", "resident_id": "res_eleanor", "battery_pct": 88,
        "thresholds_rev": 1, "firmware": "0.1.0"}

ZONES = ["bedroom", "hallway", "kitchen", "living_room", "bathroom"]


async def seed_day(day: datetime, anomalous: bool):
    """One plausible day. Asha wakes ~06:40, eats 3x, walks ~3x.

    Today's events are clamped to the clock. Seeding at 05:23 used to write
    dinner at 18:07 *today*, so `/residents` reported `last_seen` 18:07 while it
    was still morning and the timeline showed a day that had not happened yet.
    Nothing later than `now` is seeded; past days are untouched by this.
    """
    r = "res_eleanor"
    date_s = day.strftime("%A %-d %B")
    now = datetime.now(TZ)

    wake = day.replace(hour=6, minute=40) + timedelta(minutes=random.randint(-25, 25))
    if wake <= now:
        await emit(resident_id=r, source="camera", type="bed_exit", ts=wake, zone="bedroom",
                   payload={"hour_local": wake.hour},
                   embedding_text=f"On {date_s} at {wake:%-I:%M %p}, Asha got out of bed.")

    for meal, hour in (("breakfast", 7), ("lunch", 12), ("dinner", 18)):
        if anomalous and meal == "lunch":
            continue  # she skipped lunch today
        t = day.replace(hour=hour, minute=random.randint(0, 50))
        if t > now:
            continue
        await emit(resident_id=r, source="camera", type="meal_observed", ts=t,
                   zone="kitchen", confidence=0.85,
                   payload={"meal": meal, "seated_duration_s": random.randint(600, 1800)},
                   embedding_text=f"On {date_s} at {t:%-I:%M %p}, Asha ate {meal} in the kitchen.")

    # Asha walks 4-6 times a day. That consistency is the point: at lambda~5 a
    # zero-walk day is p=0.007 (surprise 2.17 -> urgent), while at lambda~3 it is
    # only 1.28 and never clears the 1.3 warn cutoff. TECHNICAL_PRD §8.2's worked
    # example ("lambda=3.1, 0 walks -> urgent") does not clear its own threshold.
    walks = 0 if anomalous else random.randint(4, 6)
    for i in range(walks):
        # Spread across waking hours and clamp: hour=10+i*3 overflows past 23 once
        # walks >= 5 and datetime.replace raises, silently truncating the seed.
        t = day.replace(hour=min(9 + i * 2, 21), minute=random.randint(0, 50))
        if t > now:
            continue
        dur = random.randint(300, 1500)
        await emit(resident_id=r, source="camera", type="walk_completed", ts=t,
                   zone="hallway", payload={"duration_s": dur},
                   ts_end=t + timedelta(seconds=dur),
                   embedding_text=f"On {date_s} at {t:%-I:%M %p}, Asha walked for {dur // 60} minutes.")

    for i in range(random.randint(0, 2)):
        t = day.replace(hour=random.choice([1, 2, 3]), minute=random.randint(0, 59))
        if t > now:
            continue
        await emit(resident_id=r, source="band", type="bed_exit", ts=t, zone="bathroom",
                   payload={"hour_local": t.hour, "night": True},
                   embedding_text=f"On {date_s} at {t:%-I:%M %p}, Asha got up during the night.")

    for i, z in enumerate(random.sample(ZONES, 3)):
        t = day.replace(hour=9 + i * 4, minute=random.randint(0, 59))
        if t > now:
            continue
        await emit(resident_id=r, source="band", type="zone_entered", ts=t, zone=z,
                   confidence=0.78, payload={"method": "ble"},
                   embedding_text=f"On {date_s} at {t:%-I:%M %p}, Asha moved into the {z.replace('_', ' ')}.")


async def main(wipe: bool, days: int):
    d = await dbmod.connect()
    if wipe:
        for c in ("events", "alerts", "residents", "contacts", "bands",
                  "baselines", "baseline_observations", "fingerprints", "calls",
                  "profile_facts", "cameras", "observations"):
            await d[c].delete_many({})

    await d.residents.replace_one({"_id": RESIDENT["_id"]}, RESIDENT, upsert=True)
    for c in CONTACTS:
        await d.contacts.replace_one({"_id": c["_id"]}, c, upsert=True)
    await d.bands.replace_one({"_id": BAND["_id"]}, BAND, upsert=True)
    await d.bands.replace_one({"_id": BAND_UNOQ["_id"]}, BAND_UNOQ, upsert=True)
    await d.cameras.replace_one({"_id": CAMERA["_id"]}, CAMERA, upsert=True)

    # Facts are embedded synchronously (there are twelve of them, once), so the
    # chat has `told` content to retrieve the moment `make seed` finishes.
    from app import memory

    await d.profile_facts.delete_many({"resident_id": "res_eleanor"})
    await memory.add_facts("res_eleanor", [{"key": k, "text": t} for k, t in FACTS],
                           "Priya Sharma")

    today = datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    for i in range(days, 0, -1):
        await seed_day(today - timedelta(days=i), anomalous=False)
    await seed_day(today, anomalous=True)  # today: no walk, no lunch

    # Roll up every seeded day: the baseline learner has to actually run before
    # the app has baselines to show, and the daily narratives it writes are the
    # RAG chunks. Without this, `make seed` leaves /baselines and /summaries
    # empty and the demo looks broken for reasons that are not bugs.
    from app import baseline
    from app.rag import daily_narrative

    for i in range(days, -1, -1):
        ds = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        try:
            await baseline.rollup("res_eleanor", ds)
            await daily_narrative("res_eleanor", ds)
        except Exception as e:  # noqa: BLE001
            print(f"  rollup {ds} failed: {type(e).__name__}: {e}")

    # Embeddings ride background tasks (rag._on_event_created). This process is
    # about to exit, which would cancel them and leave every seeded event
    # unembedded — so wait for them here.
    await rag.drain_embeddings()

    nf = await d.profile_facts.count_documents({"resident_id": "res_eleanor", "active": True})
    n = await d.events.count_documents({})
    nb = await d.baselines.count_documents({})
    nsum = await d.events.count_documents({"type": "daily_summary"})
    ndev = await d.events.count_documents({"type": "baseline_deviation"})
    print(f"seeded {n} events over {days + 1} days for Asha")
    print(f"  {nb} baselines learned, {nsum} daily narratives, {ndev} deviations flagged")
    print(f"  {nf} onboarding facts, camera {CAMERA['_id']} in the {CAMERA['zone']}")
    print("today is deliberately anomalous: no walk, no lunch — the learner should flag it")
    await dbmod.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--wipe", action="store_true")
    p.add_argument("--days", type=int, default=14)
    a = p.parse_args()
    asyncio.run(main(a.wipe, a.days))
