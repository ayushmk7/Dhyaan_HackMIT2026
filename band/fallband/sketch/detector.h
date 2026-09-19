// detector.h — Dhyaan fall cascade, HARDWARE_SPEC.md §6.5-§6.7.
//
// Deliberately free of Arduino headers: this compiles into sketch.ino AND into
// band/tests/detector_test.cpp on a laptop, so the state machine can be built and
// regression-tested without the board (DECISIONS.md D-020). Feed it samples in g
// and ms; it returns at most one event per sample.
//
// Deviations from §6.7's pseudocode, all logged as D-018:
//   1. g_pre is the mean over [-1.5 s, -0.5 s] before impact, read out of the ring,
//      not a running EMA. An EMA keeps integrating through the first 80 ms of free
//      fall and through a stumble, which drags the baseline toward the fall itself
//      and shrinks the orientation angle that is supposed to detect it.
//   2. Stillness sigma accumulates incrementally during POST_IMPACT_STILL.
//   3. `worn` is snapshotted at impact from the preceding 10 s (D-008): a band that
//      was moving before the impact counts as worn even though it lies still after.
//   4. Threshold defaults are compiled in and equal §6.4, so the band still detects
//      and buzzes when the Linux side is down. config.json overrides them at boot.

#pragma once
#include <math.h>
#include <stdint.h>

namespace dhyaan {

// ---------------------------------------------------------------- config ----
// Every field is pushed from config.json via Bridge (HARDWARE_SPEC.md §9); the
// values here are the §6.4 starting points and the fail-safe if Python never comes up.
struct Config {
  float    sample_hz          = 208.0f;
  float    ff_g               = 0.40f;    // FF_THRESHOLD_G - physics, never fitted (D-008)
  uint16_t ff_min_ms          = 80;
  uint16_t ff_max_ms          = 400;      // longer = dropped, not worn
  uint16_t drop_latch_ms      = 1000;     // see dropped_until_ below
  float    impact_ff_g        = 2.80f;    // IMPACT_G_AFTER_FF
  float    impact_soft_g      = 3.50f;    // IMPACT_G_SOFT - the only value a profile moves
  float    impact_floor_g     = 2.50f;    // profile may never go below this
  float    impact_ceil_margin = 0.30f;    // ceiling = f_min - this
  float    f_min_g            = 0.0f;     // softest calibrated drop (§7.2 step 4); 0 = uncalibrated
  float    jerk_min_g_s       = 30.0f;
  float    orient_deg         = 45.0f;
  uint16_t settle_ms          = 200;
  uint16_t still_ms           = 2000;
  float    still_std_g        = 0.12f;
  float    still_gyro_dps     = 25.0f;
  uint16_t grace_s            = 30;       // overwritten by the hub's cancel_window_s (D-017)
  uint32_t rearm_ms           = 10000;
  uint16_t worn_lookback_ms   = 10000;
  float    worn_std_g         = 0.01f;    // §5.7: a band on a table sits under this
  float    worn_tilt_deg      = 5.0f;
  bool     steps_enabled      = false;    // §6.9 walking profile, stretch
  float    step_min_peak_g    = 1.10f;
  uint16_t step_min_interval_ms = 300;
  float    step_rate_min_hz   = 1.2f;
  float    step_rate_max_hz   = 2.5f;
  uint16_t rev                = 0;        // thresholds_rev, echoed in status
};

enum State : uint8_t { IDLE, FREEFALL, IMPACT, POST_IMPACT_STILL, CONFIRMED, REARM };
enum Path  : uint8_t { PATH_FREEFALL_IMPACT = 0, PATH_SOFT_FALL = 1 };
// Why an impact did not become a fall. Ordered so the Bridge sends one byte.
enum Reason : uint8_t { REASON_ORIENT = 0, REASON_STILL = 1, REASON_NOT_WORN = 2 };

enum Event : uint8_t {
  EV_NONE = 0,
  EV_FALL,           // confirmed: buzz, notify, start the grace window
  EV_IMPACT_ONLY,    // hit something, not a fall
  EV_CANCELLED,      // button A inside the grace window
  EV_GRACE_EXPIRED,  // nobody cancelled; the hub is already dialling
  EV_REARMED,
};

struct Out {
  Event    ev           = EV_NONE;
  uint32_t seq          = 0;      // per-event id, ties a cancel to its fall
  uint8_t  path         = PATH_SOFT_FALL;
  uint8_t  reason       = REASON_ORIENT;
  bool     worn         = true;
  float    peak_g       = 0.0f;
  float    ff_min_g     = 0.0f;
  uint16_t ff_ms        = 0;      // 0 on the soft path
  float    orient_deg   = 0.0f;
  float    still_std_g  = 0.0f;
  float    gyro_max_dps = 0.0f;
  float    jerk_peak    = 0.0f;
  uint32_t age_ms       = 0;      // ms from impact to this event (≈2200 for a fall)
};

struct Step {           // §6.9, stretch
  float peak_g  = 0.0f;
  float jerk    = 0.0f;
  float gyro_dps = 0.0f;
};

// ---------------------------------------------------------------- helpers ---
namespace detail {

inline float norm3(float x, float y, float z) { return sqrtf(x * x + y * y + z * z); }

// Angle between two gravity vectors, degrees. Zero-length input reads as 0°, which
// is the conservative answer: no orientation evidence, so the soft path stays shut.
inline float angleDeg(float ax, float ay, float az, float bx, float by, float bz) {
  const float na = norm3(ax, ay, az), nb = norm3(bx, by, bz);
  if (na < 1e-6f || nb < 1e-6f) return 0.0f;
  float d = (ax * bx + ay * by + az * bz) / (na * nb);
  if (d > 1.0f) d = 1.0f;
  if (d < -1.0f) d = -1.0f;
  return acosf(d) * 57.2957795f;
}

}  // namespace detail

// ------------------------------------------------------------- the thing ----
class FallDetector {
 public:
  // 1024 samples = 4.92 s at 208 Hz (D-008): 1 s of pre-impact baseline plus the
  // 2.2 s settle-and-stillness check must still be in memory at confirmation.
  static const uint16_t kRing = 1024;

