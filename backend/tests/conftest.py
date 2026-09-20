"""Shared test harness. Every test gets a clean database.

Run: uv run pytest    (needs mongo on localhost:27017 — `make mongo`)
"""

import os

import pytest
import pytest_asyncio

# Per-process test database. A fixed name collides the moment two people (or
# two agents, or pytest-xdist) run the suite at once — DuplicateKeyError on the
# seeded resident, which looks like a code bug and is not.
TEST_DB = f"dhyaan_test_{os.getpid()}"
os.environ.setdefault("MONGO_DB", TEST_DB)

from app import db as dbmod  # noqa: E402

# No auth headers anywhere: the API has none (see app/main.py). Every request
# in this suite goes out bare, and that is the contract being tested.


@pytest_asyncio.fixture
async def db():
    """Clean dhyaan_test database, connected. Dropped after each test."""
    d = await dbmod.connect(name=TEST_DB)
    for c in await d.list_collection_names():
        await d[c].delete_many({})
    yield d
    await d.client.drop_database(TEST_DB)
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

@pytest.fixture(autouse=True)
def _reset_voice_script():
    """`voice.SCRIPT` is a module-level global that POST /admin/simulate mutates.
    One test hitting that endpoint silently changes the call outcome for every
    test that runs after it — which passes alone and fails in the suite. Reset it
    around every test rather than asking each test to remember."""
    from app import voice

    before = voice.SCRIPT
    yield
    voice.SCRIPT = before
