#!/usr/bin/env python3
"""Time every backend in backends/ on the same webcam frames. Print one table.

    python bench.py --frames 30
    python bench.py --frames 30 --source clip.mp4     # no webcam / repeatable
    python bench.py --only ultra_pytorch,apple_vision

A backend whose dependency is missing prints a skip line and the run carries on.
Nothing here invents a number: a backend that throws gets `err` in its row.
"""

import argparse
import glob
import importlib
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import CaptureFailed, frames, time_backend  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def discover(only=None):
    """Every backends/*.py, imported defensively. ponytail: a glob is the registry."""
    found = []
    for path in sorted(glob.glob(os.path.join(HERE, "backends", "*.py"))):
        mod = os.path.splitext(os.path.basename(path))[0]
        if mod.startswith("_") or (only and mod not in only):
            continue
        try:
            m = importlib.import_module(f"backends.{mod}")
        except Exception as e:
            found.append((mod, None, f"import of backends/{mod}.py raised "
                                     f"{type(e).__name__}: {e}"))
            continue
        b = getattr(m, "BACKEND", None)
        if b is None and hasattr(m, "get"):
            try:
                b = m.get()
            except Exception as e:
                found.append((mod, None, f"{mod}.get() raised {type(e).__name__}: {e}"))
                continue
        if b is None:
            found.append((mod, None, "module defines no BACKEND (see common.Backend)"))
            continue
        found.append((mod, b, ""))
    return found


def summarize(results):
    """Aggregate a run's Results into the cells of one table row."""
    if not results:
        return 0, "-", "", ""
    people = Counter(r.person_count for r in results).most_common(1)[0][0]
    posture = Counter(r.posture for r in results).most_common(1)[0][0]
    food = sorted({f for r in results for f in r.food})
    objects = [o for o, _ in Counter(o for r in results for o in r.objects).most_common(4)]
    return people, posture, ",".join(food), ",".join(objects)


def cut(s, n):
    s = str(s)
    return s if len(s) <= n else s[: n - 1] + "…"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", type=int, default=30)
    ap.add_argument("--source", default="0", help="webcam index (default 0) or a video/image file")
    ap.add_argument("--size", default="448x252")
    ap.add_argument("--only", default="", help="comma-separated module names")
    args = ap.parse_args()

    w, h = (int(v) for v in args.size.lower().split("x"))
    only = {s.strip() for s in args.only.split(",") if s.strip()} or None

    print(f"\ngrabbing {args.frames} frames from {args.source!r} at {w}x{h} ...")
    try:
        fs = frames(args.frames, size=(w, h), source=args.source)
    except CaptureFailed as e:
        print(f"\nNO FRAMES: {e}\n")
        return 1
    print(f"got {len(fs)} frames.\n")

    backends = discover(only)
    live = []
    for mod, b, why in backends:
        if b is None or not getattr(b, "available", False):
            reason = why or getattr(b, "note", "") or "unavailable, no reason given"
            print(f"SKIP {mod:<16} {reason}")
            continue
        try:
            b.warmup(fs[0])
        except Exception as e:
            print(f"SKIP {mod:<16} warmup raised {type(e).__name__}: {e}")
            continue
        live.append((mod, b))
    if not live:
        print("\nno backend was available — nothing to time.\n")
        return 1

    print(f"\ntiming {len(live)} backend(s) on the same {len(fs)} frames "
          f"(warmup done, model load excluded)\n")
    rows = []
    for mod, b in live:
        stats, results = time_backend(b, fs)
        rows.append((b, stats, results))

    hdr = f"{'backend':<22} {'median ms':>10} {'p90 ms':>8} {'ppl':>4}  {'posture':<9} {'food':<22} objects"
    print(hdr)
    print("-" * max(len(hdr), 96))
    for b, stats, results in sorted(rows, key=lambda r: (r[1]["median"] is None,
                                                         r[1]["median"] or 0)):
        if stats["median"] is None:
            print(f"{cut(b.name,22):<22} {'err':>10} {'err':>8}      "
                  f"{cut(stats['error'], 60)}")
            continue
        ppl, posture, food, objects = summarize(results)
        print(f"{cut(b.name,22):<22} {stats['median']:>10.1f} {stats['p90']:>8.1f} "
              f"{ppl:>4}  {posture:<9} {cut(food or '-', 22):<22} {cut(objects or '-', 28)}")
    print()
    for b, stats, results in rows:
        note = (results[0].note if results else "") or getattr(b, "note", "")
        if note:
            print(f"  {b.name}: {note}")

    # --- verdict --------------------------------------------------------------
    ok = [(b, s, r) for b, s, r in rows if s["median"] is not None]
    if not ok:
        print("\nevery backend threw. No verdict.\n")
        return 1
    fastest = min(ok, key=lambda x: x[1]["median"])
    saw_food = [x for x in ok if any(r.food for r in x[2])]
    print()
    if saw_food:
        f = min(saw_food, key=lambda x: x[1]["median"])
        labels = sorted({lab for r in f[2] for lab in r.food})
        # Print the labels: "saw food" means "printed these strings", and the
        # reader gets to decide whether they are a meal or a hallucination.
        print(f"VERDICT: fastest that actually saw food: {f[0].name} "
              f"@ {f[1]['median']:.1f} ms median, calling it {cut(', '.join(labels), 70)}. "
              f"Fastest overall: {fastest[0].name} @ {fastest[1]['median']:.1f} ms.")
    else:
        blind = [x[0].name for x in ok if "no food classes" in (getattr(x[0], "note", "") or "")]
        capable = [x for x in ok if x[0].name not in blind]
        note = (f" Structurally food-blind: {', '.join(blind)}." if blind else "")
        extra = ""
        if capable:
            c = min(capable, key=lambda x: x[1]["median"])
            extra = (f" Fastest backend that COULD have ({c[0].name} @ "
                     f"{c[1]['median']:.1f} ms) reported none — put food in frame and rerun.")
        print(f"VERDICT: no backend reported food on these frames.{note}{extra} "
              f"Fastest overall: {fastest[0].name} @ {fastest[1]['median']:.1f} ms "
              f"(p90 {fastest[1]['p90']:.1f}).")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
