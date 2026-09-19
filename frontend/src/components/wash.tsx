// The atmospheric ground (distinctive-frontend.md §4): a two-stop warm radial
// wash plus a tiled 64x64 grain at 4% opacity. Spent on exactly two screens —
// the sign-in door and Today — because depth is spent, not sprinkled.
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Image, View } from 'react-native';
import { palette } from '@/theme/tokens';

// ponytail: expo-linear-gradient has no radial mode, so the "radial" wash is a
// tall vertical gradient behind the hero. At phone width, over 320px, the two
// read the same. Ceiling: it is not actually radial. Upgrade: an SVG radial
// gradient, which would cost a dependency this build does not need.
export function Wash({ height = 340 }: { height?: number }) {
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, height }}
    >
      <LinearGradient
        colors={['#FCF6E8', '#F9F3E6', palette.paper]}
        locations={[0, 0.55, 1]}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      {/* react-native's Image, not expo-image, purely because only this one
          has a `repeat` resize mode — which is the entire job here. */}
      <Image
        source={require('../../assets/images/grain.png')}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.04 }}
        resizeMode="repeat"
        accessible={false} // decorative; nothing here is content
      />
    </View>
  );
}
