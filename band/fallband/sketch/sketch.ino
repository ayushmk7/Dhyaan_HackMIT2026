// sketch.ino — Dhyaan band, STM32U585 side (HARDWARE_SPEC.md §5.1, §6.8).
//
// Owns the hard-real-time half: 208 Hz IMU reads, the fall cascade (detector.h),
// the buzzer, the buttons and the LEDs. It never touches the network — the radio
// hangs off the Linux processor (§3.1), so events go up over the Bridge and the
// Python side does HTTP.
//
// Three traps this file exists to get right (§6.3, §4.4):
//   - Qwiic on the UNO Q is Wire1 (I2C4). `Wire` is the header pins, not the Modulinos.
//   - The stock library configures ±4 g; every real impact clips at 4.00 g. We rewrite
//     CTRL1_XL to 0x56 (208 Hz, ±16 g) and read OUTX_L_A ourselves, because
//     readAcceleration() hard-codes the ±4 g scale factor and would under-report 4×.
//   - Never Bridge.call / print inside a provide() callback (§5.3) — provide_safe runs
//     the callback in loop() context instead.

#include <Arduino_RouterBridge.h>
#include <Arduino_Modulino.h>
#include <Wire.h>
#include <math.h>

#include "detector.h"

using namespace dhyaan;

ModulinoMovement movement;   // lib 0x6A, bus 0x6A
ModulinoButtons  buttons;    // lib 0x7C, bus 0x3E
ModulinoBuzzer   buzzer;     // lib 0x3C, bus 0x1E

// If your Arduino_Modulino version takes chars ('A'/'B'/'C') instead of indices,
// change only these three constants.
static const int BTN_A = 0, BTN_B = 1, BTN_C = 2;

static const uint8_t IMU_ADDR = 0x6A, CTRL1_XL = 0x10, CTRL2_G = 0x11,
                     TAP_CFG0 = 0x56, TAP_CFG2 = 0x58, FREE_FALL = 0x5D,
                     MD1_CFG = 0x5E, OUTX_L_A = 0x28, OUTX_L_G = 0x22;

static const float    A_SCALE   = 16.0f / 32768.0f;     // ±16 g — NOT 4.0 (§6.3)
static const float    G_SCALE   = 2000.0f / 32768.0f;
static const uint32_t PERIOD_US = 4808;                 // 208 Hz

FallDetector det;

// Per-axis correction from §7.2 step 0, pushed as config (accel_bias/accel_gain).
float biasX = 0, biasY = 0, biasZ = 0;
float gainX = 1, gainY = 1, gainZ = 1;

uint32_t tNext = 0;
uint32_t i2cErrors = 0, i2cErrorRun = 0, droppedSamples = 0, sampleCount = 0;
uint32_t tLastImuFix = 0;
bool     imuOk = false;

// Lateness histogram, 0.5 ms buckets. §10.5 wants loop_jitter_ms_p95 < 5 ms and we
// would rather report it than guess: a p95 that creeps up is the first sign the I2C
// bus is saturated (§13 item 14).
static const uint8_t JIT_BUCKETS = 20;
uint32_t jitter[JIT_BUCKETS];

// LED / buzzer state. The band has no screen and no speaker (D-013), so these three
// LEDs and one buzzer are the entire user interface.
enum Ui : uint8_t { UI_ARMED, UI_GRACE, UI_SENT, UI_CANCELLED, UI_TOO_LATE };
Ui       ui = UI_ARMED;
uint32_t tUi = 0, tLastChirp = 0, tLastSlow = 0;
bool     uplinkDown = false, calibrateMode = false, demoChirp = false;
uint32_t btnDown[3] = {0, 0, 0};
bool     btnWas[3] = {false, false, false};
bool     btnConsumed[3] = {false, false, false};   // press already used as a cancel

// ----------------------------------------------------------------- I2C ------
static void wr(uint8_t reg, uint8_t val) {
  Wire1.beginTransmission(IMU_ADDR);
  Wire1.write(reg);
  Wire1.write(val);
  Wire1.endTransmission();
}

