// Dhyaan design tokens. The single source of color/space/type truth.
// Palette from the bird: slate wing, rust back. Rust means "alert" — nothing else.

export const palette = {
  // Neutral chrome, transcribed from the Apple Health design sheet: cool gray
  // ground, white cards, black text. Warmth was decoration; decoration is out.
  paper: '#F2F2F7',   // iOS systemGroupedBackground
  raised: '#FFFFFF',
  ink: '#1C1C1E',
  inkMuted: '#848489',
  line: '#E5E5EA',    // in-card separators only — never around cards

  // Brand: one confident, saturated green (care = growth = "she's okay").
  // Washed-out palettes are the intern-firing offense; commit.
  // Chrome carries NO hue. Interactive = ink; affordance comes from form
  // (filled button, chevron, weight), never from color. Every hue in the app
  // has exactly one meaning: moss=OK, rust=alarm, hue.*=data category.
  slate: '#1C1C1E',      // interactive ink (name is historical)
  slateDeep: '#000000',
  slateWash: '#E9E9EE',

  moss: '#2E9968',
  mossWash: '#DFF4E8',
  ochre: '#E08A00',
  ochreWash: '#FCEED2',
  rust: '#D2401E',
  rustDeep: '#96290C',
  rustWash: '#FBE5DC',

  // Camera lane: one new wash for "Dhyaan saw this just now". Not a status
  // colour — it never means alert, and rust still owns that alone.
  amber: '#9A6B1E',
  amberWash: '#F7EFDC',

  night: '#10161D',
  nightRaised: '#1A232D',
  nightInk: '#EAE5D6',
  nightMuted: '#8B93A1',
  nightLine: '#26313D',
} as const;

export type ResidentState = 'ok' | 'learning' | 'attention' | 'alerting' | 'offline';

export const stateColor: Record<ResidentState, { fg: string; wash: string; word: string }> = {
  ok: { fg: palette.moss, wash: palette.mossWash, word: 'OK' },
  learning: { fg: palette.inkMuted, wash: palette.line, word: 'Learning her routine' },
  attention: { fg: palette.ochre, wash: palette.ochreWash, word: 'Worth a look' },
  alerting: { fg: palette.rust, wash: palette.rustWash, word: 'Needs someone now' },
  offline: { fg: palette.inkMuted, wash: palette.line, word: 'Band offline' },
};

// Category hues, transcribed from the Apple Health design sheet. Color is
// taxonomy (a tiny glyph + label tint per data kind), never decoration.
export const hue = {
  activity: '#EC6330', // walks, movement
  nutrition: '#67CE67', // meals
  sleep: '#81CFFA',    // night
  location: '#3A82F7', // rooms, out of view
  heart: '#EB4B62',    // falls, safety rows (chrome alerts stay rust)
  social: '#F1A33B',   // visitors, calls, messages
  presence: '#B25FEA', // camera lane
  mind: '#87E3E1',
} as const;

// Saturated, friendly zone hues — the day bar is a hero visual, not wallpaper.
export const zoneColor: Record<string, string> = {
  bedroom: '#6E8FD0',
  bathroom: '#B77FC4',
  kitchen: '#EFA93F',
  living_room: '#63B07C',
  dining_room: '#EFA93F',
  hallway: '#CBBF9F',
  outside: '#3E9BD6',
  unknown: '#DAD3C2',
};

export const sp = (n: number) => n * 4;

export const radius = { card: 16, pill: 999, tile: 16, badge: 8 } as const;

// One soft elevation for every white card — never borders.
export const cardShadow = {
  shadowColor: '#26221B',
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 3 },
} as const;

export const font = {
  // The serif survives for exactly one job: Eleanor's own quoted words
  // (content, never chrome). Loaded weights stay available for that.
  light: 'Fraunces_300Light',
  label: 'Fraunces_600SemiBold',
  display: 'Fraunces_600SemiBold',
  displayBold: 'Fraunces_700Bold',
  black: 'Fraunces_900Black',
  displayItalic: 'Fraunces_400Regular_Italic',
  serif: 'Fraunces_400Regular',
} as const;

// SF everywhere. Screen titles belong to the native navigation bar, not to us.
// The serif exists for exactly one thing: Eleanor's own quoted words (content,
// never chrome) — an app whose chrome speaks in a display serif is a website.
export const type = {
  // `hero` kept as a compat alias for the camera-lane screens; SF like all chrome.
  hero: { fontSize: 34, lineHeight: 40, fontWeight: '800' as const, letterSpacing: -0.8 },
  display: { fontSize: 30, lineHeight: 36, fontWeight: '800' as const, letterSpacing: -0.6 }, // alert headline only
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const, letterSpacing: -0.4 },
  heading: { fontSize: 20, lineHeight: 25, fontWeight: '700' as const, letterSpacing: -0.4 }, // in-screen section (Health-style)
  stat: { fontSize: 22, lineHeight: 26, fontWeight: '700' as const, letterSpacing: -0.3 },
  body: { fontSize: 17, lineHeight: 24 }, // iOS body default (HIG)
  label: { fontSize: 15, lineHeight: 20, fontWeight: '600' as const },
  caption: { fontSize: 13, lineHeight: 18 },
} as const;
