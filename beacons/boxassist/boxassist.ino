// [claude] agent-added (2026-09-20): S3-BOX alert-response firmware
//
// boxassist.ino — Dhyaan kitchen box: iBeacon anchor + alert-response screen.
// Board: ESP32-S3-BOX (original: ILI9342C 320x240 + TT21100 touch; the BOX-3
// variant with GT911 is also handled — LovyanGFX autodetects at boot).
// FQBN: esp32:esp32:esp32s3box · Libraries: NimBLE-Arduino 2.x, LovyanGFX 1.x
//
// Behavior:
//  * ALWAYS advertises the identical iBeacon frame as beacons/beacon.ino
//    (SITE_UUID eee6331c-…, major=1, minor=1 = kitchen). Never stops.
//  * Joins WiFi (set the two #defines below at the venue) and polls
//    GET /alerts?state=open every 2 s. Any open alert ("alt_…" id in the
//    response) flips the screen to a full-screen "Are you OK?" takeover.
//  * Tap the giant on-screen button OR press the top BOOT button to POST
//    /demo/force_ack {"alert_id":"…","by":"box_kitchen"} — then a 5 s
//    "OK - glad you're safe" screen, then back to IDLE.
//  * WiFi down / unconfigured: stays a plain beacon, IDLE screen shows a
//    small red dot bottom-left. Never crashes, never stops advertising.
//  * [claude] AUDIO (added 2026-09-20): on entering ALERT the speaker plays an
//    embedded voice prompt ("Asha, are you okay? ..."), then a soft chime every
//    ~10 s while the alert stays open; on ack, a short pleasant confirm tone.
//    ES8311 codec + I2S per esp-bsp pinout (see box_audio.h). If the codec or
//    I2S init fails the sketch logs once and runs silently — audio can never
//    take down the beacon/screen.

// ---------------- VENUE CONFIG: set these before flashing ----------------
#define WIFI_SSID   "SET_ME_AT_VENUE"      // leave as-is => beacon-only mode
#define WIFI_PASS   "SET_ME_AT_VENUE"
// [claude] iOS hotspots spell the name with U+2019 ('), humans type ASCII (').
// If the primary SSID hasn't joined after 20 s, retry alternating with this.
#define WIFI_SSID_ALT WIFI_SSID
// --------------------------------------------------------------------------

#define BACKEND_BASE  "https://subsystem-mushroom-grooving.ngrok-free.dev"
#define API_KEY       "dev-key-change-me"  // Bearer for GET /alerts
#define ACK_BY        "box_kitchen"

#define LGFX_AUTODETECT
#include <LovyanGFX.hpp>
#include <LGFX_AUTODETECT.hpp>

#include <NimBLEDevice.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <vector>

#include "boxassist_types.h"
#include "box_audio.h"   // [claude] ES8311 + I2S voice/chime (see header notes)

// ======================= iBeacon (copied VERBATIM from beacons/beacon.ino;
// do NOT touch — localization dies if the frame changes) =====================
static const uint16_t ROOM_MINOR = 1;   // 1=kitchen 2=bathroom 3=bedroom 4=front_door

// Dhyaan site UUID eee6331c-6ea1-4873-83ed-ae648d10e07f — must match the band's
// config.json and the backend beacons table.
static const uint8_t SITE_UUID[16] = {
  0xee, 0xe6, 0x33, 0x1c, 0x6e, 0xa1, 0x48, 0x73,
  0x83, 0xed, 0xae, 0x64, 0x8d, 0x10, 0xe0, 0x7f,
};
static const uint16_t SITE_MAJOR = 1;
static const int8_t   MEASURED_POWER_1M = -59; // PLACEHOLDER — overwrite from the 1 m survey
static const uint16_t ADV_INTERVAL_MS   = 100; // hackathon value; product pucks run 500-1000 ms

