// detector_test.cpp — the fall cascade against synthetic traces, on a laptop.
//   make -C band test-detector
//
// Every case here is one row of HARDWARE_SPEC.md §10.2. Synthetic traces cannot
// replace the real drop suite (§7.2, §12.2) — they replace the *debug loop*: when a
// threshold moves, this says in 200 ms which of the twelve cases changed verdict.

#include <cmath>
#include <cstdio>
#include <functional>
#include <string>
#include <vector>

#include "../fallband/sketch/detector.h"

using namespace dhyaan;

static int g_failures = 0;
static std::string g_case;

#define CHECK(cond, ...)                                        \
  do {                                                          \
    if (!(cond)) {                                              \
      g_failures++;                                             \
      printf("  FAIL %s: ", g_case.c_str());                    \
      printf(__VA_ARGS__);                                      \
      printf("   (%s:%d)\n", __FILE__, __LINE__);               \
    }                                                           \
  } while (0)

// Deterministic noise: a real IMU is never perfectly still, and `worn` depends on
// that. A fixed seed keeps every run byte-identical.
struct Noise {
  uint32_t s = 12345;
  float next(float amp) {
    s = s * 1664525u + 1013904223u;
    return (((float)((s >> 8) & 0xFFFF) / 32768.0f) - 1.0f) * amp;
  }
};

// One trace segment: given seconds-into-segment, fill accel (g) and gyro (deg/s).
using Seg = std::function<void(double, float&, float&, float&, float&)>;

struct Sim {
  FallDetector d;
  Noise n;
  double t_ms = 0.0;
  std::vector<Out> events;
  std::vector<Step> steps;

  double dt_ms() const { return 1000.0 / d.config().sample_hz; }

  void run(double seconds, const Seg& seg) {
    const double base = t_ms;
    while (t_ms - base < seconds * 1000.0) {
      float ax = 0, ay = 0, az = 1, gyro = 0;
      seg((t_ms - base) / 1000.0, ax, ay, az, gyro);
      Out o = d.step(ax, ay, az, gyro, (uint32_t)llround(t_ms));
      if (o.ev != EV_NONE) events.push_back(o);
      Step st;
      while (d.pollStep(st)) steps.push_back(st);
      t_ms += dt_ms();
    }
  }

  void cancelNow() {
    Out o = d.cancel((uint32_t)llround(t_ms));
    if (o.ev != EV_NONE) events.push_back(o);
  }

  int count(Event e) const {
    int n = 0;
    for (const Out& o : events) if (o.ev == e) n++;
    return n;
  }
  const Out* first(Event e) const {
    for (const Out& o : events) if (o.ev == e) return &o;
    return nullptr;
  }
};

// ------------------------------------------------------------- segments ----
// Worn and upright: an arm is never still to better than a few hundredths of a g,
// which is the whole basis of the `worn` test (§5.7 puts a table under 0.01 g).
static Seg wornIdle(Noise& n) {
  return [&n](double, float& ax, float& ay, float& az, float& gy) {
    ax = n.next(0.03f); ay = n.next(0.03f); az = 1.0f + n.next(0.03f);
    gy = fabsf(n.next(20.0f));
  };
}

// On a table: no variance, no tilt. This is what `worn:false` must look like (§5.7).
static Seg tableIdle(Noise& n) {
  return [&n](double, float& ax, float& ay, float& az, float& gy) {
    ax = n.next(0.001f); ay = n.next(0.001f); az = 1.0f + n.next(0.001f);
    gy = fabsf(n.next(0.2f));
  };
}

// True free fall (a dropped device reads ~0 g, D-008 — a worn forearm does not).
static Seg freeFall(Noise& n) {
  return [&n](double, float& ax, float& ay, float& az, float& gy) {
    ax = n.next(0.03f); ay = n.next(0.03f); az = 0.02f + n.next(0.03f);
    gy = 150.0f;
  };
}

