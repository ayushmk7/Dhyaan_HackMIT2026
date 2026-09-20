"""Stage 3b: an open vocabulary for the keyframe path only.

COCO has exactly ten food words — sandwich, pizza, banana, apple, orange, cake,
donut, hot dog, broccoli, carrot — so `gate.PersonGate` is structurally blind to
a crisp packet, a noodle box, a mug of soup or a bowl of cereal. There is no
eleventh class and no confidence threshold that invents one. That is the bug,
and no COCO model swap fixes it.

YOLO-World replaces the fixed classifier head with CLIP text embeddings, so
`set_classes([...])` re-specifies what the detector is looking for at runtime.
Measured in testcam/FOOD.md on this machine:

  * `yolov8s-worldv2` 9-11.5 ms median vs the COCO baseline's 5.7-7.2 ms, so an
    open vocabulary costs about 4 ms.
  * A bigger vocabulary is nearly free at inference: 7.4 ms at 1 prompt, 8.1 ms
    at 100. The text embeddings are built once (4.0 s cold, 0.07 s to re-specify).
  * On real photographs: a cereal bowl that COCO called `bowl, spoon` came back
    `cereal`; a mug of soup that COCO called `cup` came back `cup` + `soup`; a
    crisp packet COCO could not see at all came back `snack bag`.

Where it runs: the KEYFRAME path, never the hot path. The 15 fps loop keeps
COCO YOLO (~7 ms, and `person` is the class it is genuinely best at); this runs
only on the frames already chosen to be worth a VLM call, which is a once-every-
few-seconds question, not an every-frame one.

ponytail: one module-level model, one vocabulary, no registry. Ceiling: one
room's words for the whole house. Upgrade path: key `VOCAB` by `cfg["zone"]`
and call `set_classes()` on a zone change — measured at 0.07 s, so it is
affordable; it is just not worth the config surface for one camera.
"""

import os
import time

# --- the vocabulary -----------------------------------------------------------
# KEEP THIS SHORT. This is the one tuning parameter that decides whether the
# feature works at all, and it is counter-intuitive: YOLO-World's confidence is
# a cosine between an image region and a text embedding, so it is RELATIVE TO
# THE PROMPT LIST. Measured on the same crisp packet, same weights, only the
# vocabulary differing (FOOD.md):
#
#     ["snack bag"]                 -> snack bag 0.48
#     22 food words                 -> snack bag 0.11
#     a 62-word household list      -> snack bag 0.09   (below any usable floor)
#
# Sixty-two questions at once and the answer flattens, because the individual
# crisps look enough like cutlery that `knife` and `fork` take the score. Ten to
# twenty short, plain, room-specific nouns at conf~0.15 is what was measured to
# work. Adding words is free in latency and expensive in confidence.
#
# The distractors are not reported and are not decoration: with no household
# nouns in the list every blob has to land on a food prompt, and the food scores
# measurably dropped. The background needs somewhere to go.
VOCAB = {
    # People, so the open-vocab pass does not fight the COCO pass over bodies.
    # Not merged into the scene — COCO owns counting.
    "person": ["person"],
    # The words COCO never had. Short plain nouns beat articled phrases
    # ("snack bag" > "a bag of crisps") — also measured.
    "food": ["food", "snack", "sandwich", "wrapper", "packet", "fruit"],
    # Containers. COCO has cup/bowl/bottle already; these are here so a mug of
    # soup has somewhere to land that is not "food".
    "dishes": ["mug", "plate", "bowl", "cup", "bottle"],
    # Somewhere for the rest of a living room to go. Never reported.
    "distractors": ["phone", "book", "laptop", "remote control"],
}

# The bound the tests assert. Not a limit of the model — a limit of the maths
# above. If this ever has to rise, re-read the table in the comment first.
MAX_PROMPTS = 24

PROMPTS = [w for bucket in VOCAB.values() for w in bucket]
_FOOD = set(VOCAB["food"])
_DISHES = set(VOCAB["dishes"])
_PERSON = set(VOCAB["person"])

# 0.35 (what gate.py uses for COCO) returns literally nothing from YOLO-World.
# Open-vocab scores live an order of magnitude lower than a trained closed-set
# logit; 0.15 is the measured floor.
CONF = float(os.getenv("OPENVOCAB_CONF", "0.15"))
IMGSZ = int(os.getenv("OPENVOCAB_IMGSZ", "640"))
MODEL = os.getenv("OPENVOCAB_MODEL", "yolov8s-worldv2.pt")

