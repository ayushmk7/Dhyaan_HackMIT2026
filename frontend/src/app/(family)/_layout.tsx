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
        // No backgroundColor. An opaque fill is exactly what defeats the
        // system's own liquid-glass tab bar on iOS 26 — the bar is glass by
        // default and painting it flat is how you lose that for free. The
        // hairline stays, because a floating bar still needs an edge.
        //
        // ponytail: the JS tab bar, not `expo-router/unstable-native-tabs`.
        // Native tabs would additionally give `minimizeBehavior:
        // 'onScrollDown'` (the bar shrinking away as you scroll), but the API
        // is explicitly unstable and moving to it rewrites every tab's options
        // — not a trade worth making the week of a demo. Upgrade there once it
        // stabilises.
        tabBarStyle: { borderTopColor: palette.line },
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
