// Pieces of the alert takeover: the cancel countdown, the ringing visual,
// and the applause-line elapsed stat. Drawn in the surface's ink, which on
// the takeover is white in light mode and black in dark mode. The ElapsedStat
// is the exception and sits on the paper close-out.
import React, { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { mono, sp } from '@/theme/tokens';
import { useReducedMotion } from './entrance';
import { Icon } from './icon';
import { Txt, useSurfaceColors } from './text';

// 30-second cancel window, counting down from the ladder step's timestamp.
export function CancelCountdownRing({ since, windowS = 30 }: { since: string; windowS?: number }) {
  // Starts at windowS; the 250ms tick corrects against the ladder timestamp.
  const [left, setLeft] = useState(windowS);
  const reduced = useReducedMotion();
  const c = useSurfaceColors();
  const [breath] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const t = setInterval(() => {
      setLeft(Math.max(0, Math.ceil(windowS - (Date.now() - new Date(since).getTime()) / 1000)));
    }, 250);
    return () => clearInterval(t);
  }, [since, windowS]);

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(breath, { toValue: 1.05, duration: 500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(breath, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [breath, reduced]);

  return (
    <View style={{ alignItems: 'center', marginVertical: sp(4) }}>
      <Animated.View style={[styles.ring, { borderColor: c.ink, transform: [{ scale: breath }] }]}>
        <Txt kind="readout" style={[styles.ringNumber, { color: c.ink }]}>{left}</Txt>
      </Animated.View>
      <Txt kind="caption" style={[styles.caption, { color: c.muted, marginTop: sp(3) }]}>
        seconds for her to cancel from the band before Dhyaan calls
      </Txt>
    </View>
  );
}

// Concentric pulses behind a phone glyph while a call is ringing.
export function RingingPulse({ label }: { label: string }) {
  const reduced = useReducedMotion();
  const c = useSurfaceColors();
  const [a] = useState(() => new Animated.Value(0));
  const [b] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduced) return;
    const wave = (v: Animated.Value, delay: number) =>
      Animated.loop(Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]));
    const l1 = wave(a, 0); const l2 = wave(b, 700);
    l1.start(); l2.start();
    return () => { l1.stop(); l2.stop(); };
  }, [a, b, reduced]);

  const ringStyle = (v: Animated.Value) => ({
    opacity: v.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.5, 0] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.6] }) }],
  });

  return (
    <View style={{ alignItems: 'center', marginVertical: sp(4) }}>
      <View style={styles.pulseStage}>
        {!reduced && <Animated.View style={[styles.pulseRing, { borderColor: c.ink }, ringStyle(a)]} />}
        {!reduced && <Animated.View style={[styles.pulseRing, { borderColor: c.ink }, ringStyle(b)]} />}
        <View style={[styles.pulseCore, { backgroundColor: c.wash, borderColor: c.rule }]}>
          <Icon name="phone.fill" size={28} color={c.ink} />
        </View>
      </View>
      <Txt kind="caption" style={[styles.caption, { color: c.muted, marginTop: sp(3) }]}>{label}</Txt>
    </View>
  );
}

// The applause line: how fast a human was told.
export function ElapsedStat({ openedAt, closedAt, name }: { openedAt: string; closedAt: string; name: string }) {
  const s = Math.max(1, Math.round((new Date(closedAt).getTime() - new Date(openedAt).getTime()) / 1000));
  return (
    <View style={{ marginTop: sp(6) }}>
      <Txt kind="readout" style={styles.statNumber}>{s} seconds</Txt>
      <Txt kind="body" tone="muted" style={{ marginTop: sp(1) }}>
        from {name}’s fall hitting the floor to a human being told.
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    width: 128, height: 128, borderRadius: 64,
    borderWidth: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  // Tabular, and mono: this number changes every second, and proportional
  // digits make the whole ring twitch as 30 becomes 29 becomes 28.
  ringNumber: { ...mono.hero, fontSize: 56, lineHeight: 62 },
  caption: { textAlign: 'center', maxWidth: 260 },
  pulseStage: { width: 140, height: 140, alignItems: 'center', justifyContent: 'center' },
  pulseRing: {
    position: 'absolute',
    width: 120, height: 120, borderRadius: 60,
    borderWidth: 2,
  },
  pulseCore: {
    width: 76, height: 76, borderRadius: 38,
    borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  // The applause line is a measurement, so it is set like one. It renders on
  // the paper close-out, so its colour comes from the surface.
  statNumber: { ...mono.hero },
});
