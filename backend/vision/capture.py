"""Camera capture. The only module in the repo that opens a camera device.

No frame leaves this process except as a base64 JPEG over loopback to Ollama,
and none is ever written to disk (VLM_PLAN §5.3).
"""

import threading
import time

import cv2

from . import FRAME_H, FRAME_W, JPEG_QUALITY


class CameraUnavailable(RuntimeError):
    """The device would not open. Worth a sentence, not a traceback — on stage
    this is almost always the macOS permission prompt, not a bug."""


class Camera:
    """Grab-always thread holding exactly one frame.

    ponytail: one lock, one slot, no queue. The main loop is allowed to miss
    frames while the VLM blocks for 3-5 s — that is the point, not a bug; a
    queue would just hand it stale pixels. Ceiling: no reconnect on a device
    yanked mid-run (read() goes stale, the heartbeat goes `offline`).
    Upgrade: reopen the VideoCapture after N consecutive failed reads.

    `source` is an int index (0 = MacBook camera, higher = Continuity Camera or
    a USB cam) or a path to a video/still for rehearsal and the on-stage
    fallback. Files are played at real time and looped.
    """

    def __init__(self, source):
        self.source = int(source) if str(source).lstrip("-").isdigit() else source
        self.is_file = not isinstance(self.source, int)
        if self.is_file:
            self.cap = cv2.VideoCapture(self.source)
        else:
            self.cap = cv2.VideoCapture(self.source, cv2.CAP_AVFOUNDATION)
        if not self.cap.isOpened():
            hint = ("macOS has not granted this terminal camera access. The TCC prompt "
                    "attaches to the process that opens the device, so it must be "
                    "answered in an interactive terminal once — run `make vision-demo` "
                    "by hand and click Allow. Until then, --source a video file."
                    if not self.is_file else "check the path and that it is a readable video/image")
            raise CameraUnavailable(f"cannot open camera source {source!r}: {hint}")

        self._lock = threading.Lock()
        self._frame = None
        self._seq = 0
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._grab_loop, daemon=True)
        self._thread.start()

    def _grab_loop(self):
        fails = 0
        while not self._stop.is_set():
            ok, frame = self.cap.read()
            if not ok:
                if self.is_file:      # clip (or still) ran out -> rewind and loop
                    self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    fails += 1
                    if fails > 2:     # genuinely unreadable file, not a short one
                        time.sleep(0.2)
                    continue
                time.sleep(0.05)
                continue
            fails = 0
            frame = cv2.resize(frame, (FRAME_W, FRAME_H), interpolation=cv2.INTER_AREA)
            with self._lock:
                self._frame = frame
                self._seq += 1
            if self.is_file:
                time.sleep(1 / 30)    # a file plays at real time, not as fast as it decodes

    def read(self):
        """(seq, frame) or (0, None) before the first grab. seq lets the caller
        skip re-processing a frame it has already seen."""
        with self._lock:
            return self._seq, self._frame

    def close(self):
        self._stop.set()
        self._thread.join(timeout=1.0)
        self.cap.release()
        with self._lock:
            self._frame = None    # the ring is emptied on the way out too


def to_jpeg_b64(frame):
    """640x360 JPEG, quality 80, ~40 KB. In memory. Never a file."""
    import base64

    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY])
    if not ok:
        raise RuntimeError("jpeg encode failed")
    return base64.b64encode(buf.tobytes()).decode("ascii")


# --- the no-webcam source -----------------------------------------------------

