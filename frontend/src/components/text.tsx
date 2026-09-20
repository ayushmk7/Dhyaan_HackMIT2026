// The one text component, and the surface it sits on.
//
// `Surface` is a context, not a View: it tells everything inside it what it is
// resting on (paper, the night ground, an ink slab, a white slab, the alarm
// takeover) so that Txt, Rule, Hairline, DataLabel, Marquee, Btn and Chip pick
// the right default colours without every screen passing `night` or an rgba
// to each child. Explicit props always win; the surface only fills the gaps.
//
// A surface is resolved against the SCHEME as well: in light mode every
// surface is light (paper is near-white; `ink`, `night` and `alarm` are the
// blue ramp's light steps) and takes ink text; in dark mode every surface but
// `cream` is deep (black paper, deep blue plates) and takes light text.
// `cream` is always the white plate.
//
// This file imports nothing from the rest of the component tree, so brutal.tsx,
// viz.tsx, avatar.tsx and alert-extras.tsx can all use <Txt> without a cycle.
import React from 'react';
import { Text, TextStyle } from 'react-native';
import { Scheme, themes, useTheme } from '@/theme/theme';
import { blue, mono, onDeep, onLight, type } from '@/theme/tokens';

// ---- Surface ------------------------------------------------------------------

export type SurfaceTone = 'paper' | 'night' | 'ink' | 'cream' | 'alarm';

const SurfaceCtx = React.createContext<SurfaceTone>('paper');

/** Declares what the children rest on. Pure context; renders no View. */
export function Surface({ tone, children }: { tone: SurfaceTone; children: React.ReactNode }) {
  return <SurfaceCtx.Provider value={tone}>{children}</SurfaceCtx.Provider>;
}

export const useSurface = (): SurfaceTone => React.useContext(SurfaceCtx);

/**
 * Whether a surface takes light text, in a given scheme. Nothing does in
 * light mode (every plate is a light blue); everything but `cream` does in
 * dark mode, where the plates are deep blue and the paper is black.
 */
export const isDarkSurface = (t: SurfaceTone, scheme: Scheme = 'light') =>
  scheme === 'dark' && t !== 'cream';

export type SurfaceColors = {
  /** Primary text. */
  ink: string;
  /** A secondary sentence or caption. */
  muted: string;
  /** A DataLabel's machine label. */
  label: string;
  /** The passive chevron. */
  faint: string;
  /** A hairline. */
  line: string;
  /** The 2px brutalist rule. */
  rule: string;
  /** A quiet fill (a tonal button, an unselected chip). */
  wash: string;
  /** `wash`, pressed. */
  pressed: string;
  /** The gravest plate on this surface: the commitment button, the alerting chip. Navy on a light surface, light blue on a deep one. */
  plate: string;
  /** `plate`, pressed. */
  platePressed: string;
  /** Text on `plate`. */
  onPlate: string;
  /** The accent, as it reads on this surface. */
  accent: string;
  /** Text on an `accent` plate. */
  onAccent: string;
  /** A pointed fill (the attention chip, the observed tag). */
  accentWash: string;
};

/**
 * The colour set a surface hands its children, in a scheme. One table, read
 * everywhere. Prefer `useSurfaceColors()` inside a component; this pure form
 * defaults to the light scheme for code that cannot call a hook.
 */
