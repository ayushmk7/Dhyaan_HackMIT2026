// Family tabs: Today · Her day · Ask · Camera · Settings. Each tab is its own
// native stack. `camera` is the console — derived geometry and telemetry, never
// a feed; there is no endpoint behind it that could return a frame.
//
// The bar floats: inset from the edges, a full capsule of <Glass>, content
// scrolling underneath it. It is a custom `tabBar` on the JS <Tabs>, chosen
// over `expo-router/unstable-native-tabs` on purpose:
//   · Native tabs only float on iOS 26. Everywhere else they are the old
//     edge-anchored UITabBar, and the ask was a floating bar, unconditionally.
//   · Native tabs give JS no bar height. Every pinned <FloatingBar> in the app
//     positions itself from the bottom edge, so with a bar of unknown height
//     the chat composer and the camera console's controls would sit under it.
//   · The API is explicitly unstable and cannot be exercised here beyond a
//     bundle check. This renderer uses only <Glass>, which the app already
//     ships on, and react-navigation's documented `tabBar` contract.
// Revisit native tabs when they stabilise and when `minimizeBehavior` is worth
// more than a bar whose geometry the rest of the app can reason about.
//
// Clearance: the bar owns the bottom of the screen, so every tab screen's
// safe-area bottom inset is raised by TAB_BAR_CLEARANCE. `Screen` pads its
// scroll content from `insets.bottom`, `FloatingBar` sits on `insets.bottom`,
// and `carefile` reads it directly — so a single provider here keeps every
// screen's last row and every pinned action above the bar without a screen
// knowing the bar exists. That is the safe-area mechanism doing its one job:
// chrome reduces the safe area.
import {
  BottomTabBarHeightCallbackContext, Tabs, type BottomTabBarProps,
} from 'expo-router/js-tabs';
import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ColorValue, Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Glass, Txt, useReducedMotion, type GlassTone } from '@/components';
import { Icon } from '@/components/icon';
import { motion, palette, radius, sp } from '@/theme/tokens';

// ---- geometry ------------------------------------------------------------------

/** The capsule. 60 = two `radius.bar` corners meeting, so it is a true pill. */
export const TAB_BAR_HEIGHT = 60;
/** Air between the capsule and the home indicator (or the screen edge). */
export const TAB_BAR_GAP = sp(2);
/** What the bar takes from the bottom of every tab screen, above the system inset. */
export const TAB_BAR_CLEARANCE = TAB_BAR_HEIGHT + TAB_BAR_GAP;
/** Inner padding: the selection pill floats this far inside the capsule. */
const PAD = sp(1);

// ---- the bar -------------------------------------------------------------------

/**
 * A floating, glass tab bar. Reads the same `title` / `tabBarIcon` options
 * the default bar reads, so the tab screens stay declarative. Selection is a
 * quiet ink pill that springs between tabs — the one transition here, and it
 * explains where you came from. Reduced motion: it simply appears.
 */
export function FloatingTabBar({
  state, descriptors, navigation, bottomInset, tone = 'neutral',
}: BottomTabBarProps & {
  /** The REAL system bottom inset — the bar must not read the raised one it causes. */
  bottomInset: number;
  tone?: GlassTone;
}) {
  const reportHeight = useContext(BottomTabBarHeightCallbackContext);
  useEffect(() => {
    // Anyone calling `useBottomTabBarHeight()` gets the truth, not the default
    // bar's guess.
    reportHeight?.(TAB_BAR_CLEARANCE + bottomInset);
  }, [reportHeight, bottomInset]);

  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const count = state.routes.length;
  const slot = width > 0 && count > 0 ? (width - PAD * 2) / count : 0;

  const x = useSharedValue(0);
  const placed = useRef(false);
  useEffect(() => {
    const target = PAD + slot * state.index;
    // The first real placement (once the bar has a width) is instant: nothing
    // animates unprompted. Every tab change after that springs.
    if (slot === 0 || !placed.current || reduced) {
      x.value = target;
      placed.current = slot > 0;
      return;
    }
    x.value = withSpring(target, motion.enter);
  }, [state.index, slot, reduced, x]);
  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  const night = tone !== 'neutral';
  const ink = night ? palette.nightInk : palette.ink;
  const dim = night ? palette.nightMuted : palette.inkMuted;
  // Chrome carries no hue: the selection is ink at low alpha, borrowing the
  // rest of its colour from whatever the glass is refracting.
  const pillFill = night ? 'rgba(234,229,214,0.10)' : 'rgba(28,28,30,0.07)';

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        paddingHorizontal: sp(4),
        paddingBottom: bottomInset + TAB_BAR_GAP,
      }}
    >
      <Glass
        tone={tone}
        radius={radius.bar}
        lift="float"
        interactive
        accessibilityRole="tablist"
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{ height: TAB_BAR_HEIGHT, padding: PAD, flexDirection: 'row' }}
      >
        {slot > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute', top: PAD, bottom: PAD, left: 0,
                width: slot, borderRadius: radius.bar, backgroundColor: pillFill,
              },
              pillStyle,
            ]}
          />
        )}
        {state.routes.map((route, i) => {
          const { options } = descriptors[route.key];
          const focused = state.index === i;
          const label = options.title ?? route.name;
          const color = focused ? ink : dim;
          const onPress = () => {
            const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !e.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              onPress={onPress}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 2 }}
            >
              {options.tabBarIcon?.({ focused, color, size: 22 })}
              <Txt
                kind="caption"
                numberOfLines={1}
                style={{ fontSize: 11, lineHeight: 13, fontWeight: focused ? '700' : '500', color }}
              >
                {label}
              </Txt>
            </Pressable>
          );
        })}
      </Glass>
    </View>
  );
}

/**
 * Raises every descendant's safe-area bottom by the bar's clearance, so
 * `Screen`, `FloatingBar` and any `useSafeAreaInsets()` reader clear the
 * floating bar without knowing it exists. The bar itself must be handed the
 * real inset (see `bottomInset` above).
 */
export function TabBarInsets({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const raised = useMemo(
    () => ({ ...insets, bottom: insets.bottom + TAB_BAR_CLEARANCE }),
    [insets],
  );
  return <SafeAreaInsetsContext.Provider value={raised}>{children}</SafeAreaInsetsContext.Provider>;
}

// ---- the family shell ----------------------------------------------------------

export const glyph = (name: string) => {
  function TabGlyph({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <Icon name={name} size={22} color={color} weight={focused ? 'semibold' : 'regular'} />;
  }
  return TabGlyph;
};

export default function FamilyLayout() {
  const insets = useSafeAreaInsets();
  return (
    <TabBarInsets>
      <Tabs
        initialRouteName="home"
        tabBar={(props) => <FloatingTabBar {...props} bottomInset={insets.bottom} />}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: palette.paper },
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
    </TabBarInsets>
  );
}
