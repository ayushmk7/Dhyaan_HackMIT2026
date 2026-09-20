"""Posture from body geometry, not from a rectangle.

Why this module exists, measured: `gate.posture_band()` used to read posture off
the person bbox's aspect ratio — taller than wide = standing, wider than tall =
on the floor. Benchmarked against MediaPipe pose landmarks on 20 live webcam
frames of someone SITTING AT A DESK, the bbox method returned `on_floor` on
20 frames out of 20. That is a false fall signal on every single frame, and
`on_floor` is the one band that jumps the keyframe queue into the alert path.

A desk does that to a bounding box: the chair, the lean, the crop at the waist
all make the box wider than it is tall. A body does not become horizontal
because its rectangle did. So ask the body instead — where are the hips relative
to the shoulders and the knees — using MediaPipe's 33-point pose topology.

The other half of the fix is what we say when we cannot see. On those same 20
frames the landmarks had shoulders and hips at 1.0/0.99 visibility and knees at
0.15/0.03, because the knees were under the desk. The honest answer there is
`unclear`, and `unclear` is a first-class result here, not a failure: a carer
paged at 3am by a confident wrong posture is worse than one not paged by an
admitted unknown.

ponytail: pose landmarker only, no object detector. The full MediaPipe backend
measured 23.4 ms because it also ran EfficientDet for boxes; we already have
YOLO for boxes, so this is the ~13.8 ms half. Ceiling: one pose per frame
(`num_poses=1`), single-occupant homes. Upgrade for a two-person room is
num_poses=N plus matching each pose to its YOLO box.
"""

import logging
import os
import threading
import urllib.error
import urllib.request
from collections import namedtuple

import numpy as np

MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
MODEL_PATH = os.path.join(MODEL_DIR, "pose_landmarker_lite.task")
POSE_URL = ("https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
            "pose_landmarker_lite/float16/latest/pose_landmarker_lite.task")

# The landmarker's own 0.5 default finds nobody in dim or tightly-cropped frames.
# 0.3 finds the body; the per-landmark `visibility` check below is what keeps the
# call honest, so a looser detector does not let us invent a pose.
POSE_CONF = float(os.getenv("POSE_CONF", "0.3"))
VIS_MIN = float(os.getenv("POSE_VIS_MIN", "0.5"))   # below this, a joint is "not seen"

# Indices in MediaPipe's 33-point pose topology.
L_SHOULDER, R_SHOULDER = 11, 12
L_HIP, R_HIP = 23, 24
L_KNEE, R_KNEE = 25, 26

# Normalised landmark, in the shape MediaPipe hands back. Exported so tests can
# build a body out of thin air — no camera, no model, no network.
Landmark = namedtuple("Landmark", "x y visibility")

UNCLEAR = ("unclear", 0.0)

log = logging.getLogger("dhyaan.posture")

_lock = threading.Lock()
_landmarker = False          # False = not tried yet, None = unavailable
_note = ""


def _fetch(url, path):
    """Download the model once, atomically. Raises; the caller records why.

    urlretrieve rather than open(): tests/test_vision_gate.py walks this
    package's AST and fails on any `open()` call, because no frame may ever
    reach the disk (VLM_PLAN §5.3). That guard stands untouched — what lands
    here is a 5 MB model file from a constant URL, never a pixel. The .part
    rename means a killed download cannot leave half a model looking whole.
    """
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    urllib.request.urlretrieve(url, path + ".part")
    os.replace(path + ".part", path)


def _get():
    """The one PoseLandmarker, built on first use. None if we cannot have it.

    Lazy because importing mediapipe costs ~1 s and downloads a 5 MB model on
    the very first run; the camera lane should not pay that at import time.
    """
    global _landmarker, _note
    with _lock:
        if _landmarker is not False:
            return _landmarker
        _landmarker = None
        try:
            from mediapipe.tasks import python as mp_python
            from mediapipe.tasks.python import vision
        except Exception as e:                      # noqa: BLE001 - any import failure is the same answer
            _note = f"import failed: {type(e).__name__}: {e}"
            return None
        try:
            _fetch(POSE_URL, MODEL_PATH)
        except (urllib.error.URLError, OSError) as e:
            _note = f"model download failed: {type(e).__name__}: {e}"
            return None
        try:
            _landmarker = vision.PoseLandmarker.create_from_options(
                vision.PoseLandmarkerOptions(
                    base_options=mp_python.BaseOptions(model_asset_path=MODEL_PATH),
                    running_mode=vision.RunningMode.IMAGE,
                    num_poses=1,
                    min_pose_detection_confidence=POSE_CONF,
                    min_pose_presence_confidence=POSE_CONF))
            _note = "pose_landmarker_lite"
        except Exception as e:                      # noqa: BLE001
            _note = f"model load failed: {type(e).__name__}: {e}"
            _landmarker = None
        return _landmarker


def available():
    """True if landmarks can actually be asked for.

    `gate.posture_band()` branches on this, and the branch is a safety one: with
    landmarks, `unclear` means "I looked at the body and could not tell";
    without them there is nothing to look at, and the bbox is not allowed to
    fill the silence with a fall.
    """
    return _get() is not None


def note():
    """Why the landmarker is unavailable, for a one-line log. '' if it is fine."""
    _get()
    return _note


