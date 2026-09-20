"""Cascade stage 5: the VLM call, its schema, its prompt, and the post-rules.

One HTTP call, to loopback, to Ollama. This is the only socket a pixel ever
crosses (VLM_PLAN §2, §5.3).
"""

import os
import time
from typing import Literal

import httpx
from pydantic import BaseModel, Field, ValidationError

from . import OLLAMA_HOST, VLM_MODEL

# §3.5's enum, and the one extra value the wire carries (§6.1): "absent" is set
# by a post-rule or by the keyframe selector, never by the model.
# Visitor detection off by default. In a real home a second person is the
# most important fact on screen; in a hall or an office it is true of every
# frame and swallows eating, walking and everything else worth saying.
# Set VISITOR_DETECTION=1 to restore it.
VISITORS = os.getenv("VISITOR_DETECTION", "0") == "1"

def _occupants(n):
    """People, as this product counts them.

    With VISITOR_DETECTION off (the default) the answer is only ever "she is
    there" or "she is not". A hall, an office or a hackathon table puts three
    strangers in every frame, and reporting that as "Eleanor has someone
    visiting" every 20 seconds drowns eating, walking and everything else worth
    saying. The detector still sees them; we just stop treating the room as the
    subject.
    """
    return min(n, 1) if not VISITORS else n

ACTIVITIES = (
    "eating", "drinking", "sitting", "reading", "watching_tv", "using_phone",
    "standing", "walking", "exercising", "lying_down", "on_floor",
    "entering", "leaving", "with_visitor", "unclear",
)


class Observation(BaseModel):
    """What the model is allowed to say. Passed to Ollama as `format` so it is a
    hard constraint, not a request."""

    activity: Literal[ACTIVITIES]
    person_count: int = Field(ge=0, le=6)
    posture: Literal["upright", "seated", "reclined", "on_floor", "unclear"]
    movement: Literal["stationary", "slow", "normal", "unsteady", "unclear"]
    spot: Literal["table", "armchair", "sofa", "doorway", "counter", "window",
                  "floor", "other", "unclear"]
    assistive_device: Literal["none", "cane", "walker", "wheelchair", "unclear"]
    plate_or_cup_present: bool
    # Broader than the field above on purpose: held food (a sandwich, fruit, a
    # snack, a wrapper) is food, and it is what a person eating actually looks
    # like. plate_or_cup_present alone missed every hand-held meal.
    food_visible: bool
    hand_to_mouth_observed: bool
    changed_between_frames: bool
    confidence: float = Field(ge=0, le=1)
    evidence: str = Field(max_length=180)  # prompt asks for <=110; 180 is slack


PROMPT = """You are looking at {n} still frames from one fixed camera in the {zone_label} of {name}'s home, taken over {span_s} seconds, in this order, at {times_local}.
{zone_hint}
{name} is the only person who lives here. {appearance_line}
{spots_line}
Report only what is visible in these frames. Do not describe clothing, body, hair, race, age, or health. Do not guess what anyone is thinking or saying. If two or more people are visible, set person_count and use activity "with_visitor", and describe nothing about the other person.
Choose the single activity that best describes what {name} is doing across the frames. If the frames do not support one, use "unclear" with confidence below 0.4.
Set food_visible true if any food or drink is visible anywhere in the frames, including food held in a hand, a wrapper, a piece of fruit, a snack or a takeaway container - not only food on a plate or in a cup.
"evidence" is one short clause, under 70 characters, naming only objects and actions.
Reply with a single JSON object and nothing else - no prose, no code fence. Use exactly these keys and only these values:
  activity: one of {activities}
  person_count: integer 0-6
  posture: one of upright, seated, reclined, on_floor, unclear      (seated, NOT "sitting")
  movement: one of stationary, slow, normal, unsteady, unclear      (stationary, NOT "still")
  spot: one of table, armchair, sofa, doorway, counter, window, floor, other, unclear
  assistive_device: one of none, cane, walker, wheelchair, unclear
  plate_or_cup_present: true or false
  food_visible: true or false
  hand_to_mouth_observed: true or false
  changed_between_frames: true or false                             (a boolean, NOT a sentence)
  confidence: number between 0 and 1
  evidence: string under 70 characters"""


def build_prompt(cfg, n, span_s, times_local):
    """Conditioned by the resident memory (§4.4).

    Facts are deliberately NOT in here. "She eats at 8" must not turn an empty
    table into breakfast — the facts are for the chatbot's contrast, after the
    fact.
    """
    name = cfg.get("name") or "the resident"
    appearance = (cfg.get("appearance") or "").strip()
    spots = (cfg.get("spots_line") or "").strip()
    return PROMPT.format(
        activities=", ".join(ACTIVITIES),
        n=n,
        zone_label=cfg.get("zone_label") or cfg.get("zone") or "main room",
        name=name,
        span_s=int(round(span_s)),
        times_local=", ".join(times_local),
        zone_hint=(cfg.get("zone_hint") or "").strip(),
        appearance_line=f"{name} is {appearance}." if appearance else "",
        spots_line=f"At this time of day she is usually found: {spots}." if spots else "",
    )


