"""YOLO-World: a YOLO you tell, at runtime, what words to look for.

The whole reason food detection "does not work" is that the baseline is a
COCO-trained YOLO, and COCO's food vocabulary is ten words long:

    sandwich pizza banana apple orange cake donut hot-dog broccoli carrot

A crisp packet, a noodle box, a mug of soup, a bowl of cereal, a protein bar —
none of those are a COCO class, so no confidence threshold and no model size
will ever make them appear. The model has no output neuron for them.

YOLO-World replaces the fixed classifier head with CLIP text embeddings, so
`set_classes([...])` re-specifies the vocabulary in one call with no retraining.
Still a one-stage YOLO underneath: one forward pass, real boxes, real pixels.

The prompts below are the actual product vocabulary — what a care camera needs
to name — not COCO's. Override with TESTCAM_VOCAB="a,b,c" to experiment.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import Backend, Result, biggest_box, posture_from_box  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WEIGHTS = os.path.join(HERE, "..", "weights",
                       os.getenv("TESTCAM_WORLD_MODEL", "yolov8s-worldv2.pt"))

# Open-vocab scores are a cosine between an image region and a text embedding,
# not a trained closed-set logit, so they live an order of magnitude lower than
# COCO's. 0.35 (what backend/vision/gate.py uses) returns literally nothing.
CONF = float(os.getenv("TESTCAM_WORLD_CONF", "0.15"))
IMGSZ = int(os.getenv("TESTCAM_IMGSZ", "640"))

# --- the vocabulary -----------------------------------------------------------
# Four buckets. Every string is a free-text prompt, not a trained class:
# rewriting this list IS the retraining step, and it costs nothing at inference
# (measured: 7.4 ms at 1 prompt, 8.1 ms at 100 — see FOOD.md).
#
# Two things were measured the hard way and are worth keeping:
#   * short plain nouns beat articled phrases ("snack bag" > "a bag of crisps");
#   * DISTRACTORS matter more than the food words do. With no household nouns
#     in the list, every blob has to land on a food prompt, and the crisp packet
#     scored 0.09. With the distractors below it scores 0.50. Background needs
#     somewhere to go.

PERSON = ["person", "person eating"]   # "person eating" is a person AND an activity

FOOD = [
    # the COCO ten are kept as the control — the words COCO already had
    "sandwich", "pizza", "banana", "apple", "cake",
    # ...and the words it never had
    "food", "snack bag", "potato chips", "wrapper", "noodles", "noodle box",
    "plate of food", "cereal", "soup", "protein bar", "biscuit", "toast",
    "rice", "bread", "fruit",
]

OBJECTS = [
    "mug", "cup", "plate", "bowl", "glass", "bottle", "spoon", "fork", "knife",
    "napkin", "tray", "table", "chair", "phone",
]

# Not reported, just somewhere for the rest of the room to land. Deleting these
# does not speed anything up and measurably hurts the food scores.
DISTRACTORS = [
    "book", "lamp", "sofa", "television", "remote control", "cushion", "blanket",
    "curtain", "rug", "box", "tin", "carton", "jar", "packet", "handbag",
    "newspaper", "keys", "glasses", "walking frame", "walking stick",
    "wheelchair", "medication box", "laptop", "clock", "door", "window",
]


def _vocab():
    """ponytail: env override is a comma-split, and everything in it is treated
    as food — you only override this to chase one word."""
    raw = os.getenv("TESTCAM_VOCAB")
    if raw:
        words = [w.strip() for w in raw.split(",") if w.strip()]
        return words, {w for w in words if w not in PERSON}
    return PERSON + FOOD + OBJECTS + DISTRACTORS, set(FOOD)


class YoloWorld(Backend):
    name = "yolo-world-s"

    def __init__(self):
        self.available, self.note, self.model = False, "", None
        try:
            import torch
            from ultralytics import YOLO
        except Exception as e:
            self.note = f"import failed: {type(e).__name__}: {e} (pip install ultralytics)"
            return
        try:
            import clip  # noqa: F401  — ultralytics' fork; set_classes() needs it
        except Exception:
            self.note = ("set_classes() needs OpenAI CLIP: "
                         "pip install git+https://github.com/ultralytics/CLIP.git")
            return

        path = WEIGHTS if os.path.exists(WEIGHTS) else os.path.basename(WEIGHTS)
        try:
            self.model = YOLO(path)          # downloads by name if the file is absent
            self.vocab, self.food_set = _vocab()
            self.model.set_classes(self.vocab)   # the one line COCO cannot offer
        except Exception as e:
            self.note = f"{os.path.basename(WEIGHTS)} unusable: {type(e).__name__}: {e}"
            return

        # ponytail: MPS is measured, not assumed — see _pick_device.
        self.device = _pick_device(self.model, torch)
        self.names = self.model.names
        self.name = f"yolo-world-s/{self.device}"
        self.note = (f"open vocabulary: {len(self.vocab)} free-text prompts "
                     f"({len(self.food_set)} of them food), conf={CONF} imgsz={IMGSZ}. "
                     f"Vocabulary is set at runtime, not trained.")
        self.available = True

    def warmup(self, frame):
        for _ in range(3):
            self.detect(frame)

    def detect(self, frame):
        r = self.model.predict(frame, imgsz=IMGSZ, conf=CONF, device=self.device,
                               verbose=False)[0]
        boxes, food, objects = [], [], []
        for b in r.boxes:
            label = self.names[int(b.cls)]
            if label in PERSON:
                # "person eating" competes with "person" for the same pixels, so
                # it has to count as a person or the head count silently drops.
                boxes.append(tuple(float(v) for v in b.xyxy[0]))
                if label == "person eating":
                    food.append("eating")
            elif label in self.food_set:
                food.append(label)
            else:
                objects.append(label)
        boxes = _dedupe(boxes)
        return Result(person_count=len(boxes), boxes=boxes,
                      posture=posture_from_box(biggest_box(boxes)),
                      food=sorted(set(food)), objects=sorted(set(objects)))


def _dedupe(boxes, iou=0.6):
    """One person, two prompts, two boxes. Ultralytics runs NMS per class, so
    "person" and "person eating" both survive on the same body and the head
    count doubles. Greedy IoU merge, biggest first. ponytail: agnostic_nms=True
    would also fix it, but it would suppress the soup inside the cup too, and
    that nesting is exactly what this backend is for."""
    out = []
    for b in sorted(boxes, key=lambda b: -(b[2] - b[0]) * (b[3] - b[1])):
        if not any(_iou(b, k) > iou for k in out):
            out.append(b)
    return out


def _iou(a, b):
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    if inter <= 0:
        return 0.0
    ar = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ar if ar > 0 else 0.0


def _pick_device(model, torch):
    """TESTCAM_WORLD_DEVICE wins; otherwise prefer MPS but only if it runs.

    YOLO-World carries the text embeddings as a buffer and some ultralytics/MPS
    combinations fall over on the einsum in the contrastive head. Rather than
    guess, do one throwaway pass and keep whichever device survives it.
    """
    want = os.getenv("TESTCAM_WORLD_DEVICE")
    if want:
        return want
    if not torch.backends.mps.is_available():
        return "cpu"
    import numpy as np
    try:
        model.predict(np.zeros((64, 64, 3), dtype=np.uint8), device="mps", verbose=False)
        return "mps"
    except Exception:
        return "cpu"


BACKEND = YoloWorld()
