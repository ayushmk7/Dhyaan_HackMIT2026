#!/usr/bin/env bash
# One-command beacon flash. Usage:
#   ./flash.sh <port> <minor> [box]
#   ./flash.sh /dev/cu.usbmodem1101 2          # DevKitC, bathroom
#   ./flash.sh /dev/cu.usbmodem1101 1 box      # S3-BOX, kitchen
# Minors: 1=kitchen 2=bathroom 3=bedroom 4=front_door
set -euo pipefail
PORT="${1:?port, e.g. /dev/cu.usbmodem1101 (ls /dev/cu.usb*)}"
MINOR="${2:?minor 1-4}"
FQBN="esp32:esp32:esp32s3"
[[ "${3:-}" == "box" ]] && FQBN="esp32:esp32:esp32s3box"

DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD="$DIR/build-$MINOR"
SKETCH="$BUILD/beacon"
mkdir -p "$SKETCH"
sed "s/ROOM_MINOR = 1;/ROOM_MINOR = $MINOR;/" "$DIR/beacon.ino" > "$SKETCH/beacon.ino"

arduino-cli compile --fqbn "$FQBN" "$SKETCH"
arduino-cli upload -p "$PORT" --fqbn "$FQBN" "$SKETCH"
echo "Flashed minor=$MINOR on $FQBN. Label the board NOW."