  FallDetector() { reset(0); }

  Config& config() { return cfg_; }
  const Config& config() const { return cfg_; }
  State state() const { return state_; }
  uint32_t seq() const { return seq_; }
  // Worn over the trailing lookback window — what the heartbeat reports (§5.7).
  bool worn() const { return wornOver(last_t_); }

  // The gyro is only needed while confirming; skip the extra I2C read otherwise
  // (a 6-byte burst at 100 kHz is ~0.7 ms, a quarter of the 4.8 ms budget).
  bool needsGyro() const { return state_ == POST_IMPACT_STILL; }

  void reset(uint32_t now_ms) {
    state_ = IDLE;
    count_ = widx_ = 0;
    t_ff_ = t_impact_ = t_still_ = t_confirm_ = t_rearm_ = dropped_until_ = 0;
    peak_g_ = jerk_peak_ = gyro_max_ = 0.0f;
    ff_min_g_ = 9.0f;
    last_mag_ = 1.0f;
    last_t_ = now_ms;
    gpx_ = 0.0f; gpy_ = 0.0f; gpz_ = 1.0f;
    ema_x_ = 0.0f; ema_y_ = 0.0f; ema_z_ = 1.0f; ema_ready_ = false;
    still_n_ = 0; still_sum_ = still_sumsq_ = 0.0f;
    gsum_x_ = gsum_y_ = gsum_z_ = 0.0f;
    bucket_reset(now_ms);
    nb_ = 0; b_head_ = 0;
    step_last_ms_ = 0; step_run_ = 0; step_peak_ = 0.0f; step_jerk_ = 0.0f;
    step_gyro_ = 0.0f; step_ema_ = 1.0f; step_prev_ = 1.0f; step_rising_ = false;
    have_step_ = false;
  }