static void startBeacon() {
  NimBLEDevice::init("");
  NimBLEDevice::setPower(3); // ~ +3 dBm; raise to 9 if a room needs more reach

  // iBeacon frame: Apple company ID (LE) + type 0x02 + len 0x15 + UUID(BE) +
  // major(BE) + minor(BE) + calibrated TX power at 1 m.
  std::vector<uint8_t> frame;
  frame.reserve(25);
  frame.push_back(0x4C); frame.push_back(0x00);
  frame.push_back(0x02); frame.push_back(0x15);
  frame.insert(frame.end(), SITE_UUID, SITE_UUID + 16);
  frame.push_back(SITE_MAJOR >> 8); frame.push_back(SITE_MAJOR & 0xFF);
  frame.push_back(ROOM_MINOR >> 8); frame.push_back(ROOM_MINOR & 0xFF);
  frame.push_back((uint8_t)MEASURED_POWER_1M);

  NimBLEAdvertisementData adv;
  adv.setFlags(0x04); // BR/EDR not supported
  adv.setManufacturerData(frame);

  NimBLEAdvertising* a = NimBLEDevice::getAdvertising();
  a->setAdvertisementData(adv);
  a->setMinInterval(ADV_INTERVAL_MS * 1000 / 625); // units of 0.625 ms
  a->setMaxInterval(ADV_INTERVAL_MS * 1000 / 625);
  a->start();

  Serial.printf("iBeacon up: major=%u minor=%u @ %u ms\n",
                SITE_MAJOR, ROOM_MINOR, ADV_INTERVAL_MS);
}
// ================================ end iBeacon ================================

// ------------------------------- display -----------------------------------
static LGFX lcd;                 // LovyanGFX autodetect (S3-BOX / BOX-3 / Lite)
static bool haveDisplay = false; // Lite / detect-failure => still run headless

// ------------------------------- state -------------------------------------
static ScreenState state = ST_IDLE;   // enum lives in boxassist_types.h
static String   activeAlertId;
static uint32_t thanksUntil   = 0;
static uint32_t nextPollAt    = 0;
static bool     online        = false;  // WiFi up AND last poll returned 200
static bool     wifiConfigured = false;
static uint32_t lastBtnMs     = 0;
static bool     btnWasDown    = false;

#define BTN_BOOT_PIN 0            // top "Boot" button on the S3-BOX, active-low
// [claude] 2026-09-20: DISABLED by default. On the original S3-BOX GPIO0 is
// ALSO the panel's SPI MISO — the display drives the line and it reads LOW,
// i.e. "pressed", forever. Live result: the box silently acked every alert
// ~10s after it opened (by=box_kitchen, nobody touching it). Touch is the
// confirm input; enable this only on hardware where GPIO0 is actually free.
#define USE_BOOT_BUTTON 0
#define POLL_MS      2000
#define THANKS_MS    5000
#define CHIME_MS     20000        // [claude] chime period; longer = more bus-quiet windows for touch

static uint32_t nextChimeAt = 0;  // [claude] next chime while in ST_ALERT

static WiFiClientSecure tls;

// Giant on-screen button rect (landscape 320x240)
static const int BTN_X = 10, BTN_Y = 96, BTN_W = 300, BTN_H = 134;

// ------------------------------- screens -----------------------------------
static void drawStatusDot() {
  if (!haveDisplay || state != ST_IDLE) return;
  lcd.fillCircle(14, 226, 5, online ? TFT_DARKGREEN : TFT_RED);
}

static void drawIdle() {
  if (!haveDisplay) return;
  lcd.fillScreen(TFT_BLACK);
  lcd.setTextDatum(textdatum_t::middle_center);
  lcd.setTextColor(0x630C /*dim gray*/, TFT_BLACK);
  lcd.setFont(&fonts::FreeSansBold18pt7b);
  lcd.drawString("Dhyaan", 160, 100);
  lcd.setFont(&fonts::FreeSans12pt7b);
  lcd.setTextColor(0x39E7 /*dimmer*/, TFT_BLACK);
  lcd.drawString("Kitchen", 160, 140);
  drawStatusDot();
}

