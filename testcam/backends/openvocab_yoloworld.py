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

# Open-vocab detectors score lower than a closed-set softmax — the text/image
# similarity is a cosine, not a trained logit — so 0.35 (the COCO default in
# backend/vision) finds nothing. 0.12 is where the food prompts start firing.
CONF = float(os.getenv("TESTCAM_WORLD_CONF", "0.12"))
IMGSZ = int(os.getenv("TESTCAM_IMGSZ", "640"))

# --- the vocabulary -----------------------------------------------------------
# Three buckets, because Result wants food and objects separated. Every string
# here is a free-text prompt, NOT a trained class: rewriting this list is the
# entire "retraining" step. Phrases beat bare nouns ("a bag of crisps" >> "crisps").

PERSON = ["person"]

FOOD = [
    # the COCO ten still matter — they are the control
    "a sandwich", "a slice of pizza", "a banana", "an apple", "a slice of cake",
    # ...and everything COCO structurally cannot name
    "a bag of crisps", "an open packet of potato chips", "a snack wrapper",
    "a bowl of noodles", "a takeaway noodle box", "a plate of food",
    "a bowl of cereal", "a bowl of soup", "a mug of soup", "a cup of tea",
    "a protein bar", "a biscuit", "a piece of toast", "a plate of rice",
    "a person eating",
]

OBJECTS = [
    "a mug", "a cup", "a plate", "a bowl", "a drinking glass", "a water bottle",
    "a spoon", "a fork", "a mobile phone", "a walking frame", "a wheelchair",
    "a dining table", "an armchair", "a television remote",
]


def _vocab():
    """ponytail: env override is a comma-split. Anything overridden lands in
    `objects` unless it contains a food word — good enough for an experiment."""
    raw = os.getenv("TESTCAM_VOCAB")
    if not raw:
        return PERSON + FOOD + OBJECTS, set(FOOD)
    words = [w.strip() for w in raw.split(",") if w.strip()]
    return words, {w for w in words if w in set(FOOD)}


def _tidy(label):
    """"a bag of crisps" -> "bag of crisps". The article is prompt engineering,
    not something a care log should print."""
    for a in ("a ", "an ", "the "):
        if label.startswith(a):
            return label[len(a):]
    return label


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
                boxes.append(tuple(float(v) for v in b.xyxy[0]))
            elif label in self.food_set:
                food.append(_tidy(label))
            else:
                objects.append(_tidy(label))
        return Result(person_count=len(boxes), boxes=boxes,
                      posture=posture_from_box(biggest_box(boxes)),
                      food=sorted(set(food)), objects=sorted(set(objects)))


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
