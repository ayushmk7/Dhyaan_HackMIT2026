# Hyperframes Composition Brief: Dhyaan

## Objective
Create a short, restrained launch-style film for Dhyaan, an eldercare sensing system built at HackMIT 2026.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 24.2s

## Source Material
- Project root: `/Users/ayush/Downloads/HackMIT`
- Primary files read: `frontend/DESIGN.md`, `frontend/src/theme/tokens.ts`, `frontend/src/lib/copy/family.ts`, `frontend/src/app/alert/[id].tsx`, `frontend/src/app/(family)/camera/index.tsx`, `backend/vision/__init__.py`, `backend/app/location.py`, `beacons/beacon.ino`, `README.md`
- Product name: Dhyaan
- Tagline: "Eldercare sensing that phones the grandparent first, and the family second."
- Key UI to recreate: the alert takeover (light-blue plate, heavy ink rule, navy plate button) and the camera console pane (night-blue ground, REC pill, PERSON 01 box, uppercase mono telemetry strip)

### Copy that must appear verbatim
- `Eleanor may have fallen.`
- `Possible fall`
- `Calling Eleanor now…`
- `Calling Priya · Marcus is next if she doesn't pick up`
- `I've got her`
- `A fall always calls. Nothing else ever does.`
- `Eleanor ate lunch at the table, 12:31–12:48.`
- `Meals` · `Minutes seen` (the Today screen's stat tiles)
- Machine readouts, uppercase mono: `REC`, `PERSON 01`, `FPS`, `MODEL`, `qwen2.5vl:3b`, `MINOR 1 · KITCHEN`, `MINOR 2 · BATHROOM`, `COMMITTED`, `IMPACT`, `AGREE`, `on_floor`, `fall_suspected`

### Claims that are true and may appear
208 Hz · ±16 g on-band cascade · 30-second cancel window · qwen2.5vl:3b at 0.69 s per call · YOLO-World 9–11.5 ms · MediaPipe pose ~13.8 ms · room-level (not metre-level) localization · no frame is ever written to disk, enforced by an AST test · 263 backend tests.

**Do not state or imply** that the text LLM is local. Anthropic's Claude is used for written narratives and family Q&A and runs in the cloud; it is not part of this video. Nothing on screen may claim otherwise.

## Creative Direction
- Tone preset: polished
- Creative direction: quiet premium medical-device film, built from the product's own screens
- Interpretation: six scenes, long settled holds, soft 0.6s crossfades. No zoom punches, no strobing, no comedy, no confetti. Motion comes from data behaving (RSSI ticking, chips committing, a countdown ring, a posture flag flipping), not from cuts competing.
- Angle: the video is the product's chain of custody — radio to room, camera to sentence, IMU to impact, camera to confirmation, phone to *her* first. Two independent sensors agree before a single human is called, and the thing watching a 79-year-old never sends a pixel off the laptop.
- Hook: the wordmark at full scale with the inversion stated in one line.
- Outro: the alert takeover, then the consent-screen line "A fall always calls. Nothing else ever does." landing dry, in silence.
- Avoid: generic SaaS language, abstract filler, dots on floor plans (the product explicitly refuses to draw one), any redesign of the product's palette, red alarm colours (this product's alarm is depth on the blue ramp, never a red).

## Visual Identity
- Background (paper): `#F3F5F9`
- Raised / card: `#FFFFFF`
- Ink (primary text): `#0B1220`
- Muted (metadata only): `#596371`
- Hairline: `#E2E6EE`
- Accent (the one blue): `#1F56C2`; pressed `#173F91`; wash `#EEF3FC`
- Focal plate: `#B9CDF3` · alarm plate (takeover ground): `#8AAEEA` · deep plate `#0F2C66`
- Night ground (camera console): `#0F2C66`-family deep blue with near-white ink. Never black.
- Display font: Fraunces (Google Fonts) — the wordmark and the one quoted human sentence only
- Body font: system SF stack / Inter fallback
- Machine readouts: a mono face, uppercase, letter-spaced. This voice marks MACHINE origin only and must never be applied to a human sentence.
- Colour law from the source: there are three colours — blue, white, black and the greys between. Blue is the only accent and means "Dhyaan is pointing at something". OK has no colour. Alarm is depth on the blue ramp, not a hue.

## Storyboard
Use `brag-output/brag-plan.md` as the creative contract.

1. Wordmark — 3.5s — Dhyaan at full scale, ink rule drawing under it, the tagline settling.
2. Which room, all day — 4.5s — two ESP32 anchors pulsing adverts, RSSI ticking, three room chips arriving one by one, `BATHROOM 0.87` committing. Caption: "Room level. Never a dot on a map."
3. The camera writes sentences — 4.5s — camera console pane with telemetry, dissolving into the sentence card "Eleanor ate lunch at the table, 12:31–12:48." plus `Meals` / `Minutes seen` tiles and the line "The model runs on this laptop. No frame is ever written to disk."
4. The fall — 3.5s — 208 Hz trace spiking, one restrained ink flash, `IMPACT` marker, countdown ring 30 → 24, "Thirty seconds to cancel. Then Dhyaan calls her."
5. Two sensors agree — 4.0s — BAND plate and CAMERA plate; posture flips `seated → unclear → on_floor`; plates lock under an `AGREE` rule. Caption: "The band opens the alert. The camera is the second opinion."
6. She is called first — 4.2s — the alert takeover with the verbatim headline and ladder lines, then the wordmark and the closing consent line, dry.

## Audio
- Audio role: warm restrained bed with sparse motion-matched accents
- Audio arc: low warm bed throughout; opens slightly as the sentence card lands; ducks fractionally under the impact; fades to zero over the final 1.2s so the closing line reads in silence.
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`
- Music treatment: start 0.0s, volume ~0.28, fade-in 0.8s, fade-out over the last 1.2s.
- Music cue guidance: bundled preset at `~/.claude/skills/brag/assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json` (109.96 BPM). Lock three strong cues: sentence card ~8.74s, two-sensor lock ~17.47s, takeover headline ~22.93s. Beat grid for sequential reveals: room chips 4.39 / 5.34 / 6.00; stat tiles 10.93 / 12.02.
- Audio-reactive treatment: subtle — RMS may breathe the accent glow behind the wordmark and the presence of the sentence card. No waveforms, no equalizer bars, no text scaling.
- Audio-coupled moments:
  - Room chips arriving one by one — soft interface tick each, on the beat grid
  - The fall spike — one dry low impact, landing on the spike frame
  - The countdown ring — a quiet repeating tick, not a game sound
  - The two plates locking — one short announcement cue at 17.47s
  - The takeover landing — one quiet confirm; then silence under the final line
- SFX selection guidance: use `~/.claude/skills/brag/assets/sfx/sfx-analysis.md`; prefer low high-frequency-risk files. Nothing bright, comedic or arcade-like anywhere in this piece — it depicts a person falling.
- Exact SFX choice: yours, after the animation exists.
- Audio files: copy the chosen music and SFX into `brag-output/composition/assets/`.

## Hyperframes Instructions
Use the current `hyperframes` skill and CLI workflow; prefer native Hyperframes conventions over anything in this brief.

Requirements:
- Recreate at least the camera console and the alert takeover from the real app — real copy, real palette.
- Every text element gets its reading floor: short label ~0.8s settled, a sentence ~0.3s per word.
- Keep total duration 24–25s.
- Run `npx hyperframes lint`, `validate`, and `inspect`; fix all errors and any text overflow.
- Render `--quality high` to `../brag.mp4`.
