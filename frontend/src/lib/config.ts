// The one switch (TODO D1.1): screens only ever import `api` from '@/lib/api',
// which resolves to the mock backend or the real client based on USE_MOCKS.
//
// A phone (Expo Go / a dev build) cannot reach `localhost` — that resolves to
// the phone itself, not your Mac. Run `make ip` in backend/ to print your
// Mac's LAN IP, then start Expo with:
//   EXPO_PUBLIC_USE_MOCKS=false EXPO_PUBLIC_API_BASE=http://<that-ip>:8000/v1 \
//   EXPO_PUBLIC_API_KEY=dev-key-change-me npx expo start
// The iOS Simulator (not a phone) can still use `localhost`, which is why
// that's the default below.
// Defaults to the REAL backend: `./dev.sh` brings mongo, ollama and the API up
// in one command, so "connected" is the normal state of this repo now. Set
// EXPO_PUBLIC_USE_MOCKS=true to demo with nothing running behind the app.
export const USE_MOCKS = process.env.EXPO_PUBLIC_USE_MOCKS === 'true';

// Real backend mounts every route under /v1 (see backend/app/main.py) — keep
// that suffix here so http.ts's paths ('/residents', '/alerts', ...) don't
// each have to repeat it.
export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE ?? 'http://localhost:8000/v1';

// ponytail: one static shared-secret key (backend/app/config.py's API_KEY),
// not a per-user JWT — the PRD's §10.5 JWT claims don't exist server-side.
// Fine for a demo on one LAN; upgrade to per-user auth the day there's a
// second tenant or this leaves the LAN.
export const API_KEY = process.env.EXPO_PUBLIC_API_KEY ?? 'dev-key-change-me';

// WS /v1/live authenticates via a `token` query param (a websocket upgrade
// request can't carry a custom header) — see backend/app/routers/live.py.
// Baking the token in here means even a naive `new WebSocket(WS_URL)` call
// site (no header support needed) still authenticates.
const wsBase = API_BASE.replace(/^http/, 'ws'); // http->ws, https->wss
export const WS_URL = `${wsBase}/live?token=${encodeURIComponent(API_KEY)}`;

// Client-side Claude key for the connection layer (demo only — see src/lib/ai.ts).
export const ANTHROPIC_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';
