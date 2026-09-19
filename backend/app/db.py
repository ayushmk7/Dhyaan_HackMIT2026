from motor.motor_asyncio import AsyncIOMotorClient

from .config import MONGO_DB, MONGO_URL

_client: AsyncIOMotorClient | None = None
_db = None


def db():
    """The Mongo database handle. Call connect() once at startup first."""
    if _db is None:
        raise RuntimeError("db not connected — call connect() first")
    return _db


async def connect(url: str = MONGO_URL, name: str = MONGO_DB):
    global _client, _db
    _client = AsyncIOMotorClient(url)
    _db = _client[name]
    await ensure_indexes()
    return _db


async def close():
    global _client, _db
    if _client:
        _client.close()
    _client, _db = None, None


async def ensure_indexes():
    d = _db
    # Every read path in the app is "this resident, newest first".
    await d.events.create_index([("resident_id", 1), ("ts_epoch", -1)])
    await d.events.create_index([("type", 1), ("ts_epoch", -1)])
    await d.events.create_index([("resident_id", 1), ("type", 1), ("ts_epoch", -1)])
    await d.alerts.create_index([("state", 1), ("opened_at", -1)])
    await d.alerts.create_index([("resident_id", 1), ("opened_at", -1)])
    await d.bands.create_index("resident_id")
    await d.contacts.create_index([("resident_id", 1), ("ladder_order", 1)])
    await d.baselines.create_index([("resident_id", 1), ("feature", 1)], unique=True)
    await d.baseline_observations.create_index(
        [("resident_id", 1), ("feature", 1), ("date_local", 1)], unique=True
    )
    # ponytail: embeddings live on the event doc and are scanned brute-force in
    # rag.py. No vector index, no Atlas. Ceiling ~50k events on a laptop; move to
    # Atlas Vector Search or sqlite-vec past that.
