import Constants from 'expo-constants';

// The one switch (TODO D1.1): screens only ever import `api` from '@/lib/api',
// which resolves to the mock backend or the real client based on USE_MOCKS.
//
// A phone (Expo Go / a dev build) cannot reach `localhost` — that resolves to
// the phone itself, not your Mac. Run `make ip` in backend/ to print your
// Mac's LAN IP, then start Expo with:
//   EXPO_PUBLIC_USE_MOCKS=false EXPO_PUBLIC_API_BASE=http://<that-ip>:8000/v1 \
//   npx expo start
// The iOS Simulator (not a phone) can still use `localhost`, which is why
// that's the default below.
// Defaults to the REAL backend: `./dev.sh` brings mongo, ollama and the API up
// in one command, so "connected" is the normal state of this repo now. Set
// EXPO_PUBLIC_USE_MOCKS=true to demo with nothing running behind the app.
export const USE_MOCKS = process.env.EXPO_PUBLIC_USE_MOCKS === 'true';

// Real backend mounts every route under /v1 (see backend/app/main.py) — keep
// that suffix here so http.ts's paths ('/residents', '/alerts', ...) don't
// each have to repeat it.
//
// The default is derived, not hardcoded. Expo already knows the address this
// bundle was served from (`hostUri`, e.g. "10.189.77.142:8081"), which is the
// dev machine — so reusing its host with the API's port means a phone in Expo
// Go and the iOS Simulator both work with no environment variable at all.
// Hardcoding `localhost` was the old default and it is wrong on a phone:
// localhost there is the phone, so every request hung until it timed out.
// EXPO_PUBLIC_API_BASE still wins when it is set.
function devHost(): string | null {
  const uri = Constants.expoConfig?.hostUri
    ?? (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;
  const host = uri?.split(':')[0]?.trim();
  return host ? host : null;
}

export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE
  ?? (devHost() ? `http://${devHost()}:8000/v1` : 'http://localhost:8000/v1');

// No API key, no login, no token. The backend has no authentication at all
// (see the notice at the top of backend/app/main.py): every request and the
// websocket go out bare. Demo build for one LAN.
const wsBase = API_BASE.replace(/^http/, 'ws'); // http->ws, https->wss
export const WS_URL = `${wsBase}/live`;

// Client-side Claude key for the connection layer (demo only — see src/lib/ai.ts).
export const ANTHROPIC_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';
