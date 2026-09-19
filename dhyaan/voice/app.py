"""Standalone voice-slice app: `uvicorn dhyaan.voice.app:app --port 8000`.

Runs the bridge + Twilio callbacks + demo endpoints before Ayush's backend exists.
At integration this router mounts into the real dhyaan-api FastAPI process.
"""
from __future__ import annotations

import logging

from fastapi import FastAPI

from .bridge import router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

app = FastAPI(title="dhyaan-voice")
app.include_router(router)


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "service": "dhyaan-voice"}
