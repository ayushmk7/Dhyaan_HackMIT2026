# Why can't it see food?

Because it was never asked to. `backend/vision/gate.py` runs a COCO-trained
YOLO, and COCO's entire food vocabulary is ten words:

    banana  apple  orange  sandwich  broccoli  carrot  hot dog  pizza  donut  cake

There is no eleventh. A crisp packet, a noodle box, a sandwich in a wrapper, a
mug of soup, a plate of rice, a protein bar, a bowl of cereal, a biscuit, a
piece of toast — none of them is a class, so none of them has an output neuron.
Lowering `conf` cannot help; nor can `yolo11n -> yolo11s -> yolo11m`. The
model's last layer has 80 slots and ten of them are food. That is the bug.

COCO does give you four useful *containers* — `cup`, `bowl`, `bottle`,
`dining table` — which is why the pipeline can say "there is a bowl" and never
"there is cereal in it".

Everything below was measured on this Mac by `bench.py`. Nothing is estimated.

---

## What each option can actually name

| backend | vocabulary | gives you | food it can name |
|---|---|---|---|
| `ultra_pytorch` / `ultra_coreml` / `onnx_yolo` (COCO YOLO) | 80 fixed classes | boxes + labels | the ten, forever |
| `apple_vision` | person + pose only | boxes + keypoints | **none** — structurally food-blind |
| `mediapipe_tasks` | person + pose (+ a COCO detector) | boxes + keypoints | the ten at best |
| `openvocab_yoloworld` (**mine**) | **any free-text list, set at runtime** | boxes + labels | whatever you type |
| `clip_zeroshot` (**mine**) | any free-text list of *sentences* | a ranked activity, **no box** | none — it names the *act*, not the object |

`clip_zeroshot` is in the bench for honesty, not because it detects food. It is
a classifier: it scores "a photo of a person eating a meal" against "a photo of
a person holding a mobile phone" over a person crop, and returns the winner. It
answers *is eating happening*. It cannot answer *there is a sandwich at
(120,80)-(190,140)* and it cannot count two plates.

---

## The test: food COCO cannot name

`fixtures/` holds seven real photographs from Wikimedia Commons — a real crisp
packet, a real instant-noodle bowl, a real mug of soup, real cereal, real
protein bars, and two real people eating. Five of the seven are outside COCO's
ten. They are downscaled to the bench's own 448x252 like every other frame, so
these are the numbers the harness actually produced:

```
for f in fixtures/*.jpg; do
  .venv/bin/python bench.py --frames 12 --source "$f" \
    --only ultra_pytorch,openvocab_yoloworld,clip_zeroshot
done
```

| fixture | in COCO? | COCO YOLO (`yolo11n`) said | YOLO-World said | CLIP said |
|---|---|---|---|---|
| `cereal_bowl.jpg` | **no** | *no food* — `bowl, spoon, dining table` | **`cereal`, `rice`, `food`** | `eating` p=.74 |
| `crisp_packet.jpg` | **no** | *nothing at all* | **`food`** generically; **`snack bag`** when asked directly — see below | `holding-food` p=.91 |
| `mug_soup.jpg` | **no** | *no food* — `cup` | `cup` + **`soup`** | `drinking` p=.83 |
| `noodle_bowl.jpg` | **no** | *no food* — `bowl, dining table` | `food`, `eating`, `rice` (wrong grain, right meal) | `holding-food` p=.62 |
| `protein_bar.jpg` | **no** | **`pizza`** — a false positive, not a save | `food` + `pizza` (same false positive) | `holding-food` p=.76 |
| `person_sandwich.jpg` | yes (`sandwich`) | 1 person, *no food* | 1 person + **`eating`** | `eating` p=.34 (below threshold → reports nothing) |
| `people_lunch.jpg` | yes | **0 people**, no food | **8 people**, seated | `idle` p=.85 |

Read the first column twice. On five images of real food, the COCO detector
reported food exactly once, and that once was wrong (`pizza` for a protein bar).
YOLO-World named the cereal, named the soup, and spotted the eating.

The `people_lunch` row is a bonus finding and not about food at all: `yolo11n`
at `conf=0.35` found **zero** people in a downscaled crowd shot where YOLO-World
found eight. The open-vocab model is a stronger person detector here too.

---

## Latency — what it costs

Full bench, 20 live webcam frames at 448x252, warmup excluded, this Mac:

```
backend                 median ms   p90 ms  ppl  posture   food     objects
ultra-coreml                  6.8      7.1    2  on_floor  -        -
ultra-pytorch/mps             7.2      8.1    2  on_floor  -        -
apple-vision                  7.3     12.4    2  unclear   -        -
onnx-yolo/coreml             10.8     13.7    2  on_floor  -        -
yolo-world-s/mps             11.5     17.9    3  on_floor  -        glasses,bottle,cup
clip-zeroshot/mps            15.8     16.5    2  on_floor  eating   eating
mediapipe-tasks              24.0     24.2    2  unclear   -        cell phone
```

**Open vocabulary costs about 4 ms.** `yolov8s-worldv2` at 11.5 ms median
against the 7.2 ms COCO baseline — and `yolov8s` is a *small*, where the
baseline is a *nano*. Per fixture it ranged 7.6–15.9 ms depending on how many
boxes survived NMS.

Two costs that are not in the 11.5 ms:

