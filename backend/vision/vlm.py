"""Cascade stage 5: the VLM call, its schema, its prompt, and the post-rules.

One HTTP call, to loopback, to Ollama. This is the only socket a pixel ever
crosses (VLM_PLAN §2, §5.3).
"""

import time
from typing import Literal

import httpx
from pydantic import BaseModel, Field

from . import OLLAMA_HOST, VLM_MODEL

# §3.5's enum, and the one extra value the wire carries (§6.1): "absent" is set
# by a post-rule or by the keyframe selector, never by the model.
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
"evidence" is one short clause, under 70 characters, naming only objects and actions."""


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
        n=n,
        zone_label=cfg.get("zone_label") or cfg.get("zone") or "main room",
        name=name,
        span_s=int(round(span_s)),
        times_local=", ".join(times_local),
        zone_hint=(cfg.get("zone_hint") or "").strip(),
        appearance_line=f"{name} is {appearance}." if appearance else "",
        spots_line=f"At this time of day she is usually found: {spots}." if spots else "",
    )


def call(images_b64, prompt, model=VLM_MODEL, host=OLLAMA_HOST, timeout=60.0):
    """One /api/chat call. Returns (observation_dict, latency_ms).

    Raises on transport error or a response that does not satisfy the schema —
    the caller drops the batch and counts it. A half-understood observation is
    worse than none.
    """
    t0 = time.monotonic()
    r = httpx.post(
        f"{host}/api/chat",
        json={
            "model": model,
            "stream": False,
            "keep_alive": -1,          # the 6 GB stays resident; a cold load is ~10 s
            # qwen3-vl is a thinking model and MUST be told not to. Measured on
            # this machine, 3 frames + this schema: think off = 2.5-4.5 s, think
            # on = 24 s and the JSON never arrives (the chain of thought eats
            # num_predict). 24 s is not a presence layer.
            "think": False,
            # 120 truncated the JSON mid-`evidence` once food_visible was added — the
            # schema is a hard constraint, so a tight budget does not shorten the
            # answer, it invalidates it. 200 fits all 11 fields with slack.
            "options": {"temperature": 0, "num_predict": 150},
            "format": Observation.model_json_schema(),
            "messages": [{"role": "user", "content": prompt, "images": list(images_b64)}],
        },
        timeout=timeout,
    )
    r.raise_for_status()
    latency_ms = int((time.monotonic() - t0) * 1000)
    msg = r.json()["message"]
    # ponytail: with think=False, Ollama 0.32.9 + qwen3-vl:8b puts the
    # schema-constrained JSON in `thinking` and leaves `content` empty. It is
    # their bug, the output is valid either way, and `format` guarantees the
    # shape whichever field it lands in. Ceiling: an Ollama release that fixes
    # the routing changes which field is populated, not what is in it — which is
    # why this reads both instead of picking one. Upgrade: drop the fallback
    # once `ollama --version` is past the fix.
    raw = msg.get("content") or msg.get("thinking") or ""
    return Observation.model_validate_json(raw).model_dump(), latency_ms


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
    # the gesture over the count and let the VLM's own evidence break the tie.
    if o.get("person_count", 0) == 0 and (
        o.get("hand_to_mouth_observed") or o.get("food_visible")
    ):
        o["person_count"] = 1
    if o.get("person_count", 0) == 0:
        o["activity"] = "absent"
    elif o.get("person_count", 0) >= 2:
        o["activity"] = "with_visitor"
    elif o.get("hand_to_mouth_observed") and (
        o.get("food_visible") or o.get("plate_or_cup_present")
    ):
        o["activity"] = "eating"
    if o.get("movement") == "unsteady":
        o["movement"] = "unclear"
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