// Half-sine deceleration pulse of `peak` g over the segment.
static Seg impact(float peak) {
  return [peak](double t, float& ax, float& ay, float& az, float& gy) {
    (void)ax; (void)ay;
    const double w = t / 0.04;                       // 40 ms pulse
    az = (w <= 1.0) ? (float)(1.0 + (peak - 1.0) * sin(M_PI * w)) : 1.0f;
    gy = 400.0f;
  };
}

// Lying still. `tilted` = gravity has swung onto the X axis (90° from upright).
static Seg lying(Noise& n, bool tilted) {
  return [&n, tilted](double, float& ax, float& ay, float& az, float& gy) {
    if (tilted) { ax = 1.0f + n.next(0.004f); az = n.next(0.004f); }
    else        { ax = n.next(0.004f);        az = 1.0f + n.next(0.004f); }
    ay = n.next(0.004f);
    gy = fabsf(n.next(3.0f));
  };
}

static Seg walking(Noise& n, float amp) {
  return [&n, amp](double t, float& ax, float& ay, float& az, float& gy) {
    az = 1.0f + amp * (float)sin(2 * M_PI * 2.0 * t) + n.next(0.03f);
    ax = 0.15f * (float)sin(2 * M_PI * 2.0 * t + 1.0) + n.next(0.03f);
    ay = n.next(0.03f);
    gy = 120.0f;
  };
}

// --------------------------------------------------------------- cases -----
// §10.2 case 8: the demo drop. 0.5 m ≈ 320 ms of free fall, inside FF_MAX_MS.
static void case_drop_50cm() {
  g_case = "drop 0.5 m onto a firm cushion (§10.2 #8)";
  Sim s;
  s.run(12.0, wornIdle(s.n));
  s.run(0.32, freeFall(s.n));
  s.run(0.10, impact(8.0f));
  s.run(3.0, lying(s.n, true));
  const Out* f = s.first(EV_FALL);
  CHECK(f != nullptr, "expected a confirmed fall, got %d events\n", (int)s.events.size());
  if (!f) return;
  CHECK(f->path == PATH_FREEFALL_IMPACT, "expected the free-fall path, got %d\n", f->path);
  CHECK(f->worn, "expected worn:true — a band held and released was moving\n");
  CHECK(f->peak_g > 3.0f, "peak %.2f g should clear 3 g (§7.2 step 3)\n", f->peak_g);
  CHECK(f->ff_ms >= 250 && f->ff_ms <= 400, "free fall %u ms, expected ~320\n", f->ff_ms);
  CHECK(f->orient_deg > 60.0f, "orientation %.0f°, expected ~90\n", f->orient_deg);
  CHECK(f->age_ms >= 2100 && f->age_ms <= 2400, "confirm at +%u ms, expected ~2200\n", f->age_ms);
  CHECK(s.count(EV_IMPACT_ONLY) == 0, "a confirmed fall must not also log impact_only\n");
}

// §10.2 case 9: harder landing. Proves the ±16 g fix — a ±4 g config pins at 4.00.
static void case_drop_hard_landing() {
  g_case = "drop onto carpet over hardwood (§10.2 #9)";
  Sim s;
  s.run(12.0, wornIdle(s.n));
  s.run(0.32, freeFall(s.n));
  s.run(0.10, impact(12.0f));
  s.run(3.0, lying(s.n, true));
  const Out* f = s.first(EV_FALL);
  CHECK(f != nullptr, "expected a confirmed fall\n");
  if (f) CHECK(f->peak_g > 4.0f, "peak %.2f g must exceed 4 g, not pin at it (§6.3)\n", f->peak_g);
}

// D-008: 1 m ≈ 450 ms of free fall — a hand let go, no forearm does this.
static void case_drop_1m_rejected() {
  g_case = "drop 1 m — dropped, not worn (§6.4, D-008)";
  Sim s;
  s.run(12.0, wornIdle(s.n));
  s.run(0.45, freeFall(s.n));
  s.run(0.10, impact(9.0f));
  s.run(3.0, lying(s.n, true));
  CHECK(s.count(EV_FALL) == 0,
        "a 450 ms free fall must not confirm — the drop latch is what makes this true\n");
}

