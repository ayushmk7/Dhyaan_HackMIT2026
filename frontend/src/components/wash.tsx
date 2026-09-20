// The atmospheric ground (distinctive-frontend.md §4). Glass is only as good as
// what it refracts, so the ground is layered: a base ramp, two crossed blooms
// that fake a mesh gradient, and 64x64 grain at 4%.
//
// ponytail: expo-linear-gradient has no radial mode, so a "bloom" is a linear
// gradient fading to a zero-alpha copy of ITS OWN colour along a diagonal.
// Two crossed at different angles read as light pooling in a corner. Ceiling:
// it is not radial, so a bloom can't sit in the middle of the screen. Upgrade
// would be an SVG radial gradient — a dependency this build does not need.
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { DimensionValue, Image, StyleSheet, View, ViewStyle } from 'react-native';
import { palette } from '@/theme/tokens';

export type WashTone = 'day' | 'night' | 'alarm';

// Fading to the string 'transparent' interpolates through black on iOS; fade to
// a zero-alpha copy of the same colour instead.
const clear = (rgb: string) => `rgba(${rgb},0)`;
const solid = (rgb: string, a: number) => `rgba(${rgb},${a})`;

const TONES: Record<WashTone, { base: [string, string, string]; warm: string; cool: string }> = {
  day: { base: ['#FCF6E8', '#F9F3E6', palette.paper], warm: '255,246,224', cool: '210,216,228' },
  night: { base: [palette.nightRaised, palette.night, palette.night], warm: '120,150,190', cool: '0,0,0' },
  // The takeover. Rust is the alarm colour and this is the one place it grounds.
  alarm: { base: [palette.rust, palette.rustDeep, palette.rustDeep], warm: '255,180,150', cool: '0,0,0' },
};

export function Wash({
  height = 340, tone = 'day', style,
}: { height?: DimensionValue; tone?: WashTone; style?: ViewStyle }) {
  const t = TONES[tone];
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', top: 0, left: 0, right: 0, height }, style]}>
      <LinearGradient colors={t.base} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
      {/* Bloom one: light pooling from the top-left. */}
      <LinearGradient
        colors={[solid(t.warm, 0.55), clear(t.warm)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.95, y: 0.75 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Bloom two: the opposite corner going cool, which is what gives the
          ground a direction for glass to bend. */}
      <LinearGradient
        colors={[clear(t.cool), solid(t.cool, 0.16)]}
        start={{ x: 1, y: 0.05 }}
        end={{ x: 0.15, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* react-native's Image, not expo-image, purely because only this one has
          a repeat resize mode, which is the entire job here. */}
      <Image
        source={require('../../assets/images/grain.png')}
        style={[StyleSheet.absoluteFill, { opacity: tone === 'day' ? 0.04 : 0.07 }]}
        resizeMode="repeat"
        accessible={false} // decorative; nothing here is content
      />
    </View>
  );
}
