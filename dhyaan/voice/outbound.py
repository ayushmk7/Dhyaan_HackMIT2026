"""Outbound call placement — TECHNICAL_PRD §5.3, abhinavtodo B0.8/B2.

Env is read lazily so imports (and tests) work without credentials; anything that
actually dials raises a clear error if the env is missing.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Awaitable, Callable
from xml.sax.saxutils import escape

log = logging.getLogger("dhyaan.voice.outbound")

RETRYABLE_STATUSES = {"no-answer", "busy", "failed"}
RETRY_DELAY_S = 15.0  # §4.2: exactly one retry, 15 s after attempt 1 ends


def _env(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        raise RuntimeError(
            f"{name} is not set. Fill .env per dhyaan/voice/README.md (B0) before dialling."
        )
    return v


def _client():
    from twilio.rest import Client  # imported lazily; tests never need it

    return Client(_env("TWILIO_ACCOUNT_SID"), _env("TWILIO_AUTH_TOKEN"))


def _attr(v: str) -> str:
    # B2.1: plain saxutils.escape does NOT escape quotes — inside an XML attribute
    # a stray `"` breaks the whole TwiML. (The PRD's own snippet has this bug.)
    return escape(v, {'"': "&quot;"})


def build_twiml(*, alert_id: str, role: str, call_id: str, attempt: int = 1) -> str:
    """Bidirectional media stream: <Connect><Stream> (NOT <Start><Stream>, which is
    receive-only). Every interpolated value is attribute-escaped — B2.1."""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="{_attr(_env('PUBLIC_WSS').rstrip('/') + '/twilio/stream')}">
      <Parameter name="alert_id" value="{_attr(alert_id)}" />
      <Parameter name="call_id"  value="{_attr(call_id)}" />
      <Parameter name="role"     value="{_attr(role)}" />
      <Parameter name="attempt"  value="{_attr(str(attempt))}" />
    </Stream>
  </Connect>
</Response>"""


def place_call(*, to_e164: str, alert_id: str, role: str, call_id: str, attempt: int = 1) -> str:
    """§5.3 verbatim params. timeout=25 ≈ 4 rings; AsyncAmd so TwiML (and our
    stream) starts immediately and the AMD verdict lands on /twilio/amd."""
    call = _client().calls.create(
        to=to_e164,
        from_=_env("TWILIO_FROM_E164"),
        twiml=build_twiml(alert_id=alert_id, role=role, call_id=call_id, attempt=attempt),
        timeout=25,
        machine_detection="Enable",
        async_amd="true",
        async_amd_status_callback=f"{_env('PUBLIC_HTTPS')}/twilio/amd",
        status_callback=f"{_env('PUBLIC_HTTPS')}/twilio/status",
        status_callback_event=["initiated", "ringing", "answered", "completed"],
    )
    log.info("placed call %s to %s (alert %s, role %s, attempt %d)",
             call.sid, to_e164, alert_id, role, attempt)
    return call.sid


def hello_world_call(to_e164: str) -> str:
    """B0.8 — prove the account can ring a verified phone before any bridge exists."""
    call = _client().calls.create(
        to=to_e164,
        from_=_env("TWILIO_FROM_E164"),
        twiml="<Response><Say>Hello from Dhyaan.</Say></Response>",
    )
    return call.sid


def hangup(call_sid: str) -> None:
    """Used by the bridge after end_call's farewell finishes (B5.5)."""
    _client().calls(call_sid).update(status="completed")


async def retry_or_escalate(
    *,
    status: str,
    attempt: int,
    place: Callable[[int], Awaitable[None]],
    on_exhausted: Callable[[], Awaitable[None]],
    delay_s: float = RETRY_DELAY_S,
) -> str:
    """B2.4 — exactly ONE retry on no-answer/busy/failed, then hand to the ladder.

    ponytail: the real FSM should own this timer (it owns every other escalation
    timer); this helper exists so the voice slice works standalone and the test
    can pin the one-retry property. Lift into the FSM's timer wheel at integration.
    """
    if status not in RETRYABLE_STATUSES:
        return "no_action"
    if attempt >= 2:
        await on_exhausted()
        return "escalated"
    await asyncio.sleep(delay_s)
    await place(attempt + 1)
    return "retried"
