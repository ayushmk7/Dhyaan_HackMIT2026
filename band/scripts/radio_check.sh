#!/usr/bin/env bash
# radio_check.sh — HARDWARE_SPEC §8.2
# Run on the UNO Q Debian side (SSH or App Lab terminal) at hour 1, not hour 12.
set -euo pipefail

echo "=== Dhyaan radio check ==="
fail=0

run() {
  echo ""
  echo "\$ $*"
  if ! "$@"; then
    echo "FAIL: $*"
    fail=1
  fi
}

run bluetoothctl --version || true

if command -v hciconfig >/dev/null 2>&1; then
  run hciconfig -a
else
  echo "hciconfig not found — trying bluetoothctl show"
  run bluetoothctl show || true
fi

if command -v btmgmt >/dev/null 2>&1; then
  echo ""
  echo "\$ sudo btmgmt info"
  sudo btmgmt info || { echo "FAIL: btmgmt info"; fail=1; }
  echo ""
  echo "\$ sudo btmgmt find -l  (10 s LE discovery)"
  timeout 12 sudo btmgmt find -l || true
else
  echo "btmgmt not installed"
  fail=1
fi

echo ""
echo "\$ python3 -c 'import bleak; print(bleak.__version__)'"
if ! python3 -c "import bleak; print(bleak.__version__)"; then
  echo "bleak missing — installing"
  pip3 install --user bleak || fail=1
fi

if command -v iw >/dev/null 2>&1; then
  echo ""
  echo "\$ iw dev"
  iw dev || true
  echo ""
  echo "\$ iw dev wlan0 scan | head -20  (may need sudo)"
  sudo iw dev wlan0 scan 2>/dev/null | head -20 || iwdev_scan_hint=1
fi

echo ""
if [[ "$fail" -eq 0 ]]; then
  echo "PASS: radio stack looks alive. Expect hci0 UP RUNNING with a BD address."
  echo "Next: join phone hotspot (prefer 5 GHz), then Blink in App Lab."
  exit 0
fi

echo "FAIL: radio check incomplete."
echo "Recovery: sudo systemctl status bluetooth; sudo rfkill list; sudo rfkill unblock bluetooth; dmesg | grep -i blue"
echo "If still dead by hour 6 → HARDWARE_SPEC §12.3 Tier 1b (spare ESP32 or Mac scanner)."
exit 1
