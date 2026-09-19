#!/usr/bin/env python3
"""B8.2 — the prompt-iteration loop: stream a recorded mulaw/8k WAV straight into a
real Deepgram Voice Agent socket (same Settings as the bridge) and print every
ConversationText and FunctionCallRequest. No phone, no Twilio.

Usage:
  DEEPGRAM_API_KEY=... python scripts/replay_to_agent.py test_audio/help.wav [role]

Run against all clips (B8.3):
  for f in test_audio/{fine,fell_but_up,help,confused,silence}.wav; do
    python scripts/replay_to_agent.py "$f"; done
"""
import asyncio
import json
import os
import struct
import sys

import websockets

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dhyaan.voice.settings import build_settings  # noqa: E402

DG_URL = "wss://agent.deepgram.com/v1/agent/converse"


def mulaw_payload(wav_path: str) -> bytes:
    """Return the raw mulaw bytes of a WAV, verifying mulaw(7)/mono/8000 Hz."""
    blob = open(wav_path, "rb").read()
    assert blob[:4] == b"RIFF" and blob[8:12] == b"WAVE", f"{wav_path}: not a WAV"
    pos, fmt = 12, None
    while pos + 8 <= len(blob):
        cid, size = blob[pos:pos + 4], struct.unpack("<I", blob[pos + 4:pos + 8])[0]
        if cid == b"fmt ":
            fmt = struct.unpack("<HHI", blob[pos + 8:pos + 16])  # code, channels, rate
        elif cid == b"data":
            assert fmt == (7, 1, 8000), \
                f"{wav_path} must be mulaw mono 8000 Hz, got {fmt} (see scripts/make_test_audio.sh)"
            return blob[pos + 8:pos + 8 + size]
        pos += 8 + size + (size & 1)
    raise AssertionError(f"{wav_path}: no data chunk")


async def replay(wav_path: str, role: str = "resident") -> None:
    key = os.environ.get("DEEPGRAM_API_KEY")
    if not key:
        sys.exit("DEEPGRAM_API_KEY is not set. Export it first (see dhyaan/voice/README.md B0).")

    async with websockets.connect(DG_URL, additional_headers={"Authorization": f"Token {key}"}) as dg:
        await dg.send(json.dumps(build_settings({"role": role, "alert_id": "alr_replay",
                                                 "call_id": "cal_replay"})))
        # wait for SettingsApplied before sending audio, same as the bridge
        while True:
            first = json.loads(await dg.recv())
            print(first)
            if first.get("type") == "SettingsApplied":
                break

        async def sender() -> None:
            # Python's wave module can't read ulaw WAVs; parse the chunks directly.
            audio = mulaw_payload(wav_path)
            for i in range(0, len(audio), 160):  # 160 bytes = ~20 ms @ 8000 Hz mulaw
                await dg.send(audio[i:i + 160])
                await asyncio.sleep(0.02)  # real-time pacing
            # trail 10 s of mulaw silence (0xFF) so the agent can respond + decide
            for _ in range(500):
                await dg.send(b"\xff" * 160)
                await asyncio.sleep(0.02)

        async def receiver() -> None:
            async for msg in dg:
                if isinstance(msg, bytes):
                    continue  # agent TTS audio — irrelevant here
                e = json.loads(msg)
                if e.get("type") in ("ConversationText", "FunctionCallRequest", "Error", "Warning"):
                    print(e)
                if e.get("type") == "FunctionCallRequest":
                    for fn in e.get("functions", []):
                        await dg.send(json.dumps({"type": "FunctionCallResponse", "id": fn.get("id"),
                                                  "name": fn["name"], "content": '{"ok": true}'}))

        await asyncio.gather(sender(), receiver())


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    asyncio.run(replay(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "resident"))
