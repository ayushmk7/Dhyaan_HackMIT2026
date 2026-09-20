// Rounds runs dark: the stack header matches the night ground.
import React from 'react';
import { Stack } from 'expo-router';
import { shell } from '@/lib/copy/staff';
import { useTheme } from '@/theme';

export default function RoundsStack() {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        headerLargeTitle: true,
        headerLargeTitleShadowVisible: false,
        headerLargeStyle: { backgroundColor: t.night },
        headerStyle: { backgroundColor: t.night },
        headerShadowVisible: false,
        headerTintColor: t.nightInk,
        headerTitleStyle: { color: t.nightInk },
        contentStyle: { backgroundColor: t.night },
      }}
    >
      <Stack.Screen name="index" options={{ title: shell.stacks.rounds }} />
    </Stack>
  );
}