static bool rdBurst(uint8_t reg, uint8_t* buf, uint8_t n) {
  Wire1.beginTransmission(IMU_ADDR);
  Wire1.write(reg);
  if (Wire1.endTransmission(false) != 0) return false;
  if (Wire1.requestFrom((int)IMU_ADDR, (int)n) != n) return false;
  for (uint8_t i = 0; i < n; i++) buf[i] = Wire1.read();
  return true;
}

static void configureIMU() {
  wr(CTRL1_XL, 0x56);    // ODR 208 Hz, FS_XL=01 => ±16 g, LPF2 on
  wr(CTRL2_G,  0x5C);    // ODR 208 Hz, ±2000 dps
  wr(TAP_CFG0, 0x41);    // latched interrupt, clear on read
  wr(TAP_CFG2, 0x80);    // INTERRUPTS_ENABLE
  wr(FREE_FALL, 0x8A);   // FF_DUR 17 (~82 ms), FF_THS 250 mg — informational (§6.6)
  wr(MD1_CFG,  0x10);    // INT1_FF: header-only on the Modulino, we poll instead
  imuOk = true;
  i2cErrorRun = 0;
}

// --------------------------------------------------------------- Bridge -----
// Argument order is frozen in band/README.md; python/agent.py unpacks positionally.
static void notifyFall(const Out& o) {
  Bridge.notify("fall", (uint32_t)o.seq, (int)o.path, o.peak_g, o.ff_min_g,
                (int)o.ff_ms, o.orient_deg, o.still_std_g, o.gyro_max_dps,
                o.jerk_peak, (uint32_t)o.age_ms);
}

static void notifyImpactOnly(const Out& o) {
  Bridge.notify("impact_only", (uint32_t)o.seq, (int)o.path, o.peak_g,
                o.orient_deg, o.still_std_g, (int)o.reason);
}

// The walking profile (§6.9). The band clamps whatever arrives to the calibrated
// bounds itself, so a wrong value from the hub can never lower protection.
static void setThresholds(float ff_g, float impact_ff_g, float impact_soft_g, int rev) {
  det.setThresholds(ff_g, impact_ff_g, impact_soft_g, (uint16_t)rev);
}

// One generic setter beats fifteen RPCs. Python pushes the whole of config.json
// through this at boot and again whenever the file changes (§7.4: during calibration
// you will change these numbers thirty times, and reflashing costs 30-60 s).
static void setParam(String name, float v) {
  Config& c = det.config();
  if      (name == "ff_g")              c.ff_g = v;
  else if (name == "ff_min_ms")         c.ff_min_ms = (uint16_t)v;
  else if (name == "ff_max_ms")         c.ff_max_ms = (uint16_t)v;
  else if (name == "impact_ff_g")       c.impact_ff_g = v;
  else if (name == "impact_soft_g")     c.impact_soft_g = v;
  else if (name == "impact_floor_g")    c.impact_floor_g = v;
  else if (name == "impact_ceil_margin") c.impact_ceil_margin = v;
  else if (name == "f_min_g")           c.f_min_g = v;
  else if (name == "jerk_min_g_s")      c.jerk_min_g_s = v;
  else if (name == "orient_deg")        c.orient_deg = v;
  else if (name == "still_ms")          c.still_ms = (uint16_t)v;
  else if (name == "still_std_g")       c.still_std_g = v;
  else if (name == "still_gyro_dps")    c.still_gyro_dps = v;
  else if (name == "grace_s")           c.grace_s = (uint16_t)v;      // hub's cancel_window_s
  else if (name == "rearm_ms")          c.rearm_ms = (uint32_t)v;
  else if (name == "worn_std_g")        c.worn_std_g = v;
  else if (name == "worn_lookback_ms")  c.worn_lookback_ms = (uint16_t)v;
  else if (name == "drop_latch_ms")     c.drop_latch_ms = (uint16_t)v;
  else if (name == "steps_enabled")     c.steps_enabled = (v != 0.0f);
  else if (name == "step_min_peak_g")   c.step_min_peak_g = v;
  else if (name == "step_min_interval_ms") c.step_min_interval_ms = (uint16_t)v;
  else if (name == "bias_x")            biasX = v;
  else if (name == "bias_y")            biasY = v;
  else if (name == "bias_z")            biasZ = v;
  else if (name == "gain_x")            gainX = (v != 0.0f) ? v : 1.0f;
  else if (name == "gain_y")            gainY = (v != 0.0f) ? v : 1.0f;
  else if (name == "gain_z")            gainZ = (v != 0.0f) ? v : 1.0f;
  else if (name == "calibrate")         calibrateMode = (v != 0.0f);
  else if (name == "demo_chirp")        demoChirp = (v != 0.0f);
}