  // The walking profile may move impact_soft_g only, and only inside the bounds the
  // calibration proved (§6.9). The band clamps too, so a bad value from the hub can
  // never raise the bar above the softest fall we measured.
  void setThresholds(float ff_g, float impact_ff_g, float impact_soft_g, uint16_t rev) {
    float ceil_g = (cfg_.f_min_g > 0.0f) ? cfg_.f_min_g - cfg_.impact_ceil_margin : impact_soft_g;
    if (impact_soft_g < cfg_.impact_floor_g) impact_soft_g = cfg_.impact_floor_g;
    if (impact_soft_g > ceil_g) impact_soft_g = ceil_g;
    cfg_.ff_g = ff_g;
    cfg_.impact_soft_g = impact_soft_g;
    cfg_.impact_ff_g = (impact_ff_g > 0.0f) ? impact_ff_g : impact_soft_g - 0.7f;
    cfg_.rev = rev;
  }

  // Button A during the grace window. Returns EV_CANCELLED, or EV_NONE if the band
  // was not in CONFIRMED (a stray press is not an event).
  Out cancel(uint32_t now_ms) {
    Out o;
    if (state_ != CONFIRMED) return o;
    o.ev = EV_CANCELLED;
    o.seq = seq_;
    o.age_ms = now_ms - t_impact_;
    state_ = REARM;
    t_rearm_ = now_ms;
    return o;
  }

  // One sample. gyro_dps is the gyro magnitude in °/s, or NAN when not sampled.
  Out step(float ax, float ay, float az, float gyro_dps, uint32_t now_ms) {
    Out o;
    const float mag = detail::norm3(ax, ay, az);
    const float dt_s = (now_ms > last_t_) ? (now_ms - last_t_) / 1000.0f : 1.0f / cfg_.sample_hz;
    const float jerk = (dt_s > 0.0f) ? fabsf(mag - last_mag_) / dt_s : 0.0f;
    last_mag_ = mag;
    last_t_ = now_ms;

    push(ax, ay, az, mag, now_ms);
    bucket_feed(ax, ay, az, mag, now_ms);
    if (cfg_.steps_enabled && state_ == IDLE) stepFeed(mag, jerk, gyro_dps, now_ms);

    switch (state_) {
      case IDLE: {
        // EMA baseline, frozen whenever the reading is not ~1 g: during free fall or
        // a hard impact it would otherwise learn the event it exists to detect.
        if (mag > 0.8f && mag < 1.2f) emaFeed(ax, ay, az);
        if (mag < cfg_.ff_g) {
          if (t_ff_ == 0) { t_ff_ = now_ms; ff_min_g_ = mag; }
          if (mag < ff_min_g_) ff_min_g_ = mag;
          if (now_ms - t_ff_ >= cfg_.ff_min_ms) state_ = FREEFALL;
        } else {
          t_ff_ = 0;
          if (mag > cfg_.impact_soft_g && jerk > cfg_.jerk_min_g_s) {
            enterImpact(PATH_SOFT_FALL, mag, jerk, 0, now_ms);
          }
        }
      } break;

      case FREEFALL: {
        if (mag < ff_min_g_) ff_min_g_ = mag;
        if (now_ms - t_ff_ > cfg_.ff_max_ms) {          // dropped, not worn (§6.4)
          state_ = IDLE;
          t_ff_ = 0;
          dropped_until_ = now_ms + cfg_.drop_latch_ms;
        } else if (mag > cfg_.impact_ff_g) {
          enterImpact(PATH_FREEFALL_IMPACT, mag, jerk, (uint16_t)(now_ms - t_ff_), now_ms);
        }
      } break;

      case IMPACT: {
        if (mag > peak_g_) peak_g_ = mag;
        if (jerk > jerk_peak_) jerk_peak_ = jerk;
        if (now_ms - t_impact_ > cfg_.settle_ms) {
          state_ = POST_IMPACT_STILL;
          t_still_ = now_ms;
          still_n_ = 0; still_sum_ = still_sumsq_ = 0.0f;
          gsum_x_ = gsum_y_ = gsum_z_ = 0.0f;
          gyro_max_ = 0.0f;
        }
      } break;

      case POST_IMPACT_STILL: {
        still_n_++;
        still_sum_ += mag;
        still_sumsq_ += mag * mag;
        gsum_x_ += ax; gsum_y_ += ay; gsum_z_ += az;
        if (!isnan(gyro_dps) && gyro_dps > gyro_max_) gyro_max_ = gyro_dps;
        if (now_ms - t_still_ >= cfg_.still_ms) return evaluate(now_ms);
      } break;

      case CONFIRMED: {
        if (now_ms - t_confirm_ > (uint32_t)cfg_.grace_s * 1000UL) {
          o.ev = EV_GRACE_EXPIRED;
          o.seq = seq_;
          o.age_ms = now_ms - t_impact_;
          state_ = REARM;
          t_rearm_ = now_ms;
        }
      } break;

      case REARM: {
        if (now_ms - t_rearm_ > cfg_.rearm_ms) {
          o.ev = EV_REARMED;
          state_ = IDLE;
          t_ff_ = 0;
          peak_g_ = jerk_peak_ = 0.0f;
          ff_min_g_ = 9.0f;
        }
      } break;
    }
    return o;
  }

