"""Cascade stages 1-3: privacy mask, motion, person.

Everything here that can be a pure function is one, so `tests/test_vision_gate.py`
can prove the logic on synthetic numpy arrays with no camera, no model and no
network. The two stateful bits (MOG2's background model, YOLO's weights) are the
two classes.
"""

import os
import time

import numpy as np

from . import FRAME_H, FRAME_W, TUNING
from . import posture as _posture


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

    def bbox(self):
        """Normalised (x0, y0, x1, y1) around the last foreground, or None.

        For the hub console ONLY — it is where something moved, which is not
        the same claim as "a person is here". Nothing that reaches an
        observation is derived from it; without a detector the VLM still owns
        `person_count`.
        """
        import cv2

        if self.fg is None:
            return None
        x, y, w, h = cv2.boundingRect((self.fg > 127).astype("uint8"))
        if w == 0 or h == 0:
            return None
        fh, fw = self.fg.shape[:2]
        return (x / fw, y / fh, (x + w) / fw, (y + h) / fh)


# --- stage 3: person, food, dishes, seating — one open-vocabulary pass --------
#
# COCO's entire food vocabulary is ten words (banana, apple, sandwich, orange,
# broccoli, carrot, hot dog, pizza, donut, cake). A crisp packet, a mug of soup,
# a bowl of cereal or a slice of toast has no output neuron, so no threshold
# and no bigger COCO model can ever report them. testcam/FOOD.md measured it:
# on five photographs of real food the COCO detector reported food once, and
# that once was wrong. YOLO-World takes its class list as free text at runtime
# and named the cereal and the soup, for ~7 ms a frame at the lane's 448x252.

DEFAULT_MODEL = "yolov8s-worldv2.pt"
# The one-line revert: YOLO_MODEL=yolo11s.pt puts the COCO detector back. The
# gate tells the two apart by capability (`set_classes`), not by name.
MODEL_NAME = os.getenv("YOLO_MODEL", DEFAULT_MODEL)
# Used only if the open-vocabulary model cannot come up (no CLIP, no network)
# AND this file is already on disk — never downloaded, because the reason we
# are here is usually that downloads do not work.
COCO_FALLBACK = "yolo11s.pt"

# --- the vocabulary -----------------------------------------------------------
# KEEP THIS SHORT, and read this before adding a word. YOLO-World's confidence
# is a cosine between an image region and a text embedding, so every score is
# RELATIVE TO THE PROMPT LIST. Same crisp packet, same weights, only the list
# differing (testcam/FOOD.md):
#
#     ["bag"]                       bag        0.75
#     ["snack bag"]                 snack bag  0.48
#     22 food words                 snack bag  0.11
#     a 62-word household list      snack bag  0.09   (below any usable floor)
#
# Adding a prompt costs nothing in latency (7.4 ms at 1 prompt, 8.1 ms at 100)
# and costs confidence on every other prompt. Twenty short plain nouns is what
# was measured to work; short nouns beat articled phrases ("snack bag" > "a bag
# of crisps"). The "background" bucket is not decoration: with no household
# nouns in the list the room has to land on a food word, and the food scores
# measurably dropped. Anything in it is never reported.
#
# Threshold, calibrated to THIS list on this machine (448x252 frames, imgsz
# 640, the seven testcam fixtures, a flat grey frame and 20 live webcam frames
# of a room with a person and no food):
#
#     cereal 0.64  snack bag 0.26  soup 0.14  food 0.26-0.53  cup 0.91
#     bowl 0.28-0.66  plate 0.62-0.76  dining table 0.21-0.55
#     live room with no food: highest non-person label 0.13 (a desk as
#       "dining table"); no food word above 0.03 in 20 frames
#     person: 0.90 live, 0.78-0.80 on a real photograph, 0.19 on a side
#       profile under a wide hat, 0.11-0.25 on a downscaled crowd; not one
#       false person on five people-free fixtures or the flat frame at a 0.01
#       floor
#
# So: objects at 0.20 (0.07 above the live room's noise, loses soup-in-a-mug
# at 0.14 but keeps its cup at 0.91), people at 0.15 (the bench's number; the
# crowd shot goes 8 people -> 1 at 0.25). Both live in TUNING as world_conf and
# world_person_conf. Changing the list re-opens the calibration.
VOCAB = {
    "person": ["person"],
    # The words COCO never had, plus the generic that catches whatever the
    # specifics miss. "food" is dropped from a scene when a specific word also
    # fired (see scene()).
    "food": ["food", "sandwich", "snack bag", "cereal", "soup", "noodles", "toast", "fruit"],
    "dishes": ["cup", "mug", "bowl", "plate", "bottle"],
    # vlm.from_scene reads "dining table" and "chair" for `spot`.
    "seating": ["chair", "sofa", "dining table", "bed"],
    "background": ["phone", "book"],
}
PROMPTS = [w for words in VOCAB.values() for w in words]
# The bound the tests assert. Not a limit of the model — a limit of the maths
# in the comment above.
MAX_PROMPTS = 24

