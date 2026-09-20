// [claude] agent-added (2026-09-20): S3-BOX speaker output (voice prompt + tones)
//
// ES8311 playback codec + I2S out for boxassist. Everything here is an
// enhancement: any init failure leaves boxAudioReady=false and every call
// becomes a no-op — the beacon/screen/poll behavior never depends on audio.
//
// Pins verified against espressif/esp-bsp (bsp/esp-box.h and bsp/esp-box-3.h):
//   I2C  SDA=8  SCL=18            (shared with the touch controller!)
//   I2S  MCLK=2 SCLK=17 DOUT=15   WS=47 on the ORIGINAL S3-BOX, WS=45 on BOX-3
//   PA   GPIO46 (speaker power-amp enable, active high)
// The only original-vs-BOX-3 audio difference is the WS/LRCK pin; the sketch
// picks it at runtime from LovyanGFX's board autodetect.
//
// Playback model: a tiny non-blocking "pump" the main loop calls every pass.
// Each pump synthesizes or copies <=512 samples (32 ms) into a scratch buffer
// and hands it to the I2S DMA (ESP_I2S.h, Arduino core 3.x STD mode, mono,
// 16 kHz/16-bit, MCLK=256*fs). The voice clip streams straight out of flash —
// it is never copied to RAM. auto_clear is on in ESP_I2S so the line goes
// silent when we stop feeding it.
#pragma once
#include <Arduino.h>
#include <ESP_I2S.h>
#include <math.h>
#include "es8311_min.h"
#include "voice_prompt.h"

#define AUDIO_I2C_SDA     8
#define AUDIO_I2C_SCL     18
#define AUDIO_I2S_MCLK    2
#define AUDIO_I2S_SCLK    17
#define AUDIO_I2S_DOUT    15
#define AUDIO_I2S_WS_BOX  47   // original ESP32-S3-BOX
#define AUDIO_I2S_WS_BOX3 45   // ESP32-S3-BOX-3
#define AUDIO_PA_GPIO     46
#define AUDIO_RATE_HZ     16000
#define AUDIO_VOLUME_PCT  70    // codec master volume, "moderate" (~ -6.5 dB)
#define AUDIO_TONE_AMP    6500  // tone peak, ~20% FS — soft next to the voice

static I2SClass boxI2S;
static bool boxCodecOk    = false;  // ES8311 answered on I2C and took the config
static bool boxAudioReady = false;  // codec ok AND I2S channel up

struct BoxToneStep { uint16_t freq_hz; uint16_t ms; };  // freq 0 = rest
static const BoxToneStep BOX_CHIME[]   = {{880, 150}, {0, 70}, {1175, 240}};    // soft A5->D6
static const BoxToneStep BOX_CONFIRM[] = {{659, 110}, {784, 110}, {1047, 220}}; // E5-G5-C6 "all good"

// ---- playback state (one source at a time: flash clip OR tone sequence) ----
static const uint8_t*     boxClip    = nullptr;
static size_t             boxClipLen = 0, boxClipPos = 0;
static const BoxToneStep* boxSeq     = nullptr;
static uint8_t            boxSeqLen  = 0, boxSeqIdx = 0;
static uint32_t           boxStepTotal = 0, boxStepDone = 0;
static float              boxPhase   = 0;

static bool boxAudioBusy() { return boxClip != nullptr || boxSeq != nullptr; }
static void boxAudioStop() { boxClip = nullptr; boxSeq = nullptr; }

// Codec config over I2C. MUST run before lcd.init(): the ES8311 shares the
// I2C bus with the touch controller and LovyanGFX drives that bus with its
// own low-level driver — so we talk to the codec with Wire first, then
// Wire.end() releases the peripheral before LGFX claims it. The codec needs
// no further I2C traffic after this.
static bool boxAudioCodecInit() {
  Wire.begin(AUDIO_I2C_SDA, AUDIO_I2C_SCL, 100000);
  boxCodecOk = es8311_init_16k_playback(AUDIO_VOLUME_PCT);
  Wire.end();
  return boxCodecOk;
}

