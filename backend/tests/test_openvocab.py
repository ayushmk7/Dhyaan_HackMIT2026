"""Open-vocabulary food detection — the logic, with no camera, no model, no network.

`vision.openvocab` imports ultralytics and torch lazily, inside `_get()`, so
importing this file costs nothing and every test here runs on a fake model or
on no model at all. What is proven is the four things that will actually break
in a real room:

  1. The vocabulary stays short. This is not tidiness — it is the measured
     failure mode (see the table in openvocab.py).
  2. Food merges ADDITIVELY and can never zero a VLM's `food_visible`.
  3. A model that will not load degrades to COCO-only instead of raising, so a
     demo with no network is a demo with the old behaviour, not no demo.
  4. The flag turns it off.
"""

import builtins

import pytest

from vision import TUNING, openvocab, vlm


@pytest.fixture(autouse=True)
def _fresh_openvocab():
    """The module caches its model, its device and its one-shot warning. Every
    test starts from cold and leaves nothing behind for the next one."""
    before = dict(openvocab._state)
    openvocab._state.update(model=None, tried=False, device="cpu", warned=False)
    yield
    openvocab._state.clear()
    openvocab._state.update(before)


# --- 1: the vocabulary --------------------------------------------------------

def test_the_vocabulary_stays_short():
    """YOLO-World's confidence is a cosine against the prompt list, so the list
    length IS a threshold. Measured on one crisp packet, same weights, same
    image, only the vocabulary differing (testcam/FOOD.md):

        ["snack bag"]            -> 0.48
        22 food words            -> 0.11
        a 62-word household list -> 0.09   (below any usable floor)

    A long list does not cost latency (7.4 ms at 1 prompt, 8.1 ms at 100) — it
    costs the answer. This bound is the only thing standing between a working
    detector and a confidently blind one, so it is asserted rather than
    commented.
    """
    assert len(openvocab.PROMPTS) <= openvocab.MAX_PROMPTS
    assert openvocab.MAX_PROMPTS <= 24, "24 is already past the measured comfortable range"
    assert len(openvocab.PROMPTS) == len(set(openvocab.PROMPTS)), "a duplicate prompt is a wasted slot"
    # Short plain nouns beat articled phrases, also measured.
    for w in openvocab.PROMPTS:
        assert w == w.lower() and len(w.split()) <= 2, w
    # The distractors are load-bearing: with no household nouns in the list the
    # background has to land on a food prompt and the food scores drop.
    assert openvocab.VOCAB["distractors"], "removing these measurably hurt the food scores"
    assert openvocab.CONF < TUNING["person_conf"], "open-vocab scores live an order of magnitude lower"


# --- 2: additive, never subtractive -------------------------------------------

def _scene(**over):
    base = {"person_count": 1, "boxes": [(10.0, 10.0, 60.0, 200.0)],
            "food": [], "dishes": ["cup"], "seating": ["chair"]}
    return dict(base, **over)


def test_open_vocab_food_is_added_to_the_coco_scene():
    merged = openvocab.merge(_scene(), {"food": ["snack"], "dishes": ["mug"], "objects": ["book"]})
    assert merged["food"] == ["snack"]
    assert merged["dishes"] == ["cup", "mug"]          # COCO's cup survives
    assert merged["person_count"] == 1 and merged["boxes"] == _scene()["boxes"]
    assert merged["seating"] == ["chair"]              # counting and geometry stay COCO's


def test_an_open_vocab_miss_never_removes_cocos_food():
    """COCO named a sandwich; YOLO-World was not asked about sandwiches in those
    words and saw nothing. A detector that saw no food has not refuted one that
    did — the same rule `vlm.merge_scene` already applies to the VLM."""
    merged = openvocab.merge(_scene(food=["sandwich"]), openvocab.empty())
    assert merged["food"] == ["sandwich"]
    assert merged["dishes"] == ["cup"]


def test_food_never_zeroes_the_models_food_visible():
    """The end-to-end version of the same rule, through the code that ships it.

    The VLM saw a bowl of porridge and said so. Neither detector has a word for
    porridge. `food_visible` must survive both of them.
    """
    said = dict(vlm.ABSENT, activity="eating", person_count=1, food_visible=True,
                confidence=0.7, evidence="A person eating at a table.")
    scene = openvocab.merge(_scene(), openvocab.empty())
    assert vlm.merge_scene(said, scene)["food_visible"] is True


def test_open_vocab_food_reaches_the_observation():
    """...and the other direction: only YOLO-World saw it, and it must arrive."""
    said = dict(vlm.ABSENT, activity="sitting", person_count=1, food_visible=False,
                confidence=0.7, evidence="A person seated.")
    scene = openvocab.merge(_scene(), {"food": ["snack"], "dishes": [], "objects": []})
    out = vlm.merge_scene(said, scene)
    assert out["food_visible"] is True
    assert "snack" in out["evidence"]
    # ...and the detector-only lane, which is what runs on 3 keyframes in 4.
    assert vlm.from_scene(scene, "mid")["activity"] == "eating"


