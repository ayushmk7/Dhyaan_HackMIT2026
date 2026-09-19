// Family tabs: Home · Timeline · Ask · Settings (§10.2).
import { Tabs } from 'expo-router';
import React from 'react';
import { ColorValue, Text } from 'react-native';
import { palette } from '@/theme/tokens';

const glyph = (g: string) =>
  ({ color }: { color: ColorValue }) => <Text style={{ fontSize: 18, color }}>{g}</Text>;

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
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: glyph('⌂') }} />
      <Tabs.Screen name="timeline/index" options={{ title: 'Timeline', tabBarIcon: glyph('☰') }} />
      <Tabs.Screen name="chat" options={{ title: 'Ask', tabBarIcon: glyph('✳') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: glyph('⚙') }} />
      <Tabs.Screen name="timeline/[eventId]" options={{ href: null }} />
    </Tabs>
  );
}
