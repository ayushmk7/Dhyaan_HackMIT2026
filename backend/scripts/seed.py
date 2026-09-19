"""Seed a demo resident with 14 days of plausible history plus today's anomaly.

    uv run python -m scripts.seed          # Eleanor, 14 days, today she never walked
    uv run python -m scripts.seed --wipe   # drop everything first

The history is synthetic. The learner that runs on it is real. Say that to judges.
"""

import argparse
import asyncio
import random
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

# Times below are wall-clock in the resident's own timezone, not UTC. Get this
# wrong and every night-time bathroom trip lands in the previous evening, which
# poisons wake_time_min and makes the learner emit nonsense.
TZ = ZoneInfo("America/New_York")

from app import db as dbmod
from app.events import emit

RESIDENT = {
    "_id": "res_eleanor",
    "display_name": "Eleanor",
    "room": "214",
    "timezone": "America/New_York",
    "phone_e164": "+15551230000",
    "consent_camera": 1,
    "consent_voice": 1,
    "consent_signed_by": "Priya (daughter)",
    "prior_profile": "independent_senior",
}

CONTACTS = [
    {"_id": "con_priya", "resident_id": "res_eleanor", "name": "Priya",
     "phone_e164": "+15551231111", "relationship": "daughter", "ladder_order": 1},
    {"_id": "con_sam", "resident_id": "res_eleanor", "name": "Sam",
     "phone_e164": "+15551232222", "relationship": "son", "ladder_order": 2},
]

BAND = {"_id": "band_a3f2", "resident_id": "res_eleanor", "battery_pct": 88,
        "thresholds_rev": 1, "firmware": "0.1.0"}

ZONES = ["bedroom", "hallway", "kitchen", "living_room", "bathroom"]


async def seed_day(day: datetime, anomalous: bool):
    """One plausible day. Eleanor wakes ~06:40, eats 3x, walks ~3x."""
    r = "res_eleanor"
    date_s = day.strftime("%A %-d %B")

    wake = day.replace(hour=6, minute=40) + timedelta(minutes=random.randint(-25, 25))
    await emit(resident_id=r, source="camera", type="bed_exit", ts=wake, zone="bedroom",
               payload={"hour_local": wake.hour},
               embedding_text=f"On {date_s} at {wake:%-I:%M %p}, Eleanor got out of bed.")

    for meal, hour in (("breakfast", 7), ("lunch", 12), ("dinner", 18)):
        if anomalous and meal == "lunch":
            continue  # she skipped lunch today
        t = day.replace(hour=hour, minute=random.randint(0, 50))
        await emit(resident_id=r, source="camera", type="meal_observed", ts=t,
                   zone="kitchen", confidence=0.85,
                   payload={"meal": meal, "seated_duration_s": random.randint(600, 1800)},
                   embedding_text=f"On {date_s} at {t:%-I:%M %p}, Eleanor ate {meal} in the kitchen.")

    # Eleanor walks 4-6 times a day. That consistency is the point: at lambda~5 a
    # zero-walk day is p=0.007 (surprise 2.17 -> urgent), while at lambda~3 it is
    # only 1.28 and never clears the 1.3 warn cutoff. TECHNICAL_PRD §8.2's worked
    # example ("lambda=3.1, 0 walks -> urgent") does not clear its own threshold.
    walks = 0 if anomalous else random.randint(4, 6)
    for i in range(walks):
        # Spread across waking hours and clamp: hour=10+i*3 overflows past 23 once
        # walks >= 5 and datetime.replace raises, silently truncating the seed.
        t = day.replace(hour=min(9 + i * 2, 21), minute=random.randint(0, 50))
        dur = random.randint(300, 1500)
        await emit(resident_id=r, source="camera", type="walk_completed", ts=t,
                   zone="hallway", payload={"duration_s": dur},
                   ts_end=t + timedelta(seconds=dur),
                   embedding_text=f"On {date_s} at {t:%-I:%M %p}, Eleanor walked for {dur // 60} minutes.")

    for i in range(random.randint(0, 2)):
        t = day.replace(hour=random.choice([1, 2, 3]), minute=random.randint(0, 59))
        await emit(resident_id=r, source="band", type="bed_exit", ts=t, zone="bathroom",
                   payload={"hour_local": t.hour, "night": True},
                   embedding_text=f"On {date_s} at {t:%-I:%M %p}, Eleanor got up during the night.")

    for i, z in enumerate(random.sample(ZONES, 3)):
        t = day.replace(hour=9 + i * 4, minute=random.randint(0, 59))
        await emit(resident_id=r, source="band", type="zone_entered", ts=t, zone=z,
                   confidence=0.78, payload={"method": "ble"},
                   embedding_text=f"On {date_s} at {t:%-I:%M %p}, Eleanor moved into the {z.replace('_', ' ')}.")


async def main(wipe: bool, days: int):
    d = await dbmod.connect()
    if wipe:
        for c in ("events", "alerts", "residents", "contacts", "bands",
                  "baselines", "baseline_observations", "fingerprints", "calls"):
            await d[c].delete_many({})

    await d.residents.replace_one({"_id": RESIDENT["_id"]}, RESIDENT, upsert=True)
    for c in CONTACTS:
        await d.contacts.replace_one({"_id": c["_id"]}, c, upsert=True)
    await d.bands.replace_one({"_id": BAND["_id"]}, BAND, upsert=True)

    today = datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    for i in range(days, 0, -1):
        await seed_day(today - timedelta(days=i), anomalous=False)
    await seed_day(today, anomalous=True)  # today: no walk, no lunch

    n = await d.events.count_documents({})
    print(f"seeded {n} events over {days + 1} days for Eleanor")
    print("today is deliberately anomalous: no walk, no lunch — the learner should flag it")
    await dbmod.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--wipe", action="store_true")
    p.add_argument("--days", type=int, default=14)
    a = p.parse_args()
    asyncio.run(main(a.wipe, a.days))
