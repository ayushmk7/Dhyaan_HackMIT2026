// Orchestrated entrance (distinctive-frontend.md §3): one staggered load
// sequence per screen, nothing else animates unprompted. Reanimated, so the
// whole sequence runs on the UI thread and survives a slow first fetch.
import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';
import { motion } from '@/theme/tokens';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (live) setReduced(v); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { live = false; sub.remove(); };
  }, []);
  return reduced;
}

// GLASS TRAP — do not "clean this up" to 0. expo-glass-effect disables the
// glass entirely when a GlassView or ANY ancestor has opacity exactly 0, so an
// <Entrance> around glass chrome would reveal a dead grey box. 0.01 is
// invisible to the eye and alive to the effect.
const INVISIBLE = 0.01;

export function Entrance({
  index = 0, children, style, distance = 22,
}: {
  /** Position in the sequence. 0 is the hero; each step costs motion.stagger ms. */
  index?: number;
  children: React.ReactNode;
  style?: ViewStyle;
  /** How far it rises. Bigger for the hero, smaller for a dense list. */
  distance?: number;
}) {
  const reduced = useReducedMotion();
  const p = useSharedValue(0);

  useEffect(() => {
    if (reduced) { p.value = 1; return; }
    p.value = withDelay(index * motion.stagger, withSpring(1, motion.enter));
  }, [index, reduced, p]);

  // The spring overshoots past 1, so opacity clamps while scale is allowed to
  // ring a little — that tiny overshoot is the whole reason this is a spring.
  const anim = useAnimatedStyle(() => ({
    opacity: INVISIBLE + (1 - INVISIBLE) * Math.min(1, p.value),
    transform: [
      { translateY: (1 - p.value) * distance },
      { scale: 0.985 + 0.015 * p.value },
    ],
  }));

  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

/**
 * The page-load choreography in one wrapper: every direct child becomes the
 * next beat of the same sequence. Use it once per screen, around the column of
 * sections — reaching for <Entrance index={n}> by hand is for odd layouts.
 */
export function Stagger({
  children, style, from = 0, gap,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  /** Start later in the sequence — when something above already took beats 0..n. */
  from?: number;
  /** Vertical rhythm between beats, in sp() units. Omit to space them yourself. */
  gap?: number;
}) {
  const kids = React.Children.toArray(children).filter(Boolean);
  return (
    <Animated.View style={style}>
      {kids.map((child, i) => (
        <Entrance key={i} index={from + i} style={gap && i > 0 ? { marginTop: gap * 4 } : undefined}>
          {child}
        </Entrance>
      ))}
    </Animated.View>
  );
}
