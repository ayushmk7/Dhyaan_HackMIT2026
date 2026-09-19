"""Cascade stage 4: which frames are worth 3 seconds of VLM.

This is the module the whole plan exists for. Running the VLM per frame is the
waste; these rules hold it to roughly one call a minute while she is in view and
none at all while she is not (VLM_PLAN §3.4).

Both classes are pure state machines: time comes in as an argument, nothing
reads a clock, opens a device or touches a network. That is what makes
`tests/test_vision_gate.py` possible without a camera.
"""

from . import TUNING
from .gate import posture_band


class KeyframeSelector:
    """Feed it `(t, person, box)` per sampled frame; it names a reason or None.

    Reasons: "appear", "posture", "dwell", "on_floor", "absent".
    "absent" is not a keyframe — it means send an absent observation with no
    VLM call at all.
    """

    def __init__(self, tuning=None):
        self.t = dict(TUNING, **(tuning or {}))
        self.last_keyframe_t = None
        self.last_person_t = None
        self.present = False
        self.last_band = None
        self.wide_run = 0
        self.floor_fired = False
        self.last_floor_t = None

    def update(self, t, person, box=None):
        T = self.t

        if not person:
            last = t if self.last_person_t is None else self.last_person_t
            if self.present and t - last >= T["absent_after_s"]:
                self.present = False
                self.last_band = None
                self.wide_run = 0
                self.floor_fired = False
                return "absent"
            return None

        gone_for = float("inf") if self.last_person_t is None else t - self.last_person_t
        self.last_person_t = t
        band = posture_band(box, self.t)

        # The one rule that jumps the min_gap queue: wide-AND-STAYS-wide is a
        # candidate on_floor, and a fall is worth a VLM call now, not in twenty
        # seconds. `on_floor_confirm` is load-bearing, not belt-and-braces: on a
        # real clip YOLO's bbox aspect oscillates across the 0.8 line frame to
        # frame, so a bare "became wide" test fires on almost every frame and
        # force-flushes a 1-frame batch each time. Measured, not theorised.
        # `on_floor_cooldown_s` caps what is left: a subject whose bbox is simply
        # wide (someone cropped at the waist by a low camera) can otherwise
        # re-arm every second or two and spend a VLM call each time.
        if band == "wide":
            self.wide_run += 1
        else:
            self.wide_run = 0
            self.floor_fired = False
        cooled = self.last_floor_t is None or t - self.last_floor_t >= T["on_floor_cooldown_s"]
        if self.wide_run >= T["on_floor_confirm"] and not self.floor_fired and cooled:
            self.floor_fired = True
            self.last_floor_t = t
            self.last_band = band
            self.last_keyframe_t = t
            self.present = True
            return "on_floor"

        if not self.present and gone_for >= T["on_person_appear_gap_s"]:
            reason = "appear"
        elif band is not None and self.last_band is not None and band != self.last_band:
            reason = "posture"
        elif self.last_keyframe_t is None or t - self.last_keyframe_t >= T["on_dwell_s"]:
            reason = "dwell"
        else:
            reason = None

        self.present = True
        if band is not None:
            self.last_band = band

        if reason is None:
            return None
        # min_gap beats every reason except on_floor, above.
        if self.last_keyframe_t is not None and t - self.last_keyframe_t < T["min_gap_s"]:
            return None
        self.last_keyframe_t = t
        return reason


class RingBatch:
    """The RAM ring: at most `batch_size` JPEGs, in memory, freed on `take()`.

    A batch is temporal context — one frame of a woman at a table is "sitting";
    three frames over 20 s with a fork moving are "eating".

    Note on the arithmetic: with `min_gap_s=20` and `max_batch_wait_s=30`, a
    steady-state batch flushes with 2 frames, not 3. That is deliberate — the
    alternative is making her wait 40 s for a sentence. `--demo` (gap 6, wait 15)
    fills all 3. Nothing downstream cares: `n_frames` rides on the payload.
    """

    def __init__(self, tuning=None):
        self.t = dict(TUNING, **(tuning or {}))
        self.items = []          # [(t, jpeg_b64)], the only place pixels are held

    def add(self, t, jpeg_b64):
        self.items.append((t, jpeg_b64))
        if len(self.items) > self.t["batch_size"]:
            self.items.pop(0)    # a ring, not a buffer: the oldest is dropped, not kept

    def ready(self, now, force=False):
        if not self.items:
            return False
        if force or len(self.items) >= self.t["batch_size"]:
            return True
        return now - self.items[0][0] >= self.t["max_batch_wait_s"]

    def take(self):
        """Hand over the batch and free the ring. Called exactly once per VLM call."""
        items, self.items = self.items, []
        return items

    def span_s(self):
        return 0.0 if len(self.items) < 2 else self.items[-1][0] - self.items[0][0]
