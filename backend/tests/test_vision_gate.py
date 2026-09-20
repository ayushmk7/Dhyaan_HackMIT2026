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

from vision import DEMO, TUNING, gate, vlm, worker
from vision.gate import (MotionGate, PersonGate, apply_mask, aspect, parse_mask,
                         posture_band)
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
    """A partial batch waits for max_batch_wait_s rather than firing early.

    Pinned to batch_size=2 on purpose: this rule only exists when a batch can be
    short, and the shipped default is 1 (one frame per VLM call is the whole
    latency budget). Reading the live TUNING here made the test assert nothing.
    """
    r = RingBatch({"batch_size": 2})
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
    # batch_size=3 with two frames in hand: the ring must be genuinely PARTIAL
    # for `force` to prove anything. At the shipped default of 1 it is ready the
    # moment a frame lands, and at 2 these two frames already fill it.
    r = RingBatch({"batch_size": 3})
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
    # Two exceptions, both read-only and neither one a frame:
    #   worker.py::_fetch_config        the --config-json stand-in, text
    #   openvocab.py::_clip_cache_is_sound
    #       reads the CLIP checkpoint's bytes to verify its SHA256. A partial
    #       download (Ctrl-C during a slow first run) otherwise costs 338 MB at
    #       every launch before the camera even opens, which on venue wifi is a
    #       dead demo. The rule this test defends is "no FRAME is written to
    #       disk"; hashing a model file neither writes anything nor touches a
    #       frame. If a third exception ever wants in, have the argument again.
    allowed_open = {("worker.py", "_fetch_config"),
                    ("openvocab.py", "_clip_cache_is_sound")}
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


# --- stage 3: one YOLO-World pass, four answers -------------------------------
#
# The model is faked: a real one would need torch, a 25 MB download, a 340 MB
# CLIP download and a webcam, and none of those prove what this file is for —
# that free-text labels land in the right buckets, that each bucket keeps its
# own confidence floor, that one person is counted once, and that every way
# the detector can fail to come up is the cut path and not a crash.

class _Tensor:
    def __init__(self, v):
        self._v = v

    def tolist(self):
        return self._v


class _Result:
    def __init__(self, names, hits):
        back = {n: i for i, n in (names.items() if isinstance(names, dict) else enumerate(names))}
        self.boxes = type("B", (), {
            "cls": _Tensor([back[label] for label, _, _ in hits]),
            "conf": _Tensor([conf for _, conf, _ in hits]),
            "xyxy": _Tensor([list(b) for _, _, b in hits]),
        })()


# What ultralytics exposes after set_classes(): the prompt list, in order.
WORLD_NAMES = list(gate.PROMPTS)
# ...and what a COCO model exposes: its own id -> name dict (a subset is enough).
COCO_NAMES = {0: "person", 16: "dog", 39: "bottle", 40: "wine glass", 41: "cup",
              42: "fork", 43: "knife", 44: "spoon", 45: "bowl", 46: "banana",
              47: "apple", 48: "sandwich", 49: "orange", 50: "broccoli", 51: "carrot",
              52: "hot dog", 53: "pizza", 54: "donut", 55: "cake", 56: "chair",
              57: "couch", 59: "bed", 60: "dining table"}


class _FakeYOLO:
    """Records what it was asked, so the conf floor and the COCO `classes=`
    filter are testable too. `hits` are (label, conf, box)."""

    def __init__(self, hits, names=WORLD_NAMES):
        self.hits, self.names, self.asked = hits, names, None

    def predict(self, frame, **kw):
        self.asked = kw
        return [_Result(self.names, self.hits)]


def fake_gate(hits, coco=False):
    g = PersonGate(enabled=False)      # no ultralytics, no torch, no download
    g.enabled = True
    if coco:
        g.model, g.open_vocab = _FakeYOLO(hits, COCO_NAMES), False
        g.classes = sorted(i for i, n in COCO_NAMES.items() if n in gate.BUCKET)
    else:
        g.model, g.open_vocab = _FakeYOLO(hits), True
    return g


def hit(label, box, conf=0.9):
    return (label, conf, box)


