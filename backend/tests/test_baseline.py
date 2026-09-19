"""Tests for the per-resident baseline learner, app/baseline.py."""

from datetime import date, timedelta

import pytest

from app import baseline


def _dates(n, end="2026-08-14"):
    end_d = date.fromisoformat(end)
    return [(end_d - timedelta(days=n - 1 - i)).isoformat() for i in range(n)]


def test_weighted_median_known_input():
    assert baseline.weighted_median([1, 2, 3], [1, 1, 1]) == 2
    # Heavily weighting one value pulls the median onto it.
    assert baseline.weighted_median([1, 2, 100], [1, 1, 10]) == 100
    assert baseline.weighted_median([], []) == 0.0


def test_single_outlier_does_not_move_median_much():
    values = [420.0] * 13 + [900.0]  # 13 normal wake times + one wild outlier
    weights = [1.0] * 14
    mu = baseline.weighted_median(values, weights)
    mean = sum(values) / len(values)
    assert mu == 420.0  # median ignores the single outlier entirely
    assert abs(mean - 420.0) > 30  # the mean, by contrast, is dragged hard


async def test_wake_time_outlier_barely_moves_baseline(resident, db):
    dates = _dates(14)
    state = None
    for i, d in enumerate(dates):
        value = 900.0 if i == len(dates) - 1 else 420.0
        state = await baseline.update_feature(resident, "wake_time_min", value, d)
    assert abs(state["mu"] - 420.0) < 5.0


async def test_walk_count_zero_after_high_lambda_scores_urgent(resident, db):
    # 14 days of a steady, higher walking rate so the Poisson math for a
    # zero-count day genuinely clears the urgent surprise threshold (surprise
    # >= 2.0, i.e. p <= 0.01 -> needs lambda >~ 4.6). Note: the PRD's own
    # narrative example ("lambda=3.1, walked 0 times -> urgent") does not
    # actually clear its own thresholds -- e^-3.1 gives surprise ~= 1.28,
    # which is below the 1.3 warn cutoff, let alone urgent. Flagged separately.
    state = None
    for d in _dates(14):
        state = await baseline.update_feature(resident, "walk_count", 5.0, d)
    assert state["n"] == 14
    assert not state["cold_start"]

    result = baseline.score("walk_count", 0.0, state)
    assert result is not None
    assert result["severity"] == "urgent"
    assert result["kind"] == "poisson"


async def test_cold_start_p0_emits_nothing(resident, db):
    state = await baseline.update_feature(resident, "meal_count", 0.0, "2026-08-01")
    assert state["n"] == 1
    assert state["cold_start"] is True
    assert baseline.score("meal_count", 0.0, state) is None

    state = await baseline.update_feature(resident, "meal_count", 3.0, "2026-08-02")
    assert state["n"] == 2
    assert baseline.score("meal_count", 0.0, state) is None


async def test_cold_start_p1_only_urgent_fires(resident, db):
    # 3-6 observations: prior-blended, warn suppressed, only urgent allowed.
    state = None
    for d, v in zip(_dates(4, end="2026-08-04"), [3.0, 3.0, 3.0, 3.0]):
        state = await baseline.update_feature(resident, "walk_count", v, d)
    assert 3 <= state["n"] < 7
    # A mild deviation (would be "warn" at full confidence) is suppressed in P1.
    mild = baseline.score("walk_count", 1.0, state)
    assert mild is None or mild["severity"] == "urgent"


async def test_feedback_expected_downweights_and_suppresses_repeat(resident, db):
    dates = _dates(14)
    for d in dates:
        await baseline.update_feature(resident, "meal_count", 4.0, d)

    # A new day of zero meals is a real (warn-level) deviation against lambda=4.
    dev_day = (date.fromisoformat(dates[-1]) + timedelta(days=1)).isoformat()
    state = await baseline.update_feature(resident, "meal_count", 0.0, dev_day)
    result = baseline.score("meal_count", 0.0, state)
    assert result is not None
    assert result["severity"] == "warn"

    await baseline.apply_feedback(resident, dev_day, "meal_count", "expected")

    # The observation is downweighted, not deleted.
    obs = await db.baseline_observations.find_one(
        {"resident_id": resident, "feature": "meal_count", "date_local": dev_day}
    )
    assert obs["weight"] == 0.2

    # apply_feedback persists a cooldown flag on the baseline doc.
    bdoc = await db.baselines.find_one({"resident_id": resident, "feature": "meal_count"})
    assert bdoc["suppress_warn"] is True

    # The identical deviation recurring is now suppressed at warn level (the
    # PRD's 7-day cooldown, simplified to a sticky flag -- see the ponytail
    # note in apply_feedback for why it isn't time-bounded here).
    result2 = baseline.score("meal_count", 0.0, dict(state, suppress_warn=True))
    assert result2 is None


async def test_feedback_false_positive_excludes_observation(resident, db):
    for d in _dates(5, end="2026-08-05"):
        await baseline.update_feature(resident, "walk_count", 3.0, d)
    target_day = "2026-08-05"
    await baseline.apply_feedback(resident, target_day, "walk_count", "false_positive")
    obs = await db.baseline_observations.find_one(
        {"resident_id": resident, "feature": "walk_count", "date_local": target_day}
    )
    assert obs["weight"] == 0.0