// I2S channel + power amp. Call after the display init picked the board.
static bool boxAudioI2SInit(int wsPin) {
  if (!boxCodecOk) return false;
  boxI2S.setPins(AUDIO_I2S_SCLK, wsPin, AUDIO_I2S_DOUT, /*din*/ -1, AUDIO_I2S_MCLK);
  if (!boxI2S.begin(I2S_MODE_STD, AUDIO_RATE_HZ, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO)) {
    return false;
  }
  pinMode(AUDIO_PA_GPIO, OUTPUT);
  digitalWrite(AUDIO_PA_GPIO, HIGH);  // speaker amp on; codec volume is the control
  boxAudioReady = true;
  return true;
}

static void boxAudioPlayVoice() {
  if (!boxAudioReady) return;
  boxSeq = nullptr;
  boxClip = VOICE_PROMPT_PCM;
  boxClipLen = VOICE_PROMPT_BYTES;
  boxClipPos = 0;
}

static void boxAudioStartSeq(const BoxToneStep* seq, uint8_t n) {
  if (!boxAudioReady || n == 0) return;
  boxClip = nullptr;
  boxSeq = seq; boxSeqLen = n; boxSeqIdx = 0;
  boxStepTotal = (uint32_t)seq[0].ms * AUDIO_RATE_HZ / 1000;
  boxStepDone = 0; boxPhase = 0;
}
static void boxAudioPlayChime()   { boxAudioStartSeq(BOX_CHIME,   sizeof(BOX_CHIME)   / sizeof(BOX_CHIME[0])); }
static void boxAudioPlayConfirm() { boxAudioStartSeq(BOX_CONFIRM, sizeof(BOX_CONFIRM) / sizeof(BOX_CONFIRM[0])); }

// Feed the next <=512 samples to the DMA. Called once per loop() pass; the
// blocking i2s write self-paces when the DMA ring (6x240 frames ~ 90 ms) is
// full, so a single call never stalls the loop for more than ~30 ms.
static void boxAudioPump() {
  if (!boxAudioReady || !boxAudioBusy()) return;
  static int16_t buf[512];  // 1 KB scratch, the only audio RAM

  if (boxClip) {  // stream the flash clip
    size_t n = boxClipLen - boxClipPos;
    if (n > sizeof(buf)) n = sizeof(buf);  // n in BYTES here
    memcpy(buf, boxClip + boxClipPos, n);
    boxClipPos += n;
    if (boxClipPos >= boxClipLen) boxClip = nullptr;
    boxI2S.write((uint8_t*)buf, n);
    return;
  }

  // synthesize the current tone step (short attack/release kills the clicks)
  const BoxToneStep& st = boxSeq[boxSeqIdx];
  uint32_t left = boxStepTotal - boxStepDone;
  size_t samples = left < 512 ? left : 512;
  float dphi = 2.0f * PI * st.freq_hz / AUDIO_RATE_HZ;
  uint32_t fade = boxStepTotal / 6 < 240 ? boxStepTotal / 6 : 240;
  if (fade == 0) fade = 1;
  for (size_t i = 0; i < samples; i++) {
    uint32_t k = boxStepDone + i;
    float env = 1.0f;
    if (k < fade)                      env = (float)k / fade;
    else if (boxStepTotal - k <= fade) env = (float)(boxStepTotal - k) / fade;
    buf[i] = st.freq_hz ? (int16_t)(sinf(boxPhase) * AUDIO_TONE_AMP * env) : 0;
    boxPhase += dphi;
    if (boxPhase > 2.0f * PI) boxPhase -= 2.0f * PI;
  }
  boxStepDone += samples;
  if (boxStepDone >= boxStepTotal) {
    if (++boxSeqIdx >= boxSeqLen) {
      boxSeq = nullptr;
    } else {
      boxStepTotal = (uint32_t)boxSeq[boxSeqIdx].ms * AUDIO_RATE_HZ / 1000;
      boxStepDone = 0; boxPhase = 0;
    }
  }
  boxI2S.write((uint8_t*)buf, samples * 2);
}
