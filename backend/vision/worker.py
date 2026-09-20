"""The loop: config poll, consent gate, cascade, VLM, POST, heartbeat.

Everything stateful about a running camera lives here. The pure logic it drives
is in gate.py / keyframe.py / vlm.py, which is where the tests point.
"""

import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import httpx

from . import DEMO, TUNING, VLM_MODEL, FRAME_H, FRAME_W
from .capture import Camera, SyntheticCamera, to_jpeg_b64
from .gate import MotionGate, PersonGate, apply_mask, posture_band
from .keyframe import KeyframeSelector, RingBatch
from . import openvocab, vlm

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


_SPOT = {"table": "at the table", "armchair": "in the armchair", "sofa": "on the sofa",
         "counter": "at the counter", "window": "by the window", "doorway": "in the doorway",
         "floor": "on the floor"}


def _sentence(obs):
    """The one line the hub console shows. Built from `activity` and `spot`,
    which are both already family-visible (`GET /presence` says the same two
    things); NEVER from `evidence`, which is staff/audit only (§5.2). The API
    scrubs it again anyway — see `routers/camera.py::MonitorIn`."""
    return " ".join(x for x in (obs["activity"].replace("_", " "),
                                _SPOT.get(obs.get("spot"))) if x)


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
        self._last_shape = None
        self.synthetic = str(source) == "synthetic"
        # The structural facts for THIS frame, or None when no detector ran.
        # Reset every sampled frame — a stale plate must never reach a later
        # observation (see `_detect`).
        self.scene = None
        # Console state, deliberately separate from `self.scene`: the last
        # geometry worth drawing, which persists between detector runs so the
        # hub console does not strobe. It is never merged into an observation.
        self.boxes, self.people = [], 0
        self.last_obs = {"activity": None, "sentence": "", "confidence": None,
                         "latency_ms": 0, "batch_frames": 0}
        self.cam = None
        self._last_monitor = 0.0
        self.frames_seen = 0
        self.last_fps_mark = (time.monotonic(), 0)
        self.fps = 0.0
        self._warned_standin = False
        self._warned_monitor = False
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

    def monitor(self, gate, force=False):
        """A tick for the hub console: counts, normalised boxes, one sentence.

        Never a pixel, never a room name, never the `evidence` line — see the
        allowlist on the API side (`routers/camera.py::MonitorIn`), which is the
        thing that actually enforces it. This is telemetry: fire and forget, and
        a console nobody is watching must not cost the cascade a millisecond.
        """
        if self.dry_run:
            return
        now = time.monotonic()
        if not force and now - self._last_monitor < self.tuning["monitor_s"]:
            return
        self._last_monitor = now
        body = {"camera_id": self.camera_id,
                "ts": datetime.now(timezone.utc).isoformat(),
                "fps": round(self.fps, 2), "person_count": self.people,
                "boxes": self.boxes, "gate": gate, "model": self.model,
                "simulated": self.synthetic, **self.last_obs}
        try:
            r = self._http.post(f"{self.api}/v1/ingest/camera/monitor", json=body)
            # Say it once. A silently-swallowed 422 here is a console that is
            # blank for no visible reason, which cost a debugging round trip.
            if r.status_code != 204 and not self._warned_monitor:
                self._warned_monitor = True
                log(f"monitor: {r.status_code} {r.text[:160]} (said once)")
        except Exception:
            pass

    def post_async(self, payload):
        """Fire the ingest POST on a worker thread.

        It is only ~3 ms, but it sits in the capture loop and the loop now runs
        at 15 fps, so it is 3 ms stolen from every frame for a result nothing
        downstream waits on. One thread, one queue, drop-oldest if the API
        stalls: a backed-up network must slow the network, not the camera.
        """
        if self.dry_run:
            return self.post(payload)
        q = getattr(self, "_postq", None)
        if q is None:
            import queue, threading

            q = self._postq = queue.Queue(maxsize=32)

            def drain():
                while True:
                    item = q.get()
                    if item is None:
                        return
                    try:
                        self.post(item)
                    except Exception as e:      # noqa: BLE001
                        log(f"post failed: {type(e).__name__}: {str(e)[:120]}")

            threading.Thread(target=drain, daemon=True, name="dhyaan-post").start()
        try:
            q.put_nowait(payload)
        except Exception:                        # noqa: BLE001
            # Full queue: the API is slower than the camera. Drop this one and
            # say so rather than letting the loop block behind it.
            log("post queue full — dropped an observation (API slower than the camera)")

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
        cam = self.cam = SyntheticCamera() if self.synthetic else Camera(self.source)
        if self.synthetic and not self.cfg.get("demo_fast"):
            log("synthetic: the API has DEMO_FAST off, so the dedup wants real minutes "
                "of eating before a meal becomes one event. Run the API with DEMO_FAST=1 "
                "to see the timeline move inside a two-minute loop.")
        motion = MotionGate(self.tuning)
        # A detector trained on photographs does not see drawn shapes — measured:
        # yolo11s finds the synthetic figure at confidence 0.04, i.e. noise. So
        # the synthetic source runs the cut path (§3.3) on purpose rather than
        # reporting an empty room for two minutes. Ceiling: no posture rule and
        # no 5 s re-confirm, so a long sit reads as absent, exactly as it would
        # with --no-yolo. Upgrade: --source clip.mp4 of a real room.
        person_gate = PersonGate(enabled=not (self.no_yolo or self.synthetic),
                                 tuning=self.tuning)
        log(f"person gate: {'YOLO on ' + person_gate.device if person_gate.enabled else 'OFF (motion-only; the VLM or the script decides presence)'}")
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
                    self.boxes, self.people = [], 0
                    self.monitor("idle")
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
                run_detector = moved or (
                    selector.present and person_gate.enabled and now - last_person_check >= 5)
                if run_detector:
                    last_person_check = now
                box, seen = self._detect(person_gate, masked, run_detector, moved, motion)

                # The keyframe selector rations VLM calls: min_gap_s holds two
                # keyframes 6-20 s apart. That was right when every observation
                # cost ~2.4 s of model time. It is nonsense now the detector
                # answers in ~13 ms, and it WAS the perceived lag - the app sat
                # six seconds behind a camera that already knew. So post the
                # detector's own observation the moment what it sees changes,
                # and leave the selector to its slow VLM cadence.
                if self.scene is not None:
                    shape = (self.scene["person_count"], bool(self.scene["food"]),
                             bool(self.scene["dishes"]), posture_band(box, self.tuning))
                    if shape != self._last_shape:
                        self._last_shape = shape
                        quick = vlm.post_rules(
                            vlm.from_scene(self.scene, posture_band(box, self.tuning)))
                        self.post_async(vlm.to_payload(
                            self.camera_id, self.cfg["resident_id"],
                            datetime.now(timezone.utc).isoformat(), 0.0, 1, quick,
                            model=os.getenv("YOLO_MODEL", "yolo11s.pt").replace(".pt", ""),
                            latency_ms=getattr(self, "scene_ms", 0)))

                reason = selector.update(now, seen, box)       # stage 4
                # Stage 3b. A keyframe is a frame already judged worth a VLM
                # call, i.e. a few seconds apart at most — the one place a
                # second ~11 ms detector is affordable. The 15 fps loop above
                # never sees it.
                if reason and reason != "absent":
                    self._openvocab(masked)
                status = f"motion {score:.3f}" + (" · person" if seen else "") + \
                         (f" · {reason}" if reason else "")

                if reason == "absent":
                    ring.take()
                    self.boxes, self.people = [], 0
                    self.post(vlm.to_payload(
                        self.camera_id, self.cfg["resident_id"], t.isoformat(),
                        0.0, 0, vlm.ABSENT, model="none", latency_ms=0,
                        simulated=self.synthetic))
                    self.last_obs = {"activity": "absent", "sentence": "out of view",
                                     "confidence": vlm.ABSENT["confidence"],
                                     "latency_ms": 0, "batch_frames": 0}
                elif reason:
                    ring.add(now, to_jpeg_b64(masked))

                if ring.ready(now, force=(reason == "on_floor")):
                    self.monitor("thinking", force=True)       # ...then block for the VLM
                    status = self._flush(ring, t0_mono, t0_wall)

                self.monitor("person" if seen else ("motion" if moved else "idle"))

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

    def _detect(self, person_gate, frame, run_it, moved, motion):
        """Stage 3. Returns (box, seen) and sets `self.scene` for this frame.

        `self.scene` is cleared FIRST, every time: it is a fact about the frame
        in hand, and a flush that lands on a frame where no detector ran must
        override nothing. Stale food is how a sandwich from a minute ago ends up
        in tonight's observation.

        One YOLO pass gives the box AND the structural facts (person_count,
        food, dishes, seating) for the same ~6 ms as asking only for a person.
        """
        self.scene = None
        self.openvocab_ms = 0
        # `self.cam` is only opened in run(), so a Worker built but not started
        # (every test, and --dry-run before the first frame) has none. Ask the
        # script only when there is one to ask.
        if self.synthetic and self.cam is not None:
            # Scripted perception (SyntheticCamera.script): nothing reads a drawn
            # figure as a person, so this source says who is in the room and the
            # rest of the cascade — keyframe rules, the VLM call, ingest, dedup,
            # presence, events, the socket — runs on it for real. The motion gate
            # still runs on every frame; on this source it just does not get a
            # vote. Every row posted carries simulated: true.
            sc = self.cam.script()
            self.boxes, self.people = sc["boxes"], sc["person_count"]
            if not sc["boxes"]:
                return None, False
            x0, y0, x1, y1 = sc["boxes"][0]
            return (x0 * FRAME_W, y0 * FRAME_H, x1 * FRAME_W, y1 * FRAME_H), True
        if not run_it:
            return None, False
        if not person_gate.enabled:
            # The cut path: motion is presence, and the console draws where the
            # foreground is, which is all anyone can honestly say without a
            # detector. `person_count` still comes from the VLM.
            self.boxes = [list(b) for b in [motion.bbox()] if b]
            return None, moved
        _t0 = time.monotonic()
        self.scene = person_gate.scene(frame)
        self.scene_ms = int((time.monotonic() - _t0) * 1000)
        h, w = frame.shape[:2]
        self.boxes = [[x0 / w, y0 / h, x1 / w, y1 / h]
                      for x0, y0, x1, y1 in self.scene["boxes"]]
        self.people = self.scene["person_count"]
        box = self.scene["boxes"][0] if self.scene["boxes"] else None
        return box, box is not None

    def _openvocab(self, frame):
        """Keyframe path: hand YOLO-World a short vocabulary and ADD what it
        finds to the COCO scene (openvocab.py has the measured numbers).

        Additive, exactly as `vlm.merge_scene` folds YOLO into the VLM: COCO
        has no word for cereal and YOLO-World was not asked about everything,
        so neither may zero the other's food. `self.scene` is None whenever no
        detector ran on this frame, and then there is nothing to add to — a
        food list with no person and no box is not an observation. In practice
        that cannot happen here: a non-"absent" reason requires `seen`, which
        requires a COCO pass.

        ponytail: no threading. It is ~9 ms on a path that is already about to
        block for a ~2.4 s VLM call. Ceiling: it lands in the capture loop, so a
        keyframe costs ~25 ms end to end instead of ~16, and the loop skips one
        camera frame. Upgrade: the same worker thread `post_async` already uses.

        Measured ceiling worth knowing on stage: 15 of 18 keyframes came back in
        16-29 ms, and 3 in 2.2-2.5 s — the ones that landed while Ollama had the
        same GPU. Two MPS consumers, one queue. If that ever hurts, the lever is
        OPENVOCAB=0, not a rewrite.
        """
        if not self.tuning.get("openvocab") or self.scene is None:
            return
        found, self.openvocab_ms = openvocab.timed(frame)
        self.scene = openvocab.merge(self.scene, found)

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
        # The VLM is now optional per cycle. YOLO already answered the four
        # structural questions (person, visitor, food, posture) in ~6 ms; the
        # model is only here for the sentence, so it runs every Nth batch and
        # every cycle in between posts YOLO's own observation instead. Set
        # vlm_every_n=1 to go back to a model call every time.
        scene = getattr(self, "scene", None)
        self._since_vlm = getattr(self, "_since_vlm", 0) + 1
        every = self.tuning.get("vlm_every_n", TUNING.get("vlm_every_n", 4))
        if scene and self._since_vlm < every:
            obs = vlm.post_rules(vlm.from_scene(scene, posture_band(
                scene["boxes"][0] if scene["boxes"] else None, self.tuning)))
            # The keyframe cost, honestly: COCO + the open-vocab pass. Naming
            # both in `model` is what makes the two lanes separable in the
            # observations collection afterwards.
            ov = getattr(self, "openvocab_ms", 0)
            name = os.getenv("YOLO_MODEL", "yolo11s.pt").replace(".pt", "")
            self._post_obs(obs, wall[-1], span, len(images),
                           f"{name}+world" if ov else name,
                           getattr(self, "scene_ms", 0) + ov)
            return f"YOLO -> {obs['activity']}"
        self._since_vlm = 0

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
            if not self.synthetic:
                return f"vlm failed ({self.dropped_batches} dropped)"
            obs, latency = dict(vlm.ABSENT), 0     # the script overwrites it below
        # YOLO saw the same frame at ~6 ms and counts people more reliably than a
        # 3B model asked to do it in prose. `post_rules` then re-derives the
        # activity from the corrected count, so "2 people" still becomes
        # with_visitor. The VLM keeps the half only language can do.
        # The rehearsal lane still spends the VLM call — Ollama and the console's
        # latency number are part of what it rehearses — but the answer is the
        # script's, because no model reads a drawing (SyntheticCamera).
        obs = self.cam.script() if self.synthetic else \
            vlm.post_rules(vlm.merge_scene(obs, self.scene))
        self._post_obs(obs, wall[-1], span, len(images), self.model, latency)
        return f"VLM {latency/1000:.1f}s -> {obs['activity']}"

    def _post_obs(self, obs, ts, span, n_frames, model, latency):
        """Post it, then remember it for the console. One place, so a second
        way of producing an observation cannot forget the console again."""
        self.post(vlm.to_payload(self.camera_id, self.cfg["resident_id"],
                                 ts.isoformat(), span, n_frames, obs,
                                 model=model, latency_ms=latency,
                                 simulated=self.synthetic))
        self.people = obs["person_count"]
        self.last_obs = {"activity": obs["activity"], "sentence": _sentence(obs),
                         "confidence": round(float(obs["confidence"]), 3),
                         "latency_ms": int(latency), "batch_frames": n_frames}

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
