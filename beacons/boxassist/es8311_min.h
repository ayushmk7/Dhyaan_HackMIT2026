// [claude] agent-added (2026-09-20): minimal ES8311 playback-only init over Wire
//
// Trimmed from espressif/esp-bsp components/es8311/es8311.c (Apache-2.0).
// Fixed configuration — exactly what boxassist needs and nothing else:
//   * slave mode, standard I2S, 16-bit
//   * MCLK taken from the MCLK pad at 256*fs (the Arduino ESP_I2S STD mode
//     default is I2S_MCLK_MULTIPLE_256), fs = 16000 -> MCLK = 4.096 MHz
//   * coeff row used: {4096000, 16000, pre_div=1, pre_multi=0, adc_div=1,
//     dac_div=1, fs_mode=0, lrck_h=0x00, lrck_l=0xff, bclk_div=4, osr=0x10}
//   * DAC path powered, ADC/mic left alone (playback only)
// Every call returns false on the first I2C NACK so the sketch can fall back
// to silent mode without hanging.
#pragma once
#include <Arduino.h>
#include <Wire.h>

#define ES8311_I2C_ADDR 0x18  // CE pin low (esp-box wiring)

static bool es8311_wr(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(ES8311_I2C_ADDR);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

static bool es8311_rd(uint8_t reg, uint8_t *val) {
  Wire.beginTransmission(ES8311_I2C_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint8_t)ES8311_I2C_ADDR, (uint8_t)1) != 1) return false;
  *val = Wire.read();
  return true;
}

// Full init for 16 kHz / 16-bit / mono playback, MCLK = 256*fs from MCLK pad.
// Mirrors es8311_init() + es8311_clock_config() + es8311_sample_frequency_config()
// + es8311_fmt_config() from the reference driver, with the coeff row inlined.
// volume_pct: 0-100 (reference driver mapping: reg32 = pct*256/100 - 1).
static bool es8311_init_16k_playback(uint8_t volume_pct) {
  uint8_t v;

  // Reset to defaults, then power on (CSM up).
  if (!es8311_wr(0x00, 0x1F)) return false;   // reset everything
  delay(20);
  if (!es8311_wr(0x00, 0x00)) return false;
  if (!es8311_wr(0x00, 0x80)) return false;   // power-on command

  // Clock manager: all clocks on, MCLK from MCLK pad, nothing inverted.
  if (!es8311_wr(0x01, 0x3F)) return false;
  if (!es8311_rd(0x06, &v)) return false;
  v &= ~(1 << 5);                              // SCLK not inverted
  if (!es8311_wr(0x06, v)) return false;

  // Dividers for mclk=4.096 MHz, fs=16 kHz (coeff row above).
  if (!es8311_rd(0x02, &v)) return false;
  v = (v & 0x07) | ((1 - 1) << 5) | (0 << 3);  // pre_div=1, pre_multi=x1
  if (!es8311_wr(0x02, v)) return false;
  if (!es8311_wr(0x03, 0x10)) return false;    // fs_mode=single | adc_osr
  if (!es8311_wr(0x04, 0x10)) return false;    // dac_osr
  if (!es8311_wr(0x05, 0x00)) return false;    // adc_div=1, dac_div=1
  if (!es8311_rd(0x06, &v)) return false;
  v = (v & 0xE0) | (4 - 1);                    // bclk_div=4 (<19 -> reg = div-1)
  if (!es8311_wr(0x06, v)) return false;
  if (!es8311_rd(0x07, &v)) return false;
  v = (v & 0xC0) | 0x00;                       // lrck_h
  if (!es8311_wr(0x07, v)) return false;
  if (!es8311_wr(0x08, 0xFF)) return false;    // lrck_l

  // Format: slave serial port, standard I2S, 16-bit in and out.
  if (!es8311_rd(0x00, &v)) return false;
  if (!es8311_wr(0x00, v & 0xBF)) return false;
  if (!es8311_wr(0x09, 3 << 2)) return false;  // SDP-in  16-bit
  if (!es8311_wr(0x0A, 3 << 2)) return false;  // SDP-out 16-bit

  // Power up the analog/DAC path (reference "NOT default" block).
  if (!es8311_wr(0x0D, 0x01)) return false;    // power up analog circuitry
  if (!es8311_wr(0x0E, 0x02)) return false;    // enable analog PGA/ADC modulator
  if (!es8311_wr(0x12, 0x00)) return false;    // power up DAC
  if (!es8311_wr(0x13, 0x10)) return false;    // enable output to HP drive
  if (!es8311_wr(0x1C, 0x6A)) return false;    // ADC eq bypass, DC offset cancel
  if (!es8311_wr(0x37, 0x08)) return false;    // bypass DAC equalizer

  // Volume + unmute.
  if (volume_pct > 100) volume_pct = 100;
  uint8_t reg32 = volume_pct == 0 ? 0 : (uint8_t)((volume_pct * 256) / 100 - 1);
  if (!es8311_wr(0x32, reg32)) return false;
  if (!es8311_rd(0x31, &v)) return false;
  if (!es8311_wr(0x31, v & ~0x60)) return false;  // clear DAC mute bits

  return true;
}