// §10.2 case 2, the hardest negative: only orientation separates it from a fall.
static void case_table_slam() {
  g_case = "slam the forearm onto a table (§10.2 #2)";
  Sim s;
  s.run(12.0, wornIdle(s.n));
  s.run(0.10, impact(4.5f));
  s.run(3.0, lying(s.n, false));   // dead still, but never rotated
  CHECK(s.count(EV_FALL) == 0, "must not confirm\n");
  const Out* i = s.first(EV_IMPACT_ONLY);
  CHECK(i != nullptr, "expected an impact_only\n");
  if (i) {
    CHECK(i->reason == REASON_ORIENT, "expected reason=orientation, got %d\n", i->reason);
    CHECK(i->orient_deg < 20.0f, "orientation %.0f° should be near 0\n", i->orient_deg);
  }
}

// §10.2 case 1: never even reaches IMPACT — the 2 g bump is under the soft bar.
static void case_sit_down_hard() {
  g_case = "sit down hard in a chair (§10.2 #1)";
  Sim s;
  s.run(12.0, wornIdle(s.n));
  s.run(0.25, [&s](double, float& ax, float& ay, float& az, float& gy) {
    ax = s.n.next(0.03f); ay = s.n.next(0.03f); az = 0.78f + s.n.next(0.03f); gy = 60.0f;
  });
  s.run(0.12, impact(2.0f));
  s.run(3.0, lying(s.n, false));
  CHECK(s.events.empty(), "expected no events at all, got %d\n", (int)s.events.size());
}

// §10.2 case 5, plus the §6.9 step detector on the same trace.
static void case_walking() {
  g_case = "20 s of normal walking (§10.2 #5, §6.9)";
  Sim s;
  s.d.config().steps_enabled = true;
  s.run(2.0, wornIdle(s.n));
  s.run(20.0, walking(s.n, 0.45f));
  CHECK(s.count(EV_FALL) == 0, "walking must never confirm\n");
  CHECK(s.count(EV_IMPACT_ONLY) == 0, "walking must not register impacts\n");
  CHECK(s.steps.size() > 25, "expected ~40 steps in 20 s at 2 Hz, got %d\n", (int)s.steps.size());
}

// §10.2 case 4 + D-008: unworn must never alert, and stillness afterwards is not
// what decides it — the 10 s before the impact is.
static void case_knocked_off_table() {
  g_case = "band on a table, knocked to the floor (§10.2 #4, D-008)";
  Sim s;
  s.run(14.0, tableIdle(s.n));
  s.run(0.30, freeFall(s.n));
  s.run(0.10, impact(6.0f));
  s.run(3.0, lying(s.n, true));
  CHECK(s.count(EV_FALL) == 0, "an unworn band must never confirm a fall\n");
  const Out* i = s.first(EV_IMPACT_ONLY);
  CHECK(i != nullptr, "expected an impact_only\n");
  if (i) CHECK(i->reason == REASON_NOT_WORN, "expected reason=not_worn, got %d\n", i->reason);
}

// §10.2 case 10: press A inside the window; the hub must not dial.
static void case_cancel_in_grace() {
  g_case = "confirmed fall, button A at t+5 s (§10.2 #10)";
  Sim s;
  s.d.config().grace_s = 30;
  s.run(12.0, wornIdle(s.n));
  s.run(0.32, freeFall(s.n));
  s.run(0.10, impact(8.0f));
  s.run(3.0, lying(s.n, true));
  CHECK(s.count(EV_FALL) == 1, "expected the fall first\n");
  s.run(5.0, lying(s.n, true));
  s.cancelNow();
  s.run(40.0, lying(s.n, true));
  CHECK(s.count(EV_CANCELLED) == 1, "expected exactly one cancel\n");
  CHECK(s.count(EV_GRACE_EXPIRED) == 0, "a cancelled fall must not also expire its grace\n");
  CHECK(s.count(EV_REARMED) == 1, "expected the band to rearm after the cancel\n");
  CHECK(s.d.state() == IDLE, "expected IDLE after rearm, got %d\n", s.d.state());
}