# Lazy, and one shot: the first call pays ~0.5 s of weights plus ~4 s of CLIP
# text embedding (and a ~25 MB download on a fresh machine). If that fails —
# no network, no ultralytics, no CLIP — `tried` stays True, the warning is said
# once, and every later call is a no-op that degrades to COCO-only.
#
# `set_classes()` needs ultralytics' CLIP fork, which is NOT a dependency of
# ultralytics itself and which ultralytics tries (and, in a pip-less venv,
# fails) to auto-install:
#
#     uv pip install "git+https://github.com/ultralytics/CLIP.git"
#
# Without it the load raises ModuleNotFoundError and this module does the right
# thing — one warning, COCO-only, no crash. That is the whole reason the
# fallback exists and it has been exercised for real on this machine.
_state = {"model": None, "tried": False, "device": "cpu", "warned": False}


def empty():
    """The shape `detect` always returns. A caller must never have to ask
    whether the model was there."""
    return {"food": [], "dishes": [], "objects": []}


def _warn(msg):
    if not _state["warned"]:
        _state["warned"] = True
        print(f"[openvocab] {msg} — falling back to COCO-only food detection.", flush=True)


def _get():
    if _state["tried"]:
        return _state["model"]
    _state["tried"] = True
    try:
        from ultralytics import YOLO
        import torch
        import numpy as np

        model = YOLO(MODEL)          # downloads by name if the file is absent
        model.set_classes(PROMPTS)   # the one line COCO cannot offer
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        # ponytail: MPS is measured, not assumed. YOLO-World carries the text
        # embeddings as a buffer and some ultralytics/MPS builds fall over on
        # the einsum in the contrastive head, so do one throwaway pass and keep
        # whichever device survives it. Ceiling: one probe, at import.
        try:
            model.predict(np.zeros((64, 64, 3), dtype="uint8"), device=device, verbose=False)
        except Exception:
            device = "cpu"
        _state["model"], _state["device"] = model, device
        print(f"[openvocab] yolo-world on {device}: {len(PROMPTS)} prompts, conf={CONF}",
              flush=True)
    except Exception as e:            # noqa: BLE001 — no load failure may reach the loop
        _warn(f"{MODEL} unusable: {type(e).__name__}: {str(e)[:120]}")
    return _state["model"]


def detect(frame):
    """One open-vocabulary pass. Returns {"food", "dishes", "objects"}.

    Never raises. A model that will not load, will not download or falls over
    mid-run returns the empty shape, which merges into a scene as nothing — the
    pipeline is exactly as good as it was before, which is COCO-only.
    """
    model = _get()
    out = empty()
    if model is None:
        return out
    try:
        res = model.predict(frame, imgsz=IMGSZ, conf=CONF, device=_state["device"],
                            verbose=False)[0]
        names = model.names
        food, dishes, objects = set(), set(), set()
        for b in res.boxes:
            label = names[int(b.cls)]
            if label in _PERSON:
                continue             # COCO owns counting; see merge().
            elif label in _FOOD:
                food.add(label)
            elif label in _DISHES:
                dishes.add(label)
            else:
                objects.add(label)
        return {"food": sorted(food), "dishes": sorted(dishes), "objects": sorted(objects)}
    except Exception as e:            # noqa: BLE001
        _warn(f"predict failed: {type(e).__name__}: {str(e)[:120]}")
        _state["model"] = None        # stop trying; the demo carries on COCO-only
        return out


def merge(scene, found):
    """Fold an open-vocab pass into a COCO scene. ADDITIVE ONLY.

    The same convention `vlm.merge_scene` already uses for the VLM, for the same
    reason: a detector that saw no food has not refuted one that did. COCO has
    no word for porridge and YOLO-World has no word for whatever it was not
    asked about, so neither may zero the other. `person_count`, `boxes` and
    `seating` are COCO's alone — counting is what a closed-set detector trained
    on a million people is for, and the open-vocab pass drops its own person
    boxes in `detect` rather than competing for them.
    """
    if not scene:
        return scene
    out = dict(scene)
    out["food"] = sorted(set(scene.get("food") or ()) | set(found.get("food") or ()))
    out["dishes"] = sorted(set(scene.get("dishes") or ()) | set(found.get("dishes") or ()))
    return out


def timed(frame):
    """(merged-ready result, elapsed ms). The worker wants both."""
    t0 = time.monotonic()
    found = detect(frame)
    return found, int((time.monotonic() - t0) * 1000)
