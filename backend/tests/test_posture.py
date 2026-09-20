"""Posture from pose landmarks: no camera, no model, no network.

Every body here is synthetic — a list of `posture.Landmark(x, y, visibility)` in
MediaPipe's 33-point order — and every test that reaches `gate.posture_band()`
monkeypatches the landmarker away, so nothing in this file opens a device or a
socket.

The regression these tests exist for is at the top: a woman seated at a desk,
her knees hidden under it, was reported `on_floor` on 20 live webcam frames out
of 20. `unclear` is the correct answer there, and it is the answer this file
spends most of its lines defending.
"""

import numpy as np
import pytest

from vision import gate
from vision import posture as P
from vision.keyframe import KeyframeSelector

W, H = 448, 252                     # the real frame size the camera lane uses

# A wide bbox: h/w = 0.3, well under TUNING["aspect_wide"]. This is the exact
# shape a person at a desk makes, and the exact shape that used to fire a fall.
BOX_WIDE = (0.0, 0.0, 200.0, 60.0)
BOX_TALL = (0.0, 0.0, 50.0, 200.0)


def body(shoulder=(0.5, 0.25), hip=(0.5, 0.55), knee=(0.5, 0.85),
         torso_vis=1.0, knee_vis=1.0):
    """33 normalised landmarks: only the six joints the rule reads are placed."""
    lm = [P.Landmark(0.5, 0.5, 0.0) for _ in range(33)]
    for i, (x, y) in ((P.L_SHOULDER, shoulder), (P.R_SHOULDER, shoulder)):
        lm[i] = P.Landmark(x, y, torso_vis)
    for i, (x, y) in ((P.L_HIP, hip), (P.R_HIP, hip)):
        lm[i] = P.Landmark(x, y, torso_vis)
    for i, (x, y) in ((P.L_KNEE, knee), (P.R_KNEE, knee)):
        lm[i] = P.Landmark(x, y, knee_vis)
    return lm


def frame():
    return np.zeros((H, W, 3), dtype=np.uint8)


@pytest.fixture(autouse=True)
def _clean():
    """No test leaks a remembered frame or a fired warning into the next."""
    gate.remember_frame(None)
    gate._warned = False
    yield
    gate.remember_frame(None)
    gate._warned = False


# --- the rule itself, on synthetic bodies -------------------------------------

def test_knees_occluded_is_unclear_not_on_floor():
    """THE REGRESSION. Seated at a desk: shoulders and hips crisp, knees hidden.

    Measured on 20 live webcam frames, the bbox-aspect rule returned `on_floor`
    on 20 of 20 — a false fall every frame — while the landmarks showed
    shoulders/hips at 1.0/0.99 and knees at 0.15/0.03 because they were under
    the desk. Seated versus standing is genuinely unknowable from those pixels.
    `unclear` is the right answer and `on_floor` is never acceptable here.
    """
    lm = body(knee=(0.5, 0.9), torso_vis=1.0, knee_vis=0.15)
    label, conf = P.posture_from_landmarks(lm, H, W)
    assert label == "unclear"
    assert label != "on_floor"
    assert conf < 0.5                       # and it says how sure it is not


def test_a_genuinely_horizontal_body_is_on_floor():
    """Torso across the frame rather than down it. A real fall still reports."""
    lm = body(shoulder=(0.2, 0.5), hip=(0.75, 0.52), knee=(0.9, 0.55))
    label, conf = P.posture_from_landmarks(lm, H, W)
    assert label == "on_floor"
    assert conf >= 0.5


def test_standing_is_upright():
    label, _ = P.posture_from_landmarks(body(), H, W)
    assert label == "upright"


def test_seated_with_visible_knees_is_seated():
    """Thighs running across the frame: sitting, and it stays sitting."""
    lm = body(shoulder=(0.5, 0.3), hip=(0.5, 0.6), knee=(0.72, 0.62))
    label, _ = P.posture_from_landmarks(lm, H, W)
    assert label == "seated"


