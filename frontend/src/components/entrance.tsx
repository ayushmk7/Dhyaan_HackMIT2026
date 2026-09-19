// Orchestrated entrance (distinctive-frontend.md §3): one staggered load
// sequence per hero screen, nothing else animates unprompted.
import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, ViewStyle } from 'react-native';

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

export function Entrance({
  index = 0, children, style,
}: { index?: number; children: React.ReactNode; style?: ViewStyle }) {
  const reduced = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 450,
      delay: index * 90,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [progress, index]);

  // Reduced motion: render visible immediately, no flash.
  if (reduced) return <Animated.View style={style}>{children}</Animated.View>;

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [{
            translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }),
          }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
