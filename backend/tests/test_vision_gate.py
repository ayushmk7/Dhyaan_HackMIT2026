"""Pure-function tests for the camera cascade — no camera, no model, no network.

Synthetic numpy arrays only. These prove the logic that will actually break in a
real room: a gate that wakes on nothing burns VLM calls, a gate that never wakes
misses her lunch, a mask that does not mask is a privacy failure, and a keyframe
selector that fires twice in ten seconds is the waste VLM_PLAN exists to avoid.

`vision.gate` imports cv2 at call time and `vision.keyframe` imports nothing
heavy, so this file never touches torch or a camera device.
"""

import numpy as np
import pytest

cv2 = pytest.importorskip("cv2", reason='camera lane extra: uv pip install -e ".[vision]"')

from vision import DEMO, TUNING
from vision.gate import MotionGate, apply_mask, aspect, parse_mask, posture_band
from vision.keyframe import KeyframeSelector, RingBatch

H, W = 360, 640


def blank(value=40):
    return np.full((H, W, 3), value, dtype=np.uint8)


def with_block(x0, y0, x1, y1, value=230, base=40):
    """A frame with one bright rectangle, in pixel coords."""
    f = blank(base)
    f[y0:y1, x0:x1] = value
    return f


def settled(gate, frames=40, value=40):
    """Let MOG2 learn a still background so the next change is real motion."""
    for _ in range(frames):
        gate.score(blank(value))


# --- stage 1: the privacy mask ------------------------------------------------

def test_parse_mask_roundtrip_and_rejections():
    assert parse_mask("0.1,0.2,0.5,0.9") == (0.1, 0.2, 0.5, 0.9)
    assert parse_mask(None) is None
    for bad in ("0.1,0.2,0.5", "0.5,0.2,0.1,0.9", "1.5,0,2,1", "a,b,c,d"):
        with pytest.raises(ValueError):
            parse_mask(bad)


