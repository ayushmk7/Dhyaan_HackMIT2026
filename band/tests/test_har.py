#!/usr/bin/env python3
# [claude] tests for the on-device activity classifier (har.py / har_model.py).
"""Three checks, no hardware and no ML runtime needed:

1. numpy-vs-PyTorch parity: the pure-numpy forward pass reproduces the
   training framework's probabilities on 20 held-out UCI-HAR windows
   (fixtures/har_parity_fixture.npz, saved at export time).
2. ring-buffer windowing: batches stream in like Bridge notifies; inference
   fires exactly on the 2.56 s window / 50 % hop schedule with the right
   window shape.
3. majority vote: one noisy window cannot flip the label; a sustained new
   label can; heartbeat_payload carries the optional activity_label key.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "fallband" / "python"))

import har  # noqa: E402
import har_model  # noqa: E402
from payloads import heartbeat_payload  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "har_parity_fixture.npz"


def test_parity() -> None:
    m = har_model.HarModel()
    fx = np.load(FIXTURE)
    max_diff = 0.0
    for x, p in zip(fx["x"], fx["probs"]):
        q = m.probs(x)
        max_diff = max(max_diff, float(np.abs(q - p).max()))
        assert abs(q.sum() - 1.0) < 1e-5
    assert max_diff < 1e-5, f"numpy forward diverges from torch: {max_diff}"
    print(f"ok  har numpy/torch parity (max abs prob diff {max_diff:.2e})")


class _StubModel:
    """Records window shapes; returns a scripted label sequence."""

    def __init__(self, labels):
        self.labels = list(labels)
        self.windows: list[tuple[int, ...]] = []

    def predict(self, window):
        self.windows.append(tuple(window.shape))
        label = self.labels.pop(0) if self.labels else "walking"
        return label, 0.9


def _feed(clf: har.HarClassifier, n_samples: int, xyz=(0, 0, 1000)) -> None:
    """Stream n_samples in MCU-sized CSV batches of 10."""
    chunk = f"{xyz[0]},{xyz[1]},{xyz[2]};"
    for start in range(0, n_samples, 10):
        clf.on_batch(chunk * min(10, n_samples - start))


def test_windowing() -> None:
    stub = _StubModel([])
    clf = har.HarClassifier(model=stub)  # type: ignore[arg-type]
    # 134 samples fill the first 2.56 s window; hop is 67 thereafter.
    _feed(clf, 133)
    assert clf.windows_run == 0, "fired before the window was full"
    _feed(clf, 1)
    assert clf.windows_run == 1
    _feed(clf, 66)
    assert clf.windows_run == 1, "fired before a full hop of new samples"
    _feed(clf, 1)
    assert clf.windows_run == 2
    _feed(clf, 67 * 3)
    assert clf.windows_run == 5
    # Model always sees the resampled (3, 128) tensor.
    assert set(stub.windows) == {(3, har_model.WINDOW)}
    print("ok  har ring-buffer windowing (134-sample window, 67-sample hop)")

    # Bad batches never raise out of the Bridge callback path.
    clf.on_batch("garbage;;1,2;x,y,z;")
    print("ok  har malformed batch tolerated")


def test_vote_and_heartbeat() -> None:
    changes: list[tuple[str, str | None]] = []
    stub = _StubModel(["walking"] * 4 + ["sitting"] + ["walking"] * 3 + ["sitting"] * 9)
    clf = har.HarClassifier(
        model=stub,  # type: ignore[arg-type]
        on_change=lambda new, old: changes.append((new, old)),
    )
    _feed(clf, 134 + 67 * 16)  # 17 inference windows
    # First stable label was walking; the single sitting window must not have
    # flipped it; the sustained sitting run must have.
    assert changes[0] == ("walking", None)
    assert changes[-1] == ("sitting", "walking")
    assert len(changes) == 2, f"noisy window flipped the vote: {changes}"
    assert clf.label == "sitting"

    hb = heartbeat_payload(band_id="band_unoq01", uptime_s=10, activity_label=clf.label)
    assert hb["activity_label"] == "sitting"
    assert "activity_label" not in heartbeat_payload(band_id="band_unoq01", uptime_s=10)
    print("ok  har majority vote + heartbeat activity_label passthrough")


def test_resample() -> None:
    # A pure 2 Hz sine at 52 Hz stays a 2 Hz sine at 50 Hz (max error small).
    t52 = np.arange(134) / har.STREAM_HZ
    samples = np.stack([np.sin(2 * np.pi * 2 * t52)] * 3, axis=1)
    out = har.resample_window(samples)
    assert out.shape == (3, 128)
    t50 = np.linspace(0.0, 2.56 - 0.02, 128)
    err = np.abs(out[0] - np.sin(2 * np.pi * 2 * t50)).max()
    assert err < 0.02, f"resample error {err}"
    print("ok  har 52->50 Hz resample")


def main() -> None:
    test_parity()
    test_windowing()
    test_vote_and_heartbeat()
    test_resample()
    print("all har tests passed")


if __name__ == "__main__":
    main()
