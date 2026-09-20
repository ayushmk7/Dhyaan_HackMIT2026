# testcam — which detector is actually fastest, and can it see food?

A standalone bench. Nothing here is imported by `backend/`; it exists to answer
two questions with numbers instead of opinions:

1. **Latency.** What is the fastest way to get person + posture + food + objects
   out of a webcam frame on this Mac?
2. **Food.** COCO has ten food classes (sandwich, pizza, banana, apple, orange,
   cake, donut, hot dog, broccoli, carrot) and nothing else. A crisp packet, a
   noodle box, a wrapper, a mug of soup are all invisible to it. What actually
   detects those?

Each backend implements `detect(frame) -> Result` and is timed on the same
frames. Run `python bench.py` for the table.
