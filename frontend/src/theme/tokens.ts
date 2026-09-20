// Dhyaan design tokens. The single source of color/space/type/depth truth.
// Palette from the bird: slate wing, rust back. Rust means "alert" — nothing else.

import { Platform, TextStyle } from 'react-native';

export const palette = {
  // Neutral chrome, transcribed from the Apple Health design sheet: cool gray
  // ground, white cards, black text. Warmth was decoration; decoration is out.
  paper: '#F2F2F7',   // iOS systemGroupedBackground
  raised: '#FFFFFF',
  ink: '#1C1C1E',
  inkMuted: '#848489',
  line: '#E5E5EA',    // in-card separators only — never around cards
  // iOS tertiary label: the passive chevron, a placeholder, the unknown badge.
  // The one grey lighter than inkMuted; there is no fourth.
  inkFaint: '#C7C7CC',

  // Brand: one confident, saturated green (care = growth = "she's okay").
  // Washed-out palettes are the intern-firing offense; commit.
  // Chrome carries NO hue. Interactive = ink; affordance comes from form
  // (filled button, chevron, weight), never from color. Every hue in the app
  // has exactly one meaning: moss=OK, rust=alarm, hue.*=data category.
  slate: '#1C1C1E',      // interactive ink (name is historical)
  slateDeep: '#000000',
  slateWash: '#E9E9EE',
  slateWashDeep: '#DADAE0',  // slateWash, pressed. Grey, not blue: chrome has no hue.

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
  amberGhost: 'rgba(154,107,30,0.06)', // the person-box fill on the camera pane

  night: '#10161D',
  nightRaised: '#1A232D',
  nightInk: '#EAE5D6',
  nightMuted: '#8B93A1',
  nightLine: '#26313D',
  nightScrim: 'rgba(16,22,29,0.82)', // burned-in caption bar over the camera pane
} as const;

// Text and rules on a dark plate (a Slab, the night ground, the alarm takeover).
// Four alphas and no more: the app had 0.55, 0.6, 0.72, 0.75, 0.8 and 0.85.
export const onDark = {
  ink: '#FFFFFF',
  soft: 'rgba(255,255,255,0.78)',   // a caption, a sub-line
  muted: 'rgba(255,255,255,0.58)',  // a DataLabel's label, metadata
  rule: 'rgba(255,255,255,0.55)',   // a hard rule
  line: 'rgba(255,255,255,0.28)',   // a hairline, an outline
  wash: 'rgba(255,255,255,0.15)',   // a quiet fill (icon button, pulse core)
  pressed: 'rgba(255,255,255,0.12)',
} as const;

// Text on the cream plate (`Slab tone="cream"`, the Rounds counter).
export const onCream = {
  ink: palette.night,
  muted: 'rgba(16,22,29,0.6)',
  rule: 'rgba(16,22,29,0.5)',
  wash: 'rgba(16,22,29,0.08)',
  pressed: 'rgba(16,22,29,0.12)',
} as const;

// The gradient monograms. Brand-adjacent, so they live here and not in Avatar.
export const avatarGradient = {
  green: ['#35B27A', '#1E7A5A'],
  amber: ['#F2B24C', '#DD8500'],
  blue: ['#6FA6E8', '#3D6FBF'],
} as const;

// The atmospheric ground's ramps and blooms. Read by <Wash> only.
export const washTone = {
  day: { base: ['#FCF6E8', '#F9F3E6', palette.paper], warm: '255,246,224', cool: '210,216,228', grain: 0.04 },
  night: { base: [palette.nightRaised, palette.night, palette.night], warm: '120,150,190', cool: '0,0,0', grain: 0.07 },
  alarm: { base: [palette.rust, palette.rustDeep, palette.rustDeep], warm: '255,180,150', cool: '0,0,0', grain: 0.07 },
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

// Radius follows the elevation tier, not taste: raised -> card (16), float ->
// glass (22), a sheet -> 28, a pill-shaped bar -> 30. `tile` is `card`.
export const radius = {
  card: 16, pill: 999, tile: 16, badge: 8, glass: 22, sheet: 28, bar: 30,
  bubble: 20,  // a chat bubble, and nothing else
} as const;

// Touch targets. `hit` is Apple's 44pt floor; `control` is the round icon button.
export const size = { hit: 44, control: 40, button: 52, buttonSmall: 44 } as const;

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
  tag: { fontSize: 13, lineHeight: 18, fontWeight: '600' as const },   // chip, tag and row-label text
  button: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const }, // Btn labels
  // The serif's one job: Eleanor's own quoted words. Content, never chrome.
  quote: { fontFamily: font.serif, fontSize: 19, lineHeight: 28 },
} as const;

