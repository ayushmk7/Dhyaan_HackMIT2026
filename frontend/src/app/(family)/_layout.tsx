// Family tabs: Home · Timeline · Ask · Settings (§10.2).
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

export default function FamilyLayout() {
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
        tabBarLabelStyle: { fontSize: 12 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: glyph('house') }} />
      <Tabs.Screen name="timeline/index" options={{ title: 'Timeline', tabBarIcon: glyph('calendar.day.timeline.left') }} />
      <Tabs.Screen name="chat" options={{ title: 'Ask', tabBarIcon: glyph('bubble.left') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: glyph('gearshape') }} />
      <Tabs.Screen name="timeline/[eventId]" options={{ href: null }} />
      <Tabs.Screen name="plan" options={{ href: null }} />
    </Tabs>
  );
}