def test_the_vocabulary_stays_short_and_names_what_the_pipeline_reads():
    """YOLO-World's confidence is a cosine against the prompt list, so the list
    length IS a threshold. Same crisp packet, same weights (the bench in git history, commit 56e2237):
    ["snack bag"] 0.48, 22 food words 0.11, a 62-word list 0.09. This bound is
    the only thing between a working detector and a confidently blind one."""
    assert len(gate.PROMPTS) <= gate.MAX_PROMPTS <= 24
    assert len(gate.PROMPTS) == len(set(gate.PROMPTS)), "a duplicate prompt is a wasted slot"
    for w in gate.PROMPTS:
        assert w == w.lower() and len(w.split()) <= 2, w    # short plain nouns, measured
        assert w in gate.BUCKET
    assert gate.VOCAB["background"], "removing these measurably hurt the food scores"
    # vlm.from_scene derives `spot` from these two words; renaming them in the
    # vocabulary would silently lose "at the table".
    assert {"dining table", "chair"} <= set(gate.VOCAB["seating"])
    # Open-vocab scores live an order of magnitude below COCO's. Inheriting the
    # COCO floor returns nothing at all (measured).
    assert TUNING["world_conf"] < TUNING["person_conf"]
    assert TUNING["world_person_conf"] <= TUNING["world_conf"]


def test_scene_splits_people_food_dishes_and_seating():
    g = fake_gate([
        hit("person", (10, 10, 40, 120)),
        hit("person", (200, 10, 300, 220)),      # a bigger person
        hit("cereal", (50, 50, 70, 70)),         # a word COCO never had -> food
        hit("cup", (80, 50, 90, 65)),            # -> dishes
        hit("bowl", (95, 50, 110, 62)),          # -> dishes
        hit("dining table", (0, 100, 300, 160)), # -> seating
        hit("phone", (0, 0, 20, 20)),            # background: somewhere to land, never reported
    ])
    s = g.scene(blank())
    assert s["person_count"] == 2
    assert s["food"] == ["cereal"]
    assert s["dishes"] == ["bowl", "cup"]
    assert s["seating"] == ["dining table"]
    # Largest first: the cascade tracks one person, and it must be the one
    # filling the frame, not whoever the detector happened to list first.
    assert s["boxes"][0] == (200, 10, 300, 220)
    assert g.model.asked.get("classes") is None, "an open-vocab model is asked for every prompt"


def test_the_generic_food_word_yields_to_a_specific_one():
    """"cereal" says more than "cereal, food", and the evidence line has room
    for two words. Alone, the generic still counts — it is the net."""
    both = fake_gate([hit("food", (0, 0, 9, 9)), hit("cereal", (0, 0, 9, 9))]).scene(blank())
    assert both["food"] == ["cereal"]
    alone = fake_gate([hit("food", (0, 0, 9, 9))]).scene(blank())
    assert alone["food"] == ["food"]


def test_each_bucket_keeps_its_own_floor():
    """Calibrated separately (gate.py): people at world_person_conf, objects at
    world_conf. The model is asked at the lower of the two and the gate filters,
    so a 0.16 person survives while a 0.16 "toast" — a measured false positive
    on a noodle bowl — does not."""
    g = fake_gate([
        hit("person", (10, 10, 40, 120), conf=0.16),
        hit("person", (50, 10, 80, 120), conf=0.14),
        hit("toast", (0, 0, 9, 9), conf=0.18),
        hit("cereal", (0, 0, 9, 9), conf=0.21),
    ], )
    g.t = dict(g.t, world_person_conf=0.15, world_conf=0.20, world_hold=0.6)
    s = g.scene(blank())
    assert s["person_count"] == 1 and s["food"] == ["cereal"]
    # Asked at the hold, not the floor: ultralytics applies `conf` inside NMS,
    # so a box dropped there can never be held. Found the hard way — asked at
    # 0.15, a packet at 0.13 vanished and the 0.12 hold never saw it.
    assert g.model.asked["conf"] == pytest.approx(0.15 * 0.6)