// ---------------------------------------------------------------------------
// Liquid glass + brutalism. Everything below is the depth/structure layer added
// on top of the colour law above — it adds no hues, only elevation and honesty.
// ---------------------------------------------------------------------------

// Four elevation tiers, and they mean things. `flat` = the page itself.
// `raised` = content cards resting on it. `float` = chrome that content passes
// UNDER (bars, headers, the presence hero). `takeover` = the alert, which owns
// the screen. A surface picks a tier; it does not invent a shadow.
export const elevation = {
  flat: {},
  raised: cardShadow,
  float: {
    shadowColor: '#0B1017',
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  takeover: {
    shadowColor: '#0B1017',
    shadowOpacity: 0.28,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 18 },
  },
} as const;

// Glass constants. Tints are near-colourless on purpose: chrome carries no hue,
// so glass borrows its colour from whatever is scrolling beneath it.
export const glass = {
  tint: {
    neutral: 'rgba(255,255,255,0.10)',
    night: 'rgba(16,22,29,0.22)',
    alarm: 'rgba(210,64,30,0.18)', // the takeover only — rust still means alarm
  },
  // Used when isLiquidGlassAvailable() is false: a deliberate frosted plate,
  // not a sad grey box. Opaque enough to read text over a moving background.
  fallback: {
    neutral: { fill: 'rgba(255,255,255,0.82)', line: 'rgba(255,255,255,0.75)' },
    night: { fill: 'rgba(26,35,45,0.86)', line: 'rgba(255,255,255,0.10)' },
    alarm: { fill: 'rgba(150,41,12,0.78)', line: 'rgba(255,255,255,0.22)' },
  },
  // Blur radii for anything that fakes depth without the native effect.
  blur: { thin: 12, regular: 22, thick: 36 },
} as const;

// Brutalist rule weights. `ink` is the 2px hard rule under a section heading —
// the structural gesture that keeps the glass from being soft mush.
export const rule = { hair: 0.5, ink: 2, heavy: 4 } as const;

// Motion. One easing, one spring, one stagger step — a page loads as one
// sequence, not as fifteen independent animations.
export const motion = {
  stagger: 70,
  duration: { quick: 160, base: 420, slow: 640 },
  ease: [0.16, 1, 0.3, 1] as [number, number, number, number], // iOS-ish expo-out
  // reanimated withSpring configs
  enter: { damping: 20, stiffness: 180, mass: 0.9 },
  press: { damping: 24, stiffness: 520, mass: 0.6 },
  pressScale: 0.965,
} as const;

// Menlo, not a webfont: it is the monospace iOS actually has. Brutalism here is
// honesty about machine origin, so the ugly-honest face is the right one.
// ponytail: no Android-specific face; 'monospace' resolves to Roboto Mono there.
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' }) as string;

// Machine voice. Tabular figures so a live number never shifts its own layout.
// NEVER used for human sentences — see DESIGN.md, the voice law.
export const mono: Record<'data' | 'big' | 'hero' | 'micro' | 'stamp', TextStyle> = {
  // The one big counter on a slab (Needs a check 03). Not for prose, ever.
  hero: { fontFamily: MONO, fontSize: 46, lineHeight: 50, fontVariant: ['tabular-nums'], letterSpacing: -1.5 },
  data: { fontFamily: MONO, fontSize: 15, lineHeight: 20, fontVariant: ['tabular-nums'], letterSpacing: -0.2 },
  big: { fontFamily: MONO, fontSize: 26, lineHeight: 30, fontVariant: ['tabular-nums'], letterSpacing: -1 },
  micro: { fontFamily: MONO, fontSize: 10, lineHeight: 13, letterSpacing: 1.1, fontVariant: ['tabular-nums'] },
  stamp: { fontFamily: MONO, fontSize: 12, lineHeight: 16, fontVariant: ['tabular-nums'], letterSpacing: 0 },
};
