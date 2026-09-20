// Brutalism, as seasoning. Three pieces: the hard rule, the heading that sits
// on it, and the machine micro-label. Nothing here imports from ui.tsx; the
// dependency runs one way, ui -> brutal, so SectionTitle can reuse Marquee.
//
// The standing rule: brutalism marks MACHINE origin. It never touches the
// reassuring human sentences: no ALL-CAPS eyebrows over prose, ever.
//
// Every piece reads the Surface it sits on and the scheme it is drawn in:
// inside a <Slab>, on a night Screen or in dark mode the rule, the heading and
// the label pick their own colours. `night` and `color`/`tone` props still win.
import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { useTheme } from '@/theme/theme';
import { rule, sp } from '@/theme/tokens';
import { Txt, useSurfaceColors } from './text';

/** `night` prop wins; otherwise the surface decides. */
const useColors = (night: boolean | undefined) =>
  useSurfaceColors(night === undefined ? undefined : night ? 'night' : 'paper');

// ---- Rule ---------------------------------------------------------------------

/** The hard, honest line. `ink` (2px) is the brutalist one; `hair` is a separator. */
export function Rule({
  weight = 'ink', night, color, style,
}: { weight?: keyof typeof rule; night?: boolean; color?: string; style?: ViewStyle }) {
  const c = useColors(night);
  const h = weight === 'hair' ? StyleSheet.hairlineWidth : rule[weight];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ height: h, backgroundColor: color ?? (weight === 'hair' ? c.line : c.rule) }, style]}
    />
  );
}

// ---- Marquee ------------------------------------------------------------------

/**
 * Section heading + 2px ink rule, with optional machine metadata parked on the
 * right. This is the app's one exposed-structure gesture: you can see where a
 * section begins because there is a hard line, not a colour change.
 */
export function Marquee({
  title, meta, right, night, first = false, style,
}: {
  title: React.ReactNode;
  /** Machine metadata only: a count, a timestamp, a source. Uppercased. */
  meta?: string;
  /** Anything richer than `meta` (a button, a chip). Wins over `meta`. */
  right?: React.ReactNode;
  night?: boolean;
  /** First section on the screen: no big top margin. */
  first?: boolean;
  style?: ViewStyle;
}) {
  const c = useColors(night);
  return (
    <View style={[{ marginTop: first ? 0 : sp(7), marginBottom: sp(2.5) }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: sp(3) }}>
        <Txt kind="heading" style={[{ flexShrink: 1 }, night === undefined ? {} : { color: c.ink }]}>
          {title}
        </Txt>
        {right ?? (!!meta && <DataLabel night={night}>{meta}</DataLabel>)}
      </View>
      <Rule night={night} style={{ marginTop: sp(1.5) }} />
    </View>
  );
}

// ---- DataLabel ----------------------------------------------------------------

/**
 * The uppercase mono micro-label, for telemetry only: FPS, LATENCY, MODEL, REC,
 * DEVICE, SOURCE. If the words are something a person would say to another
 * person, this is the wrong component.
 */
export function DataLabel({
  children, value, tone, night, style,
}: {
  children: React.ReactNode;
  /** Optional reading printed after the label in ink, tabular. */
  value?: string;
  /** A raw colour for both label and value. Prefer letting the Surface decide. */
  tone?: string;
  night?: boolean;
  style?: ViewStyle;
}) {
  const c = useColors(night);
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'baseline', gap: sp(1.5) }, style]}>
      <Txt kind="micro" style={{ color: tone ?? c.label }}>
        {typeof children === 'string' ? children.toUpperCase() : children}
      </Txt>
      {!!value && <Txt kind="stamp" style={{ color: tone ?? c.ink }}>{value}</Txt>}
    </View>
  );
}

// ---- Ticks --------------------------------------------------------------------
// Corner tick marks: the camera console's "this is a machine looking" frame.
// The camera is Dhyaan pointing, so the ticks default to the accent.
// ponytail: four absolutely-positioned L's, not a border image. Ceiling: they
// do not follow a non-rectangular crop, and nothing here has one.

export function CornerTicks({
  color, size = 14, inset = 0, weight = rule.ink,
}: { color?: string; size?: number; inset?: number; weight?: number }) {
  const t = useTheme();
  const fill = color ?? t.accent;
  const arm = (s: ViewStyle) => <View style={[{ position: 'absolute', backgroundColor: fill }, s]} />;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: inset, left: inset, right: inset, bottom: inset }}>
      {arm({ top: 0, left: 0, width: size, height: weight })}
      {arm({ top: 0, left: 0, width: weight, height: size })}
      {arm({ top: 0, right: 0, width: size, height: weight })}
      {arm({ top: 0, right: 0, width: weight, height: size })}
      {arm({ bottom: 0, left: 0, width: size, height: weight })}
      {arm({ bottom: 0, left: 0, width: weight, height: size })}
      {arm({ bottom: 0, right: 0, width: size, height: weight })}
      {arm({ bottom: 0, right: 0, width: weight, height: size })}
    </View>
  );
}