def test_merge_of_no_scene_is_the_identity():
    """No COCO pass ran on this frame, so there is nothing to add to. A food
    list with no person and no box is not an observation."""
    assert openvocab.merge(None, {"food": ["snack"], "dishes": [], "objects": []}) is None


# --- 3: a failed load is COCO-only, not a crash -------------------------------

def test_a_missing_ultralytics_degrades_to_coco_only(monkeypatch, capsys):
    real = builtins.__import__

    def no_ultralytics(name, *a, **kw):
        if name in ("ultralytics", "torch"):
            raise ImportError(f"no {name}")
        return real(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", no_ultralytics)
    assert openvocab.detect(object()) == openvocab.empty()     # no frame was even touched
    assert openvocab._state["model"] is None
    assert "falling back to COCO-only" in capsys.readouterr().out
    # Said once, and never retried — a demo must not stall on a download per keyframe.
    openvocab.detect(object())
    assert capsys.readouterr().out == ""


def test_a_model_that_explodes_mid_run_is_switched_off_not_raised(capsys):
    class Exploding:
        names = {}

        def predict(self, *a, **kw):
            raise RuntimeError("MPS einsum fell over in the contrastive head")

    openvocab._state.update(model=Exploding(), tried=True)
    assert openvocab.detect(object()) == openvocab.empty()
    assert openvocab._state["model"] is None                   # and stays off
    assert "falling back to COCO-only" in capsys.readouterr().out


def test_a_download_failure_is_one_warning(monkeypatch, capsys):
    """No network on stage. The weights are ~25 MB and auto-download on first
    use, so this is the likeliest failure of the lot."""
    class Boom:
        def __init__(self, *a, **kw):
            raise OSError("failed to download yolov8s-worldv2.pt")

    import sys
    import types

    fake = types.ModuleType("ultralytics")
    fake.YOLO = Boom
    monkeypatch.setitem(sys.modules, "ultralytics", fake)
    assert openvocab.detect(object()) == openvocab.empty()
    assert "unusable" in capsys.readouterr().out


# --- the buckets, on a fake model ---------------------------------------------

class _Box:
    def __init__(self, cls):
        self.cls = cls


class _FakeWorld:
    """Enough of an ultralytics result to prove the labels land in the right
    buckets. A real one needs torch, a 25 MB download and a webcam, none of
    which prove this."""

    def __init__(self, labels):
        self.names = {i: w for i, w in enumerate(openvocab.PROMPTS)}
        back = {w: i for i, w in self.names.items()}
        self.boxes = [_Box(back[w]) for w in labels]
        self.seen = None

    def predict(self, frame, **kw):
        self.seen = frame
        return [self]


def test_labels_land_in_food_dishes_and_objects():
    m = _FakeWorld(["snack", "wrapper", "mug", "book", "person"])
    openvocab._state.update(model=m, tried=True)
    out = openvocab.detect("a frame")
    assert out == {"food": ["snack", "wrapper"], "dishes": ["mug"], "objects": ["book"]}
    # `person` is dropped on purpose: COCO counts people, and an open-vocab
    # person box competing with COCO's would double the head count.
    assert m.seen == "a frame"


# --- 4: the flag --------------------------------------------------------------

def test_the_flag_is_on_by_default_and_openvocab_0_turns_it_off(monkeypatch):
    import importlib

    import vision

    assert vision.TUNING["openvocab"] is True
    monkeypatch.setenv("OPENVOCAB", "0")
    try:
        assert importlib.reload(vision).TUNING["openvocab"] is False
    finally:
        monkeypatch.delenv("OPENVOCAB")
        importlib.reload(vision)


def test_the_worker_skips_the_open_vocab_pass_when_the_flag_is_off(monkeypatch):
    from vision import worker

    called = []
    monkeypatch.setattr(openvocab, "timed", lambda f: (called.append(f) or (openvocab.empty(), 0)))

    w = worker.Worker(source="synthetic", camera_id="cam_x", api="http://localhost:0",
                      band_key="k", dry_run=True)
    w.scene = _scene()
    w.tuning = dict(w.tuning, openvocab=False)
    w._openvocab("a frame")
    assert called == [] and w.scene["food"] == []

    w.tuning = dict(w.tuning, openvocab=True)
    monkeypatch.setattr(openvocab, "timed",
                        lambda f: ({"food": ["snack"], "dishes": [], "objects": []}, 9))
    w._openvocab("a frame")
    assert w.scene["food"] == ["snack"] and w.openvocab_ms == 9


def test_no_scene_means_nothing_to_add_to(monkeypatch):
    """A keyframe on a frame where no COCO pass ran. Open-vocab food with no
    person and no box would be a scene invented out of one detector."""
    from vision import worker

    monkeypatch.setattr(openvocab, "timed", lambda f: pytest.fail("should not run"))
    w = worker.Worker(source="synthetic", camera_id="cam_x", api="http://localhost:0",
                      band_key="k", dry_run=True)
    w.scene = None
    w._openvocab("a frame")
    assert w.scene is None
