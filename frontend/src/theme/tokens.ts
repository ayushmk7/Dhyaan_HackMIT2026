// Dhyaan design tokens. The single source of colour/space/type/depth truth.
//
// The colour law, in one paragraph. There are three colours: blue, white and
// black, and the greys between white and black. Blue is the ONE accent, and it
// means one thing: Dhyaan is pointing at something (a control it offers, a
// thing it noticed, a state worth a look). OK has no colour at all. Alarm is
// not a colour either; it is INVERSION: the takeover, the alerting tile and
// the alerting chip are the only surfaces drawn in the opposite scheme
// (white on black in light mode, black on white in dark mode). Category is
// carried by the SF glyph and the label word, never by a tint. See
// docs/frontend-DESIGN.md, "Colour".
//
// `palette` below is the LIGHT scheme. `darkPalette` is the dark one. A
// component never reads either directly: it calls `useTheme()` from
// `@/theme/theme` (re-exported by `@/components`) and gets the resolved one.
// The static exports (`palette`, `hue`, `zoneColor`, `stateColor`,
// `avatarGradient`, `washTone`, `glass`) are the light values, kept so code
// that cannot call a hook keeps compiling. They are LIGHT-ONLY.

import { Platform, TextStyle } from 'react-native';

// ---------------------------------------------------------------------------
// The two palettes. Same keys, same meanings, different values.
// ---------------------------------------------------------------------------

export type Palette = {
  /** The page. Near-white with a blue cast in light; near-black in dark. */
  paper: string;
  /** A card resting on the page. Pure white in light; a lifted grey in dark. */
  raised: string;
  /** Primary text. Blue-black in light; near-white in dark. */
  ink: string;
  /** Metadata text (a time, a count, a unit). Clears AA on paper and raised. */
  inkMuted: string;
  /** In-card separators only. */
  line: string;
  /** The passive chevron, a placeholder. Decorative; not for words. */
  inkFaint: string;

  /** The accent. Historical name; it is the blue. Same as `accent`. */
  slate: string;
  /** The accent, pressed. */
  slateDeep: string;
  /** The quiet fill (a tonal button, an unselected chip). Grey-blue, no hue. */
  slateWash: string;
  /** `slateWash`, pressed. */
  slateWashDeep: string;

  /** The one accent. Blue. "Dhyaan is pointing at this." */
  accent: string;
  /** The accent, pressed. */
  accentDeep: string;
  /** A pointed fill: the attention chip, the observed tag. */
  accentWash: string;
  /** `accentWash`, pressed. */
  accentWashDeep: string;
  /** The person-box fill on the camera pane: the accent at 6%. */
  accentGhost: string;
  /** Text on an `accent` plate. White in light; the near-black paper in dark. */
  onAccent: string;

  /** The inverse plate: the opposite scheme's ground. This is what alarm is. */
  inverse: string;
  /** A plate one step back from `inverse` (the takeover's readout slab). */
  inverseRaised: string;
  /** Text on `inverse`. */
  onInverse: string;
  /** Pure white, in either scheme. Only for a plate that must stay white. */
  white: string;

  // The night ground (Rounds): the app in dark mode, whatever the scheme.
  night: string;
  nightRaised: string;
  nightInk: string;
  nightMuted: string;
  nightLine: string;
  /** The burned-in caption bar over the camera pane. */
  nightScrim: string;

  // ---- Deprecated hue names -------------------------------------------------
  // The old taxonomy encoded meaning in hue: moss=OK, rust=alarm, ochre=worth
  // a look, amber=the camera. Those hues are gone. The keys survive so an
  // unconverted screen compiles, each mapped to what its MEANING now resolves
  // to. Reading one of these is a bug to fix, not a colour to use.
  /** @deprecated OK has no colour. Resolves to `ink`. */
  moss: string;
  /** @deprecated Resolves to `slateWash`. */
  mossWash: string;
  /** @deprecated "Worth a look" is the accent. Resolves to `accent`. */
  ochre: string;
  /** @deprecated Resolves to `accentWash`. */
  ochreWash: string;
  /** @deprecated Alarm is inversion, not a colour. Resolves to `inverse`. */
  rust: string;
  /** @deprecated Resolves to `inverseRaised`. */
  rustDeep: string;
  /** @deprecated Resolves to `slateWash`. Pair it with `ink`, never with `rust`. */
  rustWash: string;
  /** @deprecated The camera is the accent. Resolves to `accent`. */
  amber: string;
  /** @deprecated Resolves to `accentWash`. */
  amberWash: string;
  /** @deprecated Resolves to `accentGhost`. */
  amberGhost: string;
};