def test_a_label_needs_the_floor_to_arrive_and_less_to_stay():
    """Hysteresis, measured need: a real crisp packet on a compressed clip
    scored 0.13-0.28 (median 0.19) over a 0.20 floor and crossed the line four
    times in a second of hand-held jitter; every crossing was a "what I see
    changed" post. Not memory — the label must still be detected on this
    frame, at a lower bar (0.6 of the floor: 0.12 objects, 0.09 people)."""
    g = fake_gate([])
    g.t = dict(g.t, world_person_conf=0.15, world_conf=0.20, world_hold=0.6)
    frames = [
        ([hit("snack bag", (0, 0, 9, 9), conf=0.17), hit("person", (0, 0, 50, 200), conf=0.12)],
         [], 0),          # never seen yet: below the floor, nothing
        ([hit("snack bag", (0, 0, 9, 9), conf=0.26), hit("person", (0, 0, 50, 200), conf=0.16)],
         ["snack bag"], 1),   # arrives
        ([hit("snack bag", (0, 0, 9, 9), conf=0.13), hit("person", (0, 0, 50, 200), conf=0.10)],
         ["snack bag"], 1),   # dips to the measured minimum: held (>= 0.12 / 0.09)
        ([hit("snack bag", (0, 0, 9, 9), conf=0.11), hit("person", (0, 0, 50, 200), conf=0.08)],
         [], 0),          # gone for real
        ([hit("snack bag", (0, 0, 9, 9), conf=0.17)], [], 0),   # ...and needs the full floor again
    ]
    for hits, food, people in frames:
        g.model.hits = hits
        s = g.scene(blank())
        assert (s["food"], s["person_count"]) == (food, people), hits
    # A COCO model has no such problem and gets no such rule.
    c = fake_gate([hit("pizza", (0, 0, 9, 9), conf=0.5)], coco=True)
    c.t = dict(c.t, person_conf=0.4)
    assert c.scene(blank())["food"] == ["pizza"]
    c.model.hits = [hit("pizza", (0, 0, 9, 9), conf=0.35)]
    assert c.scene(blank())["food"] == []
    assert c.model.asked["conf"] == 0.4


def test_nested_person_boxes_count_as_one_person():
    """Measured on person_sandwich.jpg: a whole body, then a torso and an
    upper-body box 98 % inside it — three "people" for one, which per-class
    NMS leaves alone (the torso's IoU with the body is only 0.47). The head
    count is what present/with_visitor hangs off."""
    nested = [(79, 27, 431, 251), (169, 109, 434, 252), (173, 50, 435, 252)]
    assert gate.dedupe_boxes(nested) == [(79, 27, 431, 251)]
    s = fake_gate([hit("person", b) for b in nested]).scene(blank())
    assert s["person_count"] == 1
    # Two real people side by side, even touching, do not contain each other.
    apart = [(10, 10, 100, 200), (95, 10, 190, 200)]
    assert len(gate.dedupe_boxes(apart)) == 2


def test_a_coco_model_put_back_with_yolo_model_reports_what_it_used_to():
    """The one-line revert. Mapped by name so the same scene() serves both,
    filtered to the ids it can name, at COCO's own floor."""
    g = fake_gate([
        hit("person", (10, 10, 40, 120)),
        hit("pizza", (50, 50, 70, 70)),
        hit("cup", (80, 50, 90, 65)),
        hit("couch", (0, 100, 300, 160)),
        hit("dog", (0, 0, 20, 20)),
    ], coco=True)
    s = g.scene(blank())
    assert s == {"person_count": 1, "boxes": [(10, 10, 40, 120)], "food": ["pizza"],
                 "dishes": ["cup"], "seating": ["couch"]}
    assert set(g.model.asked["classes"]) == {0, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49,
                                             50, 51, 52, 53, 54, 55, 56, 57, 59, 60}
    assert g.model.asked["conf"] == TUNING["person_conf"]


def test_scene_off_returns_the_same_shape_empty():
    """The cut path must not hand callers a different type to branch on."""
    s = PersonGate(enabled=False).scene(blank())
    assert s == {"person_count": 0, "boxes": [], "food": [], "dishes": [], "seating": []}


