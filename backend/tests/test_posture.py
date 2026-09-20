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

import json

import numpy as np
import pytest

from vision import DEMO, TUNING, gate
from vision import posture as P
from vision import vlm, worker
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
    """No test leaks a remembered frame, a fired warning or a part-built run of
    wide reads into the next. The run is deliberately NOT cleared by
    remember_frame — it has to survive from frame to frame to mean anything —
    so it is cleared here instead."""
    gate.remember_frame(None)
    gate._warned = False
    gate._LAST["wide_run"] = 0
    yield
    gate.remember_frame(None)
    gate._warned = False
    gate._LAST["wide_run"] = 0


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
    for label, band in (("upright", "tall"), ("seated", "mid")):
        _landmarks_say(monkeypatch, label)
        gate.remember_frame(frame())        # new frame -> no cached answer
        assert gate.posture_band(BOX_WIDE) == band

    # `wide` is the one that opens an alert, so it costs a run of frames.
    _landmarks_say(monkeypatch, "on_floor")
    seen = []
    for _ in range(TUNING["pose_wide_run"]):
        gate.remember_frame(frame())
        seen.append(gate.posture_band(BOX_WIDE))
    assert seen[-1] == "wide"
    assert set(seen[:-1]) <= {None}, "a part-confirmed fall says nothing, not 'seated'"


def test_a_single_bad_hip_estimate_never_becomes_a_fall(monkeypatch):
    """The bug this exists for: over one morning 104 of 2091 observations came
    back `on_floor` with nobody ever on the floor. The landmarker puts the hips
    somewhere plausible when it cannot really see them, and a hip guessed a
    little sideways of the shoulders is a torso past 55 degrees."""
    for _ in range(4):
        _landmarks_say(monkeypatch, "on_floor")
        gate.remember_frame(frame())
        assert gate.posture_band(BOX_WIDE) is None

        _landmarks_say(monkeypatch, "seated")       # ...and the flicker passes
        gate.remember_frame(frame())
        assert gate.posture_band(BOX_WIDE) == "mid"


def test_the_run_does_not_carry_over_to_the_next_person(monkeypatch):
    _landmarks_say(monkeypatch, "on_floor")
    for _ in range(TUNING["pose_wide_run"] - 1):
        gate.remember_frame(frame())
        gate.posture_band(BOX_WIDE)
    gate.posture_band(None)                         # she left view
    gate.remember_frame(frame())
    assert gate.posture_band(BOX_WIDE) is None, "the run restarted"


def test_a_landmark_on_floor_still_fires_the_fall(monkeypatch):
    """Stricter, not deafer: a fall the body agrees with still jumps the queue."""
    _landmarks_say(monkeypatch, "on_floor")
    k = KeyframeSelector()
    reasons = []
    for i in range(8):
        # One frame per turn, which is what the lane does. `remember_frame` is
        # what lets the pose be read again, so the run is counted per frame and
        # someone lying perfectly still — an unchanging box — still confirms.
        gate.remember_frame(frame())
        reasons.append(k.update(float(i), True, BOX_WIDE))
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


# --- foreshortening: the one case the torso angle cannot see ------------------

def test_a_body_lying_toward_the_camera_is_unclear_not_seated():
    """She fell with her head toward the lens, so the fall projects as nothing.

    Shoulders 0.30 of the frame apart, hips barely below them, knees nearer the
    camera than the hips: the torso is 12 px long, tilt reads 0 degrees (i.e.
    "vertical"), the knees come out above the hips and the rule returned
    `seated` at confidence 1.0. A real fall, confidently contradicted, and the
    VLM lane never asked. Nothing here may say `seated` and nothing may say
    `on_floor` either - two normalised landmarks cannot tell this from a deep
    lean toward the lens.
    """
    lm = body(shoulder=(0.5, 0.50), hip=(0.5, 0.55), knee=(0.5, 0.52))
    lm[P.L_SHOULDER] = P.Landmark(0.35, 0.50, 1.0)
    lm[P.R_SHOULDER] = P.Landmark(0.65, 0.50, 1.0)
    label, _ = P.posture_from_landmarks(lm, H, W)
    assert label == "unclear", "a foreshortened torso is not a posture we read"

    # ...and the ordinary bodies are untouched: their torsos are longer than
    # their shoulders are wide, which is what standing and lying both look like.
    assert P.posture_from_landmarks(body(), H, W)[0] == "upright"
    assert P.posture_from_landmarks(
        body(shoulder=(0.2, 0.5), hip=(0.75, 0.52), knee=(0.9, 0.55)), H, W)[0] == "on_floor"


# --- from_scene: what the detector alone is allowed to assert ------------------

def _scene(people=1, food=(), dishes=(), seating=()):
    """The dict gate.PersonGate.scene() hands over, with nothing else in it."""
    return {"person_count": people, "food": list(food),
            "dishes": list(dishes), "seating": list(seating)}


def test_one_frame_of_a_standing_person_is_standing_not_walking():
    """A stance is not a journey. Two `walking` posts used to add up to
    "Eleanor was up and moving about", off two still frames."""
    assert vlm.from_scene(_scene(), "tall")["activity"] == "standing"
    assert vlm.from_scene(_scene(), "tall")["movement"] == "unclear"