// The blue ramp. Every blue in the app is one of these ten. Value (light to
// dark) is the only axis, which is what lets a stacked bar, a gradient and a
// pressed state all speak the same language.
export const blue = {
  50: '#EEF3FC',
  100: '#DCE6F9',
  200: '#B9CDF3',
  300: '#8AAEEA',
  400: '#5B8DE0',
  500: '#2F6BD6',
  600: '#1F56C2',
  700: '#173F91',
  800: '#0F2C66',
  900: '#0A1D44',
} as const;

const INK = '#0B1220';
const WHITE = '#FFFFFF';
const NIGHT = '#0B0F16';
const NIGHT_RAISED = '#151B24';
const NIGHT_INK = '#F2F4F8';
const NIGHT_MUTED = '#A3ACB9';
const NIGHT_LINE = '#26303D';

const night = {
  night: NIGHT,
  nightRaised: NIGHT_RAISED,
  nightInk: NIGHT_INK,
  nightMuted: NIGHT_MUTED,
  nightLine: NIGHT_LINE,
  nightScrim: 'rgba(11,15,22,0.82)',
} as const;

/** The LIGHT palette. Light-only: components call `useTheme()` instead. */
export const palette: Palette = {
  paper: '#F3F5F9',
  raised: WHITE,
  ink: INK,
  inkMuted: '#596371',   // 5.6:1 on paper, 6.1:1 on raised
  line: '#E2E6EE',
  inkFaint: '#98A2B3',

  slate: blue[600],
  slateDeep: blue[700],
  slateWash: '#E6EAF1',
  slateWashDeep: '#D8DEE8',

  accent: blue[600],     // 6.6:1 with white text, 6.1:1 as text on paper
  accentDeep: blue[700],
  accentWash: blue[50],
  accentWashDeep: blue[100],
  accentGhost: 'rgba(31,86,194,0.06)',
  onAccent: WHITE,

  inverse: INK,
  inverseRaised: '#1A2332',
  onInverse: WHITE,
  white: WHITE,

  ...night,

  moss: INK,
  mossWash: '#E6EAF1',
  ochre: blue[600],
  ochreWash: blue[50],
  rust: INK,
  rustDeep: '#1A2332',
  rustWash: '#E6EAF1',
  amber: blue[600],
  amberWash: blue[50],
  amberGhost: 'rgba(31,86,194,0.06)',
};

/** The DARK palette. Same keys as `palette`, same meanings. */
export const darkPalette: Palette = {
  paper: NIGHT,
  raised: NIGHT_RAISED,
  ink: NIGHT_INK,
  inkMuted: NIGHT_MUTED,  // 8.4:1 on paper, 7.5:1 on raised
  line: NIGHT_LINE,
  inkFaint: '#5D6774',

  slate: blue[300],
  slateDeep: '#6B95E3',
  slateWash: '#1B2330',
  slateWashDeep: '#242E3D',

  accent: blue[300],     // 7.9:1 as text on paper; 7.8:1 with paper-coloured text on it
  accentDeep: '#6B95E3',
  accentWash: '#182740',
  accentWashDeep: '#1F3355',
  accentGhost: 'rgba(138,174,234,0.08)',
  onAccent: NIGHT,

  inverse: WHITE,
  inverseRaised: '#F3F5F9',
  onInverse: INK,
  white: WHITE,

  ...night,

  moss: NIGHT_INK,
  mossWash: '#1B2330',
  ochre: blue[300],
  ochreWash: '#182740',
  rust: WHITE,
  rustDeep: '#F3F5F9',
  rustWash: '#1B2330',
  amber: blue[300],
  amberWash: '#182740',
  amberGhost: 'rgba(138,174,234,0.08)',
};

// Text and rules on a dark plate (an ink Slab in light mode, the night ground,
// the takeover in light mode). Four alphas and no more.
export const onDark = {
  ink: WHITE,
  soft: 'rgba(255,255,255,0.78)',   // a caption, a sub-line
  muted: 'rgba(255,255,255,0.62)',  // a DataLabel's label, metadata
  rule: 'rgba(255,255,255,0.55)',   // a hard rule
  line: 'rgba(255,255,255,0.28)',   // a hairline, an outline
  wash: 'rgba(255,255,255,0.15)',   // a quiet fill (icon button, pulse core)
  pressed: 'rgba(255,255,255,0.12)',
} as const;

// Text and rules on a white plate that sits on a dark screen (the Rounds
// counter, an ink Slab in dark mode, the takeover in dark mode). The mirror
// of `onDark`, alpha for alpha.
export const onLight = {
  ink: INK,
  soft: 'rgba(11,18,32,0.78)',
  muted: 'rgba(11,18,32,0.62)',
  rule: 'rgba(11,18,32,0.55)',
  line: 'rgba(11,18,32,0.22)',
  wash: 'rgba(11,18,32,0.08)',
  pressed: 'rgba(11,18,32,0.12)',
} as const;

/** @deprecated The cream plate is a white plate now. Same values as `onLight`. */
export const onCream = onLight;

