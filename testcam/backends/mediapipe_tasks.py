"""MediaPipe Tasks: EfficientDet-Lite0 for objects + PoseLandmarker for posture.

The reason this row exists is *posture*. Every other backend here infers posture
from the person bbox's aspect ratio (common.posture_from_box), which is a lie the
moment somebody leans forward at a table: the box goes wide, h/w drops under 0.9,
and the row says "on_floor" for a woman reaching for the salt. MediaPipe returns
33 body landmarks, so the question can be asked properly — where are the hips
relative to the shoulders and the knees — and seated/upright/on_floor falls out of
geometry that actually describes a body.

Two models, run back to back on every frame:
  * efficientdet_lite0.tflite  — COCO-80, so exactly the same ten food classes
    YOLO has and not one thing more. A crisp packet is not in here.
  * pose_landmarker_lite.task  — 33 landmarks for the single largest person.

Both download on first run into testcam/models/. If the download fails the
backend marks itself unavailable with the real error and the bench skips it.
"""

import os
import sys
import urllib.error
import urllib.request

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import COCO_FOOD, Backend, Result  # noqa: E402

MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")

# ponytail: the object detector ships as a bare .tflite; only the landmarkers are
# bundled as .task. Same loader either way, so the extension is cosmetic.
DETECTOR_URL = ("https://storage.googleapis.com/mediapipe-models/object_detector/"
                "efficientdet_lite0/float32/latest/efficientdet_lite0.tflite")
POSE_URL = ("https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
            "pose_landmarker_lite/float16/latest/pose_landmarker_lite.task")

CONF = float(os.getenv("TESTCAM_CONF", "0.35"))

# Indices in MediaPipe's 33-point pose topology.
L_SHOULDER, R_SHOULDER = 11, 12
L_HIP, R_HIP = 23, 24
L_KNEE, R_KNEE = 25, 26


def _fetch(url, path):
    """Download once, atomically. Raises so the caller can record the reason."""
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".part"
    with urllib.request.urlopen(url, timeout=60) as r, open(tmp, "wb") as f:
        f.write(r.read())
    os.replace(tmp, path)


def posture_from_landmarks(lm, h, w):
    """Posture from body geometry rather than from a rectangle.

    `lm` is the 33-point normalized landmark list; normalized y grows downward.
    Three questions, in the order that actually separates the cases:

      1. Is the torso (shoulder->hip) tilted off vertical? Someone lying down has
         a torso nearer horizontal than vertical. That is on_floor, and note it
         stays true whatever the bounding box happens to look like.
      2. Are the thighs (hip->knee) running across the frame rather than down it,
         or are the hips barely above the knees? That is sitting — and it stays
         sitting when the person leans over the table, which is precisely where
         the aspect-ratio method flips to "on_floor".
      3. Otherwise torso vertical, hips well above knees: upright.

    Anything we cannot see well enough gets "unclear" rather than a guess,
    because a confident wrong posture is how you page a carer at 3am.
    """
    def pt(i):
        return np.array([lm[i].x * w, lm[i].y * h])

    def vis(*idx):
        return min(getattr(lm[i], "visibility", 1.0) for i in idx)

    if vis(L_SHOULDER, R_SHOULDER, L_HIP, R_HIP) < 0.5:
        return "unclear"

    shoulder = (pt(L_SHOULDER) + pt(R_SHOULDER)) / 2
    hip = (pt(L_HIP) + pt(R_HIP)) / 2
    torso = hip - shoulder
    torso_len = float(np.linalg.norm(torso))
    if torso_len < 1e-3:
        return "unclear"

    # 0deg = torso straight up/down, 90deg = torso lying flat.
    tilt = float(np.degrees(np.arctan2(abs(torso[0]), abs(torso[1]))))
    if tilt > 55:
        return "on_floor"

    if vis(L_KNEE, R_KNEE) < 0.5:
        # Very common webcam framing: head and torso only. The torso is upright
        # but sitting vs standing is genuinely unknowable from these pixels.
        return "unclear"

    knee = (pt(L_KNEE) + pt(R_KNEE)) / 2
    thigh = knee - hip
    if float(np.linalg.norm(thigh)) < 1e-3:
        return "unclear"
    thigh_tilt = float(np.degrees(np.arctan2(abs(thigh[0]), abs(thigh[1]))))
    hip_above_knee = (knee[1] - hip[1]) / torso_len

    if thigh_tilt > 45 or hip_above_knee < 0.55:
        return "seated"
    return "upright"