# COCO's own words for the same four buckets, so a COCO model put back with
# YOLO_MODEL reports exactly what it used to. Mapped by name, not id: this is
# what lets one scene() serve both detectors.
COCO_WORDS = {
    "person": ["person"],
    "food": ["banana", "apple", "sandwich", "orange", "broccoli", "carrot",
             "hot dog", "pizza", "donut", "cake"],
    "dishes": ["bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl"],
    "seating": ["chair", "couch", "bed", "dining table"],
}
BUCKET = {w: b for table in (COCO_WORDS, VOCAB) for b, words in table.items() for w in words}

EMPTY_SCENE = {"person_count": 0, "boxes": [], "food": [], "dishes": [], "seating": []}


def dedupe_boxes(boxes, min_inside=0.7):
    """One person, several boxes: drop any box mostly inside a larger kept one.

    Ultralytics runs NMS per class at IoU 0.7, and YOLO-World hands back nested
    person boxes NMS leaves alone — measured on person_sandwich.jpg: whole body,
    then a torso box 98 % inside it whose IoU with it is only 0.47, because IoU
    punishes the size difference. So the test is containment, not IoU: the
    fraction of the SMALLER box that lies inside the larger. The head count is
    what present/with_visitor hangs off, so it cannot be left to the default.
    Two people side by side never contain each other; a child on a lap would
    merge, which is the safe direction for a single-resident home.
    Returns largest first, which is the order every caller wants.
    """
    out = []
    for b in sorted(boxes, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]), reverse=True):
        if not any(_inside(b, k) > min_inside for k in out):
            out.append(b)
    return out


def _inside(small, big):
    """Fraction of `small`'s area that overlaps `big`."""
    ix = max(0.0, min(small[2], big[2]) - max(small[0], big[0]))
    iy = max(0.0, min(small[3], big[3]) - max(small[1], big[1]))
    area = max((small[2] - small[0]) * (small[3] - small[1]), 1e-6)
    return ix * iy / area


