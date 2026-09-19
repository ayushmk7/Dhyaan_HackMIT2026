#!/bin/bash
# B8.1 + B9.2 — synthesize the five classification-branch caller clips (mulaw/8k mono
# WAV, the exact format Twilio Media Streams carry) plus the B9.2 fallback agent clip.
# macOS only (`say` + `afconvert`). Teammates: the committed WAVs in test_audio/ are
# the artifact; you don't need to re-run this.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p test_audio

clip() { # name, text, voice
  local name="$1" text="$2" voice="${3:-Samantha}"
  say -v "$voice" -o "test_audio/_$name.aiff" "$text"
  afconvert -f WAVE -d ulaw@8000 -c 1 "test_audio/_$name.aiff" "test_audio/$name.wav"
  rm "test_audio/_$name.aiff"
}

clip fine         "Oh, I'm fine dear. The band just slipped off my wrist. False alarm."
clip fell_but_up  "Well, I did take a little tumble, but I'm back up now. Nothing hurts."
clip help         "Help. I can't get up. My hip hurts. Please help me."
clip confused     "The garden... where are my glasses... who is this? The kettle is on."
# silence: 15 seconds of mulaw silence (0xFF). Python's wave module can't write
# ulaw, so build the RIFF header by hand (format code 7 = mulaw).
python3 - <<'PY'
import struct
data = b"\xff" * 8000 * 15
hdr = b"RIFF" + struct.pack("<I", 50 + len(data)) + b"WAVE"
hdr += b"fmt " + struct.pack("<IHHIIHHH", 18, 7, 1, 8000, 8000, 1, 8, 0)
hdr += b"fact" + struct.pack("<II", 4, len(data))
hdr += b"data" + struct.pack("<I", len(data))
open("test_audio/silence.wav", "wb").write(hdr + data)
PY

# B9.2 — pre-recorded fallback "agent" clip, playable on cue if Twilio AND Deepgram die.
say -v Samantha -o test_audio/_fb.aiff \
  "Hi Eleanor, this is Dhyaan calling because your band thought you might have fallen. Are you okay? ... I'm not hearing anything, so I'm calling Priya now."
afconvert -f WAVE -d LEI16 -c 1 test_audio/_fb.aiff test_audio/fallback_agent.wav
rm test_audio/_fb.aiff

echo "--- verify ---"
for f in test_audio/*.wav; do afinfo "$f" | grep -E "^File:|format:" ; done
