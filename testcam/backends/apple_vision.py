"""Apple's own Vision framework through pyobjc. No model download, no pip wheel
of weights, nothing to warm on the GPU — it ships with macOS.

VNDetectHumanRectanglesRequest gives person boxes; VNDetectHumanBodyPoseRequest
gives 19 joints, which is a better posture signal than a box aspect ratio.

What it CANNOT do: food. Vision has no food detector — VNRecognizeObjects does
not exist, and the classifier that does (VNClassifyImageRequest) is a
whole-image label, not a detection. So `food` is always [] here and the note
says "no food classes". That is the honest answer, not a bug to work around.

ponytail: frames reach Vision as an in-memory JPEG (cv2.imencode -> NSData),
because building a CVPixelBuffer from a numpy array through pyobjc is twenty
lines of CoreVideo ceremony. The encode is ~0.3 ms at 448x252 and it is INSIDE
the timed call, so the number printed is what a caller would actually pay.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import Backend, Result, biggest_box, posture_from_box  # noqa: E402

CONF = float(os.getenv("TESTCAM_VISION_CONF", "0.3"))
NO_FOOD = "no food classes (person + pose only); ms includes jpeg encode"


def _joint(Vision, name):
    return getattr(Vision, "VNHumanBodyPoseObservationJointName" + name, name)


class AppleVision(Backend):
    name = "apple-vision"

    def __init__(self):
        self.available, self.note = False, ""
        try:
            import cv2  # noqa: F401
            import Vision
            from Foundation import NSData  # noqa: F401
        except Exception as e:
            self.note = (f"import failed ({type(e).__name__}: {e}) — "
                         "pip install pyobjc-framework-Vision")
            return
        try:
            Vision.VNDetectHumanRectanglesRequest.alloc().init()
            Vision.VNDetectHumanBodyPoseRequest.alloc().init()
        except Exception as e:
            self.note = f"Vision requests would not construct: {type(e).__name__}: {e}"
            return
        self.V = Vision
        self.note = NO_FOOD
        self.available = True

    def warmup(self, frame):
        self.detect(frame)

    def detect(self, frame):
        import cv2
        from Foundation import NSData
        V = self.V

        ok, buf = cv2.imencode(".jpg", frame)
        if not ok:
            raise RuntimeError("jpeg encode failed")
        data = NSData.dataWithBytes_length_(buf.tobytes(), int(buf.size))
        handler = V.VNImageRequestHandler.alloc().initWithData_options_(data, {})

        rects = V.VNDetectHumanRectanglesRequest.alloc().init()
        try:
            rects.setUpperBodyOnly_(False)     # revision-dependent; harmless if absent
        except Exception:
            pass
        pose = V.VNDetectHumanBodyPoseRequest.alloc().init()
        done, err = handler.performRequests_error_([rects, pose], None)
        if not done:
            raise RuntimeError(f"Vision performRequests failed: {err}")

        h, w = frame.shape[:2]
        boxes = []
        for o in (rects.results() or []):
            if o.confidence() < CONF:
                continue
            bb = o.boundingBox()                # normalized, origin BOTTOM-left
            x, y, bw, bh = bb.origin.x, bb.origin.y, bb.size.width, bb.size.height
            boxes.append((x * w, (1 - y - bh) * h, (x + bw) * w, (1 - y) * h))

        poses = pose.results() or []
        posture = self._posture(poses) or posture_from_box(biggest_box(boxes))
        # Pose finds people the rectangle request sometimes misses (and vice versa);
        # report the larger count rather than pretending one of them is the truth.
        return Result(person_count=max(len(boxes), len(poses)), boxes=boxes,
                      posture=posture, food=[], objects=[],
                      note=f"{NO_FOOD}; pose={len(poses)}")

    def _posture(self, poses):
        """Joint geometry, normalized coords, y up. None -> caller falls back to the box."""
        if not poses:
            return None
        V = self.V
        p = poses[0]

        def y_of(*names):
            ys = []
            for n in names:
                try:
                    pt, _ = p.recognizedPointForJointName_error_(_joint(V, n), None)
                except Exception:
                    pt = None
                if pt is not None and pt.confidence() > 0.2:
                    ys.append(pt.location().y)
            return sum(ys) / len(ys) if ys else None

        sh, hip = y_of("LeftShoulder", "RightShoulder"), y_of("LeftHip", "RightHip")
        ank = y_of("LeftAnkle", "RightAnkle") or y_of("LeftKnee", "RightKnee")
        if sh is None or hip is None:
            return None
        torso = sh - hip
        if torso <= 0.02:                      # shoulders level with hips -> lying down
            return "on_floor"
        if ank is None:
            return "unclear"
        legs = hip - ank
        if legs >= 0.8 * torso:
            return "upright"
        if legs <= 0.05:
            return "on_floor"
        return "seated"


BACKEND = AppleVision()
