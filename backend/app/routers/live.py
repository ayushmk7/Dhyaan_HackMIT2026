"""Live push channel for the RN app: `WS /v1/live` fans out every new Event and
every alert state change to connected clients. TECHNICAL_PRD §10.3/§10.5.

# ponytail: no message coalescing (the PRD flags `location.changed` as the
# highest-volume type and suggests throttling to 1/resident/10s). Not needed
# until the demo machine actually struggles — add a per-resident debounce in
# `_broadcast` if it does.
"""

import asyncio
import contextlib

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..config import API_KEY
from ..events import subscribe

router = APIRouter(prefix="/v1", tags=["app"])

# ponytail: one FastAPI worker -> a dict of live sockets is the whole fan-out.
# Matches the same shortcut events.py takes for `_subscribers`. Becomes
# Redis pub/sub (or sticky sessions) the day there is more than one worker.
_connections: dict[WebSocket, dict] = {}

_PING_INTERVAL_S = 25


def _ser(doc: dict) -> dict:
    out = dict(doc)
    out["id"] = out.pop("_id", doc.get("id"))
    return out


async def _send(ws: WebSocket, msg: dict) -> None:
    info = _connections.get(ws)
    if info is None:
        return
    async with info["lock"]:
        try:
            await ws.send_json(msg)
        except Exception:
            # Dead socket — drop it. The receive loop's own exception handling
            # will also clean this connection up; this just stops a slow-to-
            # notice death from soaking up every future broadcast's time.
            _connections.pop(ws, None)
            with contextlib.suppress(Exception):
                await ws.close()


async def _broadcast(msg: dict, resident_id: str | None) -> None:
    for ws, info in list(_connections.items()):
        if resident_id and info["resident_id"] and info["resident_id"] != resident_id:
            continue
        await _send(ws, msg)


@subscribe
async def _on_event(doc: dict) -> None:
    """Registered once at import time. Fired by `events.emit()` after every
    write — this is the entire "push every new event" requirement."""
    await _broadcast({"t": "event.new", "event": _ser(doc)}, doc.get("resident_id"))


async def broadcast_alert(alert: dict) -> None:
    """Called by residents.py after ack/resolve — state transitions the ladder
    itself doesn't necessarily emit as an Event."""
    await _broadcast({"t": "alert.update", "alert": _ser(alert)}, alert.get("resident_id"))


@router.websocket("/live")
async def live_ws(websocket: WebSocket, token: str = "", resident_id: str | None = None):
    # ponytail: auth via query param, not a header — a browser/RN websocket
    # can't set one on the upgrade request. This lands in access logs; accepted
    # for the demo per the task brief. Upgrade to a short-lived signed ticket
    # minted over a prior HTTPS call before this is internet-facing.
    if token != API_KEY:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    _connections[websocket] = {"resident_id": resident_id, "lock": asyncio.Lock()}
    try:
        while True:
            try:
                # We don't care what the client sends (RN pings every 25s per
                # the PRD); this just keeps the loop alive and detects a real
                # disconnect promptly instead of only on our own send.
                await asyncio.wait_for(websocket.receive_text(), timeout=_PING_INTERVAL_S)
            except asyncio.TimeoutError:
                await _send(websocket, {"t": "ping"})
    except WebSocketDisconnect:
        pass
    finally:
        _connections.pop(websocket, None)
