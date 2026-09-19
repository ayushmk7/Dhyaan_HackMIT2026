# Dhyaan — React Native app

Family + staff app for the Dhyaan elder-care sensing platform (see `../TECHNICAL_PRD.md` §10).
Expo SDK 57 · RN 0.86 · expo-router · Zustand (websocket-owned state) · TanStack Query (server reads).

## Run it

```sh
npm install
npx expo start        # press i for the iOS simulator
```

The app currently runs against an **in-memory mock backend** (`src/lib/mock/`) that
implements the §10.5 API contract, including a real-time fall escalation ladder
(§4.2 timings, compressed 6×). When the Python backend exists, set `MODE = 'http'`
and `BASE_URL` in `src/lib/api.ts` — screens and hooks don't change.

## The demo

- **Family**: Welcome → "Explore the family demo" → Home shows Eleanor's status,
  live room, ADL tiles, room-time bar. Settings → "Rehearse a fall alert" runs the
  full ladder: takeover screen, live call transcript, "I've got her" halts it.
- **Staff**: "Explore the staff demo" → Triage (ranked, not a grid), Floor, night
  Rounds, per-resident 14-day baselines. "Simulate a fall in 214" from Triage.
- **Ask**: chat answers are retrieved from the mock event store with tappable
  citations that deep-link into the timeline.

## Structure

```
src/
  app/           expo-router routes (§10.2): onboard/, (family)/, (staff)/, alert/[id]
  components/    ui.tsx (primitives) + viz.tsx (event rows, room bar, ladder, sparklines)
  lib/           types, api facade, TanStack hooks, format helpers, mock backend
  store/         live.ts (websocket state) + session.ts (role/onboarding)
  theme/         tokens.ts — the single source of color/type/spacing truth
```

Design rules live in `DESIGN.md`. Short version: serif sentences for the human
statements, rust only for alerts, no cards-for-everything, evidence is always a
sentence and never an image.

## EAS dev build (TODO D1.3 — human steps)

Push notifications need a dev build, not Expo Go. One-time setup (needs an Apple
developer account + Expo account):

```sh
npx eas login
npx eas init          # writes the real projectId into app.json extra.eas
npx eas build --profile development --platform ios
```

iOS builds take 15–25 min — kick this off at hour 0, not hour 20. After install,
Settings → "Register this phone for push" → "Send a test fall push" proves the
end-to-end push path with no backend (TODO D10.3).
