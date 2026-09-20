// One native-stack header recipe for every tab stack — real UINavigationBars
// with large titles are what make this read as a shipped iOS app.
//
// These are the app's last colours that cannot come from a surface context: a
// native header is drawn by UIKit, not by our components, so it has to be
// handed hex values. Reading them from `useTheme()` is what keeps the header
// from floating light over a dark app — the static `palette` is light-only.
import React from 'react';
import { Stack } from 'expo-router';
import { useTheme } from '@/theme';

export function TabStack({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        headerLargeTitle: true,
        headerLargeTitleShadowVisible: false,
        headerLargeStyle: { backgroundColor: t.paper },
        headerStyle: { backgroundColor: t.paper },
        headerShadowVisible: false,
        headerTintColor: t.accent,
        headerTitleStyle: { color: t.ink },
        contentStyle: { backgroundColor: t.paper },
      }}
    >
      {children}
    </Stack>
  );
}

export { Stack };