  // §6.9 stretch: one step peak, consumed by the Linux side which does the percentiles.
  bool pollStep(Step& out) {
    if (!have_step_) return false;
    out = pending_step_;
    have_step_ = false;
    return true;
  }

 private:
  struct Sample { float ax, ay, az, mag; uint32_t t; };

  void push(float ax, float ay, float az, float mag, uint32_t t) {
    ring_[widx_].ax = ax; ring_[widx_].ay = ay; ring_[widx_].az = az;
    ring_[widx_].mag = mag; ring_[widx_].t = t;
    widx_ = (uint16_t)((widx_ + 1) & (kRing - 1));
    if (count_ < kRing) count_++;
  }

  void emaFeed(float ax, float ay, float az) {
    const float k = 0.005f;   // ~1 s at 208 Hz, ORIENT_BASELINE_MS
    if (!ema_ready_) { ema_x_ = ax; ema_y_ = ay; ema_z_ = az; ema_ready_ = true; return; }
    ema_x_ += k * (ax - ema_x_);
    ema_y_ += k * (ay - ema_y_);
    ema_z_ += k * (az - ema_z_);
  }

  // Mean gravity over [t_impact-1500, t_impact-500] ms: after any stumble has begun
  // but before the fall itself. Falls back to the EMA when the ring is too young.
  void computeGPre(uint32_t t_impact) {
    const uint32_t lo = (t_impact > 1500u) ? t_impact - 1500u : 0u;
    const uint32_t hi = (t_impact > 500u) ? t_impact - 500u : 0u;
    float sx = 0, sy = 0, sz = 0;
    uint16_t n = 0;
    for (uint16_t i = 0; i < count_; i++) {
      const Sample& s = ring_[i];
      if (s.t >= lo && s.t <= hi) { sx += s.ax; sy += s.ay; sz += s.az; n++; }
    }
    if (n >= 20) { gpx_ = sx / n; gpy_ = sy / n; gpz_ = sz / n; }
    else         { gpx_ = ema_x_; gpy_ = ema_y_; gpz_ = ema_z_; }
  }

  // A free fall longer than ff_max_ms means a hand let go of the device: no forearm
  // free-falls for 400 ms (§6.1). Without this latch the impact that follows still
  // enters through the soft path and a 1 m drop onto a desk reads as a fall — which
  // is exactly the case §6.4 and D-008 say is rejected. The latch makes that true.
  void enterImpact(uint8_t path, float mag, float jerk, uint16_t ff_ms, uint32_t now_ms) {
    if (dropped_until_ != 0 && now_ms < dropped_until_) {
      state_ = IDLE;
      t_ff_ = 0;
      return;
    }
    state_ = IMPACT;
    path_ = path;
    peak_g_ = mag;
    jerk_peak_ = jerk;
    ff_ms_ = ff_ms;
    t_impact_ = now_ms;
    seq_++;
    computeGPre(now_ms);
    // The event starts when the free fall starts, not when the band lands (D-008).
    const uint32_t event_start = (path == PATH_FREEFALL_IMPACT && t_ff_ != 0) ? t_ff_ : now_ms;
    worn_at_impact_ = wornOver(event_start);
  }