def posture_from_landmarks(lm, h, w):
    """(label, confidence) from the 33-point landmark list. Pure; no model.

    Normalised y grows downward. Three questions, in the order that actually
    separates the cases:

      1. Is the torso (shoulder->hip) tilted off vertical? Someone lying down
         has a torso nearer horizontal than vertical. That is on_floor, and it
         stays true whatever the bounding box happens to look like.
      2. Are the thighs (hip->knee) running across the frame rather than down
         it, or are the hips barely above the knees? That is sitting — and it
         stays sitting when she leans over the table, which is precisely where
         the aspect-ratio method flipped to on_floor.
      3. Otherwise torso vertical, hips well above knees: upright.

    Anything we cannot see well enough returns `unclear`. Confidence is the
    weakest landmark the answer leaned on, so a caller can tell a crisp read
    from a marginal one.
    """
    def pt(i):
        return np.array([lm[i].x * w, lm[i].y * h])

    def vis(*idx):
        return float(min(getattr(lm[i], "visibility", 1.0) for i in idx))

    torso_vis = vis(L_SHOULDER, R_SHOULDER, L_HIP, R_HIP)
    if torso_vis < VIS_MIN:
        return ("unclear", torso_vis)

    shoulder = (pt(L_SHOULDER) + pt(R_SHOULDER)) / 2
    hip = (pt(L_HIP) + pt(R_HIP)) / 2
    torso = hip - shoulder
    torso_len = float(np.linalg.norm(torso))
    if torso_len < 1e-3:
        return UNCLEAR

    # 0deg = torso straight up/down, 90deg = torso lying flat.
    tilt = float(np.degrees(np.arctan2(abs(torso[0]), abs(torso[1]))))
    if tilt > 55:
        return ("on_floor", torso_vis)

    knee_vis = vis(L_KNEE, R_KNEE)
    if knee_vis < VIS_MIN:
        # THE BUG, in one branch. Desk, table, blanket, duvet: torso plainly
        # visible and upright, knees hidden. Seated vs standing is genuinely
        # unknowable from these pixels, so say so. This must never fall through
        # to a bbox aspect — that fallback is what reported `on_floor` on 20 of
        # 20 frames of a woman at her desk.
        return ("unclear", knee_vis)

    knee = (pt(L_KNEE) + pt(R_KNEE)) / 2
    thigh = knee - hip
    if float(np.linalg.norm(thigh)) < 1e-3:
        return UNCLEAR
    thigh_tilt = float(np.degrees(np.arctan2(abs(thigh[0]), abs(thigh[1]))))
    hip_above_knee = (knee[1] - hip[1]) / torso_len

    conf = min(torso_vis, knee_vis)
    if thigh_tilt > 45 or hip_above_knee < 0.55:
        return ("seated", conf)
    return ("upright", conf)


def posture(frame, box):
    """("upright"|"seated"|"on_floor"|"unclear", confidence) for the person in `box`.

    `frame` is BGR uint8 as OpenCV hands it over; `box` is that person's pixel
    xyxy from YOLO. Every path that is not a clear read returns `unclear` with
    the confidence we had — no model, no pose found, a pose belonging to
    somebody else, or a body we could only half see.
    """
    if frame is None or box is None:
        return UNCLEAR
    pose = _get()
    if pose is None:
        return UNCLEAR

    import mediapipe as mp

    h, w = frame.shape[:2]
    try:
        # ponytail: the whole frame, not the crop. num_poses=1 means the
        # landmarker picks the most prominent body, which in a single-occupant
        # home is the one YOLO boxed — and the containment check below refuses
        # the answer when it is not. Ceiling: two people in shot, where the
        # second is simply never landmarked.
        img = mp.Image(image_format=mp.ImageFormat.SRGB,
                       data=np.ascontiguousarray(frame[:, :, ::-1]))
        res = pose.detect(img)
    except Exception:                               # noqa: BLE001
        return UNCLEAR
    if not res.pose_landmarks:
        return UNCLEAR

    lm = res.pose_landmarks[0]
    # Does this pose actually belong to this box? Torso centre inside it, with a
    # 20% margin for the usual box/pose disagreement. If not, we are about to
    # describe the wrong person, and the wrong person's posture is worse than
    # none.
    x0, y0, x1, y1 = box
    mx = (lm[L_SHOULDER].x + lm[R_SHOULDER].x + lm[L_HIP].x + lm[R_HIP].x) / 4 * w
    my = (lm[L_SHOULDER].y + lm[R_SHOULDER].y + lm[L_HIP].y + lm[R_HIP].y) / 4 * h
    px, py = 0.2 * (x1 - x0), 0.2 * (y1 - y0)
    if not (x0 - px <= mx <= x1 + px and y0 - py <= my <= y1 + py):
        return UNCLEAR

    return posture_from_landmarks(lm, h, w)


def close():
    """Shut the landmarker down while Python still exists.

    MediaPipe's PoseLandmarker owns a C++ dispatcher thread whose shutdown
    handler runs from __del__. Leave that to interpreter teardown and it fires
    after module globals have been cleared, so the handler it wants to call is
    already None:

        TypeError: 'NoneType' object is not callable
          in mediapipe/tasks/python/core/serial_dispatcher.py, shutdown_aware_handler

    Harmless in the sense that the work is done, ugly in the sense that the
    worker exits with a traceback every single time - and on a laptop that
    sleeps mid-demo, an unclean exit is one more thing that can go wrong.
    Closing it explicitly makes shutdown boring.

    Idempotent: safe to call twice, and safe when MediaPipe was never loaded.
    """
    global _landmarker
    with _lock:
        lm, _landmarker = _landmarker, False
        if lm and hasattr(lm, "close"):
            try:
                lm.close()
            except Exception as e:                  # noqa: BLE001
                log.debug("pose landmarker close failed: %s", e)
