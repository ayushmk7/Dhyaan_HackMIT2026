"""Per-resident baseline learner. TECHNICAL_PRD §8.

Robust per-resident online statistics, not ML: weighted median/MAD with
recency decay for continuous features, an EWMA Poisson rate for counts.
n <= 60 (the rolling window) makes an exact sort-based weighted median cheap,
so there is no reason to reach for a streaming approximation.
"""

import math
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from .db import db
from .events import emit

GAMMA = 0.97          # recency decay, half-life ~23 days, PRD §8.2
ALPHA = 0.15          # Poisson EWMA, ~6-day effective window
WINDOW_DAYS = 60
KAPPA = 4.0           # cold-start prior pseudo-count, PRD §8.4

CONTINUOUS = "continuous"
COUNT = "count"

# feature -> (kind, direction, sigma_floor, warn_threshold, urgent_threshold|None)
# direction: 'high' alerts only when the value rises above baseline, 'low' only
# when it falls below, 'both' either way. Thresholds are z for continuous
# features (PRD §8.5); count features always use the fixed surprise cutoffs
# 1.3 / 2.0 (p<=0.05 / p<=0.01) from §8.2, so warn/urgent are unused there.
FEATURE_META = {
    "wake_time_min":          (CONTINUOUS, "high", 20.0, 3.0, 4.5),
    "sleep_time_min":         (CONTINUOUS, "both", 20.0, 3.0, 4.5),
    "breakfast_min":          (CONTINUOUS, "both", 20.0, 3.0, 4.5),
    "lunch_min":              (CONTINUOUS, "both", 20.0, 3.0, 4.5),
    "dinner_min":             (CONTINUOUS, "both", 20.0, 3.0, 4.5),
    "max_meal_gap_h":         (CONTINUOUS, "high", 1.0, 3.0, 4.0),
    "meal_count":             (COUNT, "low", None, None, None),
    "walk_count":             (COUNT, "low", None, None, None),
    "walk_total_s":           (CONTINUOUS, "both", 300.0, 3.0, 4.5),
    "first_walk_min":         (CONTINUOUS, "both", 20.0, 3.0, 4.5),
    "time_out_of_room_s":     (CONTINUOUS, "low", 900.0, 3.0, 4.5),
    "night_activity_min":     (CONTINUOUS, "high", 10.0, 3.0, 4.0),
    "night_bed_exits":        (COUNT, "high", None, None, None),
    "longest_inactivity_s":   (CONTINUOUS, "high", 1800.0, 3.0, 4.0),
    "visitor_minutes":        (CONTINUOUS, "both", 10.0, None, None),  # context only, never alerts
    "time_in_kitchen_s":      (CONTINUOUS, "low", 300.0, 3.0, 4.0),
    "time_in_bedroom_s":      (CONTINUOUS, "high", 1800.0, 3.0, 4.0),
    "bathroom_visits_day":    (COUNT, "both", None, None, None),
    "bathroom_visits_night":  (COUNT, "high", None, None, None),
    "n_room_transitions":     (COUNT, "low", None, None, None),
    "time_outside_home_s":    (CONTINUOUS, "low", 600.0, 3.0, None),   # warn only, §8.5
    "first_kitchen_visit_min": (CONTINUOUS, "high", 30.0, 3.0, 4.5),
    "door_events":            (COUNT, "both", None, None, None),
    "location_unknown_frac":  (CONTINUOUS, "high", 0.05, None, None),  # data-quality only, never alerts a human
    # Median cadence (steps/min) across the day's band gait_summary windows.
    # 'low' only: walking slower than her usual is the signal; walking faster
    # is not a problem. Floor 8 spm — day-to-day cadence noise is real.
    "gait_cadence_spm":       (CONTINUOUS, "low", 8.0, 3.0, 4.5),
}

CIRCULAR_FEATURES = {"wake_time_min", "sleep_time_min", "first_walk_min"}
# ponytail: PRD only pins anchors for wake (06:00) and sleep (22:00); first_walk
# has no stated anchor, so we reuse a plausible mid-morning one. Upgrade: derive
# per-resident from the onboarding questionnaire like the other priors.
CIRCULAR_ANCHOR = {"wake_time_min": 360.0, "sleep_time_min": 1320.0, "first_walk_min": 540.0}

