// Dhyaan design tokens. The single source of colour/space/type/depth truth.
//
// The colour law, in one paragraph. There are three colours: blue, white and
// black, and the greys between white and black. Blue is the ONE accent, and it
// means one thing: Dhyaan is pointing at something (a control it offers, a
// thing it noticed, a state worth a look). OK has no colour at all. Alarm is
// not a colour either; it is DEPTH on the blue ramp: the focal plates (a
// Slab, the night ground, the takeover) are light blue with ink text, and the
// takeover is the deepest light blue there is, under a heavy rule, with the
// one navy plate button. Nothing in the light app is black. Category is
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

  /**
   * The focal plate (an ink `Slab`, `Mark`, the alerting wash). Historical
   * name: it used to be the opposite scheme's ground. It is now a light blue
   * plate in light mode (`blue[200]`) and a deep blue one in dark (`blue[800]`).
   */
  inverse: string;
  /** The takeover's readout slab, and the alerting tile on Floor: one step lighter than the takeover. */
  inverseRaised: string;
  /** Text on `inverse`: the scheme's ink. */
  onInverse: string;
  /** The takeover ground. The deepest light blue (`blue[300]`); `blue[700]` in dark. */
  alarm: string;
  /** Pure white, in either scheme. Only for a plate that must stay white. */
  white: string;

  // The night ground (Rounds, the camera monitor pane): a light blue page in
  // light mode, a deep blue one in dark. Never black.
  night: string;
  nightRaised: string;
  nightInk: string;
  nightMuted: string;
  nightLine: string;
  /** The caption bar over the camera pane. */
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
  /** @deprecated Alarm is not a colour. Resolves to `inverse`. */
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
// The DARK SCHEME's page and its text. These are the only near-blacks left,
// and they are the dark scheme's paper, not a device drawn on the light one.
const NIGHT = '#0B0F16';
const NIGHT_RAISED = '#151B24';
const NIGHT_INK = '#F2F4F8';
const NIGHT_MUTED = '#A3ACB9';
const NIGHT_LINE = '#26303D';

// The night ground, per scheme. Light: a light blue page (Rounds at night is
// still a page you can read in daylight). Dark: a deep blue page, one step
// bluer than the dark paper, so Rounds is still its own place.
const lightNight = {
  night: blue[100],
  nightRaised: WHITE,
  nightInk: INK,
  nightMuted: '#46536A',     // 6.2:1 on night, 7.9:1 on nightRaised
  nightLine: blue[200],
  nightScrim: 'rgba(220,230,249,0.88)',
} as const;
const darkNight = {
  night: blue[900],
  nightRaised: blue[800],
  nightInk: NIGHT_INK,
  nightMuted: '#A9B7D1',     // 8.2:1 on night, 6.6:1 on nightRaised
  nightLine: blue[700],
  nightScrim: 'rgba(10,29,68,0.86)',
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

  inverse: blue[200],       // 11.7:1 with ink text
  inverseRaised: blue[100], // 14.9:1 with ink text
  onInverse: INK,
  alarm: blue[300],         // 8.3:1 with ink text
  white: WHITE,

  ...lightNight,

  moss: INK,
  mossWash: '#E6EAF1',
  ochre: blue[600],
  ochreWash: blue[50],
  rust: blue[200],
  rustDeep: blue[100],
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

  inverse: blue[800],       // 12.1:1 with nightInk text
  inverseRaised: blue[800], // one hairline back from the blue[700] takeover
  onInverse: NIGHT_INK,
  alarm: blue[700],         // 8.8:1 with nightInk text
  white: WHITE,

  ...darkNight,

  moss: NIGHT_INK,
  mossWash: '#1B2330',
  ochre: blue[300],
  ochreWash: '#182740',
  rust: blue[800],
  rustDeep: blue[800],
  rustWash: '#1B2330',
  amber: blue[300],
  amberWash: '#182740',
  amberGhost: 'rgba(138,174,234,0.08)',
};

// Ink and rules on a light plate: every plate in the light scheme (a Slab,
// the night ground, the takeover, the white plate) and the white plate in the
// dark scheme. Seven alphas and no more. `muted` is 0.74, not 0.62, because it
// has to clear AA on the takeover's blue[300] (5.0:1 there; 6.2:1 on a Slab).
export const onLight = {
  ink: INK,
  soft: 'rgba(11,18,32,0.78)',    // a caption, a sub-line
  muted: 'rgba(11,18,32,0.74)',   // a DataLabel's label, metadata
  rule: 'rgba(11,18,32,0.60)',    // a hard rule
  line: 'rgba(11,18,32,0.26)',    // a hairline, an outline
  wash: 'rgba(255,255,255,0.55)', // a quiet fill on a blue plate: a lighter pool
  pressed: 'rgba(255,255,255,0.80)',
} as const;

