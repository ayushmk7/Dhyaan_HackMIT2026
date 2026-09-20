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

from . import DEMO, PREVIEW_SCALE, TUNING, VLM_MODEL, FRAME_H, FRAME_W
from .capture import Camera, CameraUnavailable, SyntheticCamera, to_jpeg_b64
from .gate import MotionGate, PersonGate, apply_mask, iou, pick_subject, posture_band
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


# The console's "nothing is claimed" state. One definition, because the two
# places that need it — startup and a paused camera — drifted apart once and
# the hub went on printing "eating at the table" through the privacy beat.
EMPTY_OBS = {"activity": None, "posture": None, "sentence": "", "confidence": None,
             "latency_ms": 0, "batch_frames": 0}


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
        # The last structural words the detector actually found, held between
        # runs for the same reason `self.boxes` is: `self.scene` is reset every
        # sampled frame, and a console that blanks its own readings twice a
        # second is unreadable. Never merged into an observation.
        self._scene_seen = {"food": [], "dishes": [], "seating": []}
        self._subject = None      # the person we are following, box coords
        self._last_obs = None     # what the preview window prints
        self.last_obs = dict(EMPTY_OBS)
        # Wall-clock of the last time the loop decided she was out of view.
        # The VLM runs on its own thread and lands ~2.4 s late, so without this
        # a batch captured while she was eating overwrites the "out of view"
        # posted after she left, and the hub reports eating in an empty room.
        self._absent_ts = None
        self._last_quick = 0.0    # see tuning["quick_min_s"]
        self._drawn, self._draw_mark, self.draw_fps = 0, (time.monotonic(), 0), 0.0
        self._stalled = False     # see tuning["stall_s"]
        self.cam = None
        self.detector = "none"    # the model behind `self.scene`, named in every post
        self._last_monitor = 0.0
        # The preview relay: on by default, so the app shows the same picture
        # this window shows. VISION_STREAM=0 turns it off and the app goes back
        # to saying it has no picture. Never in --dry-run, which posts nothing.
        self.stream = os.getenv("VISION_STREAM", "1") != "0" and not dry_run
        self._last_stream = 0.0
        self.frames_seen = 0
        self.last_fps_mark = (time.monotonic(), 0)
        self.fps = 0.0
        self._warned_standin = False
        self._warned_monitor = False
        self._band_key = band_key
        self._http = self._new_http()

    def _new_http(self):
        return httpx.Client(timeout=5.0, headers={"X-Band-Key": self._band_key})

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

        # A 200 is not an answer. A captive portal or a proxy returns one with
        # an HTML body, `cfg` is then a str, and the first cfg.get() below
        # raised AttributeError straight out of run() - the lane died instead
        # of polling, which is the one thing the poll exists to survive.
        if not isinstance(cfg, dict):
            log(f"config: reply was {type(cfg).__name__}, not an object "
                "-> treating as NO CONSENT")
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

    def _bg(self, name, send, item):
        """Hand `item` to `send` on a named daemon thread with a ONE-deep
        mailbox: newest wins, and a slow network costs a tick or a frame rather
        than costing the capture loop a millisecond. The console is telemetry;
        it must never be able to slow the cascade down."""
        qs = self.__dict__.setdefault("_bgq", {})
        q = qs.get(name)
        if q is None:
            import queue
            import threading

            q = qs[name] = queue.Queue(maxsize=1)

            def drain():
                while not getattr(self, "_stopping", False):
                    it = q.get()
                    if it is None:
                        return
                    try:
                        send(it)
                    except Exception:            # noqa: BLE001
                        pass   # a console nobody is watching is not an incident

            threading.Thread(target=drain, daemon=True, name=f"dhyaan-{name}").start()
        try:
            q.put_nowait(item)
        except Exception:                        # noqa: BLE001
            pass       # the one we drop is already older than the one in hand

    def _readings(self):
        """Everything the hub window prints, in one dict.

        The window and the monitor tick both read THIS, so the app and the
        screen on the hub cannot drift apart: if the window says `seated`, the
        phone says `seated`, off the same values in the same tick. Held between
        detector runs (`self.scene` is reset every sampled frame) so neither
        surface blanks its own readings twice a second.
        """
        if self.scene:
            self._scene_seen = {k: list(self.scene.get(k) or [])
                                for k in ("food", "dishes", "seating")}
        obs = self.last_obs or {}
        return {"activity": obs.get("activity"), "posture": obs.get("posture"),
                "person_count": self.people, **self._scene_seen}

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
        if self.scene:
            self._scene_seen = {k: list(self.scene.get(k) or [])
                                for k in ("food", "dishes", "seating")}
        # No boxes. The app draws the annotated FRAME now, which already has
        # every person outlined on it, so sending the geometry a second time
        # was duplicate data — and it was worse than useless: a busy room made
        # the list longer than the API's allowlist permits and the whole tick
        # 422'd, so the console went blank in exactly the scenes it matters in.
        body = {"camera_id": self.camera_id,
                "ts": datetime.now(timezone.utc).isoformat(),
                "fps": round(self.fps, 2),
                "gate": gate, "model": self.model, "simulated": self.synthetic,
                **self.last_obs, **self._readings()}
        # Off the loop. This used to be a synchronous POST, which was fine at
        # 1 Hz and is not at 3 Hz: it put the network on the critical path of
        # every third frame.
        self._bg("monitor", self._post_monitor, body)

    def _post_monitor(self, body):
        try:
            r = self._http.post(f"{self.api}/v1/ingest/camera/monitor", json=body)
            # Say it once. A silently-swallowed 422 here is a console that is
            # blank for no visible reason, which cost a debugging round trip.
            if r.status_code != 204 and not self._warned_monitor:
                self._warned_monitor = True
                log(f"monitor: {r.status_code} {r.text[:160]} (said once)")
        except Exception as e:
            # Same reasoning one line up: a hub that is blank because the API
            # moved is indistinguishable from a hub that is blank because the
            # room is empty, and that cost a debugging round trip once already.
            if not self._warned_monitor:
                self._warned_monitor = True
                log(f"monitor: {type(e).__name__}: {str(e)[:120]} (said once)")

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
                while not getattr(self, '_stopping', False):
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

    def _install_signals(self):
        """SIGTERM must unwind through `finally`, not kill us where we stand.

        pkill, a supervisor, and macOS at logout all send SIGTERM, and Python's
        default action for it is immediate death: the finally below never runs,
        so the camera is never released, posture.close() never happens, and -
        worst - the "offline" heartbeat is never sent. The backend then keeps
        reporting `camera.online: true` with the last sentence frozen in place,
        which is this product looking like it is watching someone when it has
        stopped. Verified before the fix: worker killed, app still said online.
        """
        import signal

        def stop(signum, _frame):
            log(f"signal {signum}: stopping")
            self._stopping = True

        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                signal.signal(sig, stop)
            except (ValueError, OSError):
                pass        # not the main thread; the loop check still applies

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
        log(f"person gate: {person_gate.model_name + ' on ' + person_gate.device if person_gate.enabled else 'OFF (motion-only; the VLM or the script decides presence)'}")
        self.detector = person_gate.model_name if person_gate.enabled else "none"
        if person_gate.open_vocab and self.tuning.get("openvocab"):
            # Stage 3 already ran the vocabulary on every frame it looked at;
            # a second YOLO-World pass would be the same 7 ms for the same answer.
            self.tuning = dict(self.tuning, openvocab=False)
            log("stage 3b off: the person gate is already open-vocabulary")
        selector = KeyframeSelector(self.tuning)
        ring = RingBatch(self.tuning)

        t0_mono, t0_wall = time.monotonic(), datetime.now().astimezone()
        last_poll = last_hb = last_person_check = 0.0
        last_seq, n_new = 0, 0
        status = "idle"
        self._stopping = False
        # The finally below closes the client. A second run() on the same Worker
        # then failed its first config poll, fell to NO_CONSENT and blocked in
        # the consent loop for ever, which reads exactly like a hang.
        if self._http.is_closed:
            self._http = self._new_http()
        self._stalled, last_new = False, time.monotonic()
        last_box, last_score = None, 0.0
        self._install_signals()
        self.heartbeat("watching")

        try:
            while not self._stopping:
                now = time.monotonic()

                if now - last_poll >= self.tuning["config_poll_s"]:
                    last_poll = now
                    self._refresh_config()
                if now - last_hb >= self.tuning["heartbeat_s"]:
                    last_hb = now
                    self.heartbeat("offline" if self._stalled else self.state())

                st = self.state()
                if st != "watching":
                    # Frames are read and thrown away. No mask, no motion, no
                    # detector, no VLM, no POST. Nothing is retained.
                    ring.take()
                    status = st
                    self.boxes, self.people = [], 0
                    # ...and the sentence. Clearing the geometry but not the
                    # words left the hub reading "eating at the table" all the
                    # way through the privacy beat, which is the one moment in
                    # the demo where the screen has to prove it stopped looking.
                    self._subject, self._last_obs = None, None
                    self.last_obs = dict(EMPTY_OBS)
                    # Nothing captured before this may land after it.
                    self._absent_ts = datetime.now().astimezone()
                    # ...and the LED. Everything above stops us USING the
                    # frames; the device itself stayed open, so the little
                    # green light burned on through the whole privacy beat -
                    # the one moment where the hardware has to agree with the
                    # screen. A closed device is the only version of "it
                    # stopped looking" a resident can check from across the
                    # room without trusting us.
                    if cam is not None:
                        cam.close()
                        cam = self.cam = None
                    self.monitor("idle")
                    self._stream(None, None, None)
                    if self.preview and not self._show(None, None, None, 0.0, status):
                        break
                    time.sleep(0.2)
                    continue

                if cam is None:
                    # Coming back from a pause or a withdrawn consent, where
                    # the branch above closed the device.
                    try:
                        cam = self.cam = SyntheticCamera() if self.synthetic else Camera(self.source)
                    except CameraUnavailable as e:
                        # Something else may have taken the device while we
                        # were not holding it. That is a reason to keep
                        # polling, not to end the lane: she can still resume,
                        # and this loop is what would notice.
                        log(f"camera reopen failed: {e} — retrying in "
                            f"{self.tuning['config_poll_s']:g}s")
                        time.sleep(self.tuning["config_poll_s"])
                        continue
                    # A fresh device numbers its frames from zero, and the
                    # stall clock has been standing still for the whole pause.
                    last_seq, last_new = 0, time.monotonic()
                    log(f"watching again · reopened source {self.source!r}")

                seq, frame = cam.read()
                if frame is None or seq == last_seq:
                    # A camera can stop without erroring. Continuity Camera
                    # hands the phone back, a cable moves, the Mac sleeps the
                    # device — read() keeps returning the same frame and this
                    # `continue` used to run for ever. `_mark_fps` was never
                    # reached, so self.fps froze at its last value and the
                    # heartbeat went on saying "watching": the family app then
                    # showed a live camera with a sentence that never changed,
                    # which is this product's worst failure dressed as its
                    # normal state. Say offline instead, once, and keep saying
                    # it until frames come back.
                    if not self._stalled and now - last_new >= self.tuning["stall_s"]:
                        self._stalled, self.fps = True, 0.0
                        self.boxes, self.people = [], 0
                        self._subject, self._last_obs = None, None
                        self.last_obs = dict(EMPTY_OBS)
                        self._absent_ts = datetime.now().astimezone()
                        self.heartbeat("offline")
                        self.monitor("stalled", force=True)
                        log(f"camera delivered no new frame for "
                            f"{self.tuning['stall_s']:g}s — reported offline")
                    time.sleep(0.005)
                    continue
                if self._stalled:
                    self._stalled = False
                    self.heartbeat("watching")
                    log("camera recovered")
                last_seq, last_new = seq, now
                n_new += 1
                self._mark_fps(now)
                if n_new % self.tuning["sample_every_n"]:      # stage 0
                    # Display is not analysis. The cascade runs on every 2nd
                    # frame on purpose, but the window has no reason to, and
                    # drawing only sampled frames showed a 30 fps camera at
                    # 14.4-15.0 fps — measured, and exactly what "slightly
                    # laggy" was. The overlay carries over from the last
                    # detector pass; `self.boxes` already persists between
                    # passes for precisely this reason, so nothing here is
                    # claiming to have looked at this frame.
                    if self.preview and not self._show(
                            apply_mask(frame, self.mask), motion.fg,
                            last_box, last_score, status):
                        break
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
                last_box, last_score = box, score      # for the unsampled frames' overlay

                # The keyframe selector rations VLM calls: min_gap_s holds two
                # keyframes 6-20 s apart. That was right when every observation
                # cost ~2.4 s of model time. It is nonsense now the detector
                # answers in ~13 ms, and it WAS the perceived lag - the app sat
                # six seconds behind a camera that already knew. So post the
                # detector's own observation the moment what it sees changes,
                # and leave the selector to its slow VLM cadence.
                if self.scene is not None:
                    band = posture_band(box, self.tuning)
                    # One wide frame is not a fall here either. This path posts
                    # the moment the detector's answer changes, which walked
                    # straight around `on_floor_confirm` - a nap on the sofa or
                    # a sideways bend became "Eleanor appeared to be on the
                    # floor at 3:14 pm" off a single rectangle. Borrow the
                    # selector's run instead of counting a second one. It lags
                    # one frame, because selector.update() for THIS frame is
                    # still below; a fall that has been on the floor for two
                    # frames has been there for three.
                    if band == "wide" and not selector.floor_confirmed:
                        band = None
                    shape = (self.scene["person_count"], bool(self.scene["food"]),
                             bool(self.scene["dishes"]), band)
                    # The floor is what stops a posture flap becoming a write
                    # storm; see tuning["quick_min_s"]. `_last_shape` advances
                    # only on a real post, so a change held back here fires on
                    # the next frame past the floor rather than being lost.
                    if shape != self._last_shape and \
                            now - self._last_quick >= self.tuning["quick_min_s"]:
                        self._last_shape, self._last_quick = shape, now
                        # One line per change, not per frame: what the detector
                        # named, so a headless run answers "did it see the
                        # cereal?" without the preview window.
                        sc = self.scene
                        log(f"scene: people={sc['person_count']} food={sc['food']} "
                            f"dishes={sc['dishes']} seating={sc['seating']} "
                            f"({getattr(self, 'scene_ms', 0)} ms)")
                        quick = vlm.post_rules(vlm.from_scene(self.scene, band))
                        self._last_obs = quick
                        ms = getattr(self, "scene_ms", 0)
                        # Both of them. `_last_obs` is what the preview draws and
                        # `last_obs` is what the monitor POSTs, and for a while
                        # only the first was set here — so the hub console went
                        # on showing whatever the VLM last said, minutes stale,
                        # while the app had the detector's current answer.
                        self.people = quick["person_count"]
                        self.last_obs = {"activity": quick["activity"],
                                         "posture": quick.get("posture"),
                                         "sentence": _sentence(quick),
                                         "confidence": round(float(quick["confidence"]), 3),
                                         "latency_ms": int(ms), "batch_frames": 1}
                        self.post_async(vlm.to_payload(
                            self.camera_id, self.cfg["resident_id"],
                            datetime.now(timezone.utc).isoformat(), 0.0, 1, quick,
                            model=self.detector, latency_ms=ms))

                reason = selector.update(now, seen, box)       # stage 4
                # Stage 3b. A keyframe is a frame already judged worth a VLM
                # call, i.e. a few seconds apart at most — the one place a
                # second ~11 ms detector is affordable. The 15 fps loop above
                # never sees it.
                # Open vocabulary on the hot path when a person is in view.
                # Measured: COCO alone 16 ms, COCO + YOLO-World 25 ms, against a
                # 33 ms camera interval - it fits, and keyframe-only meant food
                # was invisible for the seconds between keyframes, which is
                # exactly when someone picks up a bottle. `openvocab_every_n`
                # throttles it if a slower machine starts dropping frames.
                # ...and these two are not alternatives. Written as if/elif,
                # the throttle above swallowed the keyframe pass: with
                # openvocab_every_n=3 the `elif` was unreachable on every frame
                # a person was in view, so on the COCO revert path 2 keyframes
                # in 3 went to the VLM with no food labels at all. `ran_ov`
                # only stops the same frame paying for the detector twice.
                ran_ov = False
                if seen and self.tuning.get("openvocab"):
                    self._ov_tick = getattr(self, "_ov_tick", 0) + 1
                    if self._ov_tick % self.tuning.get("openvocab_every_n", 1) == 0:
                        self._openvocab(masked)
                        ran_ov = True
                if reason and reason != "absent" and not ran_ov:
                    self._openvocab(masked)
                status = f"motion {score:.3f}" + (" · person" if seen else "") + \
                         (f" · {reason}" if reason else "")

                if reason == "absent":
                    ring.take()
                    self.boxes, self.people = [], 0
                    # Stop following whoever was here; otherwise `pick_subject`
                    # starts the next arrival from a box that is seconds old.
                    self._subject = None
                    # post(), not post_async(), meant a 5 s timeout + 1 s sleep
                    # + 5 s retry ON THE CAPTURE LOOP whenever the API was slow:
                    # eleven seconds of frozen preview and dropped frames, for a
                    # result nothing waits on. Every other post path is async.
                    self.post_async(vlm.to_payload(
                        self.camera_id, self.cfg["resident_id"], t.isoformat(),
                        0.0, 0, vlm.ABSENT, model="none", latency_ms=0,
                        simulated=self.synthetic))
                    self._absent_ts = t
                    self.last_obs = {"activity": "absent", "posture": None,
                                     "sentence": "out of view",
                                     "confidence": vlm.ABSENT["confidence"],
                                     "latency_ms": 0, "batch_frames": 0}
                elif reason:
                    ring.add(now, to_jpeg_b64(masked))

                if ring.ready(now, force=(reason == "on_floor")):
                    self.monitor("thinking", force=True)       # ...then block for the VLM
                    status = self._flush(ring, t0_mono, t0_wall)

                self.monitor("person" if seen else ("motion" if moved else "idle"))

                self._stream(masked, motion.fg, box)
                if self.preview and not self._show(masked, motion.fg, box, score, status):
                    break
        except KeyboardInterrupt:
            pass
        finally:
            ring.take()
            if cam is not None:                 # already closed by a pause
                cam.close()
            self.heartbeat("offline")
            self._http.close()
            # Before the interpreter starts tearing down modules: MediaPipe's
            # dispatcher shutdown runs from __del__ and explodes if it gets
            # there after globals are gone (see posture.close).
            try:
                from . import posture

                posture.close()
            except Exception as e:                  # noqa: BLE001
                log(f"posture shutdown: {type(e).__name__}: {e}")
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
        # Follow the person we were already watching, not simply the biggest box.
        # With two people in frame the biggest box hops the moment she lies down
        # or steps out, and the system reports a visitor as her, sitting, quite
        # happily. A switch means our subject is GONE: report not-seen this
        # frame and let the selector's absent_after_s decide, rather than
        # silently adopting someone else.
        box, switched = pick_subject(self.scene["boxes"], self._subject)
        if switched:
            log("subject changed: the person we were following is no longer in "
                "frame (someone else is). Treating as not seen.")
            self._subject = None
            return None, False
        self._subject = box
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
            name = self.detector
            self._post_obs(obs, wall[-1], span, len(images),
                           f"{name}+world" if ov else name,
                           getattr(self, "scene_ms", 0) + ov)
            return f"YOLO -> {obs['activity']}"
        self._since_vlm = 0

        # The VLM call used to happen right here, on the capture loop, and the
        # comment at the call site said so: "...then block for the VLM". Every
        # keyframe the loop stopped dead for ~2.4 s - no frames read, no
        # detection, no posts - which is the hitch you feel. Nothing downstream
        # waits on the sentence, so it goes to a worker thread and lands when it
        # lands. The loop never blocks on a model again.
        #
        # `self.scene` is snapshotted here: the loop rewrites it every frame, and
        # merge_scene on the thread must see the scene this batch came from, not
        # whatever is current 2.4 s later.
        self._submit_vlm(images, prompt, wall[-1], span, len(images),
                         dict(self.scene) if self.scene else None)
        return "VLM queued"

    def _vlm_job(self, images, prompt, ts, span, n_frames, scene):
        """Runs on the VLM thread. Never raises into the loop."""
        # Consent can be withdrawn in the ~2.4 s between handing this batch over
        # and answering it. The pause path empties the ring, but it never
        # touched this queue, so JPEGs already in flight still crossed the
        # socket and still produced an observation after she said stop.
        if self.state() != "watching":
            log("dropped a queued batch: the camera was paused before it ran")
            return
        try:
            obs, latency = vlm.call(images, prompt, model=self.model,
                                    **({"host": self.ollama} if self.ollama else {}))
        except Exception as e:
            self.dropped_batches += 1
            log(f"vlm failed: {type(e).__name__}: {str(e)[:160]}")
            if self.dry_run:
                log("dry-run: printing the payload shape with simulated=true so the "
                    "contract is still diffable. THIS IS NOT AN OBSERVATION.")
                # `wall` was a name from the caller's frame; here the timestamp
                # is `ts`. It raised NameError, the drain() handler ate it, and
                # the payload this branch exists to print never printed.
                self.post(vlm.to_payload(
                    self.camera_id, self.cfg["resident_id"], ts.isoformat(),
                    span, n_frames, dict(vlm.ABSENT, activity="unclear", confidence=0.0,
                                         evidence="VLM unavailable; shape only."),
                    model=self.model, latency_ms=0, simulated=True))
            if not self.synthetic:
                return
            obs, latency = dict(vlm.ABSENT), 0     # the script overwrites it below
        # YOLO saw the same frame at ~6 ms and counts people more reliably than a
        # 3B model asked to do it in prose. `post_rules` then re-derives the
        # activity from the corrected count, so "2 people" still becomes
        # with_visitor. The VLM keeps the half only language can do.
        # The rehearsal lane still spends the VLM call — Ollama and the console's
        # latency number are part of what it rehearses — but the answer is the
        # script's, because no model reads a drawing (SyntheticCamera).
        obs = self.cam.script() if self.synthetic else \
            vlm.post_rules(vlm.merge_scene(obs, scene))
        self._post_obs(obs, ts, span, n_frames, self.model, latency)
        log(f"VLM {latency/1000:.1f}s -> {obs['activity']}")

    def _submit_vlm(self, *args):
        """Hand a batch to the VLM thread. Queue of one, drop-oldest.

        Depth one on purpose: if the model is slower than the keyframes, the
        only batch worth answering is the newest. Queuing them would make the
        sentence describe a moment that has already passed, and it would grow
        without bound.
        """
        import queue
        import threading

        q = getattr(self, "_vlmq", None)
        if q is None:
            q = self._vlmq = queue.Queue(maxsize=1)

            def drain():
                while True:
                    job = q.get()
                    if job is None:
                        return
                    try:
                        self._vlm_job(*job)
                    except Exception as e:                       # noqa: BLE001
                        self.dropped_batches += 1
                        log(f"vlm thread: {type(e).__name__}: {str(e)[:120]}")

            threading.Thread(target=drain, daemon=True, name="dhyaan-vlm").start()
        try:
            q.put_nowait(args)
        except Exception:                                        # noqa: BLE001
            try:
                q.get_nowait()          # drop the stale one
                q.put_nowait(args)
            except Exception:                                    # noqa: BLE001
                log("vlm queue busy — skipped a batch")

    def _post_obs(self, obs, ts, span, n_frames, model, latency):
        """Post it, then remember it for the console. One place, so a second
        way of producing an observation cannot forget the console again."""
        # The VLM answers from its own thread ~2.4 s after the frames were
        # taken. If she left in those seconds the loop has already posted "out
        # of view" and moved on, and letting this land would put a person
        # eating back into an empty room until the next observation.
        #
        # The test is against the last ABSENCE, not the last observation of any
        # kind: the detector posts a fresh observation every time what it sees
        # changes, so "older than the console" would have dropped almost every
        # sentence the VLM ever produced — which is the whole reason it runs.
        if self._absent_ts is not None and ts < self._absent_ts:
            log(f"dropped a late observation ({obs['activity']}): captured "
                f"{(self._absent_ts - ts).total_seconds():.1f}s before she left view")
            return
        self.post(vlm.to_payload(self.camera_id, self.cfg["resident_id"],
                                 ts.isoformat(), span, n_frames, obs,
                                 model=model, latency_ms=latency,
                                 simulated=self.synthetic))
        self.people = obs["person_count"]
        self.last_obs = {"activity": obs["activity"], "posture": obs.get("posture"),
                         "sentence": _sentence(obs),
                         "confidence": round(float(obs["confidence"]), 3),
                         "latency_ms": int(latency), "batch_frames": n_frames}

    # --- preview: the only screen a frame ever reaches ------------------------

    def _annotate(self, frame, fg, box):
        """The frame with the motion inset and every person boxed.

        This is what the hub window draws, and since the app started showing the
        same picture, what it sends there too. Returns a copy; the caller's
        frame is never touched, and nothing here writes a file.
        """
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
        # Every person, not just the subject: the one we are following in green,
        # anyone else in grey. Without this you cannot see WHY it decided what it
        # decided - a hopping subject looked identical to a steady one.
        #
        # Drawn from `self.boxes`, NOT `self.scene["boxes"]`. The scene is a fact
        # about the frame in hand and `_detect` clears it on every frame no
        # detector ran on — which, once you sit still, is all but one frame in
        # five seconds, because MOG2 stops reporting motion and only the slow
        # re-confirm fires. Drawing from it made the green box blink on and off
        # while nothing about the room had changed. `self.boxes` is the
        # persistent copy that exists for exactly this; it is normalised, so it
        # scales back up to whatever the view happens to be.
        subject = self._subject
        for b in self.boxes:
            x0, y0, x1, y1 = int(b[0] * w), int(b[1] * h), int(b[2] * w), int(b[3] * h)
            same = subject is not None and iou((x0, y0, x1, y1), subject) > 0.9
            cv2.rectangle(view, (x0, y0), (x1, y1),
                          (60, 200, 60) if same else (120, 120, 120), 2 if same else 1)
            if same:
                cv2.putText(view, "subject", (x0, max(y0 - 6, 12)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.4, (60, 200, 60), 1, cv2.LINE_AA)

        return view

    def _stream(self, frame, fg, box):
        """Push the annotated frame to the API so the app can show it.

        Encoded in memory and posted on a thread that DROPS rather than queues:
        a slow network costs the app a frame, never the cascade a millisecond.
        The API keeps exactly one frame per camera, in RAM (routers/camera.py
        ::_FRAME). Nothing is written to disk on either side.

        Off with VISION_STREAM=0, and never in --dry-run.
        """
        if not self.stream:
            return
        now = time.monotonic()
        if now - self._last_stream < 0.2:        # ~5 fps, plenty for a phone
            return
        self._last_stream = now
        import cv2

        ok, buf = cv2.imencode(".jpg", self._annotate(frame, fg, box),
                               [int(cv2.IMWRITE_JPEG_QUALITY), 60])
        if not ok:
            return
        self._bg("frame", self._post_frame, buf.tobytes())

    def _post_frame(self, jpg):
        self._http.post(f"{self.api}/v1/ingest/camera/frame",
                        params={"camera_id": self.camera_id},
                        content=jpg, headers={"Content-Type": "image/jpeg"})

    def _show(self, frame, fg, box, score, status):
        """Returns False to quit. `p` pauses the camera for 2 h — her control, on
        her hub (PRODUCT_SPEC §8.3). Nothing here writes a file."""
        import cv2

        # Draw rate, which is NOT self.fps: that counts frames read, and a
        # window can be redrawn far less often than the camera is read. The
        # gap between the two is what a person sees as lag, so both are on the
        # overlay and both are worth watching when re-tuning a slow machine.
        self._drawn += 1
        t0, n0 = self._draw_mark
        if (mono := time.monotonic()) - t0 >= 2.0:
            self.draw_fps = (self._drawn - n0) / (mono - t0)
            self._draw_mark = (mono, self._drawn)
            if os.getenv("DRAW_DEBUG"):
                log(f"draw {self.draw_fps:.1f} fps (camera reads {self.fps:.1f})")

        view = self._annotate(frame, fg, box)
        h, w = view.shape[:2]

        win = "dhyaan hub - the only screen a frame reaches"
        if not getattr(self, "_win_made", False):
            cv2.namedWindow(win, cv2.WINDOW_NORMAL | cv2.WINDOW_KEEPRATIO)
            cv2.resizeWindow(win, w * PREVIEW_SCALE, h * PREVIEW_SCALE)
            self._win_made = True
        shown = cv2.resize(view, (w * PREVIEW_SCALE, h * PREVIEW_SCALE),
                           interpolation=cv2.INTER_LINEAR)

        # Text AFTER the upscale, so it is crisp rather than magnified pixels.
        # What it currently believes, in words, so the window answers "is it
        # seeing this?" without reading a log or the database.
        sh, sw = shown.shape[:2]
        r = self._readings()
        lines = [
            f"activity {r['activity'] or '-'}    posture {r['posture'] or '-'}",
            f"people {r['person_count']}    FOOD {', '.join(r['food']) or '-'}",
            f"DRINK/DISH {', '.join(r['dishes']) or '-'}"
            f"    seating {', '.join(r['seating'][:2]) or '-'}",
            f"{self.state()} | {status}",
        ]
        # Read rate vs draw rate. They are different numbers and the gap
        # between them is what looks like lag.
        lines.append(f"camera {self.fps:.0f} fps    window {self.draw_fps:.0f} fps")
        pad, lh = 14, 30
        cv2.rectangle(shown, (0, sh - pad - lh * len(lines)), (sw, sh), (0, 0, 0), -1)
        for i, line in enumerate(lines):
            cv2.putText(shown, line, (pad, sh - pad - lh * (len(lines) - 1 - i) - 8),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.62, (210, 225, 255), 1, cv2.LINE_AA)
        cv2.imshow(win, shown)
        k = cv2.waitKey(1) & 0xFF
        if k in (ord("q"), 27):
            return False
        if k == ord("p"):
            self.local_paused_until = datetime.now(timezone.utc) + timedelta(seconds=PAUSE_S)
            log(f"paused by resident until {self.local_paused_until.astimezone():%H:%M}")
            self.heartbeat("paused")
        return True
