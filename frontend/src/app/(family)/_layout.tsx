// Family tabs: Today · Her day · Ask · Camera · Settings. Each tab is its own
// native stack. `camera` is the console — derived geometry and telemetry, never
// a feed; there is no endpoint behind it that could return a frame.
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
      {/* The console. A viewfinder glyph, because that is honestly all it is —
          the frame the camera looks through, with no picture inside it. */}
      <Tabs.Screen name="camera" options={{ title: 'Camera', tabBarIcon: glyph('camera.viewfinder') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: glyph('gearshape') }} />
    </Tabs>
  );
}