export type ResidentState = 'ok' | 'learning' | 'attention' | 'alerting' | 'offline';

/**
 * How a state is drawn, now that it cannot be a colour. `form` is what the
 * StatusDot and the chip do; `fg`/`wash` are the chip's text and fill; `word`
 * carries the meaning for anyone who cannot see any of the above.
 *
 *   hollow   a ring, no fill: nothing is being pointed at (OK, learning)
 *   flat     a filled grey dot: no signal (offline)
 *   filled   a filled accent dot: worth a look
 *   inverse  the opposite scheme's plate: needs someone now
 */
export type StateForm = 'hollow' | 'flat' | 'filled' | 'inverse';
export type StateStyle = { fg: string; wash: string; word: string; form: StateForm };

export type ZoneColor = Record<string, string>;
export type AvatarGradient = Record<'green' | 'amber' | 'blue', readonly [string, string]>;
export type WashRamp = { base: readonly [string, string, string]; warm: string; cool: string; grain: number };
export type WashTones = Record<'day' | 'night' | 'alarm', WashRamp>;

export type Hue = Record<
  'activity' | 'nutrition' | 'sleep' | 'location' | 'heart' | 'social' | 'presence' | 'mind', string
>;

export type GlassTokens = {
  tint: Record<'neutral' | 'night' | 'alarm', string>;
  fallback: Record<'neutral' | 'night' | 'alarm', { fill: string; line: string }>;
  blur: { thin: number; regular: number; thick: number };
};

export type Semantics = {
  stateColor: Record<ResidentState, StateStyle>;
  hue: Hue;
  zoneColor: ZoneColor;
  avatarGradient: AvatarGradient;
  washTone: WashTones;
  glass: GlassTokens;
};

// The night ramp is the same in both schemes: Rounds is the app in dark mode.
const NIGHT_WASH: WashRamp = {
  base: [NIGHT_RAISED, NIGHT, NIGHT], warm: '80,110,160', cool: '0,0,0', grain: 0.07,
};

/** Everything that hangs off a palette, built once per scheme. */
export const buildSemantics = (p: Palette, scheme: 'light' | 'dark'): Semantics => {
  const dark = scheme === 'dark';
  return {
    stateColor: {
      ok: { fg: p.ink, wash: p.slateWash, word: 'OK', form: 'hollow' },
      learning: { fg: p.inkMuted, wash: p.slateWash, word: 'Learning her routine', form: 'hollow' },
      attention: { fg: p.accent, wash: p.accentWash, word: 'Worth a look', form: 'filled' },
      alerting: { fg: p.onInverse, wash: p.inverse, word: 'Needs someone now', form: 'inverse' },
      offline: { fg: p.inkMuted, wash: p.slateWash, word: 'Band offline', form: 'flat' },
    },

    // Category is the glyph and the word. The label tint is muted for every
    // ordinary category; only safety (a fall, a deviation) and the camera lane
    // are pointed at, so only those two take the accent.
    hue: {
      activity: p.inkMuted,
      nutrition: p.inkMuted,
      sleep: p.inkMuted,
      location: p.inkMuted,
      heart: p.accent,
      social: p.inkMuted,
      presence: p.accent,
      mind: p.inkMuted,
    },

    // The room-time bar: one value per room, on the blue ramp. Interleaved so
    // the rooms a day actually alternates between (bedroom/bathroom,
    // kitchen/hallway) sit far apart on the ramp. Outside is off the ramp: the
    // scheme's ink, "she has left the picture". Unknown is the hairline grey.
    zoneColor: dark
      ? {
          bedroom: blue[700], bathroom: blue[200], kitchen: blue[400], living_room: blue[100],
          dining_room: blue[500], hallway: blue[300], outside: p.ink, unknown: '#3A4553',
        }
      : {
          bedroom: blue[800], bathroom: blue[300], kitchen: blue[500], living_room: blue[200],
          dining_room: blue[600], hallway: blue[400], outside: p.ink, unknown: '#D8DEE8',
        },

    // Three monograms on the same ramp: deep, mid and graphite. The keys are
    // historical; `avatarTone(i)` cycles them. White initial on all three.
    avatarGradient: dark
      ? { green: [blue[600], blue[800]], amber: [blue[500], blue[700]], blue: ['#3A4553', NIGHT_RAISED] }
      : { green: [blue[700], blue[900]], amber: [blue[500], blue[700]], blue: ['#2A3646', INK] },

    // The atmospheric ground's ramps and blooms. `day` is the page: white
    // pooling to a blue-grey corner in light; the night ramp in dark. `alarm`
    // is the takeover: the inverse ground, so it flips with the scheme.
    washTone: {
      day: dark
        ? NIGHT_WASH
        : { base: [WHITE, '#F8FAFD', p.paper], warm: '255,255,255', cool: '185,205,235', grain: 0.04 },
      night: NIGHT_WASH,
      alarm: dark
        ? { base: [WHITE, '#F3F5F9', '#F3F5F9'], warm: '255,255,255', cool: '11,18,32', grain: 0.05 }
        : { base: ['#1A2332', INK, INK], warm: '255,255,255', cool: '0,0,0', grain: 0.07 },
    },

    // Glass constants. Tints are near-colourless: glass borrows its colour from
    // whatever scrolls beneath. `alarm` is the inverse of the scheme.
    glass: {
      tint: {
        neutral: dark ? 'rgba(11,15,22,0.22)' : 'rgba(255,255,255,0.10)',
        night: 'rgba(11,15,22,0.22)',
        alarm: dark ? 'rgba(255,255,255,0.12)' : 'rgba(11,18,32,0.24)',
      },
      fallback: {
        neutral: dark
          ? { fill: 'rgba(21,27,36,0.86)', line: 'rgba(255,255,255,0.10)' }
          : { fill: 'rgba(255,255,255,0.82)', line: 'rgba(255,255,255,0.75)' },
        night: { fill: 'rgba(21,27,36,0.86)', line: 'rgba(255,255,255,0.10)' },
        alarm: dark
          ? { fill: 'rgba(255,255,255,0.86)', line: 'rgba(11,18,32,0.12)' }
          : { fill: 'rgba(11,18,32,0.80)', line: 'rgba(255,255,255,0.22)' },
      },
      blur: { thin: 12, regular: 22, thick: 36 },
    },
  };
};