def test_a_missing_ultralytics_is_the_cut_path_not_a_crash(monkeypatch):
    import builtins

    real = builtins.__import__

    def no_ultralytics(name, *a, **kw):
        if name in ("ultralytics", "torch"):
            raise ImportError(f"no {name}")
        return real(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", no_ultralytics)
    g = PersonGate(enabled=True)
    assert g.enabled is False and g.model is None


# The load path, with ultralytics and torch faked so it runs (and proves the
# same thing) on a machine that has neither.

def _fake_stack(monkeypatch, yolo_cls):
    import sys
    import types

    ul = types.ModuleType("ultralytics")
    ul.YOLO = yolo_cls
    torch = types.ModuleType("torch")
    torch.backends = types.SimpleNamespace(mps=types.SimpleNamespace(is_available=lambda: False))
    monkeypatch.setitem(sys.modules, "ultralytics", ul)
    monkeypatch.setitem(sys.modules, "torch", torch)


class _Loadable(_FakeYOLO):
    """A YOLO-World that loads: set_classes() works and predict() answers."""

    def __init__(self, name):
        super().__init__([])
        self.name = name

    def set_classes(self, classes):
        self.names = list(classes)


def test_weights_that_will_not_download_are_the_cut_path(monkeypatch, capsys):
    """No network on stage and no file on disk: the likeliest failure of the lot."""
    class Boom:
        def __init__(self, name):
            raise OSError(f"failed to download {name}")

    _fake_stack(monkeypatch, Boom)
    g = PersonGate(enabled=True)
    assert g.enabled is False and g.model is None
    assert "unusable" in capsys.readouterr().out


def test_no_clip_means_no_open_vocabulary_but_still_a_person_gate(monkeypatch, capsys):
    """set_classes() needs CLIP (an extra dependency and a one-off download).
    Without it: fall back to the COCO weights if they are already on disk —
    people and ten foods beat motion-only — and otherwise take the cut path.
    Either way the worker starts."""
    class NoClip(_Loadable):
        def set_classes(self, classes):
            raise ModuleNotFoundError("No module named 'clip'")

    class Stack:
        def __new__(cls, name):
            if name == gate.COCO_FALLBACK:
                return _FakeYOLO([], COCO_NAMES)
            return NoClip(name)

    _fake_stack(monkeypatch, Stack)
    monkeypatch.setattr(gate.os.path, "exists", lambda p: False)
    g = PersonGate(enabled=True)
    assert g.enabled is False and g.model is None
    assert "clip" in capsys.readouterr().out

    monkeypatch.setattr(gate.os.path, "exists", lambda p: p == gate.COCO_FALLBACK)
    g = PersonGate(enabled=True)
    assert g.enabled is True and g.open_vocab is False
    assert g.model_name == "yolo11s" and 0 in g.classes and 53 in g.classes
    assert "instead" in capsys.readouterr().out


def test_the_vocabulary_is_set_at_start_and_the_first_frame_is_warm(monkeypatch):
    """The first set_classes() is ~4 s (CLIP text embeddings). It belongs at
    worker start, not on the first frame with a person in it."""
    _fake_stack(monkeypatch, _Loadable)
    g = PersonGate(enabled=True)
    assert g.enabled and g.open_vocab
    assert g.model.names == gate.PROMPTS
    assert g.model.asked is not None, "no warm-up pass was made"
    assert g.model.asked["imgsz"] == TUNING["person_imgsz"]
    assert g.model_name == "yolov8s-worldv2"


class Exploding(_FakeYOLO):
    def predict(self, *a, **kw):
        raise RuntimeError("MPS einsum fell over in the contrastive head")


def test_a_detector_that_dies_mid_run_becomes_the_cut_path(capsys):
    g = fake_gate([])
    g.model = Exploding([])
    for _ in range(gate.SCENE_FAIL_LIMIT):
        assert g.scene(blank()) == {"person_count": 0, "boxes": [], "food": [],
                                    "dishes": [], "seating": []}
    assert g.enabled is False, "the worker reads this every frame and takes the motion-only path"
    out = capsys.readouterr().out
    assert "motion-only" in out
    # The payloads must stop carrying a model name the detector no longer has.
    assert g.model_name == "none"


def test_one_failed_frame_does_not_retire_the_detector(capsys):
    """Ollama and YOLO share a single MPS queue, so a collision can cost one
    predict(). Retiring on that left the run motion-only for hours — with no
    way to re-confirm a still person, so a seated resident read as absent —
    while every payload still named the model that was no longer running."""
    g = fake_gate([])
    real, g.model = g.model, Exploding([])
    g.scene(blank())
    assert g.enabled is True, "one transient failure is not a dead model"
    g.model = real
    assert g.scene(blank())["person_count"] == 0
    g.model = Exploding([])
    g.scene(blank())
    assert g.enabled is True, "the counter must reset on a frame that worked"


# --- what a richer vocabulary changes downstream ------------------------------

def test_a_word_coco_never_had_becomes_eating_and_reaches_the_evidence():
    """The whole point. COCO said "bowl" and the observation said "sitting";
    YOLO-World says "cereal" and the observation says "eating" — which is what
    the family sentence is built from. The label itself stays in `evidence`
    (staff/audit only, §5.2)."""
    scene = {"person_count": 1, "boxes": [(10, 10, 60, 200)], "food": ["cereal"],
             "dishes": ["bowl"], "seating": ["dining table"]}
    obs = vlm.post_rules(vlm.from_scene(scene, "mid"))
    assert obs["activity"] == "eating" and obs["spot"] == "table"
    assert "cereal" in obs["evidence"]
    assert worker._sentence(obs) == "eating at the table"
    # ...and through the VLM lane, where the model saw nothing it could name.
    said = dict(vlm.ABSENT, activity="sitting", person_count=1, confidence=0.7,
                evidence="A person seated at a table.")
    merged = vlm.post_rules(vlm.merge_scene(said, scene))
    assert merged["food_visible"] is True and "cereal" in merged["evidence"]


def test_food_left_on_the_table_does_not_conjure_a_person():
    """A bowl of cereal after she has gone is now a common detection. It must
    stay "absent" — the count bump in post_rules is for a hand at a mouth, not
    for a plate."""
    scene = {"person_count": 0, "boxes": [], "food": ["cereal"], "dishes": ["bowl"],
             "seating": []}
    obs = vlm.post_rules(vlm.from_scene(scene, None))
    assert obs["activity"] == "absent" and obs["person_count"] == 0
    assert obs["food_visible"] is True                 # honest: the bowl is there
    # The gesture rule the bump exists for still holds.
    said = dict(vlm.ABSENT, person_count=0, hand_to_mouth_observed=True, food_visible=True)
    assert vlm.post_rules(said)["person_count"] == 1


# --- the override: YOLO counts, the VLM narrates ------------------------------

def vlm_said(**over):
    said = dict(vlm.ABSENT, activity="sitting", person_count=1, spot="table",
                confidence=0.7, evidence="A person is seated at a table.")
    return dict(said, **over)


def test_yolo_overrules_the_models_person_count():
    """Counting is what a detector is for. A 3B model asked to count in prose
    gets it wrong, and this split is what present/absent hangs off.

    With VISITOR_DETECTION off (the default) the count is clamped to one: the
    product answers "she is there" or "she is not", never "there are four
    people". A room full of strangers is the room, not the story - and in a
    hall it is true of every frame, which drowns everything else.
    """
    obs = vlm.merge_scene(vlm_said(person_count=0),
                          {"person_count": 4, "boxes": [], "food": [], "dishes": [],
                           "seating": ["couch"]})
    assert obs["person_count"] == 1          # clamped, not 4
    assert vlm.post_rules(obs)["activity"] != "absent"


def test_visitor_detection_can_be_switched_back_on(monkeypatch):
    """The capability is intact, just off. A real home wants it."""
    monkeypatch.setattr(vlm, "VISITORS", True)
    obs = vlm.merge_scene(vlm_said(person_count=1),
                          {"person_count": 2, "boxes": [], "food": [], "dishes": [],
                           "seating": []})
    assert obs["person_count"] == 2
    assert vlm.post_rules(obs)["activity"] == "with_visitor"


def test_yolo_may_add_food_but_never_subtract_it():
    """COCO has no class for toast, porridge or soup. A detector that saw no
    food has not refuted a model that did — zeroing this would lose exactly the
    hand-held meals `food_visible` was added for."""
    scene = {"person_count": 1, "boxes": [], "food": [], "dishes": [], "seating": []}
    kept = vlm.merge_scene(vlm_said(food_visible=True, hand_to_mouth_observed=True), scene)
    assert kept["food_visible"] is True
    assert vlm.post_rules(kept)["activity"] == "eating"

    added = vlm.merge_scene(vlm_said(food_visible=False), dict(scene, food=["sandwich"]))
    assert added["food_visible"] is True
    assert "sandwich" in added["evidence"]


def test_no_scene_is_the_identity():
    """No detector ran on these frames, so there is nothing to overrule with."""
    said = vlm_said()
    assert vlm.merge_scene(said, None) == said
    assert vlm.merge_scene(said, None) is not said     # ...and it is a copy


def test_a_stale_scene_cannot_reach_a_later_observation():
    """The bug this guards: YOLO sees a sandwich, then the person walks off and
    a later batch flushes on a frame no detector ran on. If `scene` survived,
    that observation would report food nobody can see."""
    w = worker.Worker(source="synthetic", camera_id="cam_x", api="http://localhost:0",
                      band_key="k", dry_run=True)
    g = fake_gate([hit("person", (10, 10, 40, 120)), hit("sandwich", (50, 50, 70, 70))])

    box, seen = w._detect(g, blank(), run_it=True, moved=True, motion=None)
    assert seen and box is not None
    assert w.scene["food"] == ["sandwich"]
    assert w.boxes == [[10 / W, 10 / H, 40 / W, 120 / H]], "boxes leave here normalised"

    w._detect(g, blank(), run_it=False, moved=False, motion=None)
    assert w.scene is None
    assert vlm.merge_scene(vlm_said(), w.scene)["food_visible"] is False


def test_the_cut_path_lets_motion_be_presence():
    w = worker.Worker(source="synthetic", camera_id="cam_x", api="http://localhost:0",
                      band_key="k", dry_run=True)
    g = MotionGate()
    settled(g)
    g.score(with_block(120, 60, 420, 330))
    box, seen = w._detect(PersonGate(enabled=False), blank(), run_it=True,
                          moved=True, motion=g)
    assert (box, seen) == (None, True)
    assert w.scene is None                      # nothing structural was observed
    assert len(w.boxes) == 1 and all(0.0 <= c <= 1.0 for c in w.boxes[0])


# --- the synthetic source -----------------------------------------------------

def test_the_synthetic_day_is_deterministic_and_scripted():
    from vision.capture import SyntheticCamera

    cam = SyntheticCamera()
    assert (cam._draw(5.0) == cam._draw(5.0)).all()          # pure function of the phase
    assert (cam._draw(2.0) == cam._draw(11.0)).all()         # an empty room does not move
    assert (cam._draw(5.0) != cam._draw(35.0)).any()         # ...and the middle of it does

    g = MotionGate()
    fired = []
    k = KeyframeSelector(DEMO)
    for i in range(int(SyntheticCamera.LOOP_S * 3)):         # the cascade's own 3 fps
        t = i / 3.0
        if (r := k.update(t, g.moved(g.score(cam._draw(t))))):
            fired.append(r)
    # It must drive the real cascade with no webcam and no detector: someone
    # arrives, is seen more than once, and goes away again.
    assert "appear" in fired and "dwell" in fired and "absent" in fired


def test_the_scripted_day_contains_the_three_episodes_the_dedup_needs():
    """A one-minute loop has to be worth a timeline: something to call a walk,
    a meal long enough to clear MIN_DUR_S, a visitor, and enough empty room to
    actually go out of view."""
    from vision.capture import SyntheticCamera

    cam = SyntheticCamera()
    day = [cam.script(t / 2) for t in range(int(SyntheticCamera.LOOP_S * 2))]
    seen = [s["activity"] for s in day]
    for activity in ("absent", "walking", "eating", "with_visitor"):
        assert activity in seen, f"the scripted day never does {activity}"
    # Long enough to survive the rules downstream, in loop seconds.
    assert seen.count("eating") / 2 >= 18
    # `--source synthetic` takes the DEMO cadence whether or not --demo was
    # passed, so that is the rule the empty stretch has to clear.
    assert seen.count("absent") / 2 >= DEMO["absent_after_s"]

    for s in day:
        assert len(s["boxes"]) == s["person_count"], "a box per person, or the console lies"
        for b in s["boxes"]:
            assert len(b) == 4 and all(0.0 <= c <= 1.0 for c in b), b
    assert max(len(s["boxes"]) for s in day) == 2      # her and one visitor