def _post(images_b64, prompt, model, host, timeout, use_schema):
    body = {
        "model": model,
        "stream": False,
        "keep_alive": -1,          # the model stays resident; a cold load is ~10 s
        # qwen3-vl is a thinking model and MUST be told not to. Measured on this
        # machine: think off = 2.5-4.5 s, think on = 24 s and the JSON never
        # arrives (the chain of thought eats num_predict).
        "think": False,
        "options": {"temperature": 0, "num_predict": 150},
        "messages": [{"role": "user", "content": prompt, "images": list(images_b64)}],
    }
    if use_schema:
        body["format"] = Observation.model_json_schema()
    r = httpx.post(f"{host}/api/chat", json=body, timeout=timeout)
    r.raise_for_status()
    msg = r.json()["message"]
    # ponytail: with think=False, some Ollama builds put the JSON in `thinking`
    # and leave `content` empty. Read both rather than picking one.
    return msg.get("content") or msg.get("thinking") or ""


def call(images_b64, prompt, model=VLM_MODEL, host=OLLAMA_HOST, timeout=60.0):
    """One /api/chat call. Returns (observation_dict, latency_ms).

    Fast path first, schema second. Measured on this machine, same frame and
    model, warm:

        long prompt + schema   1.54 s      <- what this used to always do
        long prompt, no schema 0.14 s

    Ollama's structured-output constraint costs about 1.4 s per call, and that
    was ~90 % of the latency of this whole lane. Prompt length turned out to be
    irrelevant (931 chars bought nothing), so shortening the conditioning would
    have been the wrong fix.

    The schema is not decoration though: it is the only reason the JSON is
    always valid, and dropping it outright is what truncated answers mid-field
    earlier. So: ask for JSON in the prompt, validate with Pydantic, and pay for
    the constrained decode only on the rare reply that does not parse. Fast
    normally, correct always.

    Raises if even the constrained retry fails — the caller drops the batch and
    counts it. A half-understood observation is worse than none.
    """
    t0 = time.monotonic()
    raw = _post(images_b64, prompt, model, host, timeout, use_schema=False)
    try:
        obs = Observation.model_validate_json(_strip_fence(raw))
    except ValidationError:
        raw = _post(images_b64, prompt, model, host, timeout, use_schema=True)
        obs = Observation.model_validate_json(raw)
    return obs.model_dump(), int((time.monotonic() - t0) * 1000)


def _strip_fence(raw):
    """Unconstrained replies often arrive as ```json ... ``` or with prose
    around the object. Take the outermost braces."""
    t = raw.strip()
    if "```" in t:
        t = t.split("```")[1].removeprefix("json").strip()
    i, j = t.find("{"), t.rfind("}")
    return t[i:j + 1] if i != -1 and j > i else t


def from_scene(scene, posture_hint=None):
    """An observation from YOLO alone, in ~6 ms and no language model.

    Everything the app needs structurally - is she there, is someone with her,
    is there food, is she up or seated - is a detection problem, not a language
    problem. The VLM is only needed for the sentence, so it runs on its own
    slower cadence and this carries the rest.
    """
    n = _occupants(scene["person_count"])
    posture = {"tall": "upright", "mid": "seated", "wide": "on_floor"}.get(posture_hint, "unclear")
    items = scene["food"] + scene["dishes"]
    if n == 0:
        activity, evidence = "absent", "no one in view"
    elif VISITORS and n >= 2:
        activity, evidence = "with_visitor", f"{n} people in view"
    elif posture == "on_floor":
        # Ranked above food on purpose: someone on the floor holding a sandwich
        # is on the floor. This branch did not exist - `on_floor` fell through
        # to "sitting", so a correctly detected fall was reported as sitting.
        activity, evidence = "on_floor", "one person, on the floor"
    elif scene["food"]:
        activity, evidence = "eating", f"one person, {', '.join(scene['food'][:2])} in view"
    elif posture == "upright":
        activity, evidence = "walking", "one person, upright"
    elif posture == "seated":
        activity, evidence = "sitting", "one person, seated"
    else:
        # Posture unknown (knees occluded, no landmarker). She is present and
        # neither upright nor on the floor, so "sitting" is the fair reading -
        # but do not claim the evidence SAW her seated, because it did not.
        activity, evidence = "sitting", "one person, in view"
    if items and "in view" not in evidence:
        evidence = f"{evidence} ({', '.join(items[:3])})"
    return dict(
        ABSENT,
        activity=activity,
        person_count=n,
        posture=posture,
        movement="unclear",
        spot="table" if "dining table" in scene["seating"] else (
             "armchair" if "chair" in scene["seating"] else "unclear"),
        plate_or_cup_present=bool(scene["dishes"]),
        food_visible=bool(scene["food"]),
        hand_to_mouth_observed=False,     # a detector cannot see a gesture
        changed_between_frames=False,
        confidence=0.75 if n else 0.6,
        evidence=evidence[:70],
    )