def _person(img, x, top, bottom, shade=(78, 84, 96)):
    """One figure: a body box and a head. Not a photograph of anyone."""
    w = max(int((bottom - top) * 0.34), 6)
    cv2.rectangle(img, (int(x - w // 2), int(top + w)), (int(x + w // 2), int(bottom)), shade, -1)
    cv2.circle(img, (int(x), int(top + w // 2)), max(w // 2, 4), shade, -1)


class SyntheticCamera:
    """`--source synthetic`: a scripted day in a drawn living room, no webcam.

    Everything downstream of perception is real — the motion gate, the keyframe
    rules, the VLM call, the POST, the dedup, presence, the events, the
    websocket. What is NOT real is the perception: no detector and no 3B model
    reads a drawn figure as a person (measured on this machine: yolo11s scores
    the figure at 0.04, i.e. noise, and the VLM answers "no person visible"). So
    on this source `script()` says who is in the room and the cascade runs on
    that, and every row it produces carries `simulated: true` — which is what
    makes this an admission rather than a lie.

    Deterministic: the frame and the script are pure functions of the loop
    phase, and the phase is wall-clock, so two runs started at the same second
    see the same day. The loop is 120 s: empty room, she comes in, eats at the
    table with a plate, crosses to the armchair, a visitor sits with her, she
    gets up and leaves, empty room.

    ponytail: rectangles and circles, no sprites, no video file to ship.
    Ceiling: it proves the lane, not the perception — a bug in the prompt or the
    detector cannot fail here. Upgrade: `--source clip.mp4` of a real room,
    which `Camera` already plays and loops, and which does exercise both.
    """

    FPS = 30
    LOOP_S = 120.0

    def __init__(self):
        self.t0 = time.monotonic()
        self._seq, self._frame = -1, None

    def phase(self):
        return (time.monotonic() - self.t0) % self.LOOP_S

    def read(self):
        seq = int((time.monotonic() - self.t0) * self.FPS)
        if seq != self._seq:
            self._seq, self._frame = seq, self._draw(seq / self.FPS % self.LOOP_S)
        return self._seq + 1, self._frame

    def close(self):
        self._frame = None

    # --- the script: one source of truth for where the people are -------------

    def _figures(self, t):
        """[(x_centre, top, bottom)] in frame pixels. The drawing and the
        scripted observation both read this, so a box on the hub console is
        always where the figure actually is."""
        import numpy as np

        jitter = int(6 * np.sin(t * 2.2))     # never perfectly still: MOG2 would
        #                                       otherwise absorb her into the wall
        if t < 12 or t >= 110:
            return []
        if t < 22:                            # walking in from the right
            return [(440 - (t - 12) * 12, 60 + jitter, 215)]
        if t < 74:                            # seated at the table
            return [(330 + jitter, 96, 190)]
        if t < 80:                            # crossing to the armchair
            return [(330 - (t - 74) * 36, 60, 215)]
        if t < 100:                           # settled in the armchair
            her = [(86, 100 + jitter, 196)]
            return her + [(170 - jitter, 98, 200)] if 82 <= t < 98 else her
        return [(86 + (t - 100) * 40, 60, 215)]   # up and out of the room

    def script(self, t=None):
        """What is happening at loop phase `t`, as an Observation plus the
        normalised boxes for the console."""
        t = self.phase() if t is None else t
        figs = self._figures(t)
        boxes = []
        for x, top, bottom in figs:
            w = max((bottom - top) * 0.34, 6)
            boxes.append([max(x - w / 2, 0) / FRAME_W, top / FRAME_H,
                          min(x + w / 2, FRAME_W) / FRAME_W, bottom / FRAME_H])

        def obs(activity, spot, **over):
            base = dict(activity=activity, spot=spot, posture="seated", movement="slow",
                        person_count=len(figs), assistive_device="none",
                        plate_or_cup_present=False, food_visible=False,
                        hand_to_mouth_observed=False, changed_between_frames=True,
                        confidence=0.82, evidence=f"Scripted rehearsal frame at {t:.0f}s.",
                        boxes=boxes)
            return dict(base, **over)

        if not figs:
            return dict(ABSENT_SCRIPT, boxes=[])
        if t < 22 or 74 <= t < 80 or t >= 100:
            return obs("walking", "doorway" if t < 22 or t >= 100 else "other",
                       posture="upright", movement="normal")
        if 30 <= t < 70:
            return obs("eating", "table", plate_or_cup_present=True, food_visible=True,
                       hand_to_mouth_observed=True, confidence=0.86)
        if 82 <= t < 98:
            return obs("with_visitor", "armchair", confidence=0.79)
        if t < 74:
            return obs("sitting", "table")
        return obs("reading", "armchair")

    # --- the drawing ----------------------------------------------------------

    def _draw(self, t):
        import numpy as np

        f = np.zeros((FRAME_H, FRAME_W, 3), dtype="uint8")
        f[:, :] = (168, 176, 182)                                    # wall
        f[int(FRAME_H * 0.62):, :] = (112, 132, 152)                 # floor
        cv2.rectangle(f, (250, 130), (400, 158), (96, 120, 150), -1)  # table top
        cv2.rectangle(f, (300, 158), (315, 205), (96, 120, 150), -1)  # table leg
        cv2.rectangle(f, (40, 120), (130, 200), (120, 110, 105), -1)  # armchair

        if 30 <= t < 70:
            cv2.ellipse(f, (330, 140), (22, 9), 0, 0, 360, (240, 240, 235), -1)  # plate
            cv2.rectangle(f, (352, 132), (356, 148), (230, 230, 225), -1)        # cup
            # the fork hand, going to the mouth and back — the one motion that
            # makes "sitting at a table" into "eating"
            cv2.line(f, (334, 138), (330, 118 + int(abs(12 * np.sin(t * 2.2)))),
                     (78, 84, 96), 5)
        for i, (x, top, bottom) in enumerate(self._figures(t)):
            _person(f, x, top, bottom, shade=(78, 84, 96) if i == 0 else (64, 72, 88))
        return f


# The scripted stand-in for "nobody is in the room". Kept beside the script
# rather than imported from vlm.py, which would make capture.py depend on the
# model layer for a dict of five words.
ABSENT_SCRIPT = dict(
    activity="absent", person_count=0, posture="unclear", movement="unclear",
    spot="unclear", assistive_device="unclear", plate_or_cup_present=False,
    food_visible=False, hand_to_mouth_observed=False, changed_between_frames=False,
    confidence=0.9, evidence="No person visible in the room.",
)
