// The one glass surface in the app. Every floating thing (tab bar, header,
// sheet, the alert takeover, the presence hero) goes through <Glass/>, so the
// availability check and its fallback exist in exactly one place.
//
// The law: glass is for chrome that content passes UNDER. A surface that
// content merely sits inside stays opaque (see <Card/>). Frosted text on
// frosted text is how a design system dies.
import {
  GlassContainer, GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable,
} from 'expo-glass-effect';
import React from 'react';
import { StyleProp, StyleSheet, View, ViewProps, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/theme';
import { elevation, radius as R, sp } from '@/theme/tokens';

export type GlassTone = 'neutral' | 'night' | 'alarm';

// BOTH checks, and the order matters. `isGlassEffectAPIAvailable` is the
// runtime one: some iOS 26 betas ship the design without the API and calling
// into it crashes. `isLiquidGlassAvailable` is the design one. On Android, in
// older iOS and wherever the native module is absent these throw or return
// false, hence the try/catch. Module scope: the answer cannot change mid-session.
export const glassAvailable: boolean = (() => {
  try { return isGlassEffectAPIAvailable() && isLiquidGlassAvailable(); } catch { return false; }
})();

export function Glass({
  children, tone = 'neutral', clear = false, radius = R.glass,
  lift = 'float', interactive = false, style, ...rest
}: {
  children?: React.ReactNode;
  tone?: GlassTone;
  /** `clear` = thinner, more transparent. Use over photography, not over text. */
  clear?: boolean;
  radius?: number;
  lift?: keyof typeof elevation;
  /** Native glass only: the surface reacts to touch. Wrap tappable chrome. */
  interactive?: boolean;
  style?: StyleProp<ViewStyle>;
} & Omit<ViewProps, 'style'>) {
  const t = useTheme();
  const base: ViewStyle = { borderRadius: radius, overflow: 'hidden' };
  const shadow = elevation[lift] as ViewStyle;
  // Neutral glass follows the scheme; night glass is always dark; alarm glass
  // sits on the takeover, which is the inverse of the scheme.
  const glassScheme =
    tone === 'night' ? 'dark' : tone === 'alarm' ? (t.isDark ? 'light' : 'dark') : t.scheme;

  if (glassAvailable) {
    return (
      // The shadow cannot live on the glass view itself (overflow:hidden clips
      // it), so it rides a plain wrapper and the glass fills it.
      <View style={[{ borderRadius: radius }, shadow]}>
        <GlassView
          {...rest}
          glassEffectStyle={clear ? 'clear' : 'regular'}
          tintColor={t.glass.tint[tone]}
          isInteractive={interactive}
          colorScheme={glassScheme}
          style={[base, style]}
        >
          {children}
        </GlassView>
      </View>
    );
  }

  const f = t.glass.fallback[tone];
  return (
    <View style={[{ borderRadius: radius }, shadow]}>
      <View
        {...rest}
        style={[
          base,
          { backgroundColor: f.fill, borderWidth: StyleSheet.hairlineWidth, borderColor: f.line },
          clear && { opacity: 0.94 },
          style,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

// Two glass surfaces closer than `spacing` merge into one blob (the Apple
// gooey effect). Only meaningful with native glass; elsewhere it is a plain
// row, which is the correct degradation.
export function GlassGroup({
  children, spacing = 24, style,
}: { children: React.ReactNode; spacing?: number; style?: ViewStyle }) {
  return <GlassContainer spacing={spacing} style={style}>{children}</GlassContainer>;
}

// ---- FloatingBar ---------------------------------------------------------------

/** Reserve this much bottom padding on a Screen so the bar never covers the
 *  last row. `Screen`'s `floatingBar` prop does it for you. */
export const FLOATING_BAR_CLEARANCE = 96;

/**
 * The pinned bottom action surface: content scrolls UNDER it, it floats over.
 * One or two buttons, never a toolbar of six. Use for the screen's single
 * commitment ("I've got her", "Send", "Pair this band").
 */
export function FloatingBar({
  children, tone = 'neutral', style, inset = true,
}: {
  children: React.ReactNode;
  tone?: GlassTone;
  style?: ViewStyle;
  /** false when the bar sits above a tab bar that already owns the inset. */
  inset?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        paddingHorizontal: sp(4),
        paddingBottom: (inset ? insets.bottom : 0) + sp(3),
        paddingTop: sp(3),
      }}
    >
      <Glass tone={tone} radius={R.bar} lift="float" interactive style={[{ padding: sp(2) }, style]}>
        {children}
      </Glass>
    </View>
  );
}