def test_a_body_we_cannot_see_at_all_is_unclear():
    assert P.posture_from_landmarks(body(torso_vis=0.2), H, W)[0] == "unclear"
    # Degenerate geometry (shoulders on top of hips) must not divide by zero.
    assert P.posture_from_landmarks(body(shoulder=(0.5, 0.5), hip=(0.5, 0.5)),
                                    H, W)[0] == "unclear"


def test_posture_without_a_frame_or_a_box_is_unclear():
    assert P.posture(None, BOX_WIDE) == ("unclear", 0.0)
    assert P.posture(frame(), None) == ("unclear", 0.0)


# --- posture_band: what the alert path actually sees ---------------------------

def _landmarks_say(monkeypatch, label, conf=0.9):
    monkeypatch.setattr(P, "available", lambda: True)
    monkeypatch.setattr(P, "posture", lambda f, b: (label, conf))


def test_landmark_unclear_never_falls_back_to_the_bbox(monkeypatch):
    """The fix, in one assertion: an occluded person does not become a fall.

    The box is the desk-shaped one that used to read `wide`. Because the
    landmarker looked and said `unclear`, posture_band must say None — NOT
    quietly re-ask the rectangle.
    """
    _landmarks_say(monkeypatch, "unclear", 0.15)
    gate.remember_frame(frame())
    assert gate.posture_band(BOX_WIDE) is None


def test_landmark_postures_map_onto_the_old_bands(monkeypatch):
    gate.remember_frame(frame())
    for label, band in (("upright", "tall"), ("seated", "mid"), ("on_floor", "wide")):
        _landmarks_say(monkeypatch, label)
        gate.remember_frame(frame())        # new frame -> no cached answer
        assert gate.posture_band(BOX_WIDE) == band


def test_a_landmark_on_floor_still_fires_the_fall(monkeypatch):
    """Stricter, not deafer: a fall the body agrees with still jumps the queue."""
    _landmarks_say(monkeypatch, "on_floor")
    gate.remember_frame(frame())
    k = KeyframeSelector()
    reasons = [k.update(float(i), True, BOX_WIDE) for i in range(4)]
    assert "on_floor" in reasons


def test_no_mediapipe_degrades_a_wide_bbox_to_unclear(monkeypatch, capsys):
    """MediaPipe unavailable: the bbox may hint, but it may not fire a fall."""
    monkeypatch.setattr(P, "available", lambda: False)
    monkeypatch.setattr(P, "note", lambda: "import failed: no mediapipe")
    gate.remember_frame(frame())

    assert gate.posture_band(BOX_WIDE) is None       # would have been "wide"
    assert gate.posture_band(BOX_TALL) == "tall"     # harmless hints survive
    out = capsys.readouterr().out
    assert "on_floor" in out and "mediapipe" in out  # logged once, not silent

    gate.posture_band(BOX_WIDE)
    assert capsys.readouterr().out == ""             # ...once


def test_no_mediapipe_never_fires_a_fall_however_long_the_bbox_stays_wide(monkeypatch):
    """Twenty desk frames in a row: not one on_floor keyframe."""
    monkeypatch.setattr(P, "available", lambda: False)
    monkeypatch.setattr(P, "note", lambda: "import failed: no mediapipe")
    gate.remember_frame(frame())
    k = KeyframeSelector()
    reasons = [k.update(float(i), True, BOX_WIDE) for i in range(20)]
    assert "on_floor" not in reasons
    assert k.wide_run == 0 and k.floor_fired is False


def test_the_pure_bbox_path_survives_for_callers_with_no_pixels():
    """No frame was ever remembered -> not the camera lane (unit tests, the
    synthetic source). The old bands stay, so KeyframeSelector's confirm logic
    is still provable without a camera. In the live pipeline a box only exists
    because PersonGate.scene() just ran, so this branch never decides a fall."""
    assert gate.posture_band(BOX_WIDE) == "wide"
    assert gate.posture_band(BOX_TALL) == "tall"
    assert gate.posture_band(None) is None
