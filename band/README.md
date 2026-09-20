# Band (Utsav)

Arduino UNO Q forearm band + ESP32 room beacons.

| Path | What |
|---|---|
| [`fallband/`](fallband/) | App Lab app: MCU sketch + Python uplink |
| [`bringup/`](bringup/) | Temporary I²C scan sketch |
| [`scripts/`](scripts/) | Radio check + venue bring-up checklist |
| [`tools/rssi_monitor.py`](tools/rssi_monitor.py) | Live beacon RSSI (Mac or board) |
| [`tests/`](tests/) | Detector + payload fixture tests |
| [`../beacons/`](../beacons/) | ESP32-S3 iBeacon firmware |

```bash
make -C band test          # detector + payload shapes
```

Venue steps: [`scripts/bringup.md`](scripts/bringup.md).
Backend contract: [`../docs/HARDWARE_INTEGRATION.md`](../docs/HARDWARE_INTEGRATION.md).
