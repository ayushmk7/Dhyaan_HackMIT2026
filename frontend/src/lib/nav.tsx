// One native-stack header recipe for every tab stack: a real UINavigationBar,
// COMPACT and CENTRED. The large title was 52pt of left-aligned chrome that
// pushed every screen's first row down; the compact bar keeps the title where
// iOS puts it and gives the height back to content. The bar is translucent
// (system chrome material), so content scrolls under it; `Screen native` pairs
// it with `contentInsetAdjustmentBehavior="automatic"` so nothing starts
// hidden beneath it.
//
// Prop names are the Expo SDK 57 native-stack ones: `headerLargeTitleEnabled`,
// not the deprecated `headerLargeTitle`. See
// docs.expo.dev/versions/v57.0.0/sdk/router.
//
// These are the app's last colours that cannot come from a surface context: a
// native header is drawn by UIKit, not by our components, so it has to be
// handed hex values. Reading them from `useTheme()` is what keeps the header
// from floating light over a dark app — the static `palette` is light-only.
import React from 'react';
import { Stack } from 'expo-router';
import { useTheme } from '@/theme';
import { type } from '@/theme/tokens';

export function TabStack({ children }: { children: React.ReactNode }) {
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
        headerTitleStyle: { color: t.ink, fontSize: type.label.fontSize, fontWeight: type.label.fontWeight },
        contentStyle: { backgroundColor: t.paper },
      }}
    >
      {children}
    </Stack>
  );
}

export { Stack };
