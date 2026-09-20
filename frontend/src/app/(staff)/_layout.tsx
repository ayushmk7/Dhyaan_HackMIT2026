// Staff tabs: Triage · Floor · Rounds. Each tab is its own native stack.
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
      initialRouteName="triage"
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
      <Tabs.Screen name="triage" options={{ title: 'Triage', tabBarIcon: glyph('list.bullet') }} />
      <Tabs.Screen name="floor" options={{ title: 'Floor', tabBarIcon: glyph('square.grid.2x2') }} />
      <Tabs.Screen name="rounds" options={{ title: 'Rounds', tabBarIcon: glyph('moon.stars') }} />
    </Tabs>
  );
}