/**
 * Light text and rules on a DEEP plate: the dark scheme's paper and its deep
 * blue plates (an ink Slab, the night ground, the takeover in dark mode).
 * The mirror of `onLight`, alpha for alpha. `muted` is 0.70 so it clears AA
 * on the dark takeover's blue[700] (5.6:1).
 */
export const onDeep = {
  ink: WHITE,
  soft: 'rgba(255,255,255,0.80)',
  muted: 'rgba(255,255,255,0.70)',
  rule: 'rgba(255,255,255,0.60)',
  line: 'rgba(255,255,255,0.28)',
  wash: 'rgba(255,255,255,0.15)',
  pressed: 'rgba(255,255,255,0.12)',
} as const;

/**
 * @deprecated The plates that used to be dark are light blue now, so "text on
 * a dark plate" resolves to INK: the same values as `onLight`. It is a static
 * light-scheme view; a component should read `useSurfaceColors()` instead,
 * which follows the scheme (in dark mode those plates take `onDeep`).
 */
export const onDark = onLight;

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
 *   inverse  the gravest plate (navy on light, light blue on deep): needs someone now
 */
export type StateForm = 'hollow' | 'flat' | 'filled' | 'inverse';
export type StateStyle = { fg: string; wash: string; word: string; form: StateForm };

export type ZoneColor = Record<string, string>;
export type AvatarGradient = Record<'green' | 'amber' | 'blue', readonly [string, string]>;
export type WashRamp = {
  base: readonly [string, string, string]; warm: string; cool: string; grain: number;
  /** A deep ramp halves its warm bloom: light pooling on a deep plate reads as glare. */
  dark: boolean;
};
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

// The dark scheme's page ramp: the only ramp that goes to black, because the
// dark paper is black.
const NIGHT_WASH: WashRamp = {
  base: [NIGHT_RAISED, NIGHT, NIGHT], warm: '80,110,160', cool: '0,0,0', grain: 0.07, dark: true,
};

