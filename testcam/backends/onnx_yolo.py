"""YOLO11n exported to ONNX, run through onnxruntime with the CoreML provider.

Same weights as the ultra-pytorch baseline, same imgsz, same conf — the only
thing that changes is the runtime underneath. That is the whole question this
row answers: does dropping PyTorch/MPS for onnxruntime/CoreML make the identical
model faster?

Ultralytics is imported ONCE, lazily, to produce models/yolo11n.onnx if it is not
already on disk. It is never imported at inference time: the letterbox, the
sigmoid-free decode and the NMS below are all local, so a detect() call touches
nothing but numpy and onnxruntime. Class names come out of the ONNX file's own
metadata, which the exporter embeds, so we do not need ultralytics to read them.
"""

import ast
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import COCO_FOOD, Backend, Result, biggest_box, posture_from_box  # noqa: E402

MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
ONNX_PATH = os.path.join(MODEL_DIR, "yolo11n.onnx")
IMGSZ = int(os.getenv("TESTCAM_IMGSZ", "640"))
CONF = float(os.getenv("TESTCAM_CONF", "0.35"))
IOU = 0.45


def _ensure_onnx():
    """Export yolo11n.pt -> models/yolo11n.onnx once. Import of ultralytics is
    scoped to this function so inference never pays for it."""
    if os.path.exists(ONNX_PATH):
        return
    os.makedirs(MODEL_DIR, exist_ok=True)
    from ultralytics import YOLO
    out = YOLO("yolo11n.pt").export(format="onnx", imgsz=IMGSZ, opset=12, simplify=True)
    if os.path.abspath(out) != os.path.abspath(ONNX_PATH):
        os.replace(out, ONNX_PATH)


def letterbox(frame, size):
    """Resize preserving aspect ratio, pad to square with grey. Returns the
    padded image plus the (scale, pad_x, pad_y) needed to invert it."""
    h, w = frame.shape[:2]
    r = min(size / h, size / w)
    nh, nw = int(round(h * r)), int(round(w * r))
    import cv2
    resized = cv2.resize(frame, (nw, nh), interpolation=cv2.INTER_LINEAR)
    out = np.full((size, size, 3), 114, dtype=np.uint8)
    dy, dx = (size - nh) // 2, (size - nw) // 2
    out[dy:dy + nh, dx:dx + nw] = resized
    return out, r, dx, dy


def nms(boxes, scores, iou_thr):
    """Plain greedy NMS on xyxy. ponytail: numpy, no torchvision, no cv2.dnn."""
    if len(boxes) == 0:
        return []
    x0, y0, x1, y1 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = np.maximum(x1 - x0, 0) * np.maximum(y1 - y0, 0)
    order = scores.argsort()[::-1]
    keep = []
    while order.size > 0:
        i = order[0]
        keep.append(i)
        if order.size == 1:
            break
        rest = order[1:]
        xx0 = np.maximum(x0[i], x0[rest])
        yy0 = np.maximum(y0[i], y0[rest])
        xx1 = np.minimum(x1[i], x1[rest])
        yy1 = np.minimum(y1[i], y1[rest])
        inter = np.maximum(xx1 - xx0, 0) * np.maximum(yy1 - yy0, 0)
        iou = inter / np.maximum(areas[i] + areas[rest] - inter, 1e-9)
        order = rest[iou <= iou_thr]
    return keep


class OnnxYolo(Backend):
    name = "onnx-yolo"

    def __init__(self):
        self.available, self.note, self.sess = False, "", None
        try:
            import cv2  # noqa: F401  (letterbox needs it)
            import onnxruntime as ort
        except Exception as e:
            self.note = f"import failed: {type(e).__name__}: {e}"
            return
        try:
            _ensure_onnx()
        except Exception as e:
            self.note = f"onnx export failed: {type(e).__name__}: {e}"
            return

        # CoreML first, CPU as the documented fallback. onnxruntime silently
        # drops a provider it cannot build, so read back what it actually used
        # rather than claiming CoreML in the table on trust.
        want = ["CoreMLExecutionProvider", "CPUExecutionProvider"]
        available = set(ort.get_available_providers())
        want = [p for p in want if p in available] or ["CPUExecutionProvider"]
        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        try:
            self.sess = ort.InferenceSession(ONNX_PATH, sess_options=so, providers=want)
        except Exception as e:
            self.note = f"session init failed: {type(e).__name__}: {e}"
            return

        used = self.sess.get_providers()[0]
        self.ep = used.replace("ExecutionProvider", "").lower()
        self.inp = self.sess.get_inputs()[0].name

        meta = self.sess.get_modelmeta().custom_metadata_map
        try:
            self.names = ast.literal_eval(meta["names"])
        except Exception:
            self.names = {i: str(i) for i in range(80)}

        self.name = f"onnx-yolo/{self.ep}"
        self.note = f"yolo11n.onnx imgsz={IMGSZ} conf={CONF} ep={used}"
        self.available = True

    def warmup(self, frame):
        for _ in range(3):
            self.detect(frame)

    def detect(self, frame):
        h, w = frame.shape[:2]
        padded, r, dx, dy = letterbox(frame, IMGSZ)
        # HWC BGR uint8 -> NCHW RGB float32 0..1
        blob = np.ascontiguousarray(
            padded[:, :, ::-1].transpose(2, 0, 1)[None].astype(np.float32) / 255.0)

        out = self.sess.run(None, {self.inp: blob})[0]   # (1, 84, 8400)

        # 84 = 4 box (cx,cy,w,h, letterboxed pixels) + 80 class scores. No
        # objectness in v8/v11 heads and the scores are already activated.
        pred = out[0].T                                   # (8400, 84)
        cls_scores = pred[:, 4:]
        cls_id = cls_scores.argmax(1)
        conf = cls_scores[np.arange(cls_scores.shape[0]), cls_id]
        m = conf >= CONF
        if not m.any():
            return Result(person_count=0, boxes=[], posture="unclear",
                          food=[], objects=[], note=self.note)
        pred, cls_id, conf = pred[m], cls_id[m], conf[m]

        cx, cy, bw, bh = pred[:, 0], pred[:, 1], pred[:, 2], pred[:, 3]
        xyxy = np.stack([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2], 1)
        # undo the letterbox back into original frame pixels
        xyxy[:, [0, 2]] = (xyxy[:, [0, 2]] - dx) / r
        xyxy[:, [1, 3]] = (xyxy[:, [1, 3]] - dy) / r
        xyxy[:, [0, 2]] = xyxy[:, [0, 2]].clip(0, w)
        xyxy[:, [1, 3]] = xyxy[:, [1, 3]].clip(0, h)

        boxes, food, objects = [], [], []
        # class-aware NMS: offset each class into its own coordinate band so
        # boxes of different classes never suppress each other.
        offset = cls_id.astype(np.float32) * (max(h, w) + IMGSZ)
        for i in nms(xyxy + offset[:, None], conf, IOU):
            label = self.names.get(int(cls_id[i]), str(cls_id[i]))
            if label == "person":
                boxes.append(tuple(float(v) for v in xyxy[i]))
            elif label in COCO_FOOD:
                food.append(label)
            else:
                objects.append(label)

        return Result(person_count=len(boxes), boxes=boxes,
                      posture=posture_from_box(biggest_box(boxes)),
                      food=sorted(set(food)), objects=sorted(set(objects)),
                      note=self.note)


BACKEND = OnnxYolo()
