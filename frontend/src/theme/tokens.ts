// Dhyaan design tokens. The single source of color/space/type truth.
// Palette from the bird: slate wing, rust back. Rust means "alert" — nothing else.

export const palette = {
  paper: '#F6F2E9',
  raised: '#FDFBF5',
  ink: '#221F19',
  inkMuted: '#6F6858',
  line: '#E4DCCA',

  slate: '#46607A',
  slateDeep: '#2E4257',
  slateWash: '#E7ECF0',

  moss: '#5F7A46',
  mossWash: '#E9EEDF',
  ochre: '#B07E20',
  ochreWash: '#F4EAD2',
  rust: '#C0431F',
  rustDeep: '#8F2F14',
  rustWash: '#F6E2D9',

  night: '#10161D',
  nightRaised: '#1A232D',
  nightInk: '#EAE5D6',
  nightMuted: '#8B93A1',
  nightLine: '#26313D',
} as const;

export type ResidentState = 'ok' | 'learning' | 'attention' | 'alerting' | 'offline';

export const stateColor: Record<ResidentState, { fg: string; wash: string; word: string }> = {
  ok: { fg: palette.moss, wash: palette.mossWash, word: 'OK' },
  learning: { fg: palette.slate, wash: palette.slateWash, word: 'Learning her routine' },
  attention: { fg: palette.ochre, wash: palette.ochreWash, word: 'Worth a look' },
  alerting: { fg: palette.rust, wash: palette.rustWash, word: 'Needs someone now' },
  offline: { fg: palette.inkMuted, wash: palette.line, word: 'Band offline' },
};

// Calm, distinguishable zone hues for the room-time bar (not status colors).
export const zoneColor: Record<string, string> = {
  bedroom: '#7E93A8',
  bathroom: '#A88BA0',
  kitchen: '#C2A15B',
  living_room: '#8FA37E',
  dining_room: '#C2A15B',
  hallway: '#B5AC97',
  outside: '#6C87B0',
  unknown: '#D8D1BF',
};

export const sp = (n: number) => n * 4;

export const radius = { card: 14, pill: 999, tile: 10 } as const;

export const font = {
  display: 'Fraunces_600SemiBold',
  displayBold: 'Fraunces_700Bold',
  black: 'Fraunces_900Black',
  displayItalic: 'Fraunces_400Regular_Italic',
  serif: 'Fraunces_400Regular',
} as const;

export const type = {
  display: { fontFamily: font.black, fontSize: 34, lineHeight: 40, letterSpacing: -0.5 },
  title: { fontFamily: font.display, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  stat: { fontFamily: font.black, fontSize: 28, lineHeight: 34 },
  body: { fontSize: 16, lineHeight: 23 },
  label: { fontSize: 14, lineHeight: 19, fontWeight: '600' as const },
  caption: { fontSize: 13, lineHeight: 18 },
} as const;