def test_apply_mask_blacks_out_the_rectangle_and_nothing_else():
    out = apply_mask(blank(200), (0.0, 0.0, 0.5, 1.0))
    assert out[:, : W // 2].max() == 0
    assert out[:, W // 2 :].min() == 200


def test_masked_region_is_excluded_from_the_motion_score():
    """The privacy rule, as a number: pixels behind the mask cannot wake the
    pipeline, because the detector never sees them (VLM_PLAN §5.1)."""
    mask = (0.0, 0.0, 0.5, 1.0)          # left half is a private doorway
    movement_in_masked_half = with_block(20, 20, 300, 340)

    unmasked = MotionGate()
    settled(unmasked)
    assert unmasked.moved(unmasked.score(movement_in_masked_half)), \
        "sanity: this much change is motion when nothing is masked"

    masked = MotionGate()
    for _ in range(40):
        masked.score(apply_mask(blank(), mask))
    score = masked.score(apply_mask(movement_in_masked_half, mask))
    assert score == 0.0
    assert not masked.moved(score)


# --- stage 2: motion ----------------------------------------------------------

def test_motion_below_threshold_does_not_wake_the_pipeline():
    g = MotionGate()
    settled(g)
    # ~0.4% of the frame: under the 0.8% threshold, so no VLM call is spent.
    tiny = with_block(0, 0, 40, 40)
    assert not g.moved(g.score(tiny))


def test_motion_above_threshold_wakes_the_pipeline():
    g = MotionGate()
    settled(g)
    assert g.moved(g.score(with_block(120, 60, 420, 330)))


def test_a_still_room_never_wakes_the_pipeline():
    g = MotionGate()
    settled(g)
    for _ in range(10):
        assert not g.moved(g.score(blank()))


def test_motion_threshold_is_the_knob_that_decides():
    """The one tuning number a real room changes. Same frame, both answers."""
    twitchy = MotionGate({"motion_ratio": 0.0001})
    settled(twitchy)
    s = twitchy.score(with_block(0, 0, 40, 40))
    assert twitchy.moved(s)
    assert not MotionGate({"motion_ratio": 0.5}).moved(s)


# --- posture from the bbox (pure) ---------------------------------------------

def test_posture_bands():
    assert aspect(None) is None
    assert posture_band(None) is None
    assert posture_band((0, 0, 50, 200)) == "tall"      # h/w = 4.0, standing
    assert posture_band((0, 0, 100, 120)) == "mid"      # h/w = 1.2, seated
    assert posture_band((0, 0, 200, 60)) == "wide"      # h/w = 0.3, on the floor


# --- stage 4: keyframe selection ----------------------------------------------

BOX_SEATED = (100, 100, 200, 220)     # h/w = 1.2 -> "mid"
BOX_STANDING = (100, 40, 160, 300)    # h/w ~ 4.3 -> "tall"
BOX_FLOOR = (100, 200, 400, 260)      # h/w = 0.2 -> "wide"


def test_first_person_fires_appear():
    k = KeyframeSelector()
    assert k.update(0.0, True, BOX_SEATED) == "appear"


def test_does_not_fire_twice_inside_min_gap():
    k = KeyframeSelector()
    assert k.update(0.0, True, BOX_SEATED) == "appear"
    for t in (1.0, 5.0, 10.0, 19.9):
        assert k.update(t, True, BOX_SEATED) is None, f"fired again at t={t}"


def test_dwell_fires_once_a_minute_not_once_a_frame():
    k = KeyframeSelector()
    k.update(0.0, True, BOX_SEATED)
    fired = [t for t in range(1, 181)
             if k.update(float(t), True, BOX_SEATED) is not None]
    # on_dwell_s=60 over three minutes -> three more keyframes, not 180.
    assert fired == [60, 120, 180]


def test_posture_change_fires_but_still_respects_min_gap():
    k = KeyframeSelector()
    k.update(0.0, True, BOX_SEATED)
    assert k.update(5.0, True, BOX_STANDING) is None       # inside min_gap
    assert k.update(25.0, True, BOX_SEATED) == "posture"   # outside it


def test_on_floor_jumps_the_min_gap_queue_but_only_once_confirmed():
    """The one rule allowed to break the interval: wide AND STAYS wide is a
    candidate fall, worth a VLM call now rather than in twenty seconds."""
    k = KeyframeSelector()
    k.update(0.0, True, BOX_STANDING)
    assert k.update(2.0, True, BOX_FLOOR) is None          # one wide frame is not a fall
    assert k.update(3.0, True, BOX_FLOOR) == "on_floor"    # two in a row is
    assert k.update(4.0, True, BOX_FLOOR) is None          # and it does not repeat


def test_on_floor_does_not_spam_when_the_bbox_oscillates():
    """Regression, found on a real clip: YOLO's aspect flickers across the 0.8
    line frame to frame. Without `on_floor_confirm` this fired on nearly every
    frame and force-flushed a 1-frame batch each time — the exact waste the
    cascade exists to avoid."""
    k = KeyframeSelector()
    k.update(0.0, True, BOX_STANDING)
    seq = [BOX_FLOOR, BOX_SEATED, BOX_FLOOR, BOX_SEATED, BOX_FLOOR, BOX_SEATED]
    fired = [r for i, b in enumerate(seq)
             if (r := k.update(1.0 + i, True, b)) == "on_floor"]
    assert fired == []


def test_on_floor_obeys_its_cooldown():
    """A subject whose bbox is simply wide must not buy a VLM call every second."""
    k = KeyframeSelector()
    fired = []
    for i in range(60):                       # 60 s of wide / not-wide, 1 Hz
        b = BOX_FLOOR if i % 3 else BOX_SEATED
        if k.update(float(i), True, b) == "on_floor":
            fired.append(i)
    assert len(fired) <= 3, fired            # on_floor_cooldown_s = 30 over 60 s
    assert all(b - a >= TUNING["on_floor_cooldown_s"] for a, b in zip(fired, fired[1:]))


def test_a_real_fall_still_fires_after_a_flicker():
    k = KeyframeSelector()
    k.update(0.0, True, BOX_STANDING)
    k.update(1.0, True, BOX_FLOOR)
    k.update(2.0, True, BOX_SEATED)          # flicker resets the run
    # one wide frame is only a posture change; the second confirms the fall.
    assert k.update(33.0, True, BOX_FLOOR) == "posture"
    assert k.update(34.0, True, BOX_FLOOR) == "on_floor"


def test_absent_fires_once_after_the_grace_and_then_stays_quiet():
    k = KeyframeSelector()
    k.update(0.0, True, BOX_SEATED)
    assert k.update(10.0, False) is None                   # inside absent_after_s
    assert k.update(31.0, False) == "absent"
    assert k.update(60.0, False) is None
    assert k.update(90.0, True, BOX_SEATED) == "appear"    # she comes back


def test_never_absent_if_she_was_never_there():
    k = KeyframeSelector()
    for t in range(0, 300, 10):
        assert k.update(float(t), False) is None


def test_demo_tuning_only_changes_the_numbers():
    k = KeyframeSelector(DEMO)
    k.update(0.0, True, BOX_SEATED)
    assert k.update(5.9, True, BOX_SEATED) is None         # DEMO min_gap_s = 6
    assert k.update(15.0, True, BOX_SEATED) == "dwell"     # DEMO on_dwell_s = 15


def test_no_yolo_path_still_produces_a_keyframe():
    """The cut path (§3.3, §9): no boxes at all, motion alone is presence. It
    must still reach a keyframe and still honour min_gap."""
    k = KeyframeSelector()
    assert k.update(0.0, True, None) == "appear"
    assert k.update(10.0, True, None) is None
    assert k.update(60.0, True, None) == "dwell"
    assert k.update(120.0, False) == "absent"


# --- the RAM ring -------------------------------------------------------------

def test_ring_flushes_on_batch_size_and_frees_itself():
    r = RingBatch()
    for i in range(TUNING["batch_size"]):
        assert not r.ready(float(i)) or i == TUNING["batch_size"] - 1
        r.add(float(i), f"jpeg{i}")
    assert r.ready(2.0)
    assert len(r.take()) == TUNING["batch_size"]
    assert r.items == [], "take() must free the ring — this is the no-retention rule"
    assert not r.ready(99.0)


def test_ring_flushes_on_max_wait_with_a_short_batch():
    r = RingBatch()
    r.add(0.0, "jpeg0")
    assert not r.ready(10.0)
    assert r.ready(TUNING["max_batch_wait_s"])


def test_ring_never_holds_more_than_batch_size():
    r = RingBatch()
    for i in range(20):
        r.add(float(i), f"jpeg{i}")
    assert len(r.items) == TUNING["batch_size"]
    assert r.items[-1][1] == "jpeg19"     # oldest dropped, newest kept


def test_ring_force_flush_for_on_floor():
    r = RingBatch()
    r.add(0.0, "jpeg0")
    r.add(1.0, "jpeg1")
    assert not r.ready(1.0)
    assert r.ready(1.0, force=True)
    assert r.span_s() == 1.0


# --- the no-retention rule, as a test -----------------------------------------

def test_no_module_in_the_vision_package_touches_the_filesystem():
    """VLM_PLAN §5.3: no frame is ever written to disk, structurally.

    Walks the AST rather than grepping, so a docstring that *mentions* imwrite
    does not fail and a call that is hidden in one does not pass. The single
    permitted `open()` in the package is worker.py reading the --config-json
    stand-in, which is text. If this test ever needs a new exception, that is
    the conversation, not a one-line edit.
    """
    import ast
    import pathlib

    import vision

    banned = {"imwrite", "imsave", "VideoWriter", "imencode_to_file", "savemat"}
    allowed_open = {("worker.py", "_fetch_config")}
    pkg = pathlib.Path(vision.__file__).parent

    for path in sorted(pkg.glob("*.py")):
        tree = ast.parse(path.read_text())
        scope = {}
        for fn in ast.walk(tree):
            if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for n in ast.walk(fn):
                    scope[id(n)] = fn.name
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            f = node.func
            name = f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", None)
            assert name not in banned, f"{path.name}:{node.lineno} calls {name}()"
            if name == "open":
                where = (path.name, scope.get(id(node)))
                assert where in allowed_open, f"{path.name}:{node.lineno} opens a file in {where[1]}"
