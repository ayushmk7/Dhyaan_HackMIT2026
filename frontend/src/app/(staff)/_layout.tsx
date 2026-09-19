// Staff tabs: Triage · Floor · Rounds (§10.1 S1–S5). Same quiet bar as family.
import { Tabs } from 'expo-router';
import React from 'react';
import { ColorValue, Text } from 'react-native';
import { palette } from '@/theme/tokens';

const glyph = (g: string) =>
  ({ color, focused }: { color: ColorValue; focused: boolean }) => (
    <Text style={{ fontSize: 18, color, fontWeight: focused ? '700' : '400' }}>{g}</Text>
  );

export default function StaffLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.slate,
        tabBarInactiveTintColor: palette.inkMuted,
        tabBarStyle: {
          backgroundColor: palette.paper,
          borderTopColor: palette.line,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Triage', tabBarIcon: glyph('≡') }} />
      <Tabs.Screen name="floor" options={{ title: 'Floor', tabBarIcon: glyph('⌗') }} />
      <Tabs.Screen name="rounds" options={{ title: 'Rounds', tabBarIcon: glyph('☾') }} />
      <Tabs.Screen name="resident/[id]" options={{ href: null }} />
    </Tabs>
  );
}
