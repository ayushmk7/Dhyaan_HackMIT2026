// beacon.ino — Dhyaan room anchor. Flash one per room; change ROOM_MINOR and nothing else.
// Verbatim from HARDWARE_SPEC.md §3.4 with our generated site UUID.
// Board: ESP32S3 Dev Module · Library: NimBLE-Arduino (Library Manager)
// Boards Manager URL: https://espressif.github.io/arduino-esp32/package_esp32_index.json
#include <NimBLEDevice.h>

// ---- PER-ROOM CONFIG: the ONLY line you edit between beacons ----
static const uint16_t ROOM_MINOR = 1;   // 1=kitchen 2=bathroom 3=bedroom 4=front_door
// -----------------------------------------------------------------

static const char*    SITE_UUID  = "eee6331c-6ea1-4873-83ed-ae648d10e07f"; // Dhyaan site UUID — must match band config.json
static const uint16_t SITE_MAJOR = 1;
static const int8_t   MEASURED_POWER_1M = -59;   // PLACEHOLDER — overwrite from the §8 survey (utsavtodo E8.1)
static const uint16_t ADV_INTERVAL_MS   = 100;   // hackathon value; product pucks run 500-1000 ms

void setup() {
  Serial.begin(115200);
  NimBLEDevice::init("");
  NimBLEDevice::setPower(ESP_PWR_LVL_P3);        // ~0 dBm. P9 ~ +9 dBm if a room needs more reach.

  NimBLEBeacon beacon;
  beacon.setManufacturerId(0x004C);              // Apple, required for the iBeacon layout
  beacon.setProximityUUID(NimBLEUUID(SITE_UUID));
  beacon.setMajor(SITE_MAJOR);
  beacon.setMinor(ROOM_MINOR);
  beacon.setSignalPower(MEASURED_POWER_1M);

  NimBLEAdvertisementData adv;
  adv.setFlags(0x04);                            // BR/EDR not supported
  adv.setManufacturerData(beacon.getData());

  NimBLEAdvertising* a = NimBLEDevice::getAdvertising();
  a->setAdvertisementData(adv);
  a->setMinInterval(ADV_INTERVAL_MS * 1000 / 625);   // units of 0.625 ms
  a->setMaxInterval(ADV_INTERVAL_MS * 1000 / 625);
  a->start();

  Serial.printf("iBeacon up: major=%u minor=%u @ %u ms\n",
                SITE_MAJOR, ROOM_MINOR, ADV_INTERVAL_MS);
}

void loop() { delay(10000); }   // advertising runs in the BLE stack; nothing to do here
