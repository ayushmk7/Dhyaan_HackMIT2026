import os

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "dhyaan")

# ponytail: one static API key for the app, one for bands. No JWT, no user table.
# Upgrade to real auth when there is a second tenant.
API_KEY = os.getenv("API_KEY", "dev-key-change-me")
BAND_KEY = os.getenv("BAND_KEY", "band-dev-key")

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000")

# Escalation ladder timings (seconds). Tunable at the venue — see TECHNICAL_PRD §4.2.
CANCEL_WINDOW_S = int(os.getenv("CANCEL_WINDOW_S", "30"))
CONTACT_WAIT_S = int(os.getenv("CONTACT_WAIT_S", "60"))
EXHAUSTED_AFTER_S = int(os.getenv("EXHAUSTED_AFTER_S", "300"))
