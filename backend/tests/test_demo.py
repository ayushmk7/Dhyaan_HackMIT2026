"""`POST /demo/force_ack` — the demo lifeline the frozen box firmware calls.

The route used to live only in the Twilio bridge, which `app/main.py` mounts
only when TWILIO_ACCOUNT_SID and DEEPGRAM_API_KEY are both set. The box's "I'M
OK" button (beacons/boxassist/boxassist.ino:237), the runbook's recovery curl
and scripts/demo_reset.sh all hard-code this path and know nothing about
Twilio, so with no credentials all three got a silent 404. The last test here is
the one that matters: the path exists with no phone credentials in the
environment.
"""

import os

from app import alerts
from app import config as cfg


async def _open_alert(resident, monkeypatch):
    """One alert sitting in the local-cancel window.

    The cancel window is stretched so the ladder's timer cannot fire mid-test and
    move the alert out from under the ack — `ack` is what we are testing, not a
    race with the escalation clock. `ack` cancels the timer on its way through.
    """
    monkeypatch.setattr(cfg, "CANCEL_WINDOW_S", 60)
    alert = await alerts.open_alert(resident, "evt_demo", kind="fall", severity="critical")
    return alert["_id"]


async def test_force_ack_acknowledges_open_alert(client, db, resident, monkeypatch):
    alert_id = await _open_alert(resident, monkeypatch)

    r = await client.post("/demo/force_ack", json={"alert_id": alert_id, "by": "box"})

    assert r.status_code == 200, r.text
    assert r.json() == {"alert_id": alert_id, "state": "ACKNOWLEDGED"}
    assert (await db.alerts.find_one({"_id": alert_id}))["state"] == "ACKNOWLEDGED"


async def test_force_ack_is_idempotent(client, resident, monkeypatch):
    """The firmware retries anything that is not 2xx (boxassist.ino:232) and the
    judge-reset script can be run twice, so a second ack must still be a 2xx
    reporting the same state — not a 409 that sends the box round again."""
    alert_id = await _open_alert(resident, monkeypatch)

    first = await client.post("/demo/force_ack", json={"alert_id": alert_id, "by": "box"})
    second = await client.post("/demo/force_ack", json={"alert_id": alert_id, "by": "box"})

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert second.json()["state"] == "ACKNOWLEDGED"
    assert "error" in second.json()


async def test_force_ack_unknown_alert_is_404(client, resident):
    r = await client.post("/demo/force_ack", json={"alert_id": "alt_nope", "by": "box"})
    assert r.status_code == 404


async def test_force_ack_requires_an_alert_id(client, resident):
    """The bridge's version defaulted a missing id to the literal "alr_demo",
    a stub artifact that no longer exists in any database: the box would have
    got a cheerful 200 for acking nothing."""
    r = await client.post("/demo/force_ack", json={"by": "box"})
    assert r.status_code == 422


async def test_route_exists_without_twilio_credentials():
    """The whole point of the task. If this fails, the box's I'M OK button and
    the judge-reset script are 404ing on a laptop with no phone credentials."""
    from app.main import app

    assert not os.getenv("TWILIO_ACCOUNT_SID")
    assert not os.getenv("DEEPGRAM_API_KEY")
    assert "/demo/force_ack" in app.openapi()["paths"]