class PersonGate:
    """YOLO-World on MPS: people and the objects that make a scene, in one pass.

    `enabled=False` is the plan's first cut path (`--no-yolo`, VLM_PLAN §3.3 and
    §9): motion alone triggers keyframes and the VLM's `person_count: 0` means
    absent. It costs VLM calls on curtains and cats, and loses the posture rule
    (no bbox -> no aspect -> no `on_floor` jump-the-queue). The gate takes that
    path by itself whenever the detector cannot come up — no ultralytics, no
    weights and no network, no CLIP for the text embeddings — and says why,
    once. It never raises out of __init__ or scene().
    """

    def __init__(self, enabled=True, tuning=None):
        self.t = dict(TUNING, **(tuning or {}))
        self.enabled = enabled
        self.model = None
        self.model_name = "none"
        self.open_vocab = False
        self.classes = None          # COCO only: the ids worth asking for
        self.device = "cpu"
        self.warm_s = 0.0
        # Labels reported on the previous pass, for the hysteresis in scene().
        self._held = set()
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

        self.model = self._load(YOLO, MODEL_NAME)
        if self.model is None and MODEL_NAME != COCO_FALLBACK and os.path.exists(COCO_FALLBACK):
            print(f"[vision] using {COCO_FALLBACK} from disk instead: people and COCO's "
                  "ten foods only, no cereal/soup/crisps until the open-vocabulary "
                  "model can load.", flush=True)
            self.model = self._load(YOLO, COCO_FALLBACK)
        if self.model is None:
            self.enabled = False
            return
        self.device = self._warm(torch)
        print(f"[vision] {self.model_name} on {self.device}: "
              + (f"open vocabulary, {len(PROMPTS)} prompts ({len(VOCAB['food'])} food), "
                 f"conf person>={self.t['world_person_conf']} objects>={self.t['world_conf']}"
                 if self.open_vocab else
                 f"COCO, {len(self.classes)} classes, conf>={self.t['person_conf']}")
              + f"; warm in {self.warm_s:.1f} s", flush=True)

    def _load(self, YOLO, name):
        """Weights, then the vocabulary. Returns the model or None, never raises.

        `YOLO(name)` downloads by name into the working directory when the file
        is absent (this is what ultralytics does; nothing here is committed).
        `set_classes()` builds CLIP text embeddings: 4.0 s the first time, and
        on a fresh machine a one-off ~340 MB ViT-B/32 download. That is why it
        happens here, at worker start, and never on the first frame.
        """
        try:
            model = YOLO(name)
            self.model_name = os.path.basename(name).replace(".pt", "")
            if hasattr(model, "set_classes"):
                t0 = time.monotonic()
                model.set_classes(list(PROMPTS))   # copy: ultralytics mutates it
                self.warm_s = time.monotonic() - t0
                self.open_vocab, self.classes = True, None
            else:
                self.open_vocab = False
                self.classes = sorted(i for i, n in model.names.items() if n in BUCKET)
            return model
        except Exception as e:                    # noqa: BLE001 — every load failure is the cut path
            print(f"[vision] {name} unusable: {type(e).__name__}: {str(e)[:140]}", flush=True)
            return None

    def _warm(self, torch):
        """One throwaway pass on a frame-sized blank, on MPS if MPS survives it.

        YOLO-World carries the text embeddings as a buffer and some
        ultralytics/MPS pairs fall over on the einsum in the contrastive head,
        so the device is measured, not assumed. The pass also builds the graph
        at the lane's own frame size, so the first real frame is not the slow
        one. YOLO_DEVICE overrides the probe.
        """
        want = os.getenv("YOLO_DEVICE")
        probe = np.zeros((FRAME_H, FRAME_W, 3), dtype=np.uint8)
        t0 = time.monotonic()
        for dev in [want] if want else (["mps"] if torch.backends.mps.is_available() else []) + ["cpu"]:
            try:
                self.model.predict(probe, device=dev, verbose=False, imgsz=self.t["person_imgsz"],
                                   **({"classes": self.classes} if self.classes else {}))
                self.warm_s += time.monotonic() - t0
                return dev
            except Exception as e:                # noqa: BLE001
                print(f"[vision] {dev} failed the probe ({type(e).__name__}); trying the next device",
                      flush=True)
        return "cpu"

    def _conf(self):
        """(person floor, object floor). COCO's closed-set logits and YOLO-World's
        cosines live an order of magnitude apart, so the threshold belongs to
        the model in use, never inherited across the YOLO_MODEL switch."""
        if self.open_vocab:
            return self.t["world_person_conf"], self.t["world_conf"]
        return self.t["person_conf"], self.t["person_conf"]

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
            return dict(EMPTY_SCENE, boxes=[], food=[], dishes=[], seating=[])
        # Hand the frame to posture_band(), which is called later in the cycle
        # with only a box. Nothing is retained: the slot holds one reference to
        # the frame the worker already has, and the next frame replaces it.
        remember_frame(frame)
        person_conf, obj_conf = self._conf()
        try:
            res = self.model.predict(
                frame, conf=min(person_conf, obj_conf), imgsz=self.t["person_imgsz"],
                device=self.device, verbose=False,
                **({"classes": self.classes} if self.classes else {}),
            )[0]
        except Exception as e:                    # noqa: BLE001
            # A detector that dies mid-run becomes the cut path, live, rather
            # than taking the camera down with it. The worker reads `enabled`
            # every frame.
            print(f"[vision] {self.model_name} failed on a frame ({type(e).__name__}: "
                  f"{str(e)[:120]}); continuing motion-only.", flush=True)
            self.enabled = False
            return dict(EMPTY_SCENE, boxes=[], food=[], dishes=[], seating=[])
        names = self.model.names
        # Hysteresis. A calibrated-low cosine floor means a real snack bag sits
        # at 0.26-0.28 over a 0.20 floor, and measured on a clip with a 1 px
        # hand-held jitter it crossed the line four times in a second — and
        # every crossing is a "what I see changed" post. So a label that was
        # reported last pass stays while it holds `world_hold` of its floor. It
        # is not memory of a stale plate: the label must still be detected on
        # THIS frame, just at a lower bar to stay than to arrive.
        hold = self.t["world_hold"] if self.open_vocab else 1.0
        boxes, found = [], {"food": set(), "dishes": set(), "seating": set()}
        for cls, conf, box in zip(res.boxes.cls.tolist(), res.boxes.conf.tolist(),
                                  res.boxes.xyxy.tolist()):
            label = names[int(cls)]
            bucket = BUCKET.get(label)
            if bucket == "person":
                if conf >= person_conf * (hold if "person" in self._held else 1.0):
                    boxes.append(tuple(box))
            elif bucket in found and conf >= obj_conf * (hold if label in self._held else 1.0):
                found[bucket].add(label)
        # The generic word is the net under the specifics: "cereal" says more
        # than "cereal, food", and the evidence line has room for two.
        if len(found["food"]) > 1:
            found["food"].discard("food")
        boxes = dedupe_boxes(boxes)
        self._held = set().union(*found.values()) | ({"person"} if boxes else set())
        return {"person_count": len(boxes), "boxes": boxes,
                "food": sorted(found["food"]), "dishes": sorted(found["dishes"]),
                "seating": sorted(found["seating"])}

