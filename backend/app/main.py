"""THIS API HAS NO AUTHENTICATION AND NO AUTHORIZATION.

There is no login, no API key, no band key, no token on the websocket. Any
process that can reach the port can read every resident's history, write
observations as any camera or band, pause and resume cameras, open and resolve
alerts, and delete a resident's memory (the DELETE still asks for her name in
the body, which is a confirmation, not a credential). CORS is wide open too.

This is a demo build for one laptop on one LAN. It must not be exposed to the
internet, and it must not be mistaken for a service that protects anyone's
data. The consent gates (camera consent, pause, the family response filter)
are still enforced: they protect the resident from the system, not the server
from the network. Put real auth back before this leaves the LAN.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .routers import camera, chat, ingest, live, residents, setup


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    from .alerts import start_timers, stop_timers
    from .fallcheck import start_fallcheck, stop_fallcheck
    from .presence import start_sweeper, stop_sweeper

    start_timers()
    # Closes camera episodes nobody has sent an observation for in a while —
    # she stops eating without anyone telling us she stopped (VLM_PLAN §3.6).
    start_sweeper()
    # Camera evidence can auto-cancel a fall during its window - never block one.
    start_fallcheck()
    yield
    stop_fallcheck()
    stop_sweeper()
    stop_timers()
    await db.close()


app = FastAPI(title="Dhyaan API", version="0.1.0", lifespan=lifespan)

# ponytail: wide open CORS. React Native does not enforce it and the demo runs on
# a LAN. Lock to the app origin before this is reachable from the internet.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest.router)
app.include_router(residents.router)
app.include_router(setup.router)
app.include_router(chat.router)
app.include_router(live.router)
app.include_router(camera.device)
app.include_router(camera.family)

# Live voice: mount the Twilio/Deepgram bridge and swap the scripted stub for
# real calls only when credentials exist, so `./dev.sh` stays zero-config.
import os as _os  # noqa: E402

if _os.getenv("TWILIO_ACCOUNT_SID") and _os.getenv("DEEPGRAM_API_KEY"):
    import sys as _sys
    from pathlib import Path as _Path

    _repo = str(_Path(__file__).resolve().parents[2])
    if _repo not in _sys.path:
        _sys.path.insert(0, _repo)
    try:
        from dhyaan.voice import bridge as _bridge

        from . import voice_adapter as _voice_adapter

        _voice_adapter.install()
        _bridge.use_fsm(_voice_adapter)
        app.include_router(_bridge.router)
    except Exception as _e:  # missing twilio/websockets deps, etc.
        import logging as _logging

        _logging.getLogger("dhyaan").warning("live voice disabled: %s", _e)


@app.get("/health")
async def health():
    await db.db().command("ping")
    return {"ok": True}