def test_food_on_the_table_and_someone_walking_past_is_not_a_meal():
    """The bowl is evidence of a bowl. Posture is the only thing left that says
    she stopped for it - and `unclear` still counts, because at a table the
    knees are under it and the meal beat has to fire anyway."""
    lunch = _scene(food=["bowl of cereal"], dishes=["plate"], seating=["dining table"])
    assert vlm.from_scene(lunch, "tall")["activity"] != "eating"
    assert vlm.from_scene(lunch, "mid")["activity"] == "eating"
    assert vlm.from_scene(lunch, None)["activity"] == "eating"
    # ...and the floor still outranks the food.
    assert vlm.from_scene(lunch, "wide")["activity"] == "on_floor"


def test_the_demo_can_still_report_a_return_it_just_called_a_departure():
    """--demo calls her absent after 12 s; an appear gap of 30 then refused to
    report the re-entry, and spent the arrival for good."""
    assert DEMO["on_person_appear_gap_s"] == DEMO["absent_after_s"]


# --- the VLM call's own recovery path ------------------------------------------

def test_a_fenced_reply_on_the_constrained_retry_is_still_read(monkeypatch):
    """`format` constrains the decode, not the wrapper. Skipping the fence
    strip here raised out of the retry and dropped the batch - the recovery
    path failing on the one reply it exists for."""
    good = json.dumps(dict(vlm.ABSENT, activity="sitting", person_count=1))
    schemas = []

    def fake_post(images_b64, prompt, model, host, timeout, use_schema):
        schemas.append(use_schema)
        return "Sure! Here is the JSON:" if not use_schema else f"```json\n{good}\n```"

    monkeypatch.setattr(vlm, "_post", fake_post)
    obs, _ms = vlm.call([], "prompt")
    assert schemas == [False, True], "the retry never ran"
    assert obs["activity"] == "sitting"


# --- the two routes from a wide rectangle to the word "floor" ------------------

def test_one_wide_frame_is_not_yet_a_confirmed_floor():
    """`floor_confirmed` is what the worker's quick detector-change post reads
    before it may say `wide`. That path had no confirm of its own, so a nap on
    the sofa became "Eleanor appeared to be on the floor" off a single frame."""
    k = KeyframeSelector()
    assert k.floor_confirmed is False
    k.update(0.0, True, BOX_WIDE)
    assert k.floor_confirmed is False
    k.update(1.0, True, BOX_WIDE)
    assert k.floor_confirmed is True
    # She gets up: the run drops and so does the permission.
    k.update(2.0, True, BOX_TALL)
    assert k.floor_confirmed is False


def test_a_real_fall_is_not_held_behind_a_false_one_s_cooldown():
    """A false on_floor arms a 30 s cooldown. The fall that follows it was
    ANDed away here and then eaten by min_gap_s, so it arrived 20-30 s late.
    Four consecutive wide frames - twice the confirm - go through."""
    k = KeyframeSelector()
    assert [k.update(t, True, BOX_WIDE) for t in (2.0, 3.0)][-1] == "on_floor"
    k.update(4.0, True, BOX_TALL)                       # up again: it was nothing
    later = [k.update(t, True, BOX_WIDE) for t in (10.0, 11.0, 12.0, 13.0)]
    assert later[-1] == "on_floor", "the real fall waited out a false alarm"
    assert later[:-1] == [None, None, None], "the bypass must cost more, not less"


# --- the worker's two fail-closed edges ----------------------------------------

def test_a_config_reply_that_is_not_an_object_is_no_consent(monkeypatch):
    """A captive portal answers 200 with HTML. `cfg` was then a str and the
    first cfg.get() raised AttributeError out of run(), so the lane died
    instead of polling - the one thing the poll exists to survive."""
    w = worker.Worker(source="synthetic", camera_id="cam_x", api="http://localhost:0",
                      band_key="k", dry_run=True, no_yolo=True)
    monkeypatch.setattr(w, "_fetch_config", lambda: "<html>Sign in to continue</html>")
    w._refresh_config()
    assert w.cfg == worker.NO_CONSENT


def test_a_paused_camera_is_closed_and_reopened(monkeypatch):
    """The privacy beat, at the hardware. Everything else stops us USING the
    frames; the device stayed open, so the capture LED burned on through the
    one moment where the light has to agree with the screen."""
    w = worker.Worker(source="synthetic", camera_id="cam_x", api="http://localhost:0",
                      band_key="k", dry_run=True, no_yolo=True)
    cams = []

    class _Cam:
        def __init__(self):
            self.n, self.closed = 0, False
            cams.append(self)

        def read(self):
            self.n += 1
            return self.n, frame()

        def close(self):
            self.closed = True

        def script(self):
            return dict(vlm.ABSENT, boxes=[], person_count=0)

    ticks = []
    monkeypatch.setattr(worker, "SyntheticCamera", _Cam)
    monkeypatch.setattr(w, "heartbeat", lambda s: None)
    monkeypatch.setattr(w, "_refresh_config", lambda: None)
    # Paused for the first pass, watching after it; stop on the second monitor
    # tick, which is one full frame into the resumed run.
    monkeypatch.setattr(w, "state", lambda: "paused" if not ticks else "watching")
    monkeypatch.setattr(w, "monitor", lambda *a, **k: (
        ticks.append(1), setattr(w, "_stopping", len(ticks) >= 2)))
    w.cfg = dict(worker.STANDIN_CONFIG, consent_camera=1)
    w.run()

    assert len(cams) == 2, "the device was never closed, or never reopened"
    assert cams[0].closed is True, "the LED stayed on through the pause"
    assert cams[1].n >= 1, "the reopened camera never delivered a frame"