const light = buildSemantics(palette, 'light');

// Static, LIGHT-ONLY views of the semantics, for code that cannot call a hook.
export const stateColor: Record<ResidentState, StateStyle> = light.stateColor;
export const hue: Hue = light.hue;
export const zoneColor: ZoneColor = light.zoneColor;
export const avatarGradient: AvatarGradient = light.avatarGradient;
export const washTone: WashTones = light.washTone;
export const glass: GlassTokens = light.glass;

export const sp = (n: number) => n * 4;

// Radius follows the elevation tier, not taste: raised -> card (16), float ->
// glass (22), a sheet -> 28, a pill-shaped bar -> 30. `tile` is `card`.
export const radius = {
  card: 16, pill: 999, tile: 16, badge: 8, glass: 22, sheet: 28, bar: 30,
  bubble: 20,  // a chat bubble, and nothing else
} as const;

// Touch targets. `hit` is Apple's 44pt floor; `control` is the round icon button.
export const size = { hit: 44, control: 40, button: 52, buttonSmall: 44 } as const;

// One soft elevation for every white card. Never borders in light mode; in dark
// mode a shadow on black is invisible, so Card draws a hairline instead.
export const cardShadow = {
  shadowColor: INK,
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
// never chrome). An app whose chrome speaks in a display serif is a website.
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
// on top of the colour law above. It adds no hues, only elevation and honesty.
// ---------------------------------------------------------------------------

// Four elevation tiers, and they mean things. `flat` = the page itself.
// `raised` = content cards resting on it. `float` = chrome that content passes
// UNDER (bars, headers, the presence hero). `takeover` = the alert, which owns
// the screen. A surface picks a tier; it does not invent a shadow.
export const elevation = {
  flat: {},
  raised: cardShadow,
  float: {
    shadowColor: INK,
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  takeover: {
    shadowColor: INK,
    shadowOpacity: 0.28,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 18 },
  },
} as const;

// Brutalist rule weights. `ink` is the 2px hard rule under a section heading:
// the structural gesture that keeps the glass from being soft mush.
export const rule = { hair: 0.5, ink: 2, heavy: 4 } as const;

// Motion. One easing, one spring, one stagger step: a page loads as one
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
// NEVER used for human sentences. See DESIGN.md, the voice law.
export const mono: Record<'data' | 'big' | 'hero' | 'micro' | 'stamp', TextStyle> = {
  // The one big counter on a slab (Needs a check 03). Not for prose, ever.
  hero: { fontFamily: MONO, fontSize: 46, lineHeight: 50, fontVariant: ['tabular-nums'], letterSpacing: -1.5 },
  data: { fontFamily: MONO, fontSize: 15, lineHeight: 20, fontVariant: ['tabular-nums'], letterSpacing: -0.2 },
  big: { fontFamily: MONO, fontSize: 26, lineHeight: 30, fontVariant: ['tabular-nums'], letterSpacing: -1 },
  micro: { fontFamily: MONO, fontSize: 10, lineHeight: 13, letterSpacing: 1.1, fontVariant: ['tabular-nums'] },
  stamp: { fontFamily: MONO, fontSize: 12, lineHeight: 16, fontVariant: ['tabular-nums'], letterSpacing: 0 },
};
