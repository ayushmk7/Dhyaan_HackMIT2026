"""Cascade stages 1-3: privacy mask, motion, person.

Everything here that can be a pure function is one, so `tests/test_vision_gate.py`
can prove the logic on synthetic numpy arrays with no camera, no model and no
network. The two stateful bits (MOG2's background model, YOLO's weights) are the
two classes.
"""

import os

import numpy as np

from . import TUNING


# --- stage 1: privacy mask ----------------------------------------------------

def parse_mask(spec):
    """"x0,y0,x1,y1" of normalised floats -> tuple, or None.

    Validated here because it is a trust boundary of a sort: a typo that
    silently masks nothing is a private doorway left in shot.
    """
    if not spec:
        return None
    parts = [p.strip() for p in str(spec).split(",")]
    if len(parts) != 4:
        raise ValueError("--mask needs four comma-separated numbers: x0,y0,x1,y1")
    x0, y0, x1, y1 = (float(p) for p in parts)
    for v in (x0, y0, x1, y1):
        if not 0.0 <= v <= 1.0:
            raise ValueError("--mask values are normalised, 0.0-1.0")
    if x1 <= x0 or y1 <= y0:
        raise ValueError("--mask needs x1>x0 and y1>y0")
    return (x0, y0, x1, y1)


def apply_mask(frame, mask):
    """Black out a normalised rectangle. Runs BEFORE motion detection so the
    masked pixels never reach a detector, let alone the VLM (VLM_PLAN §5.1).

    ponytail: one rectangle, not a polygon list. Ceiling: an L-shaped exclusion
    needs two runs of this; upgrade is a list of rects and a loop.
    """
    if mask is None:
        return frame
    h, w = frame.shape[:2]
    x0, y0, x1, y1 = mask
    out = frame.copy()
    out[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)] = 0
    return out


# --- stage 2: motion ----------------------------------------------------------

class MotionGate:
    """MOG2 foreground ratio on 320x180 grey. ~2 ms/frame.

    Stateful by nature (it learns a background), so `score()` mutates the model
    — call it exactly once per sampled frame.
    """

    def __init__(self, tuning=None):
        import cv2

        self.t = dict(TUNING, **(tuning or {}))
        self._mog = cv2.createBackgroundSubtractorMOG2(
            history=self.t["mog_history"],
            varThreshold=self.t["mog_var_threshold"],
            detectShadows=False,     # shadows as motion is exactly the false wake we pay for
        )
        self.fg = None               # last foreground mask, for --preview only

    def score(self, frame):
        """Fraction of the (masked) frame that is foreground, 0.0-1.0."""
        import cv2

        small = cv2.resize(frame, (320, 180), interpolation=cv2.INTER_AREA)
        if small.ndim == 3:
            small = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        fg = self._mog.apply(small)
        self.fg = fg
        return float(np.count_nonzero(fg > 127)) / fg.size

    def moved(self, score):
        return score >= self.t["motion_ratio"]


# --- stage 3: person ----------------------------------------------------------

class PersonGate:
    """YOLO11s on MPS: people and the objects that make a scene, in one pass.

    `enabled=False` is the plan's first cut path (`--no-yolo`, VLM_PLAN §3.3 and
    §9): motion alone triggers keyframes and the VLM's `person_count: 0` means
    absent. It costs VLM calls on curtains and cats, and loses the posture rule
    (no bbox -> no aspect -> no `on_floor` jump-the-queue).
    """

    def __init__(self, enabled=True, tuning=None):
        self.t = dict(TUNING, **(tuning or {}))
        self.enabled = enabled
        self.model = None
        self.device = "cpu"
        if not enabled:
            return
        try:
            from ultralytics import YOLO      # lazy: importing torch costs ~3 s
            import torch
        except ImportError:
            # ponytail: no ultralytics/torch installed -> take the --no-yolo cut
            # path rather than refusing to start. Motion alone becomes presence
            # and the VLM's person_count decides absence (§3.3). Ceiling: the
            # posture rule and the 5 s re-confirm go with it, so a nap can read
            # as "out of view". Upgrade: install the `vision` extra.
            self.enabled = False
            return

        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        # yolo11s, not 11n. Measured on this camera, same frames: 11n 4.9 ms
        # finding 4 people, 11s 6.0 ms finding 5. A person the detector misses
        # is a resident reported absent, so 1.1 ms for the extra recall is the
        # easiest trade in this pipeline. 11m costs 11.5 ms and finds no more.
        self.model = YOLO(os.getenv("YOLO_MODEL", "yolo11s.pt"))

    # COCO class ids. The VLM was being asked for all of this at ~1120 ms/call;
    # YOLO answers it in ~6 ms and does not hallucinate a sandwich.
    FOOD_IDS = {46: "banana", 47: "apple", 48: "sandwich", 49: "orange",
                50: "broccoli", 51: "carrot", 52: "hot dog", 53: "pizza",
                54: "donut", 55: "cake"}
    DISH_IDS = {39: "bottle", 40: "wine glass", 41: "cup", 42: "fork",
                43: "knife", 44: "spoon", 45: "bowl"}
    SEAT_IDS = {56: "chair", 57: "couch", 59: "bed", 60: "dining table"}

    def scene(self, frame):
        """One pass, everything structural: people, food, dishes, seating.

        Returns {person_count, boxes, food, dishes, seating}. This is the half of
        an observation that does not need language, and it is ~200x cheaper than
        asking the VLM for it. `boxes` are pixel xyxy in the frame handed in,
        largest first — the caller normalises before anything leaves the process.

        Off (or with no model) it returns the same shape, empty. A caller must
        never have to ask which of the two it got.
        """
        if not self.enabled or self.model is None:
            return {"person_count": 0, "boxes": [], "food": [], "dishes": [], "seating": []}
        want = [0] + list(self.FOOD_IDS) + list(self.DISH_IDS) + list(self.SEAT_IDS)
        res = self.model.predict(
            frame, classes=want, conf=self.t["person_conf"],
            imgsz=self.t["person_imgsz"], device=self.device, verbose=False,
        )[0]
        boxes, food, dishes, seating = [], [], [], []
        for cls, box in zip(res.boxes.cls.tolist(), res.boxes.xyxy.tolist()):
            c = int(cls)
            if c == 0:
                boxes.append(tuple(box))
            elif c in self.FOOD_IDS:
                food.append(self.FOOD_IDS[c])
            elif c in self.DISH_IDS:
                dishes.append(self.DISH_IDS[c])
            elif c in self.SEAT_IDS:
                seating.append(self.SEAT_IDS[c])
        boxes.sort(key=lambda b: (b[2] - b[0]) * (b[3] - b[1]), reverse=True)
        return {"person_count": len(boxes), "boxes": boxes,
                "food": sorted(set(food)), "dishes": sorted(set(dishes)),
                "seating": sorted(set(seating))}

# --- posture, from the bbox alone (pure) --------------------------------------

def aspect(box):
    """bbox height/width. Taller than wide -> standing; wide -> on the floor."""
    if box is None:
        return None
    x0, y0, x1, y1 = box
    w = max(x1 - x0, 1e-6)
    return (y1 - y0) / w


def posture_band(box, tuning=None):
    """"tall" | "mid" | "wide" | None.

    A hint only — it decides when to *spend* a VLM call, never what gets
    reported. The VLM's `posture` field is what is posted.
    """
    a = aspect(box)
    if a is None:
        return None
    t = dict(TUNING, **(tuning or {}))
    if a < t["aspect_wide"]:
        return "wide"
    if a >= t["aspect_tall"]:
        return "tall"
    return "mid"