def post_rules(obs):
    """The five rules §3.5 says are not the model's job.

    The last one matters most: `unsteady` gait is staff-only per TECHNICAL_PRD
    §12 and this lane has no staff surface. Do not record what you will not
    show.
    """
    o = dict(obs)
    # The model sometimes reports person_count 0 and then describes a person in
    # the same breath ("person holding food near mouth"). Declaring her absent on
    # that is the worst answer available: "out of view" is what the family reads
    # when she is sitting right there. A hand at a mouth is a person, so trust
    # the gesture over the count. Food alone is not: this used to fire on
    # `food_visible` too, which was harmless while COCO could name ten foods
    # and rarely did, and is wrong now the detector names a bowl of cereal left
    # on the table after she has gone — that must stay "absent".
    if o.get("person_count", 0) == 0 and o.get("hand_to_mouth_observed"):
        o["person_count"] = 1
    if o.get("person_count", 0) == 0:
        o["activity"] = "absent"
    elif VISITORS and o.get("person_count", 0) >= 2:
        o["activity"] = "with_visitor"
    elif o.get("hand_to_mouth_observed") and (
        o.get("food_visible") or o.get("plate_or_cup_present")
    ):
        o["activity"] = "eating"
    if o.get("movement") == "unsteady":
        o["movement"] = "unclear"
    return o


def merge_scene(obs, scene):
    """Fold YOLO's structural facts into the VLM's answer, before `post_rules`.

    YOLO saw the same frame at ~6 ms. It counts people better than a 3B model
    asked to do it in prose, so `person_count` is simply overruled — that is
    counting, not naming, and it is what the whole absent/with_visitor split
    hangs off. Objects go the other way: YOLO may only ADD. COCO has no class
    for toast, porridge or soup, so a YOLO miss is not a refutation, and
    zeroing `food_visible` on one would lose exactly the hand-held meals §3.5
    added that field for.

    `scene` is None whenever no detector ran on the frames in this batch. Then
    this is the identity — a stale scene must never reach a later observation.
    """
    if not scene:
        return dict(obs)
    o = dict(obs)
    o["person_count"] = _occupants(scene["person_count"])
    o["food_visible"] = bool(obs.get("food_visible")) or bool(scene["food"])
    o["plate_or_cup_present"] = bool(obs.get("plate_or_cup_present")) or bool(scene["dishes"])
    seen = (scene["food"] + scene["dishes"])[:3]
    if seen:
        # Name what the detector actually saw. The family never reads this —
        # `evidence` is staff/audit only (§5.2) — but a wrong sentence in the
        # observations table is a wrong review of the demo.
        items = ", ".join(seen)
        if items not in o.get("evidence", ""):
            o["evidence"] = f"{o.get('evidence', '')[:100]} ({items})".strip()
    return o


ABSENT = dict(
    activity="absent", person_count=0, posture="unclear", movement="unclear",
    spot="unclear", assistive_device="unclear", plate_or_cup_present=False, food_visible=False,
    hand_to_mouth_observed=False, changed_between_frames=False,
    confidence=0.9, evidence="No person visible in the room.",
)


def to_payload(camera_id, resident_id, ts, span_s, n_frames, obs,
               model=VLM_MODEL, latency_ms=0, simulated=False):
    """The exact body of `POST /v1/ingest/camera` (VLM_PLAN §6.1, frozen).

    Text only. There is no field here that could carry a pixel.
    """
    return {
        "camera_id": camera_id,
        "resident_id": resident_id,
        "ts": ts,
        "span_s": round(float(span_s), 2),
        "n_frames": int(n_frames),
        "person_count": obs["person_count"],
        "activity": obs["activity"],
        "posture": obs["posture"],
        "movement": obs["movement"],
        "spot": obs["spot"],
        "assistive_device": obs["assistive_device"],
        "plate_or_cup_present": bool(obs["plate_or_cup_present"]),
        "food_visible": bool(obs.get("food_visible", False)),
        "hand_to_mouth_observed": bool(obs["hand_to_mouth_observed"]),
        "confidence": round(float(obs["confidence"]), 3),
        "evidence": obs["evidence"][:180],
        "model": model,
        "latency_ms": int(latency_ms),
        "simulated": bool(simulated),
    }
