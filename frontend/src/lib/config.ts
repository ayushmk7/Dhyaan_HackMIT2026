// The one switch (TODO D1.1): screens only ever import `api` from '@/lib/api',
// which resolves to the mock backend or the real client based on USE_MOCKS.
// Flip for a live backend:  EXPO_PUBLIC_USE_MOCKS=false EXPO_PUBLIC_API_BASE=https://<tunnel>/v1 npx expo start
export const USE_MOCKS = process.env.EXPO_PUBLIC_USE_MOCKS !== 'false';

export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE ?? 'https://dhyaan.example.com/v1';

export const WS_URL = `${API_BASE.replace(/^https/, 'wss')}/ws`;

// Client-side Claude key for the connection layer (demo only — see src/lib/ai.ts).
export const ANTHROPIC_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';
