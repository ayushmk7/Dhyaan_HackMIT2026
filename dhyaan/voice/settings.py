"""Deepgram Voice Agent Settings builder — TECHNICAL_PRD §5.2, §5.5, §4.6.

mulaw/8000 on BOTH sides (Twilio Media Streams are fixed at mulaw/8k): the only
transform anywhere in the audio path is base64 decode/encode. No resampling.
"""
from __future__ import annotations

import json

# §4.6 — verbatim. defer_until_eot ONLY on end_call (B5.2/B5.3): the farewell TTS
# must finish before the socket closes; escalate must fire the instant the model
# decides, while the reassurance line is still playing.
TOOLS: list[dict] = [
    {
        "name": "mark_ok",
        "description": (
            "Call this as soon as you are confident the person is not in danger. "
            "Use status 'fine' if they say nothing happened, and 'fell_but_fine' "
            "if they confirm they fell but are up and not hurt."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["fine", "fell_but_fine"]},
                "detail": {"type": "string", "description": "One short sentence in their own words."},
            },
            "required": ["status"],
        },
    },
    {
        "name": "escalate",
        "description": (
            "Call this immediately if the person asks for help, says they cannot get up, "
            "sounds hurt, sounds confused, or does not respond coherently. When in doubt, "
            "escalate. Do not ask more than three questions before escalating."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "reason": {"type": "string", "enum": ["distress", "incoherent", "silence", "third_party"]},
                "detail": {"type": "string"},
            },
            "required": ["reason"],
        },
    },
    {
        "name": "request_callback",
        "description": "Only if the person is clearly fine and explicitly asks you to call back later.",
        "parameters": {
            "type": "object",
            "properties": {"minutes": {"type": "integer", "minimum": 1, "maximum": 30}},
            "required": ["minutes"],
        },
    },
    {
        # Connection layer (Meta challenge): the check-in call carries her words home.
        "name": "leave_message",
        "description": "Only after mark_ok: if the person offers a message for their family, call this with their message in their own words. Never invent or embellish a message.",
        "parameters": {
            "type": "object",
            "properties": {"message": {"type": "string"}},
            "required": ["message"],
        },
    },
    {
        "name": "end_call",
        "description": "End the conversation after you have called mark_ok or escalate and said goodbye.",
        "parameters": {"type": "object", "properties": {}},
        "defer_until_eot": True,
    },
]

# §5.5 — resident prompt, verbatim.
RESIDENT_PROMPT = """You are Dhyaan, an automated safety check-in. You are on a phone call with {resident_name}, {resident_age},
because her wearable band detected a possible fall at {fall_time}. Her daughter {contact_name} is contact #1.

Your only job is to find out if she is okay and then call a tool. You are not a doctor, a
companion, or an assistant. Do not offer medical advice. Do not diagnose. Do not discuss anything
other than whether she is okay.

Rules:
- Speak in short sentences. One question at a time. Wait for her to finish.
- Decide from her FIRST answer whenever it is clear. A clear answer gets the tool call in the
  same turn as your reply — do not ask a confirming question first. Only ask a follow-up when
  her answer is genuinely ambiguous, and never more than THREE questions total.
- If she says she is fine and sounds coherent: mark_ok(status="fine") now, in this turn.
- If she confirms she fell but is up and uninjured: mark_ok(status="fell_but_fine") now, in this turn.
- If she asks for help, says she cannot get up, mentions pain, sounds confused, slurred, or
  answers questions that were not asked: escalate immediately. Do not seek confirmation.
- If you are unsure, escalate. A false escalation costs a phone call. A missed one does not.
- After calling mark_ok (only then), ask once: "Anything you'd like me to tell {contact_name}?"
  If she gives a message, call leave_message with her words. If not, move on.
- After calling mark_ok or escalate, say one short closing line, then call end_call.
- Never say the words "emergency services", "ambulance" or "911". You do not call them."""

