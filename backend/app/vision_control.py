"""Start and stop the vision worker from the app.

WHAT THIS IS, PLAINLY: an HTTP route that opens the webcam on the machine
running this API. On this build there is no auth on any route (see the notice
at the top of main.py), so anything on the same network can turn on the
camera in her home. That is a demo affordance for a laptop on a stage, and it
is the single most dangerous route in the codebase.

What keeps it survivable, and what must not be relaxed:

  * The command is FIXED. No part of it comes from the request — not the
    source, not the flags, not the interpreter. A caller chooses `start` or
    `stop` and nothing else, so this is not a shell and cannot be made into
    one by a crafted body.
  * One worker per camera, and `start` on a running worker is a no-op rather
    than a second process fighting the first for the device.
  * `VISION_CONTROL=0` removes the routes entirely. Anything that is not a
    laptop demo should set it.
  * Consent and the pause still gate what the worker may WRITE. Starting the
    process does not grant it anything: `/ingest/camera` still fails closed.

ponytail: a dict of Popen handles plus a pid file, rather than a supervisor.
The pid file is not decoration — `uvicorn --reload` restarts this API on every
edit and takes the dict with it while the worker keeps running, so without it
the status read "off" over a camera that was on, and On would have started a
second worker fighting the first for the device. Ceiling: one machine, and a
pid file can be stale if a pid is reused. Upgrade, the day this is not a demo:
a real supervisor, and this route behind auth and behind her consent record.
"""

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

# `backend/`, which is what `python -m vision` has to run from.
ROOT = Path(__file__).resolve().parent.parent

ENABLED = os.getenv("VISION_CONTROL", "1") != "0"

# The whole command, decided here and nowhere else. `--demo` is the stage's
# faster keyframe rules; `--preview` opens the hub's own window, which is the
# screen the product's rules are written around ("the only screen a frame
# reaches") and which the app now mirrors.
ARGS = ["-m", "vision", "--source", os.getenv("VISION_SOURCE", "0"), "--demo", "--preview"]

_PROCS: dict[str, subprocess.Popen] = {}
_STARTED: dict[str, float] = {}


def _pid_path(camera_id: str) -> Path:
    return _log_path(camera_id).with_suffix(".pid")


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)              # signal 0: "does this process exist"
    except (ProcessLookupError, PermissionError, OverflowError, ValueError):
        return False
    return True


def _adopted(camera_id: str) -> int | None:
    """A worker this process did not start, but which is still running.

    `uvicorn --reload` restarts the API on every edit and takes `_PROCS` with
    it, while the worker it spawned keeps going: it has its own session.
    Without this the status said "off" over a camera that was plainly on, and
    pressing On would have started a SECOND worker fighting the first for the
    device. The pid file is written at start and is the only thing that
    survives the reload.
    """
    path = _pid_path(camera_id)
    try:
        pid = int(path.read_text().strip())
    except (OSError, ValueError):
        return None
    if _pid_alive(pid):
        return pid
    path.unlink(missing_ok=True)
    return None


def _live(camera_id: str) -> subprocess.Popen | None:
    p = _PROCS.get(camera_id)
    if p is None:
        return None
    if p.poll() is not None:          # it exited; stop pretending it is there
        _PROCS.pop(camera_id, None)
        _STARTED.pop(camera_id, None)
        _pid_path(camera_id).unlink(missing_ok=True)
        return None
    return p


def status(camera_id: str) -> dict:
    p = _live(camera_id)
    pid = p.pid if p else _adopted(camera_id)
    return {
        "running": pid is not None,
        "pid": pid,
        "started_at": _STARTED.get(camera_id),
        "controllable": ENABLED,
        # Where to look when it will not start. The log is the only thing that
        # answers "no webcam" vs "no model pulled" vs "no vision extra
        # installed", and all three look identical from the app.
        "log": str(_log_path(camera_id)),
    }


def _log_path(camera_id: str) -> Path:
    # The id reaches a FILENAME here, so it is reduced to characters that
    # cannot leave the directory. A real camera id is already this shape; an
    # id with a slash in it would otherwise write wherever it pointed.
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in camera_id)[:64]
    return Path(os.getenv("TMPDIR", "/tmp")) / f"dhyaan-vision-{safe}.log"


def start(camera_id: str) -> dict:
    """Idempotent: a second start while one is running is the running one."""
    if not ENABLED:
        raise RuntimeError("vision control is off (VISION_CONTROL=0)")
    if _live(camera_id) or _adopted(camera_id):
        return status(camera_id)

    log = _log_path(camera_id)
    # Truncated per run. A log that accumulates across starts makes the last
    # failure impossible to find, which is the only reason anyone opens it.
    handle = open(log, "w")
    _PROCS[camera_id] = subprocess.Popen(
        [sys.executable, *ARGS, "--camera-id", camera_id],
        cwd=ROOT,
        stdout=handle,
        stderr=subprocess.STDOUT,
        # Its own process group, so stopping it cannot signal this API.
        start_new_session=True,
    )
    _STARTED[camera_id] = time.time()
    _pid_path(camera_id).write_text(str(_PROCS[camera_id].pid))
    return status(camera_id)


def stop(camera_id: str) -> dict:
    p = _live(camera_id)
    if p is not None:
        p.terminate()
        try:
            # It closes the capture device on the way out, and a camera light
            # that stays on after "off" is the one thing this switch must
            # never do.
            p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            p.kill()
            p.wait(timeout=5)
    else:
        # A worker from before the last API reload. Same two signals, by pid.
        pid = _adopted(camera_id)
        if pid is None:
            return status(camera_id)
        os.kill(pid, signal.SIGTERM)
        for _ in range(50):
            if not _pid_alive(pid):
                break
            time.sleep(0.1)
        else:
            os.kill(pid, signal.SIGKILL)
    _PROCS.pop(camera_id, None)
    _STARTED.pop(camera_id, None)
    _pid_path(camera_id).unlink(missing_ok=True)
    return status(camera_id)
