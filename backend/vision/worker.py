"""The loop: config poll, consent gate, cascade, VLM, POST, heartbeat.

Everything stateful about a running camera lives here. The pure logic it drives
is in gate.py / keyframe.py / vlm.py, which is where the tests point.
"""

import json
import sys
import time
from datetime import datetime, timedelta, timezone

import httpx

from . import DEMO, TUNING, VLM_MODEL, FRAME_H, FRAME_W
from .capture import Camera, to_jpeg_b64
from .gate import MotionGate, PersonGate, apply_mask
from .keyframe import KeyframeSelector, RingBatch
from . import vlm

PAUSE_S = 2 * 60 * 60          # key `p` on the preview: her control, on her hub
PRIVATE_ZONES = {"bedroom", "bathroom"}

# Used only by --dry-run when there is no API and no --config-json. A real run
# fails closed instead; see _refresh_config.
STANDIN_CONFIG = {
    "resident_id": "res_eleanor", "name": "Eleanor", "consent_camera": 1,
    "paused_until": None, "zone": "living_room", "zone_label": "living room",
    "zone_hint": "Living room. The dining table is on the left, her armchair by the window on the right.",
    "appearance": "", "spots_line": "", "demo_fast": False,
}

NO_CONSENT = {"consent_camera": 0, "resident_id": None, "name": None}


def log(*a):
    print(f"[{datetime.now().strftime('%H:%M:%S')}]", *a, flush=True)