// Uplink feedback, so the wearer is never told something the hub did not confirm.
static void signalCode(int code) {
  switch (code) {
    case 1: ui = UI_CANCELLED; tUi = millis(); break;   // hub accepted the cancel
    case 2: ui = UI_TOO_LATE;  tUi = millis(); break;   // too late — help is coming
    case 3: uplinkDown = true;  break;
    case 4: uplinkDown = false; break;
  }
}

static uint16_t jitterP95Us() {
  uint32_t total = 0;
  for (uint8_t i = 0; i < JIT_BUCKETS; i++) total += jitter[i];
  if (total == 0) return 0;
  const uint32_t target = (total * 95) / 100;
  uint32_t seen = 0;
  for (uint8_t i = 0; i < JIT_BUCKETS; i++) {
    seen += jitter[i];
    if (seen >= target) return (uint16_t)(i * 500);
  }
  return (uint16_t)(JIT_BUCKETS * 500);
}

// CSV rather than a struct: one string is the safest thing to send back over
// MessagePack-RPC, and Python splits it in one line.
static String getStatus() {
  String s;
  s += (int)det.state();            s += ',';
  s += det.worn() ? 1 : 0;          s += ',';
  s += imuOk ? 1 : 0;               s += ',';
  s += (uint32_t)i2cErrors;         s += ',';
  s += (uint32_t)droppedSamples;    s += ',';
  s += (uint32_t)jitterP95Us();     s += ',';
  s += (uint32_t)det.config().rev;  s += ',';
  s += (uint32_t)millis();          s += ',';
  s += det.config().impact_soft_g;
  return s;
}

// ------------------------------------------------------------------ UI ------
static void setLeds(bool a, bool b, bool c) { buttons.setLeds(a, b, c); }

static void serviceUi(uint32_t now) {
  const bool blink = ((now / 250) % 2) == 0;
  switch (ui) {
    case UI_GRACE:
      setLeds(blink, blink, blink);
      if (now - tLastChirp >= 1000) { buzzer.tone(2000, 200); tLastChirp = now; }
      break;
    case UI_CANCELLED:
      setLeds(blink, false, false);
      if (now - tUi > 3000) ui = UI_ARMED;
      break;
    case UI_TOO_LATE:
      // One long low tone. The wearer pressed cancel after the window closed, so a
      // call is already going out and they should know that, not think they stopped it.
      if (now - tUi < 60) buzzer.tone(600, 1000);
      setLeds(false, false, true);
      if (now - tUi > 3000) ui = UI_SENT;
      break;
    case UI_SENT:
      setLeds(false, false, true);
      if (now - tUi > 60000) ui = UI_ARMED;
      break;
    case UI_ARMED:
    default:
      setLeds(true, calibrateMode, uplinkDown ? blink : false);
      break;
  }
}

static void serviceButtons(uint32_t now) {
  if (!buttons.update()) return;
  const bool down[3] = {buttons.isPressed(BTN_A), buttons.isPressed(BTN_B),
                        buttons.isPressed(BTN_C)};
  for (uint8_t i = 0; i < 3; i++) {
    if (down[i] && !btnWas[i]) {
      btnDown[i] = now;
      btnConsumed[i] = false;
      if (i == 0 && det.state() == CONFIRMED) {       // cancel, while it still counts
        Out o = det.cancel(now);
        if (o.ev == EV_CANCELLED) {
          buzzer.noTone();
          ui = UI_ARMED;
          btnConsumed[i] = true;                      // not also a plain button press
          Bridge.notify("cancel", (uint32_t)o.seq, (uint32_t)o.age_ms);
        }
      }
    } else if (!down[i] && btnWas[i]) {
      if (!btnConsumed[i]) {
        const uint32_t held = now - btnDown[i];
        Bridge.notify("button", (int)i, held >= 3000 ? 1 : 0);
      }
    }
    btnWas[i] = down[i];
  }
}