# §5.5: "The contact prompt swaps the goal: confirm a human is going to physically
# check on Eleanor, then escalate(reason='third_party') if they say they cannot."
CONTACT_PROMPT = """You are Dhyaan, an automated safety service calling on behalf of {resident_name}, {resident_age}.
Her wearable band detected a possible fall at {fall_time} and she did not answer when we called her.
You are speaking with {contact_name}, her {relationship}.

Your only job is to confirm that a human being is going to physically check on {resident_name} right now,
then call a tool. You are not a doctor. Do not give medical advice.

Rules:
- Speak in short sentences. Lead with what happened and when.
- If they say yes, they will check on her (or any equivalent): mark_ok(status="fine",
  detail="contact confirmed they are checking") — this acknowledges the alert.
- If they say they cannot check on her or cannot be reached in time: escalate(reason="third_party").
- If they sound confused or you are unsure: escalate(reason="third_party").
- After calling a tool, say one short closing line, then call end_call.
- Never say the words "emergency services", "ambulance" or "911". You do not call them."""

RESIDENT_GREETING = (
    "Hi {resident_name}, this is Dhyaan calling because your band thought you might have fallen. "
    "Are you okay?"
)
CONTACT_GREETING = (
    "Hi, this is Dhyaan calling about {resident_name}. Her band detected a possible fall at {fall_time}, "
    "and she didn't answer when we called her. Can you check on her? Just say yes to confirm you're on it."
)

# §5.6 — the 12-second voicemail script, spoken via InjectAgentMessage.
VOICEMAIL_MESSAGE = (
    "This is Dhyaan calling about {resident_name}. Her fall sensor went off at {fall_time} and we "
    "could not reach her. Please check on her and open the Dhyaan app."
)

_DEFAULTS = {
    "resident_name": "Asha",
    "resident_age": "81",
    "fall_time": "just now",
    "contact_name": "Priya",
    "relationship": "daughter",
}


def _fmt(template: str, ctx: dict) -> str:
    merged = {**_DEFAULTS, **{k: v for k, v in ctx.items() if v}}
    return template.format(**{k: merged.get(k, "") for k in _DEFAULTS})


def build_settings(ctx: dict) -> dict:
    """The exact §5.2 Settings message. `ctx` is Twilio's customParameters
    (alert_id, call_id, role, plus optional resident_name/fall_time/contact_name)."""
    role = ctx.get("role", "resident")
    is_contact = role.startswith("contact") or role == "staff"
    prompt = _fmt(CONTACT_PROMPT if is_contact else RESIDENT_PROMPT, ctx)
    greeting = _fmt(CONTACT_GREETING if is_contact else RESIDENT_GREETING, ctx)
    return {
        "type": "Settings",
        "audio": {
            "input": {"encoding": "mulaw", "sample_rate": 8000},
            "output": {"encoding": "mulaw", "sample_rate": 8000, "container": "none"},
        },
        "agent": {
            "greeting": greeting,
            "listen": {"provider": {"type": "deepgram", "model": "flux-general-en"}},
            "think": {
                "provider": {"type": "anthropic", "model": "claude-haiku-4-5", "temperature": 0.2},
                "prompt": prompt,
                "functions": TOOLS,
            },
            "speak": {"provider": {"type": "deepgram", "model": "aura-2-thalia-en"}},
        },
    }


def voicemail_message(ctx: dict) -> str:
    return _fmt(VOICEMAIL_MESSAGE, ctx)


if __name__ == "__main__":  # ponytail: the smallest check that fails if this breaks
    s = build_settings({"role": "resident", "alert_id": "alr_x", "call_id": "cal_x"})
    assert s["audio"]["input"]["encoding"] == "mulaw" and s["audio"]["output"]["container"] == "none"
    deferred = [t["name"] for t in s["agent"]["think"]["functions"] if t.get("defer_until_eot")]
    assert deferred == ["end_call"], deferred
    json.dumps(s)  # round-trips
    print("settings ok")
