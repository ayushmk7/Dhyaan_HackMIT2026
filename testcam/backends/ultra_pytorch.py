"""The baseline: ultralytics YOLO on PyTorch/MPS, exactly as backend/vision runs it.

This is the ~13 ms number everything else has to beat. Same model file, same
conf, same imgsz as backend/vision/gate.py so the comparison is fair.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import COCO_FOOD, Backend, Result, biggest_box, posture_from_box  # noqa: E402

# The repo already has yolo11n/s/m.pt sitting in backend/ — reuse them rather
# than re-downloading. ponytail: hardcoded relative hop, this bench lives in the repo.
REPO_BACKEND = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                             "..", "..", "backend"))
MODEL = os.getenv("TESTCAM_MODEL", "yolo11n.pt")
IMGSZ = int(os.getenv("TESTCAM_IMGSZ", "640"))
CONF = float(os.getenv("TESTCAM_CONF", "0.35"))


def model_path(name=MODEL):
    local = os.path.join(REPO_BACKEND, name)
    return local if os.path.exists(local) else name   # else ultralytics downloads it


class UltraPyTorch(Backend):
    name = "ultra-pytorch"

    def __init__(self, device=None):
        self.available, self.note, self.model = False, "", None
        try:
            import torch
            from ultralytics import YOLO
        except Exception as e:
            self.note = f"import failed: {type(e).__name__}: {e}"
            return
        self.device = device or ("mps" if torch.backends.mps.is_available() else "cpu")
        try:
            self.model = YOLO(model_path())
        except Exception as e:
            self.note = f"model {MODEL} unavailable: {type(e).__name__}: {e}"
            return
        self.names = self.model.names
        self.name = f"ultra-pytorch/{self.device}"
        self.note = f"{MODEL} imgsz={IMGSZ} conf={CONF}"
        self.available = True

    def warmup(self, frame):
        for _ in range(3):        # MPS needs a couple of passes before it is honest
            self.detect(frame)

    def detect(self, frame):
        r = self.model.predict(frame, imgsz=IMGSZ, conf=CONF, device=self.device,
                               verbose=False)[0]
        return to_result(r, self.names, self.note)


def to_result(r, names, note=""):
    """Shared by the CoreML backend — an ultralytics Results object is an
    ultralytics Results object whatever ran underneath."""
    boxes, food, objects = [], [], []
    for b in r.boxes:
        label = names[int(b.cls)]
        if label == "person":
            x0, y0, x1, y1 = (float(v) for v in b.xyxy[0])
            boxes.append((x0, y0, x1, y1))
        elif label in COCO_FOOD:
            food.append(label)
        else:
            objects.append(label)
    return Result(person_count=len(boxes), boxes=boxes,
                  posture=posture_from_box(biggest_box(boxes)),
                  food=sorted(set(food)), objects=sorted(set(objects)), note=note)


BACKEND = UltraPyTorch()
