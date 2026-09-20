from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .routers import camera, chat, ingest, live, residents, setup


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    from .alerts import start_timers, stop_timers
    from .presence import start_sweeper, stop_sweeper

    start_timers()
    # Closes camera episodes nobody has sent an observation for in a while —
    # she stops eating without anyone telling us she stopped (VLM_PLAN §3.6).
    start_sweeper()
    yield
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
app.include_router(camera.public)


@app.get("/health")
async def health():
    await db.db().command("ping")
    return {"ok": True}
