"""The user store behind POST /auth/login: one `users` collection, one password check.

What this is: a real password check against a real store. A user document
carries a per-user random salt and an scrypt hash; a login is a lookup by
normalised username plus a constant-time compare of the recomputed hash.

What this is not, yet: a session. The token a successful login hands back is
still the one shared static bearer key (`config.API_KEY`), which is what every
family-lane route checks. So this authenticates a person and then gives every
authenticated person the same key. It is authentication without authorisation
and without revocation.

# ponytail: stdlib scrypt, no bcrypt/argon2 dependency, no JWT. Enough for one
# seeded family on a demo LAN. The ceiling is the shared key: the day two
# families share an API you need (1) a per-login session token stored on the
# user doc and checked by `require_app_key`, and (2) `resident_id` taken from
# that session rather than trusted from the request. Both slot in here.

Stored document shape (collection `users`):

    {
      "_id": "usr_user",
      "username": "user",           # normalised: stripped, lower-cased
      "password_hash": "<hex>",     # scrypt(password, salt), 64 bytes
      "salt": "<hex>",              # 16 random bytes, per user
      "display_name": "User",
      "resident_id": "res_eleanor",
      "role": "family",
      "created_at": "<iso8601 utc>",
    }
"""

import hashlib
import hmac
import secrets
from datetime import datetime, timezone

from .db import db

# scrypt parameters. n=2**14, r=8, p=1 is the interactive-login setting the
# scrypt paper recommends (~16 MiB, ~50 ms on a laptop). Kept as constants so
# a future upgrade can raise them and re-hash on next successful login.
SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1
DKLEN = 64
SALT_BYTES = 16


def normalize_username(username: str) -> str:
    """The identifier is a username, not an email: lower-case and trimmed."""
    return (username or "").strip().lower()


def hash_password(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=SCRYPT_N, r=SCRYPT_R,
                          p=SCRYPT_P, dklen=DKLEN)


def user_doc(*, username: str, password: str, display_name: str, resident_id: str,
             role: str = "family", user_id: str | None = None) -> dict:
    """Build a storable user document. The plaintext never leaves this frame."""
    uname = normalize_username(username)
    salt = secrets.token_bytes(SALT_BYTES)
    return {
        "_id": user_id or f"usr_{uname}",
        "username": uname,
        "password_hash": hash_password(password, salt).hex(),
        "salt": salt.hex(),
        "display_name": display_name,
        "resident_id": resident_id,
        "role": role,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def verify_password(password: str, doc: dict) -> bool:
    """Constant-time compare of the recomputed hash against the stored one."""
    try:
        salt = bytes.fromhex(doc["salt"])
        expected = bytes.fromhex(doc["password_hash"])
    except (KeyError, ValueError, TypeError):
        return False
    return hmac.compare_digest(hash_password(password, salt), expected)


# A throwaway document with a real hash, verified against when the username is
# unknown, so a wrong username costs the same scrypt work as a wrong password.
# It removes the obvious timing tell; it does not make this a hardened login.
_DECOY = user_doc(username="decoy", password=secrets.token_hex(16),
                  display_name="", resident_id="")


async def authenticate(username: str, password: str) -> dict | None:
    """The user document on success, None on any failure.

    The caller must not say which of username or password was wrong; this
    function does not know either, on purpose.
    """
    doc = await db().users.find_one({"username": normalize_username(username)})
    if doc is None:
        verify_password(password, _DECOY)
        return None
    if not verify_password(password, doc):
        return None
    return doc