# Cohort priors (PRD §8.4 baseline/priors.yaml, "independent_senior" profile).
# ponytail: one hardcoded profile, not the per-resident onboarding-questionnaire
# table the PRD describes. Ceiling: every resident cold-starts from the same
# prior. Upgrade: store a chosen profile (or raw questionnaire answers) on the
# resident doc and key PRIORS by it.
PRIORS = {
    "wake_time_min": {"mu": 420.0, "sigma": 60.0},
    "meal_count": {"lam": 3.0},
    "walk_count": {"lam": 2.0},
    "night_bed_exits": {"lam": 1.0},
    "longest_inactivity_s": {"mu": 7200.0, "sigma": 3600.0},
}

MOTION_TYPES = {
    "person_present", "band_motion_high", "walk_started", "walk_completed",
    "bed_exit", "room_exit", "room_entry", "zone_entered", "zone_exited",
    "night_activity",
}


def weighted_median(values, weights):
    """Exact weighted median, sort-based. PRD §8.3 pseudocode, verbatim logic."""
    if not values:
        return 0.0
    pairs = sorted(zip(values, weights))
    total = sum(w for _, w in pairs)
    if total <= 0:
        return pairs[len(pairs) // 2][0]
    acc = 0.0
    for v, w in pairs:
        acc += w
        if acc >= total / 2.0:
            return v
    return pairs[-1][0]


def _unwrap(v, anchor):
    """Fold a circular (clock-time) value into [anchor-720, anchor+720)."""
    while v < anchor - 720:
        v += 1440
    while v >= anchor + 720:
        v -= 1440
    return v


def _poisson_pmf(k, lam):
    if lam <= 0:
        return 1.0 if k == 0 else 0.0
    return math.exp(-lam + k * math.log(lam) - math.lgamma(k + 1))


def _poisson_cdf(k, lam):
    if k < 0:
        return 0.0
    return sum(_poisson_pmf(j, lam) for j in range(int(k) + 1))


async def update_feature(resident_id: str, feature: str, value: float, date_local: str) -> dict:
    """Upsert today's observation, prune the 60-day window, recompute mu/MAD/lambda."""
    obs = db().baseline_observations
    await obs.update_one(
        {"resident_id": resident_id, "feature": feature, "date_local": date_local},
        {"$set": {"value": float(value)}, "$setOnInsert": {"weight": 1.0}},
        upsert=True,
    )
    cutoff = (date.fromisoformat(date_local) - timedelta(days=WINDOW_DAYS)).isoformat()
    await obs.delete_many(
        {"resident_id": resident_id, "feature": feature, "date_local": {"$lt": cutoff}}
    )

    rows = await obs.find({"resident_id": resident_id, "feature": feature}).to_list(length=WINDOW_DAYS + 5)
    today = date.fromisoformat(date_local)
    prev = await db().baselines.find_one({"resident_id": resident_id, "feature": feature})

    vals = [r["value"] for r in rows]
    if feature in CIRCULAR_FEATURES:
        anchor = prev["mu"] if prev and prev.get("n_obs", 0) >= 3 else CIRCULAR_ANCHOR.get(feature, 360.0)
        vals = [_unwrap(v, anchor) for v in vals]

    weights = []
    for r, v in zip(rows, vals):
        age = max((today - date.fromisoformat(r["date_local"])).days, 0)
        weights.append(r.get("weight", 1.0) * (GAMMA ** age))

    mu = weighted_median(vals, weights)
    mad = weighted_median([abs(v - mu) for v in vals], weights)
    floor = FEATURE_META.get(feature, (None, None, 1.0))[2] or 1.0
    sigma = max(1.4826 * mad, floor)

    lam = None
    kind = FEATURE_META.get(feature, (CONTINUOUS,))[0]
    if kind == COUNT:
        prev_lam = prev.get("lam") if prev else None
        lam = float(value) if prev_lam is None else (1 - ALPHA) * prev_lam + ALPHA * float(value)

    n = len(vals)
    suppress_warn = bool(prev.get("suppress_warn")) if prev else False
    doc = {
        "resident_id": resident_id, "feature": feature, "mu": mu, "mad": mad, "sigma": sigma,
        "n_obs": n, "lam": lam, "last_value": float(value),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "cold_start": n < 7, "suppress_warn": suppress_warn,
    }
    await db().baselines.update_one(
        {"resident_id": resident_id, "feature": feature}, {"$set": doc}, upsert=True
    )
    return {
        "mu": mu, "sigma": sigma, "mad": mad, "lam": lam, "n": n,
        "cold_start": n < 7, "suppress_warn": suppress_warn,
    }


def _score_poisson(feature, value, lam, direction):
    if direction == "low" and value > lam:
        return None
    if direction == "high" and value < lam:
        return None
    p_low = _poisson_cdf(value, lam)
    p_high = 1.0 - _poisson_cdf(value - 1, lam)
    p = max(min(p_low, p_high), 1e-12)
    surprise = -math.log10(p)
    if surprise >= 2.0:
        severity = "urgent"
    elif surprise >= 1.3:
        severity = "warn"
    else:
        return None
    return {"kind": "poisson", "surprise": surprise, "severity": severity, "lam": lam, "p": p}


def _score_z(feature, value, mu, sigma, direction, warn_t, urgent_t):
    z = (value - mu) / sigma if sigma else 0.0
    if direction == "high" and z < 0:
        return None
    if direction == "low" and z > 0:
        return None
    az = abs(z)
    if urgent_t is not None and az >= urgent_t:
        severity = "urgent"
    elif warn_t is not None and az >= warn_t:
        severity = "warn"
    else:
        return None
    return {"kind": "robust_z", "z": z, "severity": severity, "mu": mu, "sigma": sigma}


def score(feature: str, value: float, state: dict) -> dict | None:
    """Robust z / Poisson-tail scoring with cold-start blending. PRD §8.3-8.5.

    Deviation from the PRD's literal score_today() pseudocode: that pseudocode
    does not direction-gate the Poisson branch at all (it always uses
    min(p_low, p_high)), even though §8.5's threshold table assigns explicit
    directions to count features (walk_count=low, n_room_transitions=low,
    bathroom_visits_night=high, ...). Applying no direction filter there would
    mean walking *more* than usual fires the same "low" alert as walking less,
    which contradicts the table and the product story. We gate Poisson by
    direction too, matching the z-branch and the threshold table.
    """
    meta = FEATURE_META.get(feature)
    if meta is None:
        return None
    kind, direction, _floor, warn_t, urgent_t = meta
    n = state.get("n", 0)
    if n < 3:
        return None  # P0: observation only, no deviation alerts at all

    if kind == COUNT:
        lam = state.get("lam")
        if lam is None:
            return None
        eff_lam = lam
        prior = PRIORS.get(feature)
        if n < 7 and prior and "lam" in prior:
            eff_lam = (n * lam + KAPPA * prior["lam"]) / (n + KAPPA)
        result = _score_poisson(feature, value, eff_lam, direction)
    else:
        if warn_t is None and urgent_t is None:
            return None  # context-only / data-quality feature, never alerts
        mu, sigma = state.get("mu"), state.get("sigma")
        if mu is None or sigma is None:
            return None
        eff_mu, eff_sigma = mu, sigma
        prior = PRIORS.get(feature)
        if n < 7 and prior and "mu" in prior:
            eff_mu = (n * mu + KAPPA * prior["mu"]) / (n + KAPPA)
            eff_sigma = (n * sigma + KAPPA * prior["sigma"]) / (n + KAPPA)
        result = _score_z(feature, value, eff_mu, eff_sigma, direction, warn_t, urgent_t)

    if result is None:
        return None

    if n < 7:  # P1: prior-blended, only urgent fires, labelled low-confidence
        if result["severity"] != "urgent":
            return None
        result["confidence"] = "low"

    if state.get("suppress_warn") and result["severity"] == "warn":
        return None  # §8.6 7-day (ponytail: indefinite, see apply_feedback) cooldown

    return result


# How each learned feature is said out loud. `embedding_text` is written for
# retrieval and for staff — it carries the raw value, the baseline and the
# z-score — but `/activity` puts a deviation on the FAMILY timeline, and
# "Eleanor's longest inactivity s was 14340 (baseline 8040.0, z=3.50)" is a
# debug line, not something a daughter should have to parse. `_family_item`
# prefers `payload.narrative`, so the family sentence is written here, once,
# beside the machine one.
_FEATURE_PHRASE = {
    "meal_count": ("meal", "meals"),
    "walk_count": ("walk", "walks"),
    "night_bed_exits": ("time up in the night", "times up in the night"),
    "steps_day": ("step", "steps"),
}


def _hours(seconds: float) -> str:
    h = seconds / 3600
    if h < 1:
        return f"{round(seconds / 60)} minutes"
    return "an hour" if round(h) == 1 else f"{h:.0f} hours"


def _family_text(name, feature, value, result, date_local) -> str:
    """One plain sentence. No feature slugs, no z-scores, no em dashes, and no
    number a daughter would have to convert out of seconds."""
    if feature == "longest_inactivity_s":
        usual = result.get("lam") or result.get("mu") or 0
        if value > usual:
            return (f"{name} went about {_hours(value)} without moving. "
                    f"She usually settles for about {_hours(usual)}.")
        return f"{name} was on her feet more than she usually is."

    if feature == "gait_cadence_spm":
        usual = result.get("mu")
        if usual is not None and value < usual:
            return (f"{name} is walking slower than usual, about {round(value)} steps "
                    f"a minute instead of her typical {round(usual)}.")
        return f"{name}'s walking pace was unusual today."

    if feature == "night_bed_exits":
        usual = result.get("lam") or result.get("mu") or 0
        count, usual_r = round(value), round(usual)
        was = "once" if count == 1 else f"{count} times"
        norm = "once" if usual_r == 1 else ("not at all" if usual_r == 0 else f"{usual_r} times")
        if count == 0:
            return f"{name} slept through. She is usually up {norm}."
        return f"{name} was up {was} in the night. She is usually up {norm}."

    singular, plural = _FEATURE_PHRASE.get(feature, (feature.replace("_", " "),
                                                     feature.replace("_", " ")))
    usual = result.get("lam") if result.get("kind") == "poisson" else result.get("mu")
    count = round(value)
    had = f"{count} {singular if count == 1 else plural}"
    if usual is None:
        return f"{name} had {had}, which is unusual for her."
    usual_r = round(usual)
    usual_s = f"{usual_r} {singular if usual_r == 1 else plural}"
    if count == 0:
        return f"No {plural} today. She usually has {usual_s}."
    direction = "Fewer" if value < usual else "More"
    return f"{name} had {had}. {direction} than her usual {usual_s}."


def _embedding_text(name, feature, value, result, date_local):
    label = feature.replace("_", " ")
    if result["kind"] == "poisson":
        text = (
            f"On {date_local}, {name}'s {label} was {value:g}, versus a usual rate of "
            f"about {result['lam']:.1f} (surprise {result['surprise']:.2f}). "
            "This is unusual for her."
        )
    else:
        text = (
            f"On {date_local}, {name}'s {label} was {value:g} "
            f"(baseline {result['mu']:.1f}, z={result['z']:.2f}). This is unusual for her."
        )
    return text[:400]


async def _emit_deviation(resident_id, feature, value, result, date_local, resident_doc):
    """Emit baseline_deviation, damped by the global rate limiter, PRD §8.5.

    Max 2 (non-info) baseline alerts per resident per 24h, max 1 per feature
    per day. A damped deviation is still written, with severity downgraded to
    'info', so the timeline and the daily summary can still reference it.
    """
    now_epoch = int(datetime.now(timezone.utc).timestamp())
    since_24h = now_epoch - 86400
    day_count = await db().events.count_documents({
        "resident_id": resident_id, "type": "baseline_deviation",
        "payload.feature": feature, "payload.date_local": date_local,
        "payload.severity": {"$ne": "info"},
    })
    recent_count = await db().events.count_documents({
        "resident_id": resident_id, "type": "baseline_deviation",
        "ts_epoch": {"$gte": since_24h}, "payload.severity": {"$ne": "info"},
    })
    severity = result["severity"]
    if day_count >= 1 or recent_count >= 2:
        severity = "info"

    name = (resident_doc or {}).get("display_name", "Resident")
    text = _embedding_text(name, feature, value, result, date_local)
    payload = {
        # First, not last: `result` carries its own undamped "severity", and
        # spreading it over the top put the rate limiter back where it started.
        **result,
        "feature": feature, "value": value, "date_local": date_local,
        "severity": severity, "raw_severity": result["severity"],
        # What the family reads. `_family_item` prefers this over embedding_text.
        "narrative": _family_text(name, feature, value, result, date_local),
    }
    return await emit(
        resident_id=resident_id, source="derived", type="baseline_deviation",
        embedding_text=text, payload=payload,
    )


def _day_range_utc(tz: ZoneInfo, date_local: str) -> tuple[int, int]:
    d = date.fromisoformat(date_local)
    start_local = datetime(d.year, d.month, d.day, tzinfo=tz)
    end_local = start_local + timedelta(days=1)
    return int(start_local.astimezone(timezone.utc).timestamp()), int(end_local.astimezone(timezone.utc).timestamp())


def _local_dt(ts_epoch, tz):
    return datetime.fromtimestamp(ts_epoch, tz=timezone.utc).astimezone(tz)


def _minutes_after_midnight(dt_local):
    midnight = dt_local.replace(hour=0, minute=0, second=0, microsecond=0)
    return (dt_local - midnight).total_seconds() / 60.0


def _derive_features(docs, tz) -> dict:
    """Roll one resident-day of events up into the feature subset this build
    covers: wake time, meal count, walk count, night bed-exits, longest
    inactivity, and zone_dwell room-time totals (PRD §8.1 table).
    ponytail: the PRD table has ~20 features; we derive the ones the task
    explicitly calls out, plus band gait cadence (median of the day's
    gait_summary windows). Upgrade: add the rest (meal timing, RF location
    features) as more event producers come online.
    """
    meal_count = walk_count = night_bed_exits = 0
    wake_candidates = []
    motion_epochs = []
    zone_seconds: dict[str, float] = {}
    cadences: list[float] = []  # band gait_summary windows (steps/min)

    for d in docs:
        dt_local = _local_dt(d["ts_epoch"], tz)
        t = d["type"]
        if t == "meal_observed":
            meal_count += 1
        if t == "walk_completed":
            walk_count += 1
        if t == "bed_exit" and 0 <= dt_local.hour < 5:
            night_bed_exits += 1
        if t in ("bed_exit", "band_motion_high") and dt_local.hour >= 4:
            wake_candidates.append(_minutes_after_midnight(dt_local))
        if t in MOTION_TYPES and 8 <= dt_local.hour < 22:
            motion_epochs.append(d["ts_epoch"])
        if t == "zone_dwell":
            # location.py writes `dwell_s`; reading `duration_s` alone published
            # three hard-zero features that could never deviate.
            p = d.get("payload") or {}
            secs = float(p.get("dwell_s", p.get("duration_s", 0)) or 0)
            zone = d.get("zone") or "unknown"
            zone_seconds[zone] = zone_seconds.get(zone, 0.0) + secs
        if t == "gait_summary":
            c = (d.get("payload") or {}).get("cadence_spm")
            if c is not None:
                cadences.append(float(c))

    features: dict[str, float] = {
        "meal_count": float(meal_count),
        "walk_count": float(walk_count),
        "night_bed_exits": float(night_bed_exits),
    }
    if wake_candidates:
        features["wake_time_min"] = min(wake_candidates)
    motion_epochs.sort()
    if len(motion_epochs) >= 2:
        gaps = [b - a for a, b in zip(motion_epochs, motion_epochs[1:])]
        features["longest_inactivity_s"] = float(max(gaps))
    if zone_seconds:
        if "kitchen" in zone_seconds:
            features["time_in_kitchen_s"] = zone_seconds["kitchen"]
        if "bedroom" in zone_seconds:
            features["time_in_bedroom_s"] = zone_seconds["bedroom"]
        features["time_out_of_room_s"] = sum(v for z, v in zone_seconds.items() if z != "bedroom")
    if cadences:
        # Median across the day's walk windows — one slow shuffle to the
        # bathroom must not define the day. Feeds "walking slower than usual".
        features["gait_cadence_spm"] = float(sorted(cadences)[len(cadences) // 2])
    return features


async def rollup(resident_id: str, date_local: str) -> dict:
    """Nightly (or on-demand, POST /v1/admin/rollup) baseline update for one resident-day."""
    resident_doc = await db().residents.find_one({"_id": resident_id}) or {}
    tz = ZoneInfo(resident_doc.get("timezone") or "UTC")
    start_epoch, end_epoch = _day_range_utc(tz, date_local)
    docs = await db().events.find({
        "resident_id": resident_id, "ts_epoch": {"$gte": start_epoch, "$lt": end_epoch},
    }).to_list(length=5000)

    if not docs:
        # A day we saw nothing is an outage, not a day she did not eat.
        # meal_count=0 against lambda=3 scores warn and then sits in the 60-day
        # window as if it were a real observation.
        return {}

    features = _derive_features(docs, tz)
    results = {}
    for feature, value in features.items():
        state = await update_feature(resident_id, feature, value, date_local)
        result = score(feature, value, state)
        if result:
            await _emit_deviation(resident_id, feature, value, result, date_local, resident_doc)
        results[feature] = {"value": value, "state": state, "result": result}
    return results


async def apply_feedback(resident_id: str, date_local: str, scope: str, verdict: str) -> None:
    """§8.6. scope is either the literal 'day' (every feature that date) or a
    feature key (just that one). 'expected' downweights to 0.2 and enters a
    warn-level cooldown; 'false_positive' excludes the observation entirely.
    """
    if verdict == "expected":
        weight = 0.2
    elif verdict == "false_positive":
        weight = 0.0
    else:
        raise ValueError(f"unknown verdict {verdict!r}")

    q = {"resident_id": resident_id, "date_local": date_local}
    if scope == "day":
        features = await db().baseline_observations.distinct(
            "feature", {"resident_id": resident_id, "date_local": date_local}
        )
    else:
        features = [scope]
        q["feature"] = scope
    await db().baseline_observations.update_many(q, {"$set": {"weight": weight}})

    resident_doc = await db().residents.find_one({"_id": resident_id}) or {}
    name = resident_doc.get("display_name", "Resident")
    await emit(
        resident_id=resident_id, source="manual", type="feedback_given",
        embedding_text=f"Feedback on {date_local} ({scope}): marked {verdict}."[:400],
        payload={"date_local": date_local, "scope": scope, "verdict": verdict},
    )

    for feature in features:
        rows = await db().baseline_observations.find(
            {"resident_id": resident_id, "feature": feature}
        ).to_list(length=WINDOW_DAYS + 5)
        if not rows:
            continue
        ref_date = max(r["date_local"] for r in rows)
        ref_value = next(r["value"] for r in rows if r["date_local"] == ref_date)
        await update_feature(resident_id, feature, ref_value, ref_date)

        if verdict != "expected":
            continue

        # ponytail: PRD's cooldown is a 7-day expiry (`suppress_until`); score()
        # takes no "today" so it cannot check an expiry date. We use a boolean
        # flag instead — it suppresses warn-level alerts indefinitely, not for
        # exactly 7 days. Ceiling: a resident who was "expected" once stays
        # damped forever unless the repeated-expected reset below fires.
        # Upgrade: pass today's date into score() and store a real timestamp.
        await db().baselines.update_one(
            {"resident_id": resident_id, "feature": feature},
            {"$set": {"suppress_warn": True}},
        )

        cutoff_epoch = int(datetime.now(timezone.utc).timestamp()) - 14 * 86400
        count = await db().events.count_documents({
            "resident_id": resident_id, "type": "feedback_given",
            "payload.scope": {"$in": [feature, "day"]}, "payload.verdict": "expected",
            "ts_epoch": {"$gte": cutoff_epoch},
        })
        if count >= 3:
            await db().baseline_observations.update_many(
                {"resident_id": resident_id, "feature": feature}, {"$set": {"weight": 1.0}}
            )
            await update_feature(resident_id, feature, ref_value, ref_date)
            await db().baselines.update_one(
                {"resident_id": resident_id, "feature": feature},
                {"$set": {"suppress_warn": False}},
            )
            await emit(
                resident_id=resident_id, source="derived", type="baseline_updated",
                embedding_text=(
                    f"{name}'s {feature.replace('_', ' ')} baseline was reset after being "
                    "marked expected 3+ times in 14 days."
                )[:400],
                payload={"feature": feature, "reason": "repeated_expected"},
            )
