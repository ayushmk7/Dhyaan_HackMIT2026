// Dhyaan's information graphics: event rows, the room-time bar, the live
// escalation ladder, and 14-day sparklines. Pure Views, no chart library.
import React, { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme/theme';
import { Hue, sp, rule as ruleW } from '@/theme/tokens';
import type { KEvent, LadderStep, LocationSegment } from '@/lib/types';
import { displaySentence, eventTitle, mins, timeOf, zoneLabel } from '@/lib/format';
import { eventSymbol, Icon } from './icon';
import { Chevron, Row } from './ui';
import { Rule } from './brutal';
import { Txt, useSurfaceColors } from './text';

// ---- THE row (Health anatomy) ---------------------------------------------------
// One row species for the whole app: tiny glyph + label up top, the datum
// below in ink. The GLYPH is the category; the label tint is muted for every
// ordinary category and the accent only for what Dhyaan is pointing at (a
// fall, a deviation, the camera lane). Screens repeat this row; they do not
// invent blocks.

export function MetricRow({
  hue: tint, icon, label, value, unit, sentence, time, onPress, lines = 2, expanded,
}: {
  /** The label tint. Omit it for the surface's muted; pass `t.accent` to point. */
  hue?: string; icon: string; label: string;
  value?: string; unit?: string; sentence?: string; time?: string;
  onPress?: () => void; lines?: number;
  /**
   * Set this when the row opens IN PLACE rather than going somewhere.
   *
   * A right chevron is a promise that tapping leaves this screen. A row that
   * only unfolds was making that promise and breaking it, so a disclosure row
   * gets a chevron that points down, and up once it is open.
   */
  expanded?: boolean;
}) {
  const c = useSurfaceColors();
  const fg = tint ?? c.label;
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      // A disclosure row has to announce whether it is open, or a screen-reader
      // user taps it and is told nothing changed.
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      style={({ pressed }) => [{ paddingVertical: sp(2.5) }, pressed && onPress ? { opacity: 0.55 } : null]}
    >
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={1.5}>
          <Icon name={icon} size={13} color={fg} />
          <Txt kind="tag" style={{ color: fg }}>{label}</Txt>
        </Row>
        <Row gap={1}>
          {!!time && <Txt kind="stamp" tone="muted">{time}</Txt>}
          {onPress && (expanded === undefined
            ? <Chevron size={11} />
            : <Icon name={expanded ? 'chevron.up' : 'chevron.down'} size={11} color={c.faint} />)}
        </Row>
      </Row>
      {value != null ? (
        <Row gap={1} style={{ alignItems: 'baseline', marginTop: 2 }}>
          {/* The datum is the one brutalist note in an otherwise soft row:
              tabular mono, so a column of them lines up and a changing number
              does not reflow the row it lives in. */}
          <Txt kind="data">{value}</Txt>
          {!!unit && <Txt kind="stamp" tone="muted">{unit}</Txt>}
        </Row>
      ) : sentence ? (
        <Txt kind="body" numberOfLines={lines} style={{ marginTop: 2 }}>
          {sentence}
        </Txt>
      ) : null}
    </Pressable>
  );
}

const typeHue = (t: string, hue: Hue): string => {
  if (t.startsWith('meal')) return hue.nutrition;
  if (t.startsWith('walk') || t === 'bed_exit') return hue.activity;
  if (t.includes('night') || t.includes('sleep')) return hue.sleep;
  if (t.includes('fall') || t === 'button_pressed' || t.includes('inactiv')) return hue.heart;
  if (t.includes('visit') || t.startsWith('call') || t.includes('voice')) return hue.social;
  if (t.includes('presence') || t.includes('camera') || t.includes('observed')) return hue.presence;
  return hue.location;
};

export function EventRow({ event, onPress }: { event: KEvent; onPress?: () => void }) {
  const t = useTheme();
  return (
    <MetricRow
      hue={event.deviation ? t.hue.heart : typeHue(event.type, t.hue)}
      icon={eventSymbol(event.type)}
      label={eventTitle(event.type)}
      time={timeOf(event.ts)}
      sentence={displaySentence(event.sentence ?? event.embedding_text ?? '')}
      onPress={onPress}
    />
  );
}

// ---- Room-time stacked bar -------------------------------------------------------
// One value per room on the blue ramp (tokens: `zoneColor`). The legend swatch
// beside each name is what makes seven blues readable; the bar alone is a
// shape, the legend is the key.

