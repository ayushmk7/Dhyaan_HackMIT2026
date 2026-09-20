// [claude] agent-added (2026-09-20): bathroom beacon + help button + status LED
//
// bathhelp.ino — Dhyaan bathroom anchor for an ESP32-S3 DevKitC. REPLACES the
// plain beacon.ino on that board: it keeps advertising the IDENTICAL iBeacon
// frame (minor=2 = bathroom) and adds, when WiFi is configured:
//  * GET /v1/alerts?state=open every 2 s -> LED pulses red while an alert is
//    open, soft dim green otherwise (after an ack it goes green on the next poll).
//  * BOOT button long-press (>=1.5 s) = HELP: POST /v1/ingest/band with
//    type=button_pressed. LED flashes blue 3x when the POST went out, or
//    alternates red/blue on HTTP failure.
//  * WiFi left as the placeholder => beacon-only mode, dim white breathing LED.
// The beacon NEVER stops advertising, whatever WiFi/HTTP does.
//
// Board: ESP32-S3 DevKitC · FQBN per beacons/flash.sh DevKitC target:
//   arduino-cli compile --fqbn esp32:esp32:esp32s3 beacons/bathhelp
// Libraries: NimBLE-Arduino 2.x only (LED uses the core's rgbLedWrite; HTTP is
// the core's HTTPClient).
//
// BACKEND CONTRACT (verified against backend/app/routers/ingest.py BandEventIn):
//   required: band_id (str), type (literal incl. "button_pressed"),
//             ts (ISO-8601 datetime), battery_pct (int 0-100)
//   optional: peak_g, free_fall_ms, post_impact_tilt_deg, stillness_ms, simulated
// so the body below matches the pydantic model exactly. NOTE: the backend
// currently only LOGS button_pressed (only fall_suspected opens an alert); a
// pending backend hook will make button_pressed open the alert ladder — the
// firmware contract here is already correct and needs no change when that
// lands. Also note: band_id must exist in the backend `bands` collection or
// the POST 404s (scripts/seed.py seeds band_a3f2; band_unoq01 is the band
// team's id from band/fallband/config.json — make sure it is registered).

// ---------------- VENUE CONFIG: set these before flashing ----------------
#define WIFI_SSID   "SET_ME_AT_VENUE"      // leave as-is => beacon-only mode
#define WIFI_PASS   "SET_ME_AT_VENUE"
// --------------------------------------------------------------------------

#define BACKEND_BASE  "https://subsystem-mushroom-grooving.ngrok-free.dev"
#define API_KEY       "dev-key-change-me"  // Bearer for GET /v1/alerts
#define BAND_KEY      "band-dev-key"       // X-Band-Key for /v1/ingest/band
#define BAND_ID       "band_unoq01"

#define LED_PIN       48   // WS2812 on most S3 DevKitC boards (v1.1 boards use 38)
#define BOOT_BTN_PIN  0    // BOOT button, active-low
#define POLL_MS       2000
#define LONGPRESS_MS  1500

#include <NimBLEDevice.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <time.h>
#include <vector>

// ======================= iBeacon (copied VERBATIM from beacons/beacon.ino;
// do NOT touch — localization dies if the frame changes) =====================
static const uint16_t ROOM_MINOR = 2;   // 1=kitchen 2=bathroom 3=bedroom 4=front_door

// Dhyaan site UUID eee6331c-6ea1-4873-83ed-ae648d10e07f — must match the band's
// config.json and the backend beacons table.
static const uint8_t SITE_UUID[16] = {
  0xee, 0xe6, 0x33, 0x1c, 0x6e, 0xa1, 0x48, 0x73,
  0x83, 0xed, 0xae, 0x64, 0x8d, 0x10, 0xe0, 0x7f,
};
static const uint16_t SITE_MAJOR = 1;
static const int8_t   MEASURED_POWER_1M = -59; // PLACEHOLDER — overwrite from the 1 m survey (utsavtodo E8.1)
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

// ------------------------------- state -------------------------------------
static bool     wifiConfigured = false;
static bool     alertOpen      = false;   // last successful poll saw "alt_"
static uint32_t nextPollAt     = 0;
static uint32_t pressStartMs   = 0;       // 0 = button not currently down
static bool     helpFired      = false;   // fired for this press already
static WiFiClientSecure tls;

// ------------------------------- LED ----------------------------------------
// One WS2812 via the core's rgbLedWrite(); brightness kept low throughout.
static void ledShow(uint8_t r, uint8_t g, uint8_t b) { rgbLedWrite(LED_PIN, r, g, b); }

static void ledIdleAnimate() {
  uint32_t now = millis();
  if (!wifiConfigured) {
    // dim white breathing, ~3 s period, peak brightness 30
    float ph = (now % 3000) / 3000.0f;
    uint8_t v = (uint8_t)(6 + 24 * 0.5f * (1 - cosf(2 * PI * ph)));
    ledShow(v, v, v);
  } else if (alertOpen) {
    // red pulse, ~1 s period, 15..160
    float ph = (now % 1000) / 1000.0f;
    uint8_t v = (uint8_t)(15 + 145 * 0.5f * (1 - cosf(2 * PI * ph)));
    ledShow(v, 0, 0);
  } else {
    ledShow(0, 22, 0);  // soft green, low brightness
  }
}

