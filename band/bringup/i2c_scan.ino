// i2c_scan.ino — temporary bring-up sketch (HARDWARE_SPEC §11 step 16 / E3.3).
// Flash this FIRST. Expect bus addresses 0x6A (Movement), 0x3E (Buttons), 0x1E (Buzzer).
// Nothing found → you used Wire instead of Wire1.
#include <Wire.h>

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 3000) {}
  Wire1.begin();  // Qwiic = I2C4 on UNO Q
  Serial.println("I2C scan on Wire1:");
  for (uint8_t a = 1; a < 127; a++) {
    Wire1.beginTransmission(a);
    if (Wire1.endTransmission() == 0) {
      Serial.print("found 0x");
      Serial.println(a, HEX);
    }
  }
  Serial.println("done");
}

void loop() {}
