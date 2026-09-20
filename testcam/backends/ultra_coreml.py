"""The same YOLO weights exported to CoreML, so the ANE/GPU runs it instead of MPS.

Ultralytics does the export and the postprocess, so the only thing that changes
between this row and the pytorch row is the execution engine — which is exactly
the comparison we want.

The export takes a minute or two and writes `<model>.mlpackage` next to the .pt.
It is cached: the second run finds the package and skips straight to loading.
Set TESTCAM_NO_EXPORT=1 to refuse to export and just skip the backend instead.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import Backend  # noqa: E402
from backends.ultra_pytorch import CONF, IMGSZ, MODEL, model_path, to_result  # noqa: E402


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

        pt = model_path()
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
