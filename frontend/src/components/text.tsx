// The one text component, and the surface it sits on.
//
// `Surface` is a context, not a View: it tells everything inside it what it is
// resting on (paper, the night ground, an ink slab, a cream slab, the alarm
// takeover) so that Txt, Rule, Hairline, DataLabel, Marquee, Btn and Chip pick
// the right default colours without every screen passing `night` or an rgba
// to each child. Explicit props always win; the surface only fills the gaps.
//
// This file imports nothing from the rest of the component tree, so brutal.tsx,
// viz.tsx, avatar.tsx and alert-extras.tsx can all use <Txt> without a cycle.
import React from 'react';
import { Text, TextStyle } from 'react-native';
import { mono, onCream, onDark, palette, type } from '@/theme/tokens';

// ---- Surface ------------------------------------------------------------------

export type SurfaceTone = 'paper' | 'night' | 'ink' | 'cream' | 'alarm';

const SurfaceCtx = React.createContext<SurfaceTone>('paper');

/** Declares what the children rest on. Pure context; renders no View. */
export function Surface({ tone, children }: { tone: SurfaceTone; children: React.ReactNode }) {
  return <SurfaceCtx.Provider value={tone}>{children}</SurfaceCtx.Provider>;
}

export const useSurface = (): SurfaceTone => React.useContext(SurfaceCtx);

/** Dark surfaces take light text. `cream` is the one light plate on a dark screen. */
export const isDarkSurface = (t: SurfaceTone) => t === 'night' || t === 'ink' || t === 'alarm';

/**
 * The colour set a surface hands its children. One table, read everywhere.
 * `ink` = primary text. `muted` = a secondary sentence or caption. `label` =
 * a DataLabel's machine label. `faint` = the passive chevron. `line` = a
 * hairline. `rule` = the 2px brutalist rule. `wash`/`pressed` = quiet fills.
 */
export const surfaceColors = (t: SurfaceTone) => {
  switch (t) {
    case 'night':
      return {
        ink: palette.nightInk, muted: palette.nightMuted, label: palette.nightMuted, faint: palette.nightMuted,
        line: palette.nightLine, rule: palette.nightInk, wash: palette.nightRaised,
        pressed: palette.nightLine,
      };
    case 'ink':
    case 'alarm':
      return {
        ink: onDark.ink, muted: onDark.soft, label: onDark.muted, faint: onDark.muted,
        line: onDark.line, rule: onDark.rule, wash: onDark.wash, pressed: onDark.pressed,
      };
    case 'cream':
      return {
        ink: onCream.ink, muted: onCream.muted, label: onCream.muted, faint: onCream.muted,
        line: onCream.rule, rule: onCream.rule, wash: onCream.wash, pressed: onCream.pressed,
      };
    default:
      return {
        ink: palette.ink, muted: palette.inkMuted, label: palette.inkMuted, faint: palette.inkFaint,
        line: palette.line, rule: palette.ink, wash: palette.slateWash,
        pressed: palette.slateWashDeep,
      };
  }
};

// ---- Txt -----------------------------------------------------------------------
// `mono`/`data`/`readout`/`stamp`/`micro` are the MACHINE voice — telemetry,
// timestamps, counters. Never a sentence a person would say out loud. `quote`
// is the serif, and it is only ever her own words.

export type TxtKind = keyof typeof type | 'mono' | 'data' | 'readout' | 'stamp' | 'micro';
export type Tone =
  | 'ink' | 'muted' | 'ok' | 'warn' | 'alert' | 'slate' | 'paper' | 'amber' | 'white'
  | 'nightInk' | 'nightMuted';

const fixedTone: Record<Exclude<Tone, 'ink' | 'muted'>, string> = {
  ok: palette.moss, warn: palette.ochre, alert: palette.rust, slate: palette.slate,
  paper: palette.paper, amber: palette.amber, white: onDark.ink,
  nightInk: palette.nightInk, nightMuted: palette.nightMuted,
};

const kindStyle = (k: TxtKind): TextStyle =>
  k === 'mono' ? mono.data
  : k === 'data' ? mono.big
  : k === 'readout' ? mono.hero
  : k === 'stamp' ? mono.stamp
  : k === 'micro' ? mono.micro
  : (type[k] as TextStyle);

/**
 * Resolve a tone against the surface. Absent -> the surface's ink; `muted` ->
 * the surface's muted; `ink` stays palette.ink on purpose (explicit wins, and
 * an explicit black on a black slab is the caller's to notice). Everything
 * else is a fixed colour with one meaning.
 */
export function toneColor(tone: Tone | undefined, surface: SurfaceTone): string {
  const c = surfaceColors(surface);
  if (tone === undefined) return c.ink;
  if (tone === 'muted') return c.muted;
  if (tone === 'ink') return palette.ink;
  return fixedTone[tone];
}

export function Txt({
  kind = 'body', tone, children, style, ...rest
}: {
  kind?: TxtKind; tone?: Tone; children: React.ReactNode; style?: TextStyle | TextStyle[];
} & React.ComponentProps<typeof Text>) {
  const surface = useSurface();
  return (
    <Text {...rest} style={[kindStyle(kind), { color: toneColor(tone, surface) }, style]}>
      {children}
    </Text>
  );
}