# --- posture ------------------------------------------------------------------
# Measured on 20 live webcam frames of someone seated at a desk: the bbox aspect
# rule below called `wide` — i.e. on_floor — on 20 frames out of 20. A false fall
# on every frame, on the one band that jumps the keyframe queue into the alert
# path. So the bbox no longer gets the last word; `posture.py` asks the body.

# The frame the current box came from. `posture_band(box, tuning)` keeps its old
# signature because keyframe.py and worker.py both call it that way and neither
# is ours to edit, so the pixels arrive by the side door: PersonGate.scene() is
# handed the frame and the box in the same call, and stashes it here.
# ponytail: one module-level slot, single camera process, single worker thread.
# Ceiling: two cameras in one process would interleave frames here; the upgrade
# is to hang this off the PersonGate instance and pass it through the selector.
_LAST = {"frame": None, "box": None, "band": None}
_warned = False


def remember_frame(frame):
    """Called by PersonGate.scene(). Invalidates the cached posture with it."""
    _LAST["frame"], _LAST["box"], _LAST["band"] = frame, None, None


def iou(a, b):
    """Intersection over union of two boxes. 0 when they do not overlap."""
    if a is None or b is None:
        return 0.0
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    iw, ih = max(ix1 - ix0, 0.0), max(iy1 - iy0, 0.0)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    union = ((ax1 - ax0) * (ay1 - ay0)) + ((bx1 - bx0) * (by1 - by0)) - inter
    return inter / union if union > 0 else 0.0


