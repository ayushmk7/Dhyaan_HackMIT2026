#!/usr/bin/env python3
# [claude] new module: on-device activity classification (Linux side).
"""Neural activity classifier: walking / sitting / standing / lying.

The MCU streams raw acceleration over the Bridge ("accel_win" notifies, CSV
batches of milli-g ints at 52 Hz — 208 Hz fall-cascade samples decimated by 4).
This module rings them up, resamples each 2.56 s window to the model's
128-samples-at-50-Hz shape, and runs the pure-numpy 1D-CNN (har_model.py,
trained on UCI-HAR raw inertial signals). A majority vote over ~10 s of
windows smooths the per-window predictions; the voted label rides the next
heartbeat as `activity_label` and is logged on every change.

Honest caveats
--------------
* Training data is waist-mounted (UCI-HAR); the Dhyaan pendant hangs at the
  chest. Gravity still separates upright from lying, and walking dynamics
  survive the placement change, but sitting-vs-standing leans on subtle
  torso-tilt cues that a swinging pendant renders noisier than the validation
  accuracy suggests. Training used random yaw rotation about the vertical
  axis (device heading is arbitrary on a pendant) — a magnitude-only model
  was rejected because |a| = 1 g in every static posture, which makes
  sitting/standing/lying information-theoretically indistinguishable.
* The stream is clamped to ±4 g on the MCU. Fine for activity; the fall
  cascade keeps the full ±16 g on its own path.

Raw samples never leave the pendant — only the voted label goes to the hub.
"""
from __future__ import annotations

import logging
import threading
from collections import Counter, deque
from typing import Callable

import numpy as np

import har_model

log = logging.getLogger("fallband.har")

STREAM_HZ = 208.0 / 4.0          # MCU decimation: 52 Hz exactly
WINDOW_S = 2.56                  # model window (128 @ 50 Hz)
HOP_S = 1.28                     # 50% overlap
VOTE_WINDOWS = 8                 # ~10.2 s of predictions per vote


def parse_batch(csv: str) -> list[tuple[float, float, float]]:
    """'x,y,z;x,y,z;...' in milli-g -> list of (x, y, z) in g. Bad chunks skipped."""
    out: list[tuple[float, float, float]] = []
    for chunk in csv.split(";"):
        if not chunk:
            continue
        parts = chunk.split(",")
        if len(parts) != 3:
            continue
        try:
            out.append((int(parts[0]) / 1000.0, int(parts[1]) / 1000.0,
                        int(parts[2]) / 1000.0))
        except ValueError:
            continue
    return out


def resample_window(samples: np.ndarray, src_hz: float = STREAM_HZ) -> np.ndarray:
    """(N, 3) @ src_hz covering >= WINDOW_S -> (3, 128) @ 50 Hz via linear interp."""
    n = samples.shape[0]
    t_src = np.arange(n) / src_hz
    t_dst = np.linspace(0.0, WINDOW_S - 1.0 / 50.0, har_model.WINDOW)
    return np.stack([np.interp(t_dst, t_src, samples[:, i]) for i in range(3)])


class HarClassifier:
    """Ring buffer + windowed inference + majority vote. Thread-safe feed."""

    def __init__(
        self,
        model: har_model.HarModel | None = None,
        *,
        src_hz: float = STREAM_HZ,
        vote_windows: int = VOTE_WINDOWS,
        min_conf: float = 0.5,
        on_change: Callable[[str, str | None], None] | None = None,
    ):
        self.model = model or har_model.HarModel()
        self.src_hz = float(src_hz)
        self.win_n = int(round(WINDOW_S * self.src_hz)) + 1   # 134 @ 52 Hz
        self.hop_n = int(round(HOP_S * self.src_hz))          # 67 @ 52 Hz
        self.min_conf = min_conf
        self.on_change = on_change
        self._buf: deque[tuple[float, float, float]] = deque(maxlen=self.win_n)
        self._primed = False   # True once the first full window has run
        self._since_infer = 0
        self._votes: deque[str] = deque(maxlen=vote_windows)
        self._lock = threading.Lock()
        self.label: str | None = None       # current voted label
        self.confidence: float = 0.0        # last window's top prob
        self.windows_run = 0

    # -- feed (Bridge callback thread) ---------------------------------------

    def on_batch(self, csv: str) -> None:
        try:
            self._push(parse_batch(str(csv)))
        except Exception:                    # never let a bad batch kill Bridge
            log.exception("har batch failed")

    def _push(self, samples: list[tuple[float, float, float]]) -> None:
        with self._lock:
            fire = False
            for s in samples:
                self._buf.append(s)
                if self._primed:
                    self._since_infer += 1
                elif len(self._buf) == self.win_n:
                    self._primed = True      # first full window: infer now,
                    fire = True              # hop counting starts from here
            if not fire:
                if not self._primed or self._since_infer < self.hop_n:
                    return
                # Subtract (not reset): batches arrive ~10 samples at a time,
                # and zeroing would silently discard the overshoot, drifting
                # the hop schedule.
                self._since_infer -= self.hop_n
            window = np.array(self._buf, dtype=np.float32)
        self._infer(window)

    # -- inference + vote -----------------------------------------------------

    def _infer(self, window: np.ndarray) -> None:
        label, conf = self.model.predict(resample_window(window, self.src_hz))
        self.windows_run += 1
        self.confidence = conf
        if conf < self.min_conf:
            return                            # ambiguous window: abstain from vote
        self._votes.append(label)
        counts = Counter(self._votes)
        top, top_n = counts.most_common(1)[0]
        # Majority (not plurality) of the vote buffer, so one noisy window
        # can't flip the label; ties keep the current label.
        if top_n <= len(self._votes) / 2 or top == self.label:
            return
        prev, self.label = self.label, top
        log.info("activity: %s -> %s (conf %.2f, %d/%d windows)",
                 prev, top, conf, top_n, len(self._votes))
        if self.on_change:
            try:
                self.on_change(top, prev)
            except Exception:
                log.exception("har on_change failed")