static void drawAlert() {
  if (!haveDisplay) return;
  lcd.fillScreen(TFT_RED);
  lcd.setTextDatum(textdatum_t::middle_center);
  lcd.setTextColor(TFT_WHITE, TFT_RED);
  lcd.setFont(&fonts::FreeSansBold24pt7b);
  lcd.drawString("Are you OK?", 160, 48);
  // giant button
  lcd.fillRoundRect(BTN_X, BTN_Y, BTN_W, BTN_H, 16, TFT_WHITE);
  lcd.setTextColor(TFT_BLACK, TFT_WHITE);
  lcd.setFont(&fonts::FreeSansBold24pt7b);
  lcd.drawString("I'M OK", 160, BTN_Y + 52);
  lcd.setFont(&fonts::FreeSansBold12pt7b);
  lcd.drawString("- TAP -", 160, BTN_Y + 98);
}

static void drawThanks() {
  if (!haveDisplay) return;
  lcd.fillScreen(TFT_DARKGREEN);
  lcd.setTextDatum(textdatum_t::middle_center);
  lcd.setTextColor(TFT_WHITE, TFT_DARKGREEN);
  lcd.setFont(&fonts::FreeSansBold24pt7b);
  lcd.drawString("OK", 160, 84);
  lcd.setFont(&fonts::FreeSansBold18pt7b);
  lcd.drawString("glad you're safe", 160, 140);
}

static void setState(ScreenState s) {
  if (s == state) return;
  state = s;
  switch (s) {
    case ST_IDLE:
      drawIdle();
      boxAudioStop();                       // [claude] alert cleared elsewhere -> hush
      break;
    case ST_ALERT:
      drawAlert();
      boxAudioPlayVoice();                  // [claude] spoken prompt once...
      nextChimeAt = millis() + CHIME_MS;    // [claude] ...then chimes every ~10 s
      break;
    case ST_THANKS:
      drawThanks();
      thanksUntil = millis() + THANKS_MS;
      boxAudioStop();
      boxAudioPlayConfirm();                // [claude] pleasant ack tone, played out
      while (boxAudioBusy()) boxAudioPump(); //          fully (~0.45 s) before the
      break;                                 //          blocking ack POST starts
  }
  Serial.printf("state -> %d\n", (int)s);
}

// ------------------------------- backend -----------------------------------
// Poll GET /alerts?state=open. Returns: 1 = open alert found (id stored in
// activeAlertId), 0 = confirmed empty, -1 = request failed (keep prior state).
static int pollAlerts() {
  if (WiFi.status() != WL_CONNECTED) { online = false; return -1; }
  HTTPClient http;
  http.setConnectTimeout(3000);
  http.setTimeout(4000);
  if (!http.begin(tls, BACKEND_BASE "/v1/alerts?state=open")) return -1;
  http.addHeader("Authorization", "Bearer " API_KEY);
  http.addHeader("ngrok-skip-browser-warning", "1");
  int code = http.GET();
  if (code != 200) {
    http.end();
    online = false;
    Serial.printf("poll HTTP %d\n", code);
    return -1;
  }
  String body = http.getString();
  http.end();
  bool wasOnline = online;
  online = true;
  if (!wasOnline) drawStatusDot();

  int p = body.indexOf("alt_");
  if (p < 0) return 0;
  int q = body.indexOf('"', p);
  if (q < 0) q = body.length();
  activeAlertId = body.substring(p, q);
  return 1;
}

// POST /demo/force_ack (no auth). Best-effort, one retry.
static bool postAck(const String& alertId) {
  String payload = String("{\"alert_id\":\"") + alertId + "\",\"by\":\"" ACK_BY "\"}";
  for (int attempt = 0; attempt < 2; ++attempt) {
    if (WiFi.status() != WL_CONNECTED) break;
    HTTPClient http;
    http.setConnectTimeout(3000);
    http.setTimeout(4000);
    if (!http.begin(tls, BACKEND_BASE "/demo/force_ack")) continue;
    http.addHeader("Content-Type", "application/json");
    http.addHeader("ngrok-skip-browser-warning", "1");
    int code = http.POST(payload);
    http.end();
    Serial.printf("force_ack HTTP %d (%s)\n", code, payload.c_str());
    if (code >= 200 && code < 300) return true;
  }
  return false;
}

