// The atmospheric ground (distinctive-frontend.md §4). Glass is only as good as
// what it refracts, so the ground is layered: a base ramp, two crossed blooms
// that fake a mesh gradient, and 64x64 grain at 4%.
//
// The ramps live in tokens (`washTone`, resolved per scheme by `useTheme`).
// `day` is white pooling to a blue-grey corner in light mode and the black
// ramp in dark mode; `night` and `alarm` are the two blue grounds, pale in
// light and deep in dark. A deep wash is not an inverted light wash: the
// blooms are dimmer and the grain heavier, because light on a deep plate
// reads as glare.
//
// ponytail: expo-linear-gradient has no radial mode, so a "bloom" is a linear
// gradient fading to a zero-alpha copy of ITS OWN colour along a diagonal.
// Two crossed at different angles read as light pooling in a corner. Ceiling:
// it is not radial, so a bloom can't sit in the middle of the screen. Upgrade
// would be an SVG radial gradient, a dependency this build does not need.
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { DimensionValue, Image, StyleSheet, View, ViewStyle } from 'react-native';
import { useTheme } from '@/theme/theme';
import type { WashTones } from '@/theme/tokens';

export type WashTone = keyof WashTones;

// Fading to the string 'transparent' interpolates through black on iOS; fade to
// a zero-alpha copy of the same colour instead.
const clear = (rgb: string) => `rgba(${rgb},0)`;
const solid = (rgb: string, a: number) => `rgba(${rgb},${a})`;

export function Wash({
  height = 340, tone = 'day', style,
}: { height?: DimensionValue; tone?: WashTone; style?: ViewStyle }) {
  const th = useTheme();
  const t = th.washTone[tone];
  // Bloom strength: a white bloom on a dark ramp is glare, so it is halved.
  const warmA = t.dark ? 0.22 : 0.55;
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', top: 0, left: 0, right: 0, height }, style]}>
      <LinearGradient colors={t.base} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
      {/* Bloom one: light pooling from the top-left. */}
      <LinearGradient
        colors={[solid(t.warm, warmA), clear(t.warm)]}
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
        style={[StyleSheet.absoluteFill, { opacity: t.grain }]}
        resizeMode="repeat"
        accessible={false} // decorative; nothing here is content
      />
    </View>
  );
}
