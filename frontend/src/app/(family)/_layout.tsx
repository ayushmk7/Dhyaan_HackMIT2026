// Family tabs: Today · Her day · Ask · Settings. Each tab is its own native stack.
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
      initialRouteName="home"
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
      <Tabs.Screen name="home" options={{ title: 'Today', tabBarIcon: glyph('house') }} />
      <Tabs.Screen name="timeline" options={{ title: 'Her day', tabBarIcon: glyph('calendar.day.timeline.left') }} />
      <Tabs.Screen name="chat" options={{ title: 'Ask', tabBarIcon: glyph('bubble.left') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: glyph('gearshape') }} />
    </Tabs>
  );
}