// ------------------------------- inputs ------------------------------------
static bool confirmPressed() {
  // Physical top BOOT button (active-low), edge-triggered + debounced.
#if !USE_BOOT_BUTTON
  bool down = false;  // [claude] GPIO0 conflicts with panel MISO — see define above
#else
  bool down = (digitalRead(BTN_BOOT_PIN) == LOW);
#endif
  bool fired = false;
  if (down && !btnWasDown && millis() - lastBtnMs > 300) {
    fired = true;
    lastBtnMs = millis();
  }
  btnWasDown = down;
  if (fired) return true;

  // Touch anywhere on the giant button (generously: lower 3/4 of the screen).
  // [claude] 2026-09-20: the ES8311 codec SHARES the I2C bus with the touch
  // controller, and audio traffic (the spoken prompt, ~4-6s into an alert)
  // corrupts single touch reads into phantom taps — live, the box acked
  // alerts nobody touched. Require 3 consecutive in-region samples 40ms
  // apart: bus garbage never repeats consistently; a real finger does.
  if (haveDisplay && state == ST_ALERT) {
    int32_t x, y;
    if (lcd.getTouch(&x, &y) && y >= BTN_Y - 20) {
      // [claude] v3 of this check. v1 (single read) phantom-acked during audio:
      // the codec shares I2C with touch, and the spoken prompt corrupts reads.
      // v2 (3 consecutive clean reads) ate REAL taps for the same reason - the
      // bus is noisy exactly while the box is talking. v3: the first plausible
      // hit SILENCES the audio (frees the bus), then 4 clean reads decide.
      // A held finger persists ~200ms and passes; one-frame garbage cannot.
      if (boxAudioBusy()) boxAudioStop();
      delay(50);
      int hits = 0;
      for (int i = 0; i < 4; i++) {
        if (lcd.getTouch(&x, &y) && y >= BTN_Y - 20) hits++;
        delay(40);
      }
      Serial.printf("touch confirm hits=%d/4\n", hits);
      if (hits >= 2) return true;
    }
  }
  return false;
}

// ------------------------------- arduino -----------------------------------
void setup() {
  Serial.begin(115200);

  // 1) Beacon first — it must run no matter what else fails.
  startBeacon();

  // [claude] 1.5) ES8311 codec config over I2C. Must run BEFORE lcd.init():
  // the codec shares the I2C bus (GPIO8/18) with the touch controller and
  // LovyanGFX drives that bus with its own driver — box_audio.h uses Wire and
  // releases the peripheral (Wire.end) before LGFX claims it. On failure we
  // log once and stay silent; nothing else is affected.
  if (!boxAudioCodecInit()) {
    Serial.println("ES8311 init failed - running without audio");
  }

  // 2) Display (autodetect; a failure leaves us headless but alive).
  //    NOTE: on the original S3-BOX GPIO0 is also the panel's SPI MISO and the
  //    autodetect reads the panel ID over it, so claim the BOOT button pin
  //    only AFTER lcd.init() (the panel is write-only from then on).
  haveDisplay = lcd.init();
  pinMode(BTN_BOOT_PIN, INPUT_PULLUP);
  if (haveDisplay) {
    lcd.setRotation(1);            // landscape 320x240 (autodetect preset)
    lcd.setBrightness(200);
    drawIdle();
  } else {
    Serial.println("display init failed — running headless (button-only)");
  }

  // [claude] 2.5) I2S out + power amp. The only audio pin that differs between
  // the original S3-BOX and the BOX-3 is WS/LRCK (47 vs 45, per esp-bsp), so
  // pick it from LovyanGFX's board autodetect; headless fallback = original.
  if (boxCodecOk) {
    int ws = AUDIO_I2S_WS_BOX;
    if (haveDisplay && lcd.getBoard() == lgfx::board_t::board_ESP32_S3_BOX_V3) {
      ws = AUDIO_I2S_WS_BOX3;
    }
    if (!boxAudioI2SInit(ws)) {
      Serial.println("I2S init failed - running without audio");
    }
  }

  // 3) WiFi, non-blocking. Placeholder SSID => beacon-only mode.
  wifiConfigured = strcmp(WIFI_SSID, "SET_ME_AT_VENUE") != 0;
  if (wifiConfigured) {
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    Serial.printf("WiFi connecting to %s ...\n", WIFI_SSID);
  } else {
    Serial.println("WiFi not configured (placeholder SSID) — beacon-only mode");
  }
  tls.setInsecure();               // demo-grade TLS: skip cert validation

  nextPollAt = millis() + 1000;
}

