// Rounds runs dark: the stack header matches the night ground.
import React from 'react';
import { Stack } from 'expo-router';
import { palette } from '@/theme/tokens';

export default function RoundsStack() {
  return (
    <Stack
      screenOptions={{
        headerLargeTitle: true,
        headerLargeTitleShadowVisible: false,
        headerLargeStyle: { backgroundColor: palette.night },
        headerStyle: { backgroundColor: palette.night },
        headerShadowVisible: false,
        headerTintColor: palette.nightInk,
        headerTitleStyle: { color: palette.nightInk },
        contentStyle: { backgroundColor: palette.night },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Rounds' }} />
    </Stack>
  );
}