class Worker:
    def __init__(self, *, source, camera_id, api, band_key, mask=None, preview=False,
                 demo=False, dry_run=False, no_yolo=False, config_json=None,
                 model=VLM_MODEL, ollama=None):
        self.source, self.camera_id, self.api = source, camera_id, api.rstrip("/")
        self.band_key, self.mask, self.preview = band_key, mask, preview
        self.dry_run, self.no_yolo, self.config_json = dry_run, no_yolo, config_json
        self.model = model
        self.ollama = ollama

        self.tuning = dict(TUNING, **(DEMO if demo else {}))
        self.cfg = dict(NO_CONSENT)       # fail closed until a poll succeeds
        self.local_paused_until = None
        self.dropped_batches = 0
        self.frames_seen = 0
        self.last_fps_mark = (time.monotonic(), 0)
        self.fps = 0.0
        self._warned_standin = False
        self._http = httpx.Client(timeout=5.0, headers={"X-Band-Key": band_key})

    # --- config + consent -----------------------------------------------------

    def _fetch_config(self):
        if self.config_json:
            with open(self.config_json) as f:
                return json.load(f)
        r = self._http.get(f"{self.api}/v1/camera/config", params={"camera_id": self.camera_id})
        r.raise_for_status()
        return r.json()

    def _refresh_config(self):
        """Poll, then validate at the trust boundary. A fetch that fails means
        NO CONSENT, not "carry on with the last one" (VLM_PLAN §5.6)."""
        try:
            cfg = self._fetch_config()
        except Exception as e:
            if self.dry_run and not self.config_json:
                if not self._warned_standin:
                    log("config: API unreachable and no --config-json; --dry-run is using a "
                        "local stand-in config, consented by you at this terminal. "
                        "A real run fails closed here.")
                    self._warned_standin = True
                self.cfg = dict(STANDIN_CONFIG)
                return
            log(f"config: fetch failed ({type(e).__name__}) -> treating as NO CONSENT")
            self.cfg = dict(NO_CONSENT)
            return

        # The API returns 422 for a private zone, but a worker that would point a
        # camera at a bedroom because a server said so is not a gate.
        if str(cfg.get("zone", "")).lower() in PRIVATE_ZONES:
            log(f"config: zone {cfg.get('zone')!r} is never allowed -> NO CONSENT")
            self.cfg = dict(NO_CONSENT)
            return
        if not cfg.get("resident_id"):
            log("config: no resident_id -> NO CONSENT")
            self.cfg = dict(NO_CONSENT)
            return
        self.cfg = cfg

    def _paused_until(self):
        """The later of her local pause and the server's, as an aware datetime."""
        ends = [self.local_paused_until]
        raw = self.cfg.get("paused_until")
        if raw:
            try:
                d = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
                ends.append(d if d.tzinfo else d.replace(tzinfo=timezone.utc))
            except ValueError:
                log(f"config: unparseable paused_until {raw!r} -> treating as paused")
                ends.append(datetime.now(timezone.utc) + timedelta(seconds=PAUSE_S))
        ends = [e for e in ends if e and e > datetime.now(timezone.utc)]
        return max(ends) if ends else None

    def state(self):
        if not self.cfg.get("consent_camera"):
            return "no_consent"
        return "paused" if self._paused_until() else "watching"

    # --- outbound -------------------------------------------------------------

    def heartbeat(self, state):
        if self.dry_run:
            return
        pu = self._paused_until()
        body = {"camera_id": self.camera_id, "state": state,
                "paused_until": pu.isoformat() if pu else None,
                "fps": round(self.fps, 2), "dropped_batches": self.dropped_batches}
        try:
            self._http.post(f"{self.api}/v1/ingest/camera/heartbeat", json=body)
        except Exception as e:
            log(f"heartbeat failed: {type(e).__name__}")

    def post(self, payload):
        """--dry-run prints the exact JSON instead of posting it, so it can be
        diffed against fixtures/camera_observation.json."""
        if self.dry_run:
            print(json.dumps(payload, indent=2), flush=True)
            return
        for attempt in (1, 2):
            try:
                r = self._http.post(f"{self.api}/v1/ingest/camera", json=payload)
                if r.status_code == 403:
                    log("ingest: 403 — consent off or paused at the API. Stopping the camera.")
                    self.cfg = dict(NO_CONSENT)
                    return
                if r.status_code == 404:
                    log(f"ingest: 404 — unknown camera_id {self.camera_id!r}. Check --camera-id.")
                    return
                r.raise_for_status()
                body = r.json()
                log(f"posted {payload['activity']} conf={payload['confidence']} "
                    f"-> obs {body.get('observation_id')} events {body.get('event_ids')}")
                return
            except Exception as e:
                if attempt == 2:
                    self.dropped_batches += 1
                    log(f"ingest failed after retry: {type(e).__name__}: {e}")
                    return
                time.sleep(1.0)

    # --- the run --------------------------------------------------------------

    def run(self):
        # Consent gate BEFORE the camera device is opened. No consent, no camera.
        self._refresh_config()
        said = False
        while not self.cfg.get("consent_camera"):
            if not said:
                log("no camera consent — the camera has NOT been opened. "
                    f"Polling {self.api}/v1/camera/config every {self.tuning['config_poll_s']}s.")
                self.heartbeat("no_consent")
                said = True
            time.sleep(self.tuning["config_poll_s"])
            self._refresh_config()

        log(f"consent ok for {self.cfg.get('name')} · zone {self.cfg.get('zone')} · "
            f"opening source {self.source!r}")
        cam = Camera(self.source)
        motion = MotionGate(self.tuning)
        person_gate = PersonGate(enabled=not self.no_yolo, tuning=self.tuning)
        log(f"person gate: {'YOLO11n on ' + person_gate.device if person_gate.enabled else 'OFF (--no-yolo, motion-only; the VLM decides presence)'}")
        selector = KeyframeSelector(self.tuning)
        ring = RingBatch(self.tuning)

        t0_mono, t0_wall = time.monotonic(), datetime.now().astimezone()
        last_poll = last_hb = last_person_check = 0.0
        last_seq, n_new = 0, 0
        status = "idle"
        self.heartbeat("watching")

        try:
            while True:
                now = time.monotonic()

                if now - last_poll >= self.tuning["config_poll_s"]:
                    last_poll = now
                    self._refresh_config()
                if now - last_hb >= self.tuning["heartbeat_s"]:
                    last_hb = now
                    self.heartbeat(self.state())

                st = self.state()
                if st != "watching":
                    # Frames are read and thrown away. No mask, no motion, no
                    # detector, no VLM, no POST. Nothing is retained.
                    ring.take()
                    status = st
                    if self.preview and not self._show(None, None, None, 0.0, status):
                        break
                    time.sleep(0.2)
                    continue

                seq, frame = cam.read()
                if frame is None or seq == last_seq:
                    time.sleep(0.005)
                    continue
                last_seq = seq
                n_new += 1
                self._mark_fps(now)
                if n_new % self.tuning["sample_every_n"]:      # stage 0
                    continue

                t = t0_wall + timedelta(seconds=now - t0_mono)
                masked = apply_mask(frame, self.mask)          # stage 1
                score = motion.score(masked)                   # stage 2
                moved = motion.moved(score)

                # stage 3. Also run it on a slow tick while she is believed to be
                # present: MOG2 absorbs a person who sits still for ~100 s into
                # the background, and "she stopped moving" must not become
                # "she left". With --no-yolo there is no way to make that check,
                # which is the honest cost of the cut path.
                box, seen = None, False
                if moved or (selector.present and person_gate.enabled and now - last_person_check >= 5):
                    last_person_check = now
                    if person_gate.enabled:
                        box = person_gate.detect(masked)
                        seen = box is not None
                    else:
                        seen = moved

                reason = selector.update(now, seen, box)       # stage 4
                status = f"motion {score:.3f}" + (" · person" if seen else "") + \
                         (f" · {reason}" if reason else "")

                if reason == "absent":
                    ring.take()
                    self.post(vlm.to_payload(
                        self.camera_id, self.cfg["resident_id"], t.isoformat(),
                        0.0, 0, vlm.ABSENT, model="none", latency_ms=0))
                elif reason:
                    ring.add(now, to_jpeg_b64(masked))

                if ring.ready(now, force=(reason == "on_floor")):
                    status = self._flush(ring, t0_mono, t0_wall)

                if self.preview and not self._show(masked, motion.fg, box, score, status):
                    break
        except KeyboardInterrupt:
            pass
        finally:
            ring.take()
            cam.close()
            self.heartbeat("offline")
            self._http.close()
            log("stopped. no frame was written to disk.")

    def _mark_fps(self, now):
        t0, n0 = self.last_fps_mark
        self.frames_seen += 1
        if now - t0 >= 2.0:
            self.fps = (self.frames_seen - n0) / (now - t0)
            self.last_fps_mark = (now, self.frames_seen)

    def _flush(self, ring, t0_mono, t0_wall):
        """Batch -> one VLM call -> one POST. The ring is emptied first, so the
        pixels are unreferenced the moment the call returns."""
        items = ring.take()
        span = items[-1][0] - items[0][0] if len(items) > 1 else 0.0
        wall = [t0_wall + timedelta(seconds=m - t0_mono) for m, _ in items]
        images = [b64 for _, b64 in items]
        prompt = vlm.build_prompt(self.cfg, len(images), span,
                                  [w.strftime("%H:%M:%S") for w in wall])
        try:
            obs, latency = vlm.call(images, prompt, model=self.model,
                                    **({"host": self.ollama} if self.ollama else {}))
        except Exception as e:
            self.dropped_batches += 1
            log(f"vlm failed: {type(e).__name__}: {str(e)[:160]}")
            if self.dry_run:
                log("dry-run: printing the payload shape with simulated=true so the "
                    "contract is still diffable. THIS IS NOT AN OBSERVATION.")
                self.post(vlm.to_payload(
                    self.camera_id, self.cfg["resident_id"], wall[-1].isoformat(),
                    span, len(images), dict(vlm.ABSENT, activity="unclear", confidence=0.0,
                                            evidence="VLM unavailable; shape only."),
                    model=self.model, latency_ms=0, simulated=True))
            return f"vlm failed ({self.dropped_batches} dropped)"
        obs = vlm.post_rules(obs)
        self.post(vlm.to_payload(self.camera_id, self.cfg["resident_id"],
                                 wall[-1].isoformat(), span, len(images), obs,
                                 model=self.model, latency_ms=latency))
        return f"VLM {latency/1000:.1f}s -> {obs['activity']}"

    # --- preview: the only screen a frame ever reaches ------------------------

    def _show(self, frame, fg, box, score, status):
        """Returns False to quit. `p` pauses the camera for 2 h — her control, on
        her hub (PRODUCT_SPEC §8.3). Nothing here writes a file."""
        import cv2
        import numpy as np

        if frame is None:
            frame = np.zeros((FRAME_H, FRAME_W, 3), dtype="uint8")
        view = frame.copy()
        h, w = view.shape[:2]
        # Derive the inset from the real frame. These were hard-coded to a
        # 640-wide frame and threw the moment FRAME_W changed:
        # "could not broadcast (90,160,3) into (90,0,3)".
        if fg is not None:
            iw, ih = max(w // 4, 40), max(h // 4, 24)
            small = cv2.cvtColor(cv2.resize(fg, (iw, ih)), cv2.COLOR_GRAY2BGR)
            view[4:4 + ih, w - iw - 4:w - 4] = small
        if box:
            x0, y0, x1, y1 = (int(v) for v in box)
            cv2.rectangle(view, (x0, y0), (x1, y1), (60, 200, 60), 2)
        cv2.rectangle(view, (0, h - 30), (w, h), (0, 0, 0), -1)
        cv2.putText(view, f"{self.state()} | {status}", (8, h - 9),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (240, 240, 240), 1, cv2.LINE_AA)
        cv2.imshow("dhyaan hub - the only screen a frame reaches", view)
        k = cv2.waitKey(1) & 0xFF
        if k in (ord("q"), 27):
            return False
        if k == ord("p"):
            self.local_paused_until = datetime.now(timezone.utc) + timedelta(seconds=PAUSE_S)
            log(f"paused by resident until {self.local_paused_until.astimezone():%H:%M}")
            self.heartbeat("paused")
        return True
