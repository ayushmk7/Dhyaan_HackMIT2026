// Staff tabs: Triage · Floor · Rounds (§10.1 S1–S5). Same quiet bar as family.
import { Tabs } from 'expo-router';
import React from 'react';
import { ColorValue } from 'react-native';
import { Icon } from '@/components/icon';
import { palette } from '@/theme/tokens';

const glyph = (name: string) => {
  function TabGlyph({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <Icon name={name} size={22} color={color} weight={focused ? 'semibold' : 'regular'} />;
  }
  return TabGlyph;
};

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
      <Tabs.Screen name="index" options={{ title: 'Triage', tabBarIcon: glyph('list.bullet') }} />
      <Tabs.Screen name="floor" options={{ title: 'Floor', tabBarIcon: glyph('square.grid.2x2') }} />
      <Tabs.Screen name="rounds" options={{ title: 'Rounds', tabBarIcon: glyph('moon.stars') }} />
      <Tabs.Screen name="resident/[id]" options={{ href: null }} />
    </Tabs>
  );
}
