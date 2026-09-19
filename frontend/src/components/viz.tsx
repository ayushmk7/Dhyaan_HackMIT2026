// Dhyaan's information graphics: event rows, the room-time bar, the live
// escalation ladder, and 14-day sparklines. Pure Views — no chart library.
import React, { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, sp, radius, type, zoneColor } from '@/theme/tokens';
import type { KEvent, LadderStep, LocationSegment } from '@/lib/types';
import { eventGlyph, eventTitle, mins, timeOf, zoneLabel } from '@/lib/format';
import { Txt, Row } from './ui';

// ---- Timeline event row --------------------------------------------------------

export function EventRow({ event, onPress }: { event: KEvent; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.eventRow, pressed && onPress ? { opacity: 0.6 } : null]}
    >
      <View style={[styles.glyph, event.deviation && styles.glyphDeviation]}>
        <Text style={{ fontSize: 15 }}>{eventGlyph(event.type)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt kind="label">{eventTitle(event.type)}</Txt>
          <Txt kind="caption" tone="muted">{timeOf(event.ts)}</Txt>
        </Row>
        <Txt kind="caption" tone="muted" style={{ marginTop: 2 }} numberOfLines={2}>
          {event.embedding_text}
        </Txt>
      </View>
    </Pressable>
  );
}

// ---- Room-time stacked bar -------------------------------------------------------

export function RoomTimeBar({ segments, night = false }: { segments: LocationSegment[]; night?: boolean }) {
  const total = segments.reduce((a, s) => a + s.s, 0);
  if (!total) {
    return <Txt kind="caption" tone={night ? 'nightMuted' : 'muted'}>No location data for this day yet.</Txt>;
  }
  // Legend: top zones by dwell, merged.
  const byZone = new Map<string, number>();
  segments.forEach((s) => byZone.set(s.zone, (byZone.get(s.zone) ?? 0) + s.s));
  const top = [...byZone.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  return (
    <View>
      <View style={styles.bar}>
        {segments.map((s, i) => (
          <View
            key={i}
            style={{ flex: s.s, backgroundColor: zoneColor[s.zone] ?? zoneColor.unknown }}
          />
        ))}
      </View>
      <Row style={{ marginTop: sp(2), flexWrap: 'wrap' }} gap={3}>
        {top.map(([zone, s]) => (
          <Row key={zone} gap={1.5}>
            <View style={[styles.swatch, { backgroundColor: zoneColor[zone] ?? zoneColor.unknown }]} />
            <Txt kind="caption" tone={night ? 'nightMuted' : 'muted'}>
              {zoneLabel(zone)} · {mins(s)}
            </Txt>
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

export function LadderTimeline({ steps, night = true }: { steps: LadderStep[]; night?: boolean }) {
  const ink = night ? palette.nightInk : palette.ink;
  const muted = night ? palette.nightMuted : palette.inkMuted;
  const line = night ? 'rgba(234,229,214,0.25)' : palette.line;
  return (
    <View>
      {steps.map((s, i) => {
        const current = i === steps.length - 1;
        return (
          <View key={`${s.step}-${i}`} style={{ flexDirection: 'row' }}>
            <View style={{ width: 28, alignItems: 'center' }}>
              {current
                ? <Pulse color={night ? '#FFD9CC' : palette.rust} />
                : <View style={[styles.doneDot, { borderColor: muted }]} />}
              {i < steps.length - 1 && <View style={[styles.ladderLine, { backgroundColor: line }]} />}
            </View>
            <View style={{ flex: 1, paddingBottom: sp(4) }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={[type.caption, { color: muted }]}>
                  {String(i + 1).padStart(2, '0')} · {timeOf(s.at)}
                </Text>
              </Row>
              <Text style={[type.body, { color: ink, fontWeight: current ? '600' : '400', marginTop: 1 }]}>
                {s.detail}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ---- Sparkline -----------------------------------------------------------------------

export function Sparkline({ series, tone = palette.slate, height = 34 }: { series: number[]; tone?: string; height?: number }) {
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
            backgroundColor: i >= series.length - 3 ? tone : palette.line,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  eventRow: {
    flexDirection: 'row',
    gap: sp(3),
    paddingVertical: sp(3),
    alignItems: 'flex-start',
  },
  glyph: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: palette.raised,
    borderWidth: 1, borderColor: palette.line,
    alignItems: 'center', justifyContent: 'center',
  },
  glyphDeviation: { borderColor: palette.ochre, borderWidth: 2 },
  bar: {
    flexDirection: 'row',
    height: 14,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  pulseDot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  doneDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, marginTop: 5 },
  ladderLine: { width: 2, flex: 1, marginTop: 4 },
});