* **Cold start.** Weights load in 0.52 s, but the first `set_classes()` is
  **4.0 s** because it builds CLIP text embeddings — and on a fresh machine it
  first downloads CLIP ViT-B/32 (338 MB) once. Subsequent `set_classes()` calls
  are **0.07 s**, so the vocabulary can be changed per-room at runtime.
* **Nothing per prompt.** Vocabulary size is free at inference:

  | prompts | 1 | 8 | 20 | 35 | 100 |
  |---|---|---|---|---|---|
  | median ms | 7.4 | 7.4 | 8.3 | 8.1 | 8.1 |

  The text embeddings are computed once in `set_classes()`; the forward pass
  does not care how many there are.

`clip_zeroshot` is 15.8 ms — YOLO for the crop plus one ViT-B/32 image encode —
and gives no boxes for its answer. It is not competitive as a food detector.

---

## The catch, stated plainly

**YOLO-World's confidence is relative to the prompt list, and the list changes
the answer.** Measured on `crisp_packet.jpg`, same image, same model, same
weights, only the vocabulary differing:

| vocabulary | best label for the packet |
|---|---|
| `["bag"]` | `bag` **0.75** |
| `["snack bag"]` | `snack bag` **0.48** |
| 22 food words | `snack bag` 0.11 |
| the backend's 62-word list | `snack bag` **0.09** — below any usable threshold |
| 62-word list minus `knife/fork/spoon/tray` | `snack bag` 0.09, now top-3 |

So the model genuinely *sees* the crisp packet. Ask it one question and it is
sure. Ask it sixty-two questions at once and the answer flattens into the
generic `food` at 0.15, because the individual crisps look enough like cutlery
that `knife` and `fork` take the score. That is not a bug to thresholds — it is
what a cosine-similarity head does.

Practical consequences:

1. **Use a low threshold.** `conf=0.35` (what `backend/vision/gate.py` uses)
   returns literally nothing from YOLO-World. The default here is `0.15`.
2. **Keep the vocabulary short and scene-specific.** Ten to twenty words for a
   kitchen, a different ten for a living room. Swapping costs 0.07 s.
3. **Include distractors.** Household nouns that are not food give the
   background somewhere to land. Removing them measurably hurt the food scores;
   they cost nothing in latency.
4. **It will still be confidently wrong sometimes.** `protein_bar.jpg` came back
   as `pizza` at 0.59 — and so did the COCO baseline. A cereal bowl came back as
   `rice` as well as `cereal`. Open vocabulary buys coverage, not correctness.

`clip_zeroshot` has the matching weakness, worse: a softmax over six sentences
always elects a winner. On a live webcam of someone sitting at a desk with no
food anywhere it returned `eating` at p=0.57. The `MIN_P` floor is the only
thing between it and a hallucinated meal, and 0.57 clears it.

---

## Recommendation

**Run `yolov8s-worldv2` as a second, slower lane — not as a replacement for the
COCO detector.**

* Keep COCO YOLO on the hot path. 6.8–7.2 ms, and `person` is the class it is
  genuinely best at. Posture, presence, and the fall gate do not need food.
* Add YOLO-World on the *keyframe* path — the frames already selected for the
  VLM in `backend/vision/keyframe.py`. At 11.5 ms it is far cheaper than the
  18 ms YOLO-plus-VLM lane, and the meal question is a once-a-frame-in-fifty
  question, not a once-every-frame one.
* Give it a short, room-specific vocabulary from the existing `zone` config, at
  `conf≈0.15`, and treat a bare `food` hit as "a meal is present" rather than
  trying to name the dish. Naming the dish is the VLM's job, and it is good at
  it; YOLO-World's job is to decide whether the VLM needs waking.
* Do not ship `clip_zeroshot`. It is 15.8 ms for an answer with no box and a
  forced-choice softmax that invents meals. It is in the bench to prove that
  point, and the only thing it is genuinely better at is the open-ended
  *activity* question, which the VLM already answers.

The one-line version: COCO cannot see food because it has ten food words.
YOLO-World can be handed any words you like, for about 4 ms, and it will find
cereal and soup that COCO cannot — but the words you hand it are now a tuning
parameter, and a badly chosen list is nearly as blind as COCO was.

---

### Reproducing

```bash
cd testcam
.venv/bin/pip install -q -r requirements.txt
.venv/bin/python bench.py --frames 20                         # live webcam
.venv/bin/python bench.py --frames 12 --source fixtures/cereal_bowl.jpg
TESTCAM_VOCAB="snack bag" .venv/bin/python bench.py --frames 12 --source fixtures/crisp_packet.jpg
```

That last command is the whole argument in one line. COCO has no word for a
crisp packet at any confidence; YOLO-World, handed the word, returns it:

```
backend                 median ms   p90 ms  ppl  posture   food          objects
clip-zeroshot/mps            13.4     16.8    0  unclear   holding-food  holding-food
yolo-world-s/mps             15.1     17.9    0  unclear   snack bag     -
```

Knobs: `TESTCAM_VOCAB` (comma-separated, replaces the whole list),
`TESTCAM_WORLD_CONF`, `TESTCAM_WORLD_DEVICE`, `TESTCAM_CLIP_MINP`.

`fixtures/` are Wikimedia Commons photographs, kept because they are real,
reusable, and identical for everyone running the bench. No webcam frame is
committed — the live `bench.py --frames 20` run above is the "whatever is to
hand" test, and its output is quoted verbatim in the latency table.