export const surfaceColors = (t: SurfaceTone, scheme: Scheme = 'light'): SurfaceColors => {
  const th = themes[scheme];
  const deep = isDarkSurface(t, scheme);
  // Light text on a deep plate, or ink on a light one: the same seven alphas,
  // mirrored. Which set a plate takes depends on the scheme: an ink Slab is
  // light blue with ink text in light mode, deep blue with light text in dark.
  const on = deep ? onDeep : onLight;
  // The gravest plate is the far end of the blue ramp from the surface: navy
  // (blue[800]) on any light surface, light blue (blue[200]) on a deep one.
  // Never black, never white: it has to be the loudest thing on the takeover
  // without being a hue of its own.
  const plate = deep
    ? { plate: blue[200], platePressed: blue[300], onPlate: '#0B1220' }
    : { plate: blue[800], platePressed: blue[900], onPlate: '#FFFFFF' };
  // The accent, as text, is picked by the SURFACE: blue[600] on white or
  // paper, one step deeper (blue[700]) on a light blue plate so it still
  // clears AA there, and blue[200] on a deep blue plate.
  const bluePlate = t === 'ink' || t === 'alarm' || t === 'night';
  const accent = deep
    ? bluePlate
      ? { accent: blue[200], onAccent: blue[900], accentWash: 'rgba(185,205,243,0.16)' }
      : { accent: themes.dark.accent, onAccent: themes.dark.onAccent, accentWash: themes.dark.accentWash }
    : bluePlate
      ? { accent: blue[700], onAccent: '#FFFFFF', accentWash: 'rgba(255,255,255,0.62)' }
      : { accent: themes.light.accent, onAccent: themes.light.onAccent, accentWash: themes.light.accentWash };

  switch (t) {
    case 'night':
      return {
        ink: th.nightInk, muted: th.nightMuted, label: th.nightMuted, faint: th.nightMuted,
        line: th.nightLine, rule: th.nightInk, wash: th.nightRaised, pressed: th.nightLine,
        ...plate, ...accent,
      };
    case 'ink':
    case 'alarm':
    case 'cream':
      return {
        ink: on.ink, muted: on.soft, label: on.muted, faint: on.muted,
        line: on.line, rule: on.rule, wash: on.wash, pressed: on.pressed,
        ...plate, ...accent,
      };
    default:
      return {
        ink: th.ink, muted: th.inkMuted, label: th.inkMuted, faint: th.inkFaint,
        line: th.line, rule: th.ink, wash: th.slateWash, pressed: th.slateWashDeep,
        ...plate, ...accent,
      };
  }
};

/** The surface's colour set, resolved for the scheme this component is drawn in. */
export const useSurfaceColors = (override?: SurfaceTone): SurfaceColors => {
  const surface = useSurface();
  const { scheme } = useTheme();
  return surfaceColors(override ?? surface, scheme);
};

// ---- Txt -----------------------------------------------------------------------
// `mono`/`data`/`readout`/`stamp`/`micro` are the MACHINE voice: telemetry,
// timestamps, counters. Never a sentence a person would say out loud. `quote`
// is the serif, and it is only ever her own words.

export type TxtKind = keyof typeof type | 'mono' | 'data' | 'readout' | 'stamp' | 'micro';

/**
 * `ink`/`muted` read the surface. `accent` is the blue. The rest are kept for
 * compatibility and resolve to what their MEANING is now: `ok` and `alert`
 * are ink (OK has no colour; alarm is a plate, which text alone cannot be),
 * `warn`, `slate` and `amber` are the accent.
 */
export type Tone =
  | 'ink' | 'muted' | 'accent'
  | 'ok' | 'warn' | 'alert' | 'slate' | 'paper' | 'amber' | 'white'
  | 'nightInk' | 'nightMuted';

const kindStyle = (k: TxtKind): TextStyle =>
  k === 'mono' ? mono.data
  : k === 'data' ? mono.big
  : k === 'readout' ? mono.hero
  : k === 'stamp' ? mono.stamp
  : k === 'micro' ? mono.micro
  : (type[k] as TextStyle);

/**
 * Resolve a tone against the surface and scheme. Absent -> the surface's ink;
 * `muted` -> the surface's muted; `ink` -> the scheme's ink on purpose
 * (explicit wins, and it is right on every light-mode plate now). `accent`
 * follows the surface so it stays legible on a blue plate.
 */
export function toneColor(tone: Tone | undefined, surface: SurfaceTone, scheme: Scheme = 'light'): string {
  const c = surfaceColors(surface, scheme);
  const th = themes[scheme];
  switch (tone) {
    case undefined: return c.ink;
    case 'muted': return c.muted;
    case 'ink': case 'ok': case 'alert': return th.ink;
    case 'accent': case 'warn': case 'slate': case 'amber': return c.accent;
    case 'paper': return th.paper;
    case 'white': return th.white;
    case 'nightInk': return th.nightInk;
    case 'nightMuted': return th.nightMuted;
  }
}

export function Txt({
  kind = 'body', tone, children, style, ...rest
}: {
  kind?: TxtKind; tone?: Tone; children: React.ReactNode; style?: TextStyle | TextStyle[];
} & React.ComponentProps<typeof Text>) {
  const surface = useSurface();
  const { scheme } = useTheme();
  return (
    <Text {...rest} style={[kindStyle(kind), { color: toneColor(tone, surface, scheme) }, style]}>
      {children}
    </Text>
  );
}
