"""The contract, the frame source, and the stopwatch. Everything else is a backend.

Three agents build against this file, so the shapes below are frozen:

    Result   - what every detect() returns
    Backend  - what every backends/*.py exposes as a module-level `BACKEND`
    frames() - identical pixels for everyone
    time_backend() - the only place a millisecond is measured

A backend module MUST be importable on a machine that has none of its deps.
That means: do the risky import inside __init__, catch everything, and set
`available = False` plus a one-line `note` saying what was missing. The bench
then prints a skip line. It must never raise at import time.
"""

import statistics
import time
from dataclasses import dataclass, field


# --- the contract -------------------------------------------------------------

@dataclass
class Result:
    person_count: int
    boxes: list = field(default_factory=list)   # [(x0,y0,x1,y1)] person boxes, pixel coords
    posture: str = "unclear"                    # "upright" | "seated" | "on_floor" | "unclear"
    food: list = field(default_factory=list)    # labels; [] if this backend cannot see food
    objects: list = field(default_factory=list) # cups, plates, bottles, furniture, whatever it knows
    note: str = ""                              # anything worth printing


class Backend:
    """Not a base class to inherit — a shape to match. Duck-type it.

    ponytail: no ABC, no registry, no plugin loader. bench.py imports every
    backends/*.py and looks for a module-level `BACKEND` (or a `get()` that
    returns one). That is the whole protocol.

        name: str        # short, fits a table column
        available: bool  # False -> bench prints `note` and skips, never crashes
        note: str        # why it is unavailable, or a caveat worth printing
        def warmup(self, frame) -> None
        def detect(self, frame) -> Result

    A backend that structurally cannot see food puts the exact phrase
    "no food classes" in its note. The verdict line reads that, so it can tell
    "saw no food in this room" apart from "could never see food at all".
    """
    name = "unnamed"
    available = False
    note = ""

    def warmup(self, frame):
        self.detect(frame)

    def detect(self, frame):
        raise NotImplementedError


# --- shared vocabulary --------------------------------------------------------

# COCO's entire food vocabulary. Ten classes. That is the point the README makes.
COCO_FOOD = {"banana", "apple", "sandwich", "orange", "broccoli", "carrot",
             "hot dog", "pizza", "donut", "cake"}

# Tableware / context, not food. A cup is not a meal but it is evidence of one.
COCO_TABLEWARE = {"cup", "bowl", "bottle", "wine glass", "fork", "knife", "spoon",
                  "dining table", "plate"}


def posture_from_box(box, frame_hw=None):
    """Aspect-ratio posture. Crude, shared, and identically crude for everyone —
    which is the only property that matters when comparing detectors.

    ponytail: a real posture call needs keypoints. This is h/w on the person box:
    tall = standing, squarish = sitting, wide = lying down. Backends that have
    real keypoints (apple_vision, mediapipe) are free to do better.
    """
    if not box:
        return "unclear"
    x0, y0, x1, y1 = box
    w, h = max(x1 - x0, 1e-6), max(y1 - y0, 1e-6)
    r = h / w
    if r >= 1.7:
        return "upright"
    if r >= 0.9:
        return "seated"
    return "on_floor"


def biggest_box(boxes):
    return max(boxes, key=lambda b: (b[2] - b[0]) * (b[3] - b[1])) if boxes else None


# --- frames -------------------------------------------------------------------

class CaptureFailed(RuntimeError):
    """Say this out loud rather than timing a backend on an empty array."""


def frames(n, size=(448, 252), source=0, warm=5):
    """`n` real frames, all the same size, as a list of BGR uint8 arrays.

    source=0 is the Mac webcam (macOS will prompt for camera permission the
    first time — the prompt attaches to this terminal process). Pass a path to
    a video or an image instead when there is no camera; a still is repeated,
    a clip is read frame by frame and rewound if it runs short.
    """
    import cv2

    is_file = not (isinstance(source, int) or str(source).lstrip("-").isdigit())
    if is_file:
        import os
        if not os.path.exists(source):
            raise CaptureFailed(f"--source {source!r} does not exist")
        still = cv2.imread(source)
        if still is not None:
            f = cv2.resize(still, size, interpolation=cv2.INTER_AREA)
            return [f.copy() for _ in range(n)]
        cap = cv2.VideoCapture(source)
    else:
        cap = cv2.VideoCapture(int(source), cv2.CAP_AVFOUNDATION)

    if not cap.isOpened():
        raise CaptureFailed(
            f"cannot open source {source!r}. If this is the webcam: macOS has not "
            "granted this terminal camera access. The permission prompt attaches to "
            "the process that opens the device, so answer it once in an interactive "
            "terminal, or run with --source <file.mp4|file.jpg>.")

    out = []
    try:
        for _ in range(warm):          # let auto-exposure settle; these are thrown away
            cap.read()
        misses = 0
        while len(out) < n:
            ok, f = cap.read()
            if not ok:
                misses += 1
                if is_file and misses <= 2:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                if misses > 30:
                    break
                time.sleep(0.01)
                continue
            out.append(cv2.resize(f, size, interpolation=cv2.INTER_AREA))
    finally:
        cap.release()

    if not out:
        raise CaptureFailed(f"opened {source!r} but read zero frames — nothing to time.")
    if len(out) < n:
        print(f"  (only {len(out)}/{n} frames came off {source!r}; timing those)")
    return out


# --- the stopwatch ------------------------------------------------------------

def time_backend(backend, fs):
    """Time detect() over `fs`, one frame at a time, wall clock.

    Returns (stats_dict, results). The backend is assumed already warmed —
    bench.py does that — so no model load is inside these numbers.
    Returns median=None on the first exception, with the traceback line in the
    stats, because a backend that throws has no latency worth printing.
    """
    ms, results = [], []
    for f in fs:
        t0 = time.perf_counter()
        try:
            r = backend.detect(f)
        except Exception as e:
            return {"median": None, "p90": None, "n": len(ms),
                    "error": f"{type(e).__name__}: {e}"}, results
        ms.append((time.perf_counter() - t0) * 1000)
        results.append(r)
    ms_sorted = sorted(ms)
    return {"median": statistics.median(ms),
            "p90": ms_sorted[min(int(round(0.9 * (len(ms_sorted) - 1))), len(ms_sorted) - 1)],
            "min": ms_sorted[0], "max": ms_sorted[-1], "n": len(ms), "error": None}, results
