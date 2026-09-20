// beacon.ino — Dhyaan room anchor. Flash one per room; change ROOM_MINOR and nothing else.
// HARDWARE_SPEC §3.4, ported to NimBLE-Arduino 2.x (NimBLEBeacon was removed in 2.0;
// the iBeacon manufacturer frame is built by hand).
// Board: ESP32S3 Dev Module (or ESP32-S3-Box) · Library: NimBLE-Arduino 2.x
#include <NimBLEDevice.h>

#include <vector>

// ---- PER-ROOM CONFIG: the ONLY line you edit between beacons ----
static const uint16_t ROOM_MINOR = 1;   // 1=kitchen 2=bathroom 3=bedroom 4=front_door
// -----------------------------------------------------------------

// Dhyaan site UUID eee6331c-6ea1-4873-83ed-ae648d10e07f — must match the band's
// config.json and the backend beacons table.
static const uint8_t SITE_UUID[16] = {
  0xee, 0xe6, 0x33, 0x1c, 0x6e, 0xa1, 0x48, 0x73,
  0x83, 0xed, 0xae, 0x64, 0x8d, 0x10, 0xe0, 0x7f,
};
static const uint16_t SITE_MAJOR = 1;
static const int8_t   MEASURED_POWER_1M = -59; // PLACEHOLDER — overwrite from the 1 m survey
static const uint16_t ADV_INTERVAL_MS   = 100; // hackathon value; product pucks run 500-1000 ms

void setup() {
  Serial.begin(115200);
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

void loop() { delay(10000); } // advertising runs in the BLE stack