class MediaPipeTasks(Backend):
    name = "mediapipe-tasks"

    def __init__(self):
        self.available, self.note = False, ""
        self._det = self._pose = None
        try:
            import mediapipe as mp
            from mediapipe.tasks import python as mp_python
            from mediapipe.tasks.python import vision
        except Exception as e:
            self.note = f"import failed: {type(e).__name__}: {e}"
            return

        det_path = os.path.join(MODEL_DIR, "efficientdet_lite0.tflite")
        pose_path = os.path.join(MODEL_DIR, "pose_landmarker_lite.task")
        try:
            _fetch(DETECTOR_URL, det_path)
            _fetch(POSE_URL, pose_path)
        except (urllib.error.URLError, OSError) as e:
            self.note = f"model download failed: {type(e).__name__}: {e}"
            return

        try:
            self._det = vision.ObjectDetector.create_from_options(
                vision.ObjectDetectorOptions(
                    base_options=mp_python.BaseOptions(model_asset_path=det_path),
                    running_mode=vision.RunningMode.IMAGE,
                    score_threshold=CONF))
            self._pose = vision.PoseLandmarker.create_from_options(
                vision.PoseLandmarkerOptions(
                    base_options=mp_python.BaseOptions(model_asset_path=pose_path),
                    running_mode=vision.RunningMode.IMAGE,
                    num_poses=1))   # ponytail: single occupant, same as the real pipeline
        except Exception as e:
            self.note = f"model load failed: {type(e).__name__}: {e}"
            return

        self._Image, self._SRGB = mp.Image, mp.ImageFormat.SRGB
        self.available = True
        self.note = (f"efficientdet-lite0 COCO-80 conf={CONF}; posture from 33 pose "
                     "landmarks, not bbox aspect ratio")

    def _wrap(self, frame):
        """frame is BGR uint8 from OpenCV; MediaPipe wants contiguous SRGB."""
        return self._Image(image_format=self._SRGB,
                           data=np.ascontiguousarray(frame[:, :, ::-1]))

    def warmup(self, frame):
        img = self._wrap(frame)
        self._det.detect(img)
        self._pose.detect(img)

    def detect(self, frame):
        h, w = frame.shape[:2]
        img = self._wrap(frame)

        boxes, food, objects = [], [], []
        for d in self._det.detect(img).detections:
            if not d.categories:
                continue
            label = d.categories[0].category_name
            bb = d.bounding_box
            x0, y0 = float(bb.origin_x), float(bb.origin_y)
            box = (x0, y0, x0 + float(bb.width), y0 + float(bb.height))
            if label == "person":
                boxes.append(box)
            elif label in COCO_FOOD:
                food.append(label)
            else:
                objects.append(label)

        pose = self._pose.detect(img)
        if pose.pose_landmarks:
            posture = posture_from_landmarks(pose.pose_landmarks[0], h, w)
            note = "posture from pose landmarks"
        else:
            posture = "unclear"
            note = "no pose landmarks in frame"

        # The two models disagree sometimes. The landmarker found an actual
        # articulated body, so let it rescue a person the detector missed.
        count = len(boxes) or (1 if pose.pose_landmarks else 0)

        return Result(person_count=count, boxes=boxes, posture=posture,
                      food=sorted(set(food)), objects=sorted(set(objects)), note=note)


BACKEND = MediaPipeTasks()
