"""The one unconditional demo escape hatch: `POST /demo/force_ack`.

This route used to exist only inside the Twilio/Deepgram voice bridge
(`dhyaan/voice/bridge.py`), which `app/main.py` mounts *only* when
`TWILIO_ACCOUNT_SID` and `DEEPGRAM_API_KEY` are both set. Three things hard-code
this path and none of them know anything about Twilio:

  - `beacons/boxassist/boxassist.ino::postAck` (line 237) — the box's "I'M OK"
    button POSTs `{"alert_id", "by"}` here and treats any 2xx as success. That
    firmware is under hardware freeze and cannot be changed.
  - `DEMO_RUNBOOK.md` §"Recovery moves" — the fastest way to unstick an alert on
    stage is a curl at this path.
  - `scripts/demo_reset.sh` — the judge-reset loop acks every open alert here.

With no credentials in the environment the bridge is never mounted, so all three
got a silent 404: the resident presses I'M OK, the box prints `force_ack HTTP
404`, and the ladder keeps dialling. A demo lifeline that only works when the
phone stack is configured is not a lifeline. This router is mounted
unconditionally, before the bridge, so the path is always there.

No `/v1` prefix and no auth — the box sends only `Content-Type` and
`ngrok-skip-browser-warning`, and the API has no auth anyway (see app/main.py).
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import live
from ..db import db

router = APIRouter(tags=["demo"])


class ForceAckBody(BaseModel):
    alert_id: str = Field(min_length=1)
    by: str = "demo"


@router.post("/demo/force_ack")
async def force_ack(body: ForceAckBody) -> dict:
    """Acknowledge an alert out of band. Halts the escalation ladder.

    Mirrors the response shape of `app/voice_adapter.py::force_ack`, which the
    bridge version returned, so nothing that already parses this changes. The
    box only reads the status code, but the runbook reads the body on stage.
    """
    d = db()
    a = await d.alerts.find_one({"_id": body.alert_id})
    if not a:
        raise HTTPException(404, "alert not found")

    from ..alerts import ack  # ponytail: lazy import, same as residents.py::ack_alert

    try:
        await ack(body.alert_id, body.by, channel="demo")
    except ValueError as e:
        # alerts.ack raises when there is no (state, "ack") transition — the
        # alert is already terminal. A second press of I'M OK, or the reset
        # script running twice, must be a no-op and still a 2xx: the firmware
        # retries on anything that is not 2xx (boxassist.ino:232).
        return {"alert_id": body.alert_id, "state": a.get("state"), "error": str(e)}

    # Re-read and push the state change exactly like residents.py::ack_alert
    # does: the app dismisses its full-screen takeover off the shape
    # `live.broadcast_alert` sends, so the box's I'M OK button clears the phone
    # screen too. The bridge's copy of this route never broadcast.
    a = await d.alerts.find_one({"_id": body.alert_id})
    await live.broadcast_alert(a)
    return {"alert_id": body.alert_id, "state": a.get("state")}
