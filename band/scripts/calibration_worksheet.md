# IMU calibration worksheet (HARDWARE_SPEC §7.2 / E9)

Run once after drops work. Write results into `fallband/config.json` — **do not
edit sketch literals after integration freeze.**

## §7.2 step 0 — static bias/gain (six orientations)

| Axis | +up (g) | −up (g) | bias=(up+down)/2 | gain=(up−down)/2 |
|---|---|---|---|---|
| X | | | | |
| Y | | | | |
| Z | | | | |

Resting `|a|` must be **1.00 ± 0.02 g** in every orientation after applying bias/gain.
If not → I²C/scaling bug (E4.1), not calibration.

Push via config:

```json
"imu": {
  "accel_bias": [bx, by, bz],
  "accel_gain": [gx, gy, gz]
}
```

## Negatives (N_max) and drops (F_min)

| # | Action | peak_g | confirmed? |
|---|---|---|---|
| N1–N10 | sit / slam / clap / table / walk / stand | | must be false |
| F1–F10 | 0.5 m firm cushion | | must be true |

`F_min` = softest confirmed drop peak_g → `calibration.f_min`
`IMPACT_G_SOFT = N_max + 0.45*(F_min - N_max)`
`IMPACT_G_AFTER_FF = IMPACT_G_SOFT - 0.7`
**Leave `ff_threshold_g` at 0.40** (D-008).

## Verify

5 fresh negatives + 5 fresh drops → **5/5 detected, 0/5 false**. Re-fit once max.