def pick_subject(boxes, previous=None, min_iou=0.2):
    """Which of these people is the one we were already watching?

    Returns (box, switched). `switched` is True when the subject we had is gone
    and this is a DIFFERENT person - the caller should treat that as "she left",
    not as continuous presence.

    Without this, the subject was simply the largest box each frame. In a room
    with more than one person that silently hops: the resident lies down or
    walks out, a visitor is now the biggest box, and the system happily reports
    her as present and sitting. Nothing looked wrong; it was watching someone
    else. Measured the hard way - lying on the floor produced 60 of 60
    observations saying "sitting", because a second person was in frame.

    ponytail: IoU against the last box, no appearance model, no Kalman filter.
    It holds while she is visible frame to frame at 15 fps. It cannot re-identify
    her after she is occluded for a while - that needs the appearance descriptor
    from VLM_PLAN §4, and until then a re-entry reads as a new subject, which is
    the safe direction.
    """
    if not boxes:
        return None, False
    if previous is None:
        return max(boxes, key=lambda b: (b[2] - b[0]) * (b[3] - b[1])), False
    best = max(boxes, key=lambda b: iou(b, previous))
    if iou(best, previous) >= min_iou:
        return best, False
    # Nothing here overlaps who we were watching: she is gone, even though the
    # frame still has people in it.
    return max(boxes, key=lambda b: (b[2] - b[0]) * (b[3] - b[1])), True


def aspect(box):
    """bbox height/width. Taller than wide -> standing; wide -> on the floor."""
    if box is None:
        return None
    x0, y0, x1, y1 = box
    w = max(x1 - x0, 1e-6)
    return (y1 - y0) / w


def _bbox_band(box, t):
    """The old rule, kept for the two bands that cannot page anybody."""
    a = aspect(box)
    if a is None:
        return None
    if a < t["aspect_wide"]:
        return "wide"
    if a >= t["aspect_tall"]:
        return "tall"
    return "mid"


def posture_band(box, tuning=None):
    """"tall" | "mid" | "wide" | None — same four answers as before.

    A hint only: it decides when to *spend* a VLM call, and `wide` is the one
    that jumps the min_gap queue as a candidate fall. `None` means "I do not
    know", and every consumer already treats it that way — vlm.from_scene maps
    it to posture "unclear" and KeyframeSelector resets its wide run on it.

    Where the answer comes from, in order:

      1. Pose landmarks, when MediaPipe is there and a body was found in this
         box: upright->tall, seated->mid, on_floor->wide. An `unclear` from the
         landmarker (knees under a desk, say) returns None and STOPS THERE. It
         does not fall through to the bbox — that fallback is the bug: it is
         what turned a woman at her desk into `on_floor` on 20 frames of 20.
      2. No MediaPipe at all (import failed, model never downloaded): the bbox
         aspect, but `wide` degrades to None. tall/mid only ever cost a VLM
         call; `wide` starts an alert, and a rectangle on its own has not
         earned that. Logged once so nobody is surprised by a fall that never
         fires. The fix for that log line is `uv pip install -e ".[vision]"`.

    Net effect: the on_floor -> VLM -> alert path got strictly harder to enter,
    never easier.
    """
    global _warned
    if box is None:
        return None
    t = dict(TUNING, **(tuning or {}))
    frame = _LAST["frame"]

    if frame is None:
        # No frame was ever remembered, so this is not the camera lane: unit
        # tests and the synthetic source call posture_band() on a bare
        # rectangle. Keep the old bands there so KeyframeSelector's on_floor
        # confirm logic stays provable without a camera. In the live pipeline a
        # box only exists because PersonGate.scene() just ran on a frame, so
        # this branch cannot carry a real fall decision.
        return _bbox_band(box, t)

    if _posture.available():
        key = tuple(box)
        if _LAST["box"] != key:                  # ~13.8 ms; called 3x per cycle
            _LAST["box"] = key
            label, _conf = _posture.posture(frame, box)
            _LAST["band"] = {"upright": "tall", "seated": "mid",
                             "on_floor": "wide"}.get(label)
        return _LAST["band"]

    band = _bbox_band(box, t)
    if band == "wide":
        if not _warned:
            _warned = True
            print(f"[vision] no pose landmarks ({_posture.note()}); a wide bbox "
                  "alone will NOT be reported as on_floor. Install the vision "
                  "extra to restore fall detection.", flush=True)
        return None
    return band