export function RoomTimeBar({ segments, night = false }: { segments: LocationSegment[]; night?: boolean }) {
  const t = useTheme();
  const c = useSurfaceColors(night ? 'night' : undefined);
  const total = segments.reduce((a, s) => a + s.s, 0);
  if (!total) {
    return <Txt kind="caption" tone={night ? 'nightMuted' : 'muted'}>No location data for this day yet.</Txt>;
  }
  const zone = (z: string) => t.zoneColor[z] ?? t.zoneColor.unknown;
  // Legend: top zones by dwell, merged.
  const byZone = new Map<string, number>();
  segments.forEach((s) => byZone.set(s.zone, (byZone.get(s.zone) ?? 0) + s.s));
  const top = [...byZone.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  return (
    <View>
      <View style={[styles.bar, { borderWidth: StyleSheet.hairlineWidth, borderColor: c.line }]}>
        {segments.map((s, i) => (
          <View key={i} style={{ flex: s.s, backgroundColor: zone(s.zone) }} />
        ))}
      </View>
      {/* The bar sits ON a line rather than floating: a measurement needs a
          baseline to be read against, and the hard rule is that baseline. */}
      <Rule weight="hair" night={night} />
      <Row style={{ marginTop: sp(2), flexWrap: 'wrap' }} gap={3}>
        {top.map(([z, s]) => (
          <Row key={z} gap={1.5}>
            <View style={[styles.swatch, { backgroundColor: zone(z), borderWidth: StyleSheet.hairlineWidth, borderColor: c.line }]} />
            <Txt kind="caption" tone={night ? 'nightMuted' : 'muted'}>{zoneLabel(z)}</Txt>
            <Txt kind="stamp" tone={night ? 'nightMuted' : 'muted'}>{mins(s)}</Txt>
          </Row>
        ))}
      </Row>
    </View>
  );
}

// ---- Live escalation ladder --------------------------------------------------------

function Pulse({ color }: { color: string }) {
  const [v] = useState(() => new Animated.Value(0.4));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={[styles.pulseDot, { backgroundColor: color, opacity: v }]} />;
}

export function LadderTimeline({ steps, night }: { steps: LadderStep[]; night?: boolean }) {
  // Defaults to the surface it sits on (the takeover is an alarm surface). A
  // bare `night` forces the night ground's set; this ladder only ever runs on
  // the takeover, so leave it unset and let the surface decide.
  const c = useSurfaceColors(night === undefined ? undefined : night ? 'night' : 'paper');
  // The live step pulses in the surface's ink: ink on the light blue takeover,
  // light on the deep one in dark mode. Motion is the signal, not a hue.
  const ink = c.ink;
  const muted = c.muted;
  const line = c.line;
  return (
    <View>
      {steps.map((s, i) => {
        const current = i === steps.length - 1;
        return (
          <View key={`${s.step}-${i}`} style={{ flexDirection: 'row' }}>
            <View style={{ width: 28, alignItems: 'center' }}>
              {current
                ? <Pulse color={ink} />
                : <View style={[styles.doneDot, { borderColor: muted }]} />}
              {i < steps.length - 1 && <View style={[styles.ladderLine, { backgroundColor: line }]} />}
            </View>
            <View style={{ flex: 1, paddingBottom: sp(4) }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt kind="micro" style={{ color: muted }}>
                  {String(i + 1).padStart(2, '0')} · {timeOf(s.at).toUpperCase()}
                </Txt>
              </Row>
              <Txt kind="body" style={{ color: ink, fontWeight: current ? '600' : '400', marginTop: 1 }}>
                {s.detail}
              </Txt>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ---- Sparkline -----------------------------------------------------------------------

/**
 * The last three bars take `tone` (default: the surface's ink); the rest are
 * the hairline grey. Pass the accent when the series is deviating and the
 * ink when it is not: that is the only difference between the two, and it
 * is enough with the word beside it.
 */
export function Sparkline({ series, tone, height = 34 }: { series: number[]; tone?: string; height?: number }) {
  const c = useSurfaceColors();
  // The real backend sends one point per feature (`last_value`), or none at
  // all when a baseline hasn't been learned yet. A one-bar "trend" is a lie
  // and an empty one used to render as a silent void, so both say so.
  if (series.length < 2) {
    return (
      <View style={{ height, justifyContent: 'flex-end' }}>
        <Txt kind="caption" tone="muted">
          {/* voice-ok: an empty state, which docs/frontend-DESIGN.md exempts. */}
          {series.length === 0 ? 'No readings yet' : 'Only one reading so far'}
        </Txt>
      </View>
    );
  }
  const max = Math.max(...series, 1);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height }}>
      {series.map((v, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: Math.max(3, (v / max) * height),
            borderRadius: 2,
            backgroundColor: i >= series.length - 3 ? (tone ?? c.ink) : c.line,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Square, not a pill, and taller: it is a measurement, and a rounded end
  // lies about where the first and last segment actually begin.
  bar: {
    flexDirection: 'row',
    height: 20,
    overflow: 'hidden',
    marginBottom: ruleW.hair,
  },
  swatch: { width: 10, height: 10 },
  pulseDot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  doneDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, marginTop: 5 },
  ladderLine: { width: 2, flex: 1, marginTop: 4 },
});