  Out evaluate(uint32_t now_ms) {
    Out o;
    o.seq = seq_;
    o.path = path_;
    o.peak_g = peak_g_;
    o.ff_min_g = (path_ == PATH_FREEFALL_IMPACT) ? ff_min_g_ : 0.0f;
    o.ff_ms = (path_ == PATH_FREEFALL_IMPACT) ? ff_ms_ : 0;
    o.jerk_peak = jerk_peak_;
    o.gyro_max_dps = gyro_max_;
    o.worn = worn_at_impact_;
    o.age_ms = now_ms - t_impact_;

    const float n = (still_n_ > 0) ? (float)still_n_ : 1.0f;
    const float mean = still_sum_ / n;
    float var = still_sumsq_ / n - mean * mean;
    if (var < 0.0f) var = 0.0f;                 // rounding, not physics
    o.still_std_g = sqrtf(var);
    o.orient_deg = detail::angleDeg(gpx_, gpy_, gpz_, gsum_x_ / n, gsum_y_ / n, gsum_z_ / n);

    const bool still_ok  = (o.still_std_g < cfg_.still_std_g) && (gyro_max_ < cfg_.still_gyro_dps);
    const bool orient_ok = (o.orient_deg > cfg_.orient_deg);

    if (!worn_at_impact_) {
      o.ev = EV_IMPACT_ONLY;                    // a band knocked off a table is not a person
      o.reason = REASON_NOT_WORN;
    } else if (still_ok && (orient_ok || path_ == PATH_FREEFALL_IMPACT)) {
      o.ev = EV_FALL;
    } else {
      o.ev = EV_IMPACT_ONLY;
      o.reason = still_ok ? REASON_ORIENT : REASON_STILL;
    }

    if (o.ev == EV_FALL) { state_ = CONFIRMED; t_confirm_ = now_ms; }
    else                 { state_ = REARM;     t_rearm_ = now_ms; }
    return o;
  }

  // ---- worn: 1 s buckets of sigma(|a|) and mean gravity over the last 10 s ----
  struct Bucket { float sum, sumsq, gx, gy, gz; uint16_t n; uint32_t t0; };

  void bucket_reset(uint32_t t0) {
    cur_.sum = cur_.sumsq = cur_.gx = cur_.gy = cur_.gz = 0.0f;
    cur_.n = 0;
    cur_.t0 = t0;
  }

  void bucket_feed(float ax, float ay, float az, float mag, uint32_t t) {
    if (t - cur_.t0 >= 1000u && cur_.n > 0) {
      buckets_[b_head_] = cur_;
      b_head_ = (uint8_t)((b_head_ + 1) % kBuckets);
      if (nb_ < kBuckets) nb_++;
      bucket_reset(t);
    }
    cur_.sum += mag;
    cur_.sumsq += mag * mag;
    cur_.gx += ax; cur_.gy += ay; cur_.gz += az;
    cur_.n++;
  }

  static float bucketStd(const Bucket& b) {
    const float n = (b.n > 0) ? (float)b.n : 1.0f;
    const float mean = b.sum / n;
    float var = b.sumsq / n - mean * mean;
    return (var > 0.0f) ? sqrtf(var) : 0.0f;
  }

