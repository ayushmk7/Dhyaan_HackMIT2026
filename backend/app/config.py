import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "dhyaan")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

# Escalation ladder timings (seconds). Tunable at the venue — see TECHNICAL_PRD §4.2.
CANCEL_WINDOW_S = int(os.getenv("CANCEL_WINDOW_S", "30"))
CONTACT_WAIT_S = int(os.getenv("CONTACT_WAIT_S", "60"))
EXHAUSTED_AFTER_S = int(os.getenv("EXHAUSTED_AFTER_S", "300"))
# Fixed in PRD as constants; env overrides for demo snappiness (alerts.py reads these).
RETRY_WAIT_S = int(os.getenv("RETRY_WAIT_S", "15"))
RESIDENT_RESPONSE_TIMEOUT_S = int(os.getenv("RESIDENT_RESPONSE_TIMEOUT_S", "90"))
