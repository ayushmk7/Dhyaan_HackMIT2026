#!/usr/bin/env python3
# [claude] new module: on-device gait metrics (Linux side of the pendant).
"""Gait window math. Pure functions, no I/O — unit-tested in band/tests.

The privacy story is enforced here: raw IMU samples never leave the MCU, and
even the per-step records never leave the pendant. Only this window summary
(cadence, variability scores) goes over the wire, inside the heartbeat.

These are descriptive statistics over detected steps, not a trained model:
  cadence_spm       steps per minute over the window
  step_interval_cv  coefficient of variation of inter-step intervals
                    (higher = less regular stride timing)
  peak_g_cv         coefficient of variation of per-step impact peaks
                    (higher = less consistent foot-strike force)
"""
from __future__ import annotations

import math
from typing import Any


def _cv(values: list[float]) -> float:
    """Population coefficient of variation (std/mean). 0.0 when undefined."""
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    if mean <= 0:
        return 0.0
    var = sum((v - mean) ** 2 for v in values) / len(values)
    return math.sqrt(var) / mean


def summarize(
    step_times: list[float],
    peak_gs: list[float],
    *,
    window_s: float = 60.0,
    min_steps: int = 10,
) -> dict[str, Any] | None:
    """One gait summary for a window of detected steps, or None below the
    step floor (min_steps) — a couple of shuffles is not a walk and would
    produce garbage cadence/CV numbers."""
    n = len(step_times)
    if n < min_steps or n != len(peak_gs) or window_s <= 0:
        return None
    times = sorted(step_times)
    intervals = [b - a for a, b in zip(times, times[1:])]
    return {
        "window_s": round(float(window_s), 1),
        "steps": n,
        "cadence_spm": round(n / window_s * 60.0, 1),
        "step_interval_cv": round(_cv(intervals), 3),
        "peak_g_cv": round(_cv(list(peak_gs)), 3),
        "peak_g_p50": round(sorted(peak_gs)[n // 2], 2),
        "peak_g_max": round(max(peak_gs), 2),
    }
