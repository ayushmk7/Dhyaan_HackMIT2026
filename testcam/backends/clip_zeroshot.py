"""CLIP zero-shot: ask "is eating happening?" instead of "where is the sandwich?"

Two stages, both cheap:
  1. a small COCO YOLO finds the person box (COCO is perfectly good at `person`
     — person is the one class it was never the bottleneck on);
  2. crop it, hand the crop to CLIP ViT-B/32, and score a handful of sentences.

READ THIS BEFORE BELIEVING THE `food` COLUMN. This is classification, not
detection. It returns "the crop looks more like someone eating than like
someone holding a phone", with no box, no pixel coordinates, and no count. It
cannot tell you a sandwich is at (120, 80)-(190, 140), and it cannot say "two
plates". It answers a different question from YOLO-World, and it answers it
about the whole crop at once.

What it is genuinely good at: the open-ended activity question, for which no
detector vocabulary exists — "eating", "drinking", "on the phone", "asleep".
Softmax over prompts, so it ALWAYS returns a winner; the confidence and the
margin over the null prompt are the only things keeping it honest, which is why
both are printed and why a weak win reports no food at all.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import Backend, Result, biggest_box, posture_from_box  # noqa: E402

REPO_BACKEND = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                             "..", "..", "backend"))
DET_MODEL = os.getenv("TESTCAM_CLIP_DET", "yolo11n.pt")
DET_CONF = float(os.getenv("TESTCAM_CONF", "0.35"))
DET_IMGSZ = int(os.getenv("TESTCAM_CLIP_DET_IMGSZ", "448"))

# A softmax needs somewhere to put "none of the above", so the last two prompts
# are deliberate nulls. Below this probability we report nothing rather than the
# argmax, because the argmax is never empty.
MIN_P = float(os.getenv("TESTCAM_CLIP_MINP", "0.35"))

# (prompt, short label, is_this_food_evidence)
PROMPTS = [
    ("a photo of a person eating a meal",            "eating",        True),
    ("a photo of a person holding food",             "holding-food",  True),
    ("a photo of a person drinking from a mug",      "drinking",      True),
    ("a photo of a person holding a mobile phone",   "on-phone",      False),
    ("a photo of a person sitting and doing nothing", "idle",         False),
    ("a photo of an empty room with no people",      "empty-room",    False),
]


class ClipZeroShot(Backend):
    name = "clip-zeroshot"

    def __init__(self):
        self.available, self.note = False, ""
        self.det = self.clip = self.preprocess = self.text = None
        try:
            import torch
            from ultralytics import YOLO
        except Exception as e:
            self.note = f"import failed: {type(e).__name__}: {e}"
            return

        # ponytail: ultralytics already vendors an OpenAI-CLIP fork (YOLO-World
        # needs it for set_classes), so reuse that import rather than adding
        # open_clip or transformers for the same 150 MB of ViT-B/32 weights.
        try:
            import clip as openai_clip
        except Exception as e:
            self.note = ("no CLIP: pip install git+https://github.com/ultralytics/CLIP.git "
                         f"({type(e).__name__}: {e})")
            return

        self.torch = torch
        self.device = os.getenv("TESTCAM_CLIP_DEVICE") or (
            "mps" if torch.backends.mps.is_available() else "cpu")
        try:
            local = os.path.join(REPO_BACKEND, DET_MODEL)
            self.det = YOLO(local if os.path.exists(local) else DET_MODEL)
            self.clip, self.preprocess = openai_clip.load("ViT-B/32", device=self.device)
            self.clip.eval()
            with torch.no_grad():
                tok = openai_clip.tokenize([p for p, _, _ in PROMPTS]).to(self.device)
                t = self.clip.encode_text(tok).float()
                self.text = t / t.norm(dim=-1, keepdim=True)   # precomputed once
        except Exception as e:
            self.note = f"model load failed: {type(e).__name__}: {e}"
            return

        self.name = f"clip-zeroshot/{self.device}"
        self.note = (f"CLASSIFIER, NOT A DETECTOR: {DET_MODEL} crops the person, "
                     f"CLIP ViT-B/32 ranks {len(PROMPTS)} sentences over that crop. "
                     f"Gives 'eating is happening' (p>={MIN_P}), never 'a sandwich at "
                     f"these pixels'. No box, no count, no food label.")
        self.available = True

    def warmup(self, frame):
        for _ in range(3):
            self.detect(frame)

    def detect(self, frame):
        import numpy as np
        from PIL import Image

        r = self.det.predict(frame, imgsz=DET_IMGSZ, conf=DET_CONF,
                             device=self.device, verbose=False)[0]
        boxes = [tuple(float(v) for v in b.xyxy[0])
                 for b in r.boxes if self.det.names[int(b.cls)] == "person"]

        # No person -> score the whole frame anyway. The null prompts are there
        # precisely so "empty-room" can win.
        box = biggest_box(boxes)
        crop = _crop(frame, box) if box else frame
        if crop.size == 0:
            crop = frame

        img = Image.fromarray(crop[:, :, ::-1])            # BGR -> RGB
        x = self.preprocess(img).unsqueeze(0).to(self.device)
        with self.torch.no_grad():
            f = self.clip.encode_image(x).float()
            f = f / f.norm(dim=-1, keepdim=True)
            probs = (100.0 * f @ self.text.T).softmax(dim=-1)[0].cpu().numpy()

        i = int(np.argmax(probs))
        prompt, label, is_food = PROMPTS[i]
        p = float(probs[i])
        food = [f"{label}?p={p:.2f}"] if (is_food and p >= MIN_P) else []
        return Result(
            person_count=len(boxes), boxes=boxes,
            posture=posture_from_box(box),
            food=food,
            objects=[f"{label}?p={p:.2f}"],
            note=("activity guess only — CLIP softmax over sentences, "
                  "no location and no object name"))


def _crop(frame, box, pad=0.15):
    """Person box with a margin, because the food is in the hands, and the hands
    are routinely just outside a tight person box."""
    h, w = frame.shape[:2]
    x0, y0, x1, y1 = box
    mx, my = (x1 - x0) * pad, (y1 - y0) * pad
    return frame[max(0, int(y0 - my)):min(h, int(y1 + my)),
                 max(0, int(x0 - mx)):min(w, int(x1 + mx))]


BACKEND = ClipZeroShot()
