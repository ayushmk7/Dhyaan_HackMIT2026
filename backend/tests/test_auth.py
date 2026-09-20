"""POST /auth/login against the `users` store seeded by scripts/seed.py.

What is promised here: the seeded account gets in, nobody else does, the
stored document never contains the password, and the seed is idempotent.
What is deliberately not promised: a session. The token is still API_KEY.
"""

import pytest_asyncio

from app import auth
from app.config import API_KEY
from scripts.seed import USER, seed_user

BAD = {"detail": "check your username and password"}


@pytest_asyncio.fixture
async def user(db, resident):
    return await seed_user(db)


async def login(client, username, password):
    return await client.post("/v1/auth/login", json={"email": username, "password": password})


async def test_seeded_user_logs_in(client, user):
    r = await login(client, "user", "password")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body == {
        "ok": True, "token": API_KEY,
        "user": {"name": "Priya", "email": "user"},
        "resident_id": "res_eleanor",
    }


async def test_username_is_trimmed_and_case_insensitive(client, user):
    r = await login(client, "  User ", "password")
    assert r.status_code == 200, r.text
    assert r.json()["user"]["email"] == "user"


async def test_password_is_exact(client, user):
    for bad in ("Password", " password", "password ", "passwor"):
        r = await login(client, "user", bad)
        assert r.status_code == 401, bad
        assert r.json() == BAD


async def test_wrong_password_is_401(client, user):
    r = await login(client, "user", "wrong")
    assert r.status_code == 401
    assert r.json() == BAD


async def test_unknown_username_is_401_with_the_same_body(client, user):
    r_user = await login(client, "nobody", "password")
    r_pass = await login(client, "user", "wrong")
    assert r_user.status_code == r_pass.status_code == 401
    assert r_user.json() == r_pass.json() == BAD


async def test_empty_fields_are_401(client, user):
    for body in ({"email": "", "password": "password"}, {"email": "user", "password": ""},
                 {"email": "   ", "password": "   "}):
        r = await client.post("/v1/auth/login", json=body)
        assert r.status_code == 401, body
        assert r.json() == BAD


async def test_stored_document_never_contains_the_password(db, user):
    doc = await db.users.find_one({"username": "user"})
    assert doc is not None
    assert set(doc) == {"_id", "username", "password_hash", "salt", "display_name",
                        "resident_id", "role", "created_at"}
    assert doc["password_hash"] != USER["password"]
    # The plaintext appears in no stored value (keys are checked above; one of
    # them is literally "password_hash", which is not the same thing).
    assert all(USER["password"] not in str(v) for v in doc.values())
    # Hex of a 64-byte scrypt output and a 16-byte salt.
    assert len(bytes.fromhex(doc["password_hash"])) == auth.DKLEN
    assert len(bytes.fromhex(doc["salt"])) == auth.SALT_BYTES
    assert doc["resident_id"] == "res_eleanor" and doc["role"] == "family"


async def test_salt_is_per_user():
    a = auth.user_doc(username="a", password="same", display_name="", resident_id="r")
    b = auth.user_doc(username="b", password="same", display_name="", resident_id="r")
    assert a["salt"] != b["salt"]
    assert a["password_hash"] != b["password_hash"]


async def test_reseeding_is_idempotent(db, client, user):
    first = await db.users.find_one({"username": "user"})
    await seed_user(db)
    await seed_user(db)
    assert await db.users.count_documents({}) == 1
    assert await db.users.count_documents({"username": "user"}) == 1
    second = await db.users.find_one({"username": "user"})
    assert second["_id"] == first["_id"]
    # A fresh salt each time is fine; the same password must still open the door.
    r = await login(client, "user", "password")
    assert r.status_code == 200, r.text


async def test_login_does_not_touch_the_other_guards(client, user):
    """A successful login hands back API_KEY; it does not loosen the header checks."""
    r = await login(client, "user", "password")
    token = r.json()["token"]
    ok = await client.get("/v1/residents/res_eleanor/presence",
                          headers={"Authorization": f"Bearer {token}"})
    assert ok.status_code != 401
    bad = await client.get("/v1/residents/res_eleanor/presence",
                           headers={"Authorization": "Bearer user:password"})
    assert bad.status_code == 401
