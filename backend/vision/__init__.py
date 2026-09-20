"""Dhyaan camera lane — the only process that ever holds a pixel.

Run it: `python -m vision --source 0 --camera-id cam_mac_01`.

Three promises this package keeps structurally, not by convention
(VLM_PLAN §5.2, §5.3, §5.6):

  1. No frame is ever written to disk. There is no `cv2.imwrite`, no `open(...,
     "wb")`, no `frames/` directory. Frames live in a RAM ring of at most
     `batch_size` JPEGs and are dropped the moment the observation is posted.
  2. Frames cross exactly one socket: loopback to Ollama. The API gets text.
  3. Consent is checked before the camera device is opened and on every config
     poll. A failed config fetch means no consent, not "carry on".

The review check is the last test in tests/test_vision_gate.py, which walks
this package's AST and fails on any imwrite/VideoWriter/open() call.
"""

import os


# --- the one tuning dict ------------------------------------------------------
# Every threshold in the cascade lives here so a real room can be re-tuned in one
# place. THESE NUMBERS ARE NOT UNIVERSAL: a webcam in a bright kitchen with a
# window behind the chair is not this model's ideal input — MOG2 will call moving
# sunlight "motion" and YOLO will lose a seated person against a bright window.
# Expect to re-tune `motion_ratio` (up, in a busy/bright room) and `person_conf`
# (down, for a seated resident) at the actual install. Ten minutes with
# `--preview` in the real room beats any default here.
TUNING = dict(
    # --- stage 0: sampling ---
    # Every 2nd frame, not every 10th. At 10 a 30 fps camera ran the cascade at
    # ~3 fps, so up to 333 ms passed before a change was even looked at - which
    # was the rest of the perceived lag once the rate limit was gone. The budget
    # per frame is now detector 14 ms + post 3 ms against a 33 ms camera
    # interval, so 15 fps is comfortable. Raise it if a slower machine starts
    # dropping frames.
    sample_every_n=int(os.getenv("SAMPLE_EVERY_N", "2")),
    # --- stage 2: motion (MOG2 on 320x180 grey) ---
    mog_history=300,
    mog_var_threshold=25,
    motion_ratio=0.008,       # foreground fraction that counts as "something moved"
    # --- stage 3: person (YOLO11n, class 0) ---
    person_conf=0.4,
    person_imgsz=640,
    # --- stage 3b: open vocabulary, KEYFRAME PATH ONLY (see openvocab.py) ---
    # COCO knows ten food words, so a crisp packet or a bowl of cereal is
    # invisible to the hot path no matter what. YOLO-World costs ~4 ms over the
    # COCO baseline and can be handed any words at runtime, so it runs on the
    # frames already chosen to be worth a VLM call and never on the 15 fps loop.
    # OPENVOCAB=0 cuts it in one second if it misbehaves on stage; everything
    # then degrades to exactly the COCO-only behaviour it had before.
    openvocab=os.getenv("OPENVOCAB", "1") != "0",
    # Every 3rd frame a person is in view - 5 food checks a second at 15 fps.
    # Measured: at every frame the open-vocab pass fights the resident 3B VLM
    # for the GPU and latency spiked to 824 ms and 2702 ms. At every 3rd:
    # median 12 ms, p90 14 ms, max 15 ms. Food does not change in 200 ms.
    openvocab_every_n=int(os.getenv("OPENVOCAB_EVERY_N", "3")),
    # --- stage 4: keyframe selection (VLM_PLAN §3.4) ---
    min_gap_s=20,             # never two keyframes within 20 s
    on_person_appear_gap_s=30,  # first person-positive frame after >=30 s of none
    aspect_tall=1.6,          # bbox h/w above this = upright
    aspect_wide=0.8,          # below this = wide, i.e. lying / on the floor
    on_floor_confirm=2,       # consecutive wide frames before believing it
    on_floor_cooldown_s=30,   # ...and at most one such jump-the-queue call per 30 s
    on_dwell_s=60,            # while she stays in view, one keyframe a minute
    # One frame per call. Each extra frame is another full vision encode, and
    # that dominates the wall clock. The cost is `changed_between_frames`, which
    # a single frame cannot judge — presence.py sees movement across consecutive
    # observations anyway, so the field was doing little work.
    batch_size=1,             # frames per VLM call
    # YOLO answers person/visitor/food/posture every cycle at ~6 ms. The model
    # only writes the sentence, so it runs every 4th cycle. 1 = a model call
    # every time, as it used to be.
    vlm_every_n=int(os.getenv("VLM_EVERY_N", "4")),
    max_batch_wait_s=30,      # ...flushed after this long even if short
    absent_after_s=30,        # no person for this long -> "absent", no VLM call
    # --- worker cadence ---
    config_poll_s=10,
    heartbeat_s=30,
    monitor_s=1.0,            # at most one monitor tick a second (telemetry, not data)
)

# --demo: the same rules, fast enough that a bite becomes a sentence inside the
# 3-minute slot. Not a separate code path — just smaller numbers.
DEMO = dict(min_gap_s=6, on_dwell_s=15, max_batch_wait_s=15, absent_after_s=12)

# A VLM's vision encoder cost scales with pixels, and this is the single
# biggest latency lever left. 448x252 is still ample to see a person, a table
# and a sandwich; it is not ample to read a document, which we never do.
FRAME_W, FRAME_H = 448, 252   # nothing larger is ever kept
JPEG_QUALITY = 70             # ~18 KB/frame to Ollama

# Measured on this machine, same live frame, same prompt, warm:
#   qwen3-vl:8b   7.3 s
#   qwen3-vl:4b   1.95 s   (spends tokens on a <think> preamble)
#   qwen2.5vl:3b  0.69 s   <- shipped
#   moondream     returned nothing usable on this schema
# 2.5vl:3b answers in clean JSON with no thinking tax and got the same scene
# right (person_count 1, sitting). Override with VLM_MODEL.
VLM_MODEL = os.getenv("VLM_MODEL", "qwen2.5vl:3b")
OLLAMA_HOST = "http://localhost:11434"
