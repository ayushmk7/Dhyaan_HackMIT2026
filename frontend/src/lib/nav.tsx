// One native-stack header recipe for every tab stack — real UINavigationBars
// with large titles are what make this read as a shipped iOS app.
import React from 'react';
import { Stack } from 'expo-router';
import { palette } from '@/theme/tokens';

export function TabStack({ children }: { children: React.ReactNode }) {
  return (
    <Stack
      screenOptions={{
        headerLargeTitle: true,
        headerLargeTitleShadowVisible: false,
        headerLargeStyle: { backgroundColor: palette.paper },
        headerStyle: { backgroundColor: palette.paper },
        headerShadowVisible: false,
        headerTintColor: palette.slate,
        headerTitleStyle: { color: palette.ink },
        contentStyle: { backgroundColor: palette.paper },
      }}
    >
      {children}
    </Stack>
  );
}

export { Stack };
