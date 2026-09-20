"""Live push channel for the RN app: `WS /v1/live` fans out every new Event and
every alert state change to connected clients. TECHNICAL_PRD §10.3/§10.5.

# ponytail: no message coalescing (the PRD flags `location.changed` as the
# highest-volume type and suggests throttling to 1/resident/10s). Not needed
# until the demo machine actually struggles — add a per-resident debounce in
# `broadcast` if it does.
"""

import asyncio
import contextlib

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..events import subscribe
from ..rag import FAMILY_EXCLUDED_TYPES
from .camera import _family_item

router = APIRouter(prefix="/v1", tags=["app"])

# ponytail: one FastAPI worker -> a dict of live sockets is the whole fan-out.
# Matches the same shortcut events.py takes for `_subscribers`. Becomes
# Redis pub/sub (or sticky sessions) the day there is more than one worker.
_connections: dict[WebSocket, dict] = {}

_PING_INTERVAL_S = 25


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


async def broadcast(msg: dict, resident_id: str | None) -> None:
    """Public since the camera lane pushes `presence.update` too.

    In parallel and on a clock. `events.emit()` awaits its subscribers, so this
    sits on the fall-ingest path: one phone on bad venue wifi that never
    finishes its send used to block every other client's event — and, behind
    the per-socket lock, queue the next one behind it. Two seconds is long
    enough for a slow phone and short enough that the ladder does not wait for
    it; a socket that misses the deadline is dropped and reconnects with its
    own backoff.
    """
    targets = [
        ws for ws, info in _connections.items()
        if not (resident_id and info["resident_id"] and info["resident_id"] != resident_id)
    ]
    results = await asyncio.gather(
        *(asyncio.wait_for(_send(ws, msg), 2.0) for ws in targets),
        return_exceptions=True,
    )
    for ws, res in zip(targets, results):
        if isinstance(res, asyncio.TimeoutError):
            # Same treatment as the dead-socket branch in `_send`, which the
            # cancelled send never reached.
            _connections.pop(ws, None)
            with contextlib.suppress(Exception):
                await ws.close()


@subscribe
async def _on_event(doc: dict) -> None:
    """Registered once at import time. Fired by `events.emit()` after every
    write — this is the entire "push every new event" requirement.

    It used to push the raw Mongo doc: `zone` and the raw `embedding_text`
    ("Asha moved into the bathroom") went to every client on the LAN, which is
    the same D-001 leak `/timeline` had. Same shaper as `/activity` and
    `/timeline`, so a row cannot be safe on one path and not the other. The
    `resident_id` is added back because clients route on it and `_family_item`
    (written for a single-resident day view) has no reason to carry it.
    """
    if doc["type"] in FAMILY_EXCLUDED_TYPES:
        return
    await broadcast({"t": "event.new",
                     "event": {**_family_item(doc), "resident_id": doc.get("resident_id")}},
                    doc.get("resident_id"))


async def broadcast_alert(alert: dict) -> None:
    """Called by alerts.py on every FSM transition and by residents.py after
    ack/resolve.

    It sends the SAME shape `GET /alerts/{id}` returns, via residents.py's
    `alert_response`. That is the whole point: this used to push the raw Mongo
    doc, which has no `closed_at`, and the app dismisses its full-screen
    takeover by reading `closed_at`. So resolving an alert closed it on the REST
    path and left it stuck on screen on the socket. One shaper, no drift.
    Lazy import because residents.py imports this module.
    """
    if not _connections:
        # Nobody is listening, so do not pay two queries to shape a message that
        # goes nowhere. `alerts.py` broadcasts on every FSM transition, and that
        # ladder must not slow down for an empty room.
        return

    from .residents import alert_response

    await broadcast({"t": "alert.update", "alert": await alert_response(alert)},
                    alert.get("resident_id"))


@router.websocket("/live")
async def live_ws(websocket: WebSocket, resident_id: str | None = None):
    # No token. Anyone who can open the socket gets every event for every
    # resident (or one, if they pass resident_id). Demo build; see app/main.py.
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