// §10.2 case 11 with the stage's 10 s window (PRODUCT_SPEC §10, D-017).
static void case_grace_expires() {
  g_case = "confirmed fall, nobody presses (§10.2 #11)";
  Sim s;
  s.d.config().grace_s = 10;
  s.run(12.0, wornIdle(s.n));
  s.run(0.32, freeFall(s.n));
  s.run(0.10, impact(8.0f));
  s.run(3.0, lying(s.n, true));
  const double t_fall = s.t_ms;
  s.run(12.0, lying(s.n, true));
  CHECK(s.count(EV_GRACE_EXPIRED) == 1, "expected the grace window to expire once\n");
  const Out* g = s.first(EV_GRACE_EXPIRED);
  if (g) {
    const double elapsed = (double)g->age_ms - 2200.0;
    CHECK(elapsed > 9000 && elapsed < 11000, "grace ran %.0f ms, expected ~10000\n", elapsed);
  }
  (void)t_fall;
}

// §6.9: the band clamps whatever the hub sends, so a bad profile can never raise the
// bar above the softest fall we calibrated, nor drop it into the sit-down band.
static void case_threshold_clamp() {
  g_case = "walking profile bounds are enforced on the band (§6.9)";
  FallDetector d;
  d.config().f_min_g = 3.9f;             // §7.2 step 4
  d.config().impact_floor_g = 2.5f;
  d.config().impact_ceil_margin = 0.3f;

  d.setThresholds(0.40f, 0.0f, 1.0f, 7);
  CHECK(fabsf(d.config().impact_soft_g - 2.5f) < 1e-4f,
        "1.0 g should clamp up to the 2.5 g floor, got %.2f\n", d.config().impact_soft_g);
  CHECK(fabsf(d.config().impact_ff_g - 1.8f) < 1e-4f,
        "after_ff should track soft-0.7, got %.2f\n", d.config().impact_ff_g);

  d.setThresholds(0.40f, 0.0f, 9.0f, 8);
  CHECK(fabsf(d.config().impact_soft_g - 3.6f) < 1e-4f,
        "9.0 g should clamp down to f_min-0.3 = 3.6, got %.2f\n", d.config().impact_soft_g);
  CHECK(d.config().rev == 8, "rev should follow the push\n");
}

// A confirmed fall while the profile sits at its ceiling still fires (§10.2 #15).
static void case_profile_ceiling_still_fires() {
  g_case = "fall still confirms with the profile at its ceiling (§10.2 #15)";
  Sim s;
  s.d.config().f_min_g = 3.9f;
  s.d.setThresholds(0.40f, 0.0f, 9.0f, 3);    // clamps to 3.6 g soft / 2.9 g after free fall
  s.run(12.0, wornIdle(s.n));
  s.run(0.32, freeFall(s.n));
  s.run(0.10, impact(5.0f));
  s.run(3.0, lying(s.n, true));
  CHECK(s.count(EV_FALL) == 1, "a calibrated fall must fire at the ceiling threshold\n");
}

int main() {
  printf("detector_test — HARDWARE_SPEC §10.2 cases against synthetic traces\n");
  case_drop_50cm();
  case_drop_hard_landing();
  case_drop_1m_rejected();
  case_table_slam();
  case_sit_down_hard();
  case_walking();
  case_knocked_off_table();
  case_cancel_in_grace();
  case_grace_expires();
  case_threshold_clamp();
  case_profile_ceiling_still_fires();
  if (g_failures == 0) {
    printf("all cases passed\n");
    return 0;
  }
  printf("%d check(s) failed\n", g_failures);
  return 1;
}
