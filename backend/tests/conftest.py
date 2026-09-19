"""Shared test harness. Every test gets a clean database.

Run: uv run pytest    (needs mongo on localhost:27017 — `make mongo`)
"""

import os

import pytest
import pytest_asyncio

os.environ.setdefault("MONGO_DB", "dhyaan_test")
os.environ.setdefault("API_KEY", "test-key")
os.environ.setdefault("BAND_KEY", "test-band-key")

from app import db as dbmod  # noqa: E402
from app.config import API_KEY, BAND_KEY  # noqa: E402

APP_HEADERS = {"Authorization": f"Bearer {API_KEY}"}
BAND_HEADERS = {"X-Band-Key": BAND_KEY}


@pytest_asyncio.fixture
async def db():
    """Clean dhyaan_test database, connected. Dropped after each test."""
    d = await dbmod.connect(name="dhyaan_test")
    for c in await d.list_collection_names():
        await d[c].delete_many({})
    yield d
    await dbmod.close()


@pytest_asyncio.fixture
async def resident(db):
    """One seeded resident with two escalation contacts."""
    await db.residents.insert_one({
        "_id": "res_eleanor",
        "display_name": "Eleanor",
        "room": "214",
        "timezone": "America/New_York",
        "phone_e164": "+15551230000",
        "consent_camera": 1,
        "consent_voice": 1,
    })
    await db.contacts.insert_many([
        {"_id": "con_priya", "resident_id": "res_eleanor", "name": "Priya",
         "phone_e164": "+15551231111", "relationship": "daughter", "ladder_order": 1},
        {"_id": "con_sam", "resident_id": "res_eleanor", "name": "Sam",
         "phone_e164": "+15551232222", "relationship": "son", "ladder_order": 2},
    ])
    await db.bands.insert_one({
        "_id": "band_a3f2", "resident_id": "res_eleanor", "battery_pct": 88,
    })
    return "res_eleanor"


@pytest_asyncio.fixture
async def client(db):
    """httpx client against the real ASGI app, DB already connected."""
    import httpx

    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
def anyio_backend():
    return "asyncio"
