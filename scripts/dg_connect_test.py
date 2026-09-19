#!/usr/bin/env python3
"""B0.6 — confirm the Deepgram Voice Agent socket auth header shape.

Expected output: a JSON frame with "type": "Welcome". A 401/403 means try
`Bearer` instead of `Token` before assuming the key is wrong.
"""
import asyncio
import os
import sys

import websockets


async def main() -> None:
    key = os.environ.get("DEEPGRAM_API_KEY")
    if not key:
        sys.exit("DEEPGRAM_API_KEY is not set. Get a key at console.deepgram.com and export it first.")
    async with websockets.connect(
        "wss://agent.deepgram.com/v1/agent/converse",
        additional_headers={"Authorization": f"Token {key}"},
    ) as ws:
        print(await ws.recv())  # expect {"type":"Welcome",...}


if __name__ == "__main__":
    asyncio.run(main())
