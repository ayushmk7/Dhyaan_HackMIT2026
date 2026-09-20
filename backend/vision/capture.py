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
