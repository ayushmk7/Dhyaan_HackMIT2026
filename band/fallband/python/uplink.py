"""HTTP uplink with retry + spool for fall events (HARDWARE_SPEC §5.4)."""
from __future__ import annotations

import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any

import requests

log = logging.getLogger("fallband.uplink")

RETRY_DELAYS_S = (0.5, 2.0, 5.0)


class Uplink:
    def __init__(
        self,
        hub_url: str,
        band_key: str,
        spool_dir: str | Path | None = None,
        session: requests.Session | None = None,
    ):
        self.hub_url = hub_url.rstrip("/")
        self.band_key = band_key
        self.spool_dir = Path(spool_dir or os.environ.get("FALLBAND_SPOOL", "/home/arduino/spool"))
        self.session = session or requests.Session()
        self.uplink_ok = True

    def _headers(self) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "X-Band-Key": self.band_key,
        }

    def post(
        self,
        path: str,
        body: dict[str, Any],
        *,
        critical: bool = False,
        timeout_s: float = 5.0,
    ) -> dict[str, Any] | None:
        """POST JSON. critical=True → spool after exhausted retries. Else drop."""
        url = f"{self.hub_url}{path}"
        last_err: Exception | None = None

        for attempt, delay in enumerate((0.0,) + RETRY_DELAYS_S):
            if delay:
                time.sleep(delay)
            try:
                r = self.session.post(url, headers=self._headers(), json=body, timeout=timeout_s)

                if r.status_code in (401, 404):
                    log.error("%s → %s %s", path, r.status_code, r.text[:200])
                    self.uplink_ok = False
                    return None

                if r.status_code == 409:
                    # Cancel too late — final.
                    self.uplink_ok = True
                    try:
                        return r.json()
                    except Exception:
                        return {"cancelled": False, "status_code": 409}

                if 400 <= r.status_code < 500:
                    log.error("%s → %s %s (final)", path, r.status_code, r.text[:200])
                    self.uplink_ok = True
                    return None

                if r.status_code >= 500:
                    raise requests.HTTPError(f"{r.status_code} {r.text[:200]}", response=r)

                self.uplink_ok = True
                if r.status_code == 204 or not r.content:
                    return {}
                try:
                    return r.json()
                except Exception:
                    return {}
            except Exception as e:
                last_err = e
                log.warning("POST %s attempt %d failed: %s", path, attempt + 1, e)

        self.uplink_ok = False
        if critical:
            self._spool(path, body)
            log.error("spooled critical %s after retries: %s", path, last_err)
        else:
            log.warning("dropped non-critical %s: %s", path, last_err)
        return None

    def _spool(self, path: str, body: dict[str, Any]) -> None:
        try:
            self.spool_dir.mkdir(parents=True, exist_ok=True)
            name = f"{int(time.time())}_{uuid.uuid4().hex[:8]}.json"
            (self.spool_dir / name).write_text(
                json.dumps({"path": path, "body": body}, indent=2),
                encoding="utf-8",
            )
        except Exception as e:
            log.error("spool write failed: %s", e)

    def drain_spool(self) -> int:
        """Replay spooled events once each. Returns number successfully drained."""
        if not self.spool_dir.exists():
            return 0
        n = 0
        for f in sorted(self.spool_dir.glob("*.json")):
            try:
                doc = json.loads(f.read_text(encoding="utf-8"))
                path, body = doc["path"], doc["body"]
                url = f"{self.hub_url}{path}"
                r = self.session.post(url, headers=self._headers(), json=body, timeout=5.0)
                if r.status_code < 400 or r.status_code == 409:
                    f.unlink(missing_ok=True)
                    n += 1
                    self.uplink_ok = True
                elif r.status_code >= 500:
                    self.uplink_ok = False
                    break
            except Exception as e:
                log.warning("spool drain %s: %s", f, e)
                self.uplink_ok = False
                break
        return n