/** Everything that hangs off a palette, built once per scheme. */
export const buildSemantics = (p: Palette, scheme: 'light' | 'dark'): Semantics => {
  const dark = scheme === 'dark';
  return {
    // `alerting` is the focal plate with ink on it; the StateChip draws it as
    // the surface's navy plate (`surfaceColors().plate`), the loudest thing a
    // chip can be without a hue of its own.
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
    // pooling to a blue-grey corner in light; the black ramp in dark. `night`
    // and `alarm` are the two blue grounds: in light they pool from white
    // into their blue, in dark from a lighter blue into a deeper one.
    washTone: {
      day: dark
        ? NIGHT_WASH
        : { base: [WHITE, '#F8FAFD', p.paper], warm: '255,255,255', cool: '185,205,235', grain: 0.04, dark: false },
      night: dark
        ? { base: [blue[800], blue[900], blue[900]], warm: '138,174,234', cool: '0,0,0', grain: 0.07, dark: true }
        : { base: [blue[50], blue[100], blue[100]], warm: '255,255,255', cool: '138,174,234', grain: 0.04, dark: false },
      alarm: dark
        ? { base: ['#1A4AA8', blue[700], blue[800]], warm: '255,255,255', cool: '0,0,0', grain: 0.06, dark: true }
        : { base: [blue[200], blue[300], blue[300]], warm: '255,255,255', cool: '23,63,145', grain: 0.05, dark: false },
    },

    // Glass constants. Tints are near-colourless: glass borrows its colour from
    // whatever scrolls beneath. `night` and `alarm` sit on the blue grounds, so
    // they are light glass in light mode and deep glass in dark.
    glass: {
      tint: {
        neutral: dark ? 'rgba(11,15,22,0.22)' : 'rgba(255,255,255,0.10)',
        night: dark ? 'rgba(10,29,68,0.30)' : 'rgba(255,255,255,0.18)',
        alarm: dark ? 'rgba(15,44,102,0.30)' : 'rgba(255,255,255,0.22)',
      },
      fallback: {
        neutral: dark
          ? { fill: 'rgba(21,27,36,0.86)', line: 'rgba(255,255,255,0.10)' }
          : { fill: 'rgba(255,255,255,0.82)', line: 'rgba(255,255,255,0.75)' },
        night: dark
          ? { fill: 'rgba(15,44,102,0.86)', line: 'rgba(255,255,255,0.12)' }
          : { fill: 'rgba(238,243,252,0.86)', line: 'rgba(11,18,32,0.10)' },
        alarm: dark
          ? { fill: 'rgba(15,44,102,0.88)', line: 'rgba(255,255,255,0.16)' }
          : { fill: 'rgba(220,230,249,0.88)', line: 'rgba(11,18,32,0.14)' },
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
// mode a shadow on a deep ground is invisible, so Card draws a hairline instead.
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

// SF everywhere. Screen titles belong to the native navigation bar (compact,
// centred; see lib/nav.tsx), not to us. The serif exists for exactly one
// thing: Eleanor's own quoted words (content, never chrome). An app whose
// chrome speaks in a display serif is a website.
//
// THE SCALE. Six sizes and no more: 11, 13, 17, 22, 30, 40. Each step is a
// real jump (about 1.3x), so the big things are genuinely big and the small
// things genuinely small; two sizes a point apart are not a hierarchy, they
// are drift. Every key below is an ALIAS onto one of the six. Same size, two
// jobs? Weight tells them apart (`label` is `body` at 600; `tag` is `caption`
// at 600), never a private size.
//
// Line-height and tracking are one rule each, not hand-picked per entry:
//   display sizes (>= 22): line-height 1.12x, tracking -(size / 40)
//   text sizes   (< 22):   line-height 1.35x, tracking 0
//   prose (the serif quote): the text ratio, whatever the size
export const scale = { micro: 11, caption: 13, body: 17, title: 22, display: 30, hero: 40 } as const;

const lh = (size: number, prose = false) => Math.round(size * (size >= 22 && !prose ? 1.12 : 1.35));
const track = (size: number) => (size >= 22 ? -(size / 40) : 0);
const step = <W extends TextStyle['fontWeight']>(size: number, fontWeight: W, prose = false) =>
  ({ fontSize: size, lineHeight: lh(size, prose), fontWeight, letterSpacing: track(size) }) as const;

const HERO = step(scale.hero, '800' as const);
const DISPLAY = step(scale.display, '800' as const);
const TITLE = step(scale.title, '700' as const);
const BODY = step(scale.body, '400' as const);
const STRONG = step(scale.body, '600' as const);
const CAPTION = step(scale.caption, '400' as const);
const CAPTION_STRONG = step(scale.caption, '600' as const);

export const type = {
  /** 40. A screen's one big sentence (the camera lane, a Presence headline). */
  hero: HERO,
  /** 30. The alert headline, a question that is the whole screen. */
  display: DISPLAY,
  /** 22. A title inside content. */
  title: TITLE,
  /** = title. The Marquee section heading. */
  heading: TITLE,
  /** = title. A tile's figure. */
  stat: TITLE,
  /** 17. Prose. The iOS body default. */
  body: BODY,
  /** = body, at 600. A row title, a field label. */
  label: STRONG,
  /** = body, at 600. A Btn label. */
  button: STRONG,
  /** 13. Metadata: a time, a count, a unit. */
  caption: CAPTION,
  /** = caption, at 600. A chip, a tag, a row label. */
  tag: CAPTION_STRONG,
  /** The serif's one job: her own quoted words, at the title size, set as prose. */
  quote: { fontFamily: font.serif, fontSize: scale.title, lineHeight: lh(scale.title, true) },
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
// NEVER used for human sentences. See docs/frontend-DESIGN.md, the voice law. Same six sizes
// as `type`, same line-height and tracking rules; `micro` is the one entry that
// tracks OUT (+1), because it is the uppercase overline and caps need air.
const monoStep = (size: number, letterSpacing = track(size)): TextStyle =>
  ({ fontFamily: MONO, fontSize: size, lineHeight: lh(size), fontVariant: ['tabular-nums'], letterSpacing });

export const mono: Record<'data' | 'big' | 'hero' | 'micro' | 'stamp', TextStyle> = {
  /** 40 (= type.hero). The one big counter on a slab (Needs a check 03). */
  hero: monoStep(scale.hero),
  /** 22 (= type.title). A tile's figure, a card's number. */
  big: monoStep(scale.title),
  /** 13 (= type.caption). A reading in a row. */
  data: monoStep(scale.caption),
  /** = data. A timestamp, a band id. */
  stamp: monoStep(scale.caption),
  /** 11, uppercase, tracked out. `DataLabel`. */
  micro: monoStep(scale.micro, 1),
};
