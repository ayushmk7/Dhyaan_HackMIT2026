"""CLI: `python -m vision --source 0 --camera-id cam_mac_01`.

  --source synthetic a scripted day in a drawn living room — no webcam, no
                     permission prompt, and the real cascade end to end
  --dry-run          print the exact JSON it would POST, never post it
  --demo             faster keyframe rules for the 3-minute slot
  --no-yolo          the cut path: motion only, the VLM decides presence
  --preview          a window on the hub's own screen (the only screen a frame reaches)
  --mask x0,y0,x1,y1 black out a private doorway before anything else sees it
  --config-json FILE read /camera/config's shape from a file instead of the API
"""

import argparse
import os
import sys

from . import OLLAMA_HOST, VLM_MODEL
from .capture import CameraUnavailable
from .gate import parse_mask
from .worker import Worker


def main(argv=None):
    p = argparse.ArgumentParser("python -m vision", description=__doc__,
                               formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--source", default="0",
                   help="camera index (0 = MacBook camera, 1+ = Continuity Camera), "
                        "a path to a video/still for rehearsal, or 'synthetic' for a "
                        "scripted drawn room that needs no webcam")
    p.add_argument("--camera-id", default="cam_mac_01")
    p.add_argument("--api", default=os.getenv("DHYAAN_API", "http://localhost:8000"))
    p.add_argument("--band-key", default=os.getenv("BAND_KEY", "band-dev-key"))
    p.add_argument("--mask", default=None, help="x0,y0,x1,y1 normalised 0-1")
    p.add_argument("--preview", action="store_true")
    p.add_argument("--demo", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--no-yolo", action="store_true")
    p.add_argument("--config-json", default=None)
    p.add_argument("--model", default=VLM_MODEL)
    p.add_argument("--ollama", default=OLLAMA_HOST)
    a = p.parse_args(argv)

    try:
        mask = parse_mask(a.mask)
    except ValueError as e:
        p.error(str(e))

    try:
        Worker(source=a.source, camera_id=a.camera_id, api=a.api, band_key=a.band_key,
               mask=mask, preview=a.preview, demo=a.demo, dry_run=a.dry_run,
               no_yolo=a.no_yolo, config_json=a.config_json, model=a.model,
               ollama=a.ollama).run()
    except CameraUnavailable as e:
        print(f"camera: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