// Everything that is not the 208 Hz sample, run in the slack between samples.
static void serviceSlow() {
  const uint32_t now = millis();
  if (now - tLastSlow < 50) return;      // 20 Hz is plenty for a thumb (§6.6)
  tLastSlow = now;
  serviceButtons(now);
  serviceUi(now);

  if (!imuOk && now - tLastImuFix > 1000) {   // a jolted Qwiic cable should recover
    tLastImuFix = now;
    configureIMU();
  }
}

// ---------------------------------------------------------------- setup -----
void setup() {
  Serial.begin();
  Bridge.begin();
  Modulino.begin();          // defaults to Wire1 on ARDUINO_UNO_Q
  movement.begin();          // comes up 104 Hz / ±4 g ...
  buttons.begin();
  buzzer.begin();
  configureIMU();            // ... and we immediately override it (§6.3)

  Bridge.provide_safe("set_thresholds", setThresholds);
  Bridge.provide_safe("set_param", setParam);
  Bridge.provide_safe("signal", signalCode);
  Bridge.provide_safe("get_status", getStatus);

  for (uint8_t i = 0; i < JIT_BUCKETS; i++) jitter[i] = 0;
  det.reset(millis());
  setLeds(true, false, false);
  buzzer.tone(1200, 80);     // one chirp: armed, and the bus is alive
  tNext = micros();
}

// ----------------------------------------------------------------- loop -----
void loop() {
  const uint32_t now_us = micros();
  if ((int32_t)(now_us - tNext) < 0) { serviceSlow(); return; }

  const uint32_t late_us = now_us - tNext;
  jitter[(late_us / 500 < JIT_BUCKETS) ? (late_us / 500) : (JIT_BUCKETS - 1)]++;
  if (late_us > PERIOD_US) {
    // Behind by whole periods: count them and resync. Catching up in a burst would
    // hand the detector samples with wrong timestamps, which is worse than a gap.
    droppedSamples += late_us / PERIOD_US;
    tNext = now_us + PERIOD_US;
  } else {
    tNext += PERIOD_US;
  }

  uint8_t b[6];
  if (!rdBurst(OUTX_L_A, b, 6)) {
    i2cErrors++;
    if (++i2cErrorRun > 50) imuOk = false;
    return;
  }
  i2cErrorRun = 0;
  sampleCount++;

  const int16_t xr = (int16_t)(b[1] << 8 | b[0]);
  const int16_t yr = (int16_t)(b[3] << 8 | b[2]);
  const int16_t zr = (int16_t)(b[5] << 8 | b[4]);
  const float ax = (xr * A_SCALE - biasX) / gainX;
  const float ay = (yr * A_SCALE - biasY) / gainY;
  const float az = (zr * A_SCALE - biasZ) / gainZ;

  float gyro = NAN;
  if (det.needsGyro()) {
    uint8_t g6[6];
    if (rdBurst(OUTX_L_G, g6, 6)) {
      const float wx = (int16_t)(g6[1] << 8 | g6[0]) * G_SCALE;
      const float wy = (int16_t)(g6[3] << 8 | g6[2]) * G_SCALE;
      const float wz = (int16_t)(g6[5] << 8 | g6[4]) * G_SCALE;
      gyro = sqrtf(wx * wx + wy * wy + wz * wz);
    }
  }

  const uint32_t now_ms = millis();
  Out o = det.step(ax, ay, az, gyro, now_ms);

  switch (o.ev) {
    case EV_FALL:
      // Fire once, immediately, at the START of the grace window (§6.7): a band that
      // dies on impact must still have told the hub. Cancel is a second message.
      notifyFall(o);
      ui = UI_GRACE;
      tUi = now_ms;
      tLastChirp = 0;
      break;
    case EV_IMPACT_ONLY:
      notifyImpactOnly(o);
      if (demoChirp) buzzer.tone(1500, 60);   // expo table only (§6.9) — off in production
      break;
    case EV_GRACE_EXPIRED:
      buzzer.noTone();
      ui = UI_SENT;
      tUi = now_ms;
      break;
    case EV_REARMED:
      if (ui == UI_GRACE) ui = UI_ARMED;
      break;
    default:
      break;
  }

  Step st;
  while (det.pollStep(st)) Bridge.notify("step", st.peak_g, st.jerk, st.gyro_dps);
}
