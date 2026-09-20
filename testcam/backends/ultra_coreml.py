"""The same YOLO weights exported to CoreML, so the ANE/GPU runs it instead of MPS.

Ultralytics does the export and the postprocess, so the only thing that changes
between this row and the pytorch row is the execution engine — which is exactly
the comparison we want.

The export writes `testcam/models/<model>.mlpackage` (a couple of seconds for
yolo11n, longer for bigger weights) and is cached: the second run finds the
package and goes straight to loading. It never writes into backend/ — the .pt is
copied out of there first, so this bench leaves the app's tree alone.
Set TESTCAM_NO_EXPORT=1 to skip the backend instead of exporting.
"""

import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import Backend  # noqa: E402
from backends.ultra_pytorch import CONF, IMGSZ, MODEL, model_path, to_result  # noqa: E402

MODELS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")


class UltraCoreML(Backend):
    name = "ultra-coreml"

    def __init__(self):
        self.available, self.note, self.model = False, "", None
        try:
            import coremltools  # noqa: F401
            from ultralytics import YOLO
        except Exception as e:
            self.note = f"import failed ({type(e).__name__}: {e}) — pip install coremltools"
            return

        os.makedirs(MODELS, exist_ok=True)
        pt = os.path.join(MODELS, MODEL)
        if not os.path.exists(pt):
            src = model_path()
            if os.path.exists(src):
                shutil.copy(src, pt)   # ponytail: copy, so the export lands here not in backend/
            else:
                pt = src               # let ultralytics fetch it (into cwd)
        pkg = os.path.splitext(pt)[0] + ".mlpackage"
        if not os.path.exists(pkg):
            if os.getenv("TESTCAM_NO_EXPORT"):
                self.note = f"{os.path.basename(pkg)} not built and TESTCAM_NO_EXPORT is set"
                return
            print(f"  ultra-coreml: exporting {os.path.basename(pt)} -> CoreML "
                  f"(one-off, a minute or two)...", flush=True)
            try:
                out = YOLO(pt).export(format="coreml", imgsz=IMGSZ, nms=True)
                pkg = str(out) if out and os.path.exists(str(out)) else pkg
            except Exception as e:
                self.note = f"export failed: {type(e).__name__}: {e}"
                return
        if not os.path.exists(pkg):
            self.note = f"export produced no {os.path.basename(pkg)}"
            return

        try:
            self.model = YOLO(pkg, task="detect")
            self.names = self.model.names
        except Exception as e:
            self.note = f"loading {os.path.basename(pkg)} failed: {type(e).__name__}: {e}"
            return
        self.note = f"{MODEL} -> mlpackage, imgsz={IMGSZ} conf={CONF}"
        self.available = True

    def warmup(self, frame):
        for _ in range(3):
            self.detect(frame)

    def detect(self, frame):
        r = self.model.predict(frame, imgsz=IMGSZ, conf=CONF, verbose=False)[0]
        return to_result(r, self.names, self.note)


BACKEND = UltraCoreML()
