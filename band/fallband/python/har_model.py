#!/usr/bin/env python3
# [claude] new module: pure-numpy forward pass for the HAR 1D-CNN.
"""Human-activity model, inference only — no ML runtime on the pendant.

Architecture (trained offline in PyTorch on UCI-HAR raw total-acceleration
windows, weights exported to har_weights.npz):

    input  (3, 128)   three accel channels in g, 128 samples @ 50 Hz (2.56 s)
    conv1d 3->16 k9 p4, relu, maxpool 4
    conv1d 16->32 k9 p4, relu, maxpool 4
    flatten -> dense 256->64, relu -> dense 64->4, softmax

Classes: 0 walking (UCI walking + up/downstairs), 1 sitting, 2 standing,
3 lying. The container ships numpy only, so conv is an im2col matmul —
a full window costs ~1 ms on the UNO Q's Linux core.

Parity with the PyTorch reference is unit-tested against a fixture of 20
validation windows (band/tests/fixtures/har_parity_fixture.npz).
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

LABELS = ("walking", "sitting", "standing", "lying")
WINDOW = 128  # samples per inference window
DEFAULT_WEIGHTS = Path(__file__).resolve().parent / "har_weights.npz"


def _conv1d(x: np.ndarray, w: np.ndarray, b: np.ndarray, pad: int) -> np.ndarray:
    """x (C_in, L), w (C_out, C_in, K), b (C_out,) -> (C_out, L)."""
    c_in, length = x.shape
    c_out, _, k = w.shape
    xp = np.pad(x, ((0, 0), (pad, pad)))
    # im2col: columns (C_in*K, L), then one matmul.
    cols = np.empty((c_in * k, length), dtype=x.dtype)
    for i in range(k):
        cols[i * c_in:(i + 1) * c_in] = xp[:, i:i + length]
    wm = w.transpose(2, 1, 0).reshape(c_in * k, c_out)  # matches cols layout
    return wm.T @ cols + b[:, None]


def _maxpool(x: np.ndarray, size: int) -> np.ndarray:
    c, length = x.shape
    return x[:, : length - length % size].reshape(c, -1, size).max(axis=2)


def _softmax(z: np.ndarray) -> np.ndarray:
    e = np.exp(z - z.max())
    return e / e.sum()


class HarModel:
    def __init__(self, weights_path: Path | str = DEFAULT_WEIGHTS):
        w = np.load(weights_path)
        self.c1_w, self.c1_b = w["c1_w"].astype(np.float32), w["c1_b"].astype(np.float32)
        self.c2_w, self.c2_b = w["c2_w"].astype(np.float32), w["c2_b"].astype(np.float32)
        self.f1_w, self.f1_b = w["f1_w"].astype(np.float32), w["f1_b"].astype(np.float32)
        self.f2_w, self.f2_b = w["f2_w"].astype(np.float32), w["f2_b"].astype(np.float32)

    def probs(self, window: np.ndarray) -> np.ndarray:
        """window (3, 128) accel in g -> probabilities over LABELS."""
        x = np.asarray(window, dtype=np.float32)
        if x.shape != (3, WINDOW):
            raise ValueError(f"expected (3, {WINDOW}), got {x.shape}")
        x = _maxpool(np.maximum(_conv1d(x, self.c1_w, self.c1_b, 4), 0.0), 4)
        x = _maxpool(np.maximum(_conv1d(x, self.c2_w, self.c2_b, 4), 0.0), 4)
        # PyTorch flatten(1) is channel-major: (C, L) -> C*L in C order.
        h = x.reshape(-1)
        h = np.maximum(self.f1_w @ h + self.f1_b, 0.0)
        return _softmax(self.f2_w @ h + self.f2_b)

    def predict(self, window: np.ndarray) -> tuple[str, float]:
        p = self.probs(window)
        i = int(p.argmax())
        return LABELS[i], float(p[i])