// Blocking confirm patterns (~1.2 s) right after the HELP POST; the beacon
// keeps advertising from the BLE stack the whole time.
static void ledFlashOk()  { for (int i = 0; i < 3; i++) { ledShow(0, 0, 160); delay(180); ledShow(0, 0, 0); delay(140); } }
static void ledFlashErr() { for (int i = 0; i < 3; i++) { ledShow(160, 0, 0); delay(160); ledShow(0, 0, 160); delay(160); } ledShow(0, 0, 0); }

// ------------------------------- time ---------------------------------------
// ISO-8601 UTC from NTP (configTime in setup). If SNTP has not synced yet the
// literal fallback below is sent — the backend only needs a parseable ts, and
// a fixed demo-day stamp beats blocking the HELP path on NTP.
static String isoNowUTC() {
  time_t t = time(nullptr);
  if (t < 1750000000) {                    // clock still at epoch => unsynced
    Serial.println("NTP unsynced - using fixed ts placeholder");
    return String("2026-09-20T12:00:00Z");
  }
  struct tm tmv;
  gmtime_r(&t, &tmv);
  char buf[24];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tmv);
  return String(buf);
}

// ------------------------------- backend ------------------------------------
// Poll GET /v1/alerts?state=open. 1 = open alert, 0 = none, -1 = failed.
static int pollAlerts() {
  if (WiFi.status() != WL_CONNECTED) return -1;
  HTTPClient http;
  http.setConnectTimeout(3000);
  http.setTimeout(4000);
  if (!http.begin(tls, BACKEND_BASE "/v1/alerts?state=open")) return -1;
  http.addHeader("Authorization", "Bearer " API_KEY);
  http.addHeader("ngrok-skip-browser-warning", "1");
  int code = http.GET();
  if (code != 200) { http.end(); Serial.printf("poll HTTP %d\n", code); return -1; }
  String body = http.getString();
  http.end();
  return body.indexOf("alt_") >= 0 ? 1 : 0;
}

// POST the HELP event. Body matches BandEventIn exactly (see header comment).
static bool postHelp() {
  if (WiFi.status() != WL_CONNECTED) return false;
  String payload = String("{\"band_id\":\"" BAND_ID "\",\"type\":\"button_pressed\",\"ts\":\"")
                   + isoNowUTC() + "\",\"battery_pct\":100}";
  HTTPClient http;
  http.setConnectTimeout(3000);
  http.setTimeout(5000);
  if (!http.begin(tls, BACKEND_BASE "/v1/ingest/band")) return false;
  http.addHeader("X-Band-Key", BAND_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("ngrok-skip-browser-warning", "1");
  int code = http.POST(payload);
  http.end();
  Serial.printf("HELP POST HTTP %d (%s)\n", code, payload.c_str());
  return code >= 200 && code < 300;
}

// ------------------------------- button -------------------------------------
// Long-press (>=1.5 s) fires once per press; the press start doubles as the
// debounce (a bounce shorter than LONGPRESS_MS can never fire).
static bool helpLongPressed() {
  bool down = (digitalRead(BOOT_BTN_PIN) == LOW);
  if (!down) { pressStartMs = 0; helpFired = false; return false; }
  if (pressStartMs == 0) { pressStartMs = millis(); return false; }
  if (!helpFired && millis() - pressStartMs >= LONGPRESS_MS) {
    helpFired = true;   // once per press; re-arm on release
    return true;
  }
  return false;
}

// ------------------------------- arduino ------------------------------------
void setup() {
  Serial.begin(115200);
  pinMode(BOOT_BTN_PIN, INPUT_PULLUP);
  ledShow(0, 0, 0);

  // 1) Beacon first — it must run no matter what else fails.
  startBeacon();

  // 2) WiFi, non-blocking. Placeholder SSID => beacon-only mode.
  wifiConfigured = strcmp(WIFI_SSID, "SET_ME_AT_VENUE") != 0;
  if (wifiConfigured) {
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");  // UTC; syncs when WiFi is up
    Serial.printf("WiFi connecting to %s ...\n", WIFI_SSID);
  } else {
    Serial.println("WiFi not configured (placeholder SSID) — beacon-only mode");
  }
  tls.setInsecure();  // demo-grade TLS: skip cert validation

  nextPollAt = millis() + 1000;
}

void loop() {
  uint32_t now = millis();

  // HELP long-press (checked first so a held button never waits on a poll).
  if (wifiConfigured && helpLongPressed()) {
    Serial.println("HELP long-press -> POST /v1/ingest/band");
    if (postHelp()) ledFlashOk();
    else            ledFlashErr();
    nextPollAt = now;  // poll immediately after — the backend hook may open an alert
  }

  // Poll the alert state every 2 s.
  if (wifiConfigured && (int32_t)(now - nextPollAt) >= 0) {
    nextPollAt = now + POLL_MS;
    int r = pollAlerts();
    if (r >= 0 && alertOpen != (r == 1)) {
      alertOpen = (r == 1);
      Serial.printf("alert state -> %s\n", alertOpen ? "OPEN (red)" : "clear (green)");
    }
  }

  ledIdleAnimate();
  delay(20);
}