  // Worn if anything in the lookback moved: either a bucket with real variance, or a
  // gravity direction that swung. A band on a table fails both; an arm passes one.
  //
  // `until_ms` is where the event begins — the start of the free fall, not the impact.
  // Only buckets that closed strictly before it count: the open bucket always contains
  // the free fall and the impact onset, whose variance is enormous, so including it
  // would make every dropped band look worn and defeat the check entirely.
  //
  // With no usable history (fresh boot) the answer is `true`. Unworn has to be proven;
  // assuming it would silently suppress a real fall, and §7.3 says bias the other way.
  bool wornOver(uint32_t until_ms) const {
    const uint32_t lo = (until_ms > cfg_.worn_lookback_ms) ? until_ms - cfg_.worn_lookback_ms : 0u;
    float rx = 0, ry = 0, rz = 0;
    bool have_ref = false, moved = false, any = false;
    for (uint8_t i = 0; i < nb_; i++) {
      const Bucket& b = buckets_[(b_head_ + kBuckets - nb_ + i) % kBuckets];
      const uint32_t end = b.t0 + 1000u;
      if (b.n == 0 || end > until_ms || end < lo) continue;
      any = true;
      if (bucketStd(b) >= cfg_.worn_std_g) return true;
      const float n = (float)b.n;
      if (!have_ref) { rx = b.gx / n; ry = b.gy / n; rz = b.gz / n; have_ref = true; continue; }
      if (detail::angleDeg(rx, ry, rz, b.gx / n, b.gy / n, b.gz / n) > cfg_.worn_tilt_deg) moved = true;
    }
    return any ? moved : true;
  }

  // ---- step detector (§6.9, stretch) ----
  void stepFeed(float mag, float jerk, float gyro_dps, uint32_t now_ms) {
    step_ema_ += 0.15f * (mag - step_ema_);        // ~30 ms, a light 5 Hz low-pass
    if (!isnan(gyro_dps) && gyro_dps > step_gyro_) step_gyro_ = gyro_dps;
    if (jerk > step_jerk_) step_jerk_ = jerk;
    if (step_ema_ > step_peak_) step_peak_ = step_ema_;

    if (step_ema_ > step_prev_) { step_rising_ = true; }
    else if (step_rising_ && step_prev_ >= cfg_.step_min_peak_g) {
      step_rising_ = false;                         // just crossed a local maximum
      if (step_last_ms_ != 0 && now_ms - step_last_ms_ >= cfg_.step_min_interval_ms) {
        const float rate = 1000.0f / (float)(now_ms - step_last_ms_);
        step_run_ = (rate >= cfg_.step_rate_min_hz && rate <= cfg_.step_rate_max_hz)
                        ? (uint8_t)(step_run_ + 1) : 1;
        if (step_run_ >= 4) {                       // sustained walking only, never one thump
          pending_step_.peak_g = step_peak_;
          pending_step_.jerk = step_jerk_;
          pending_step_.gyro_dps = step_gyro_;
          have_step_ = true;
        }
        step_peak_ = 0.0f; step_jerk_ = 0.0f; step_gyro_ = 0.0f;
      }
      step_last_ms_ = now_ms;
    }
    step_prev_ = step_ema_;
  }

  static const uint8_t kBuckets = 12;   // 10 s of lookback plus slack

  Config   cfg_;
  Sample   ring_[kRing];
  uint16_t widx_ = 0, count_ = 0;
  State    state_ = IDLE;
  uint8_t  path_ = PATH_SOFT_FALL;
  uint32_t seq_ = 0;
  uint32_t t_ff_ = 0, t_impact_ = 0, t_still_ = 0, t_confirm_ = 0, t_rearm_ = 0, last_t_ = 0;
  uint32_t dropped_until_ = 0;
  uint16_t ff_ms_ = 0;
  float    peak_g_ = 0, jerk_peak_ = 0, ff_min_g_ = 9.0f, gyro_max_ = 0, last_mag_ = 1.0f;
  float    gpx_ = 0, gpy_ = 0, gpz_ = 1;
  float    ema_x_ = 0, ema_y_ = 0, ema_z_ = 1;
  bool     ema_ready_ = false, worn_at_impact_ = true;
  uint16_t still_n_ = 0;
  float    still_sum_ = 0, still_sumsq_ = 0, gsum_x_ = 0, gsum_y_ = 0, gsum_z_ = 0;
  Bucket   buckets_[kBuckets];
  Bucket   cur_;
  uint8_t  nb_ = 0, b_head_ = 0;
  uint32_t step_last_ms_ = 0;
  uint8_t  step_run_ = 0;
  float    step_peak_ = 0, step_jerk_ = 0, step_gyro_ = 0, step_ema_ = 1.0f, step_prev_ = 1.0f;
  bool     step_rising_ = false, have_step_ = false;
  Step     pending_step_;
};

}  // namespace dhyaan
