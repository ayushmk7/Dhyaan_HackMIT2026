// Rounds: the same compact, centred, translucent bar as every other stack
// (see `src/lib/nav.tsx`'s TabStack). It used to be pinned to a night variant;
// the app is light-only now, so the header is the light one like everywhere
// else. The blur only takes effect with `headerTransparent`.
import React from 'react';
import { Stack } from 'expo-router';
import { shell } from '@/lib/copy/staff';
import { type as typeScale, useTheme } from '@/theme';

export default function RoundsStack() {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        headerLargeTitleEnabled: false,
        headerTitleAlign: 'center',
        headerTransparent: true,
        // No `headerBlurEffect`. On iOS 26 react-native-screens applies its own
        // scroll-edge effect to a transparent header, and setting both makes
        // them overlap — RNScreens warns about exactly this at runtime. The
        // system effect is the one Apple ships, so we take it and set nothing.
        headerShadowVisible: false,
        headerTintColor: t.accent,
        // Off the scale, not a literal: a native header is drawn by UIKit and
        // must be handed a number, but the number still comes from the type
        // system so it moves when the scale does. The same pair as TabStack
        // (title size, label weight) so the app has one title size.
        headerTitleStyle: {
          color: t.ink,
          fontSize: typeScale.title.fontSize,
          fontWeight: typeScale.label.fontWeight,
        },
        contentStyle: { backgroundColor: t.paper },
      }}
    >
      <Stack.Screen name="index" options={{ title: shell.stacks.rounds }} />
    </Stack>
  );
}