void loop() {
  uint32_t now = millis();

  // [claude] SSID fallback + join visibility (learned live: the typographic
  // apostrophe cost us 20 minutes of "WiFi connecting ..." silence).
  static uint32_t wifiAttemptAt = 0;
  static bool altSsid = false, ipLogged = false;
  if (wifiConfigured && WiFi.status() != WL_CONNECTED && now - wifiAttemptAt > 20000) {
    if (wifiAttemptAt != 0 && strcmp(WIFI_SSID, WIFI_SSID_ALT) != 0) {
      altSsid = !altSsid;
      WiFi.disconnect();
      WiFi.begin(altSsid ? WIFI_SSID_ALT : WIFI_SSID, WIFI_PASS);
      Serial.printf("WiFi retry with %s\n", altSsid ? WIFI_SSID_ALT : WIFI_SSID);
    }
    wifiAttemptAt = now;
    ipLogged = false;
  }
  if (wifiConfigured && WiFi.status() == WL_CONNECTED && !ipLogged) {
    ipLogged = true;
    Serial.printf("WiFi OK ip=%s\n", WiFi.localIP().toString().c_str());
  }

  // [claude] Keep the speaker fed (no-op when idle/audio-less). While a clip
  // or tone is playing we also defer the blocking HTTP poll below so a slow
  // request can't put a gap in the middle of the spoken prompt — the voice
  // clip is 3.4 s, so at worst one poll cycle slips.
  boxAudioPump();

  // [claude] Soft reminder chime every ~10 s while the alert stays open.
  if (state == ST_ALERT && !boxAudioBusy() && (int32_t)(now - nextChimeAt) >= 0) {
    boxAudioPlayChime();
    nextChimeAt = now + CHIME_MS;
  }

  // Poll backend every 2 s (in IDLE and ALERT; not during the THANKS splash).
  if (wifiConfigured && state != ST_THANKS && !boxAudioBusy() /*[claude]*/ &&
      (int32_t)(now - nextPollAt) >= 0) {
    nextPollAt = now + POLL_MS;
    bool wasOnline = online;
    int r = pollAlerts();
    if (r == 1)      setState(ST_ALERT);
    else if (r == 0) setState(ST_IDLE);   // alert cleared elsewhere too
    if (online != wasOnline) drawStatusDot();
  }

  // Confirm input (touch or top button) while alerting.
  if (state == ST_ALERT && confirmPressed()) {
    Serial.printf("confirm pressed, acking %s\n", activeAlertId.c_str());
    setState(ST_THANKS);                  // instant feedback, then network
    postAck(activeAlertId);               // best-effort; demo continues regardless
    activeAlertId = "";
    nextPollAt = millis() + POLL_MS;      // don't re-latch the same alert instantly
  }

  // THANKS splash times out back to IDLE.
  if (state == ST_THANKS && (int32_t)(now - thanksUntil) >= 0) {
    setState(ST_IDLE);
  }

  delay(30);
}
