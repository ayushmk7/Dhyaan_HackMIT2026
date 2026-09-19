from fastapi import Header, HTTPException

from .config import API_KEY, BAND_KEY


# ponytail: shared-secret headers, not JWT. Two callers exist (the app, the band)
# and both ship with the demo. Swap for real auth when there is a second tenant.
async def require_app_key(authorization: str = Header("")):
    if authorization.removeprefix("Bearer ").strip() != API_KEY:
        raise HTTPException(401, "bad or missing API key")


async def require_band_key(x_band_key: str = Header("")):
    if x_band_key != BAND_KEY:
        raise HTTPException(401, "bad or missing band key")
