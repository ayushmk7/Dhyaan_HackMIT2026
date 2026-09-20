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

// The HEAD backend has no authentication, but the backend PROCESS serving the
// demo predates that change and still 401s any request without this shared
// key (and closes a websocket without the token param). Sending both is
// harmless against a no-auth server — an unused header and an unused query
// param — and required against the one that is actually running, so the app
// sends them unconditionally rather than betting the demo on which build is
// behind port 8000.
export const API_KEY = process.env.EXPO_PUBLIC_API_KEY ?? 'dev-key-change-me';
const wsBase = API_BASE.replace(/^http/, 'ws'); // http->ws, https->wss
export const WS_URL = `${wsBase}/live?token=${encodeURIComponent(API_KEY)}`;

// Client-side Claude key for the connection layer (demo only — see src/lib/ai.ts).
export const ANTHROPIC_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';
export const OPENAI_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? '';
export const OPENAI_MODEL = process.env.EXPO_PUBLIC_OPENAI_MODEL ?? 'gpt-5-mini';
