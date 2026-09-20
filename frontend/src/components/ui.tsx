// Dhyaan primitives. Every screen builds from these — see DESIGN.md.
//
// The depth law in one line: content is opaque, chrome is glass. A card holds
// text, so it stays solid and legible; a bar, header or takeover has content
// travelling under it, so it earns <Glass>.
import React from 'react';
import {
  ActivityIndicator, Pressable, RefreshControlProps, ScrollView, StyleSheet, Text, TextInput,
  TextStyle, View, ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  elevation, mono, motion, palette, radius, sp, stateColor, type, ResidentState,
} from '@/theme/tokens';
import { Marquee, Rule } from './brutal';
import { FLOATING_BAR_CLEARANCE, FloatingBar, Glass } from './glass';
import { IconBadge } from './icon';
import { Wash, WashTone } from './wash';

// ---- press spring ---------------------------------------------------------------
// Every tappable surface in the app dips on the same spring. One hook so it is
// one feel, not nine.

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function usePressSpring() {
  const p = useSharedValue(0);
  const [held, setHeld] = React.useState(false);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - p.value * (1 - motion.pressScale) }],
  }));
  return {
    style,
    held,
    onPressIn: () => { setHeld(true); p.value = withSpring(1, motion.press); },
    onPressOut: () => { setHeld(false); p.value = withSpring(0, motion.press); },
  };
}

// ---- Screen -----------------------------------------------------------------

export function Screen({
  children, scroll = true, night = false, style, padded = true, refreshControl, native = false,
  wash = false, floatingBar,
}: {
  children: React.ReactNode; scroll?: boolean; night?: boolean;
  style?: ViewStyle; padded?: boolean;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  /** Screen sits under a native-stack header: let iOS manage the top inset. */
  native?: boolean;
  /** Atmospheric ground behind the content. `true` follows `night`. Spend it. */
  wash?: boolean | WashTone;
  /** Pinned bottom action. Content scrolls under it; clearance is automatic. */
  floatingBar?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const base: ViewStyle = { flex: 1, backgroundColor: night ? palette.night : palette.paper };
  const pad: ViewStyle = padded
    ? {
        paddingHorizontal: sp(4),
        paddingBottom: insets.bottom + sp(6) + (floatingBar ? FLOATING_BAR_CLEARANCE : 0),
      }
    : {};
  const top = { paddingTop: native ? sp(2) : insets.top + sp(3) };
  const tone: WashTone | null = wash === true ? (night ? 'night' : 'day') : wash === false ? null : wash;

  const body = scroll ? (
    <ScrollView
      contentInsetAdjustmentBehavior={native ? 'automatic' : 'never'}
      contentContainerStyle={[top, pad, style]}
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, top, pad, style]}>{children}</View>
  );

  return (
    <View style={base}>
      {tone && <Wash tone={tone} height="100%" />}
      {body}
      {!!floatingBar && <FloatingBar tone={night ? 'night' : 'neutral'}>{floatingBar}</FloatingBar>}
    </View>
  );
}

// ---- Loading / error states ---------------------------------------------------
// ponytail: one shape for "still loading" and "the request failed" everywhere a
// screen fetches, so no screen ever silently renders nothing on a bad request.

export function LoadingState({ label = 'Loading…', night = false }: { label?: string; night?: boolean }) {
  return (
    <View style={{ paddingVertical: sp(10), alignItems: 'center', gap: sp(3) }}>
      <ActivityIndicator color={night ? palette.nightMuted : palette.inkMuted} />
      <Txt kind="caption" tone={night ? 'nightMuted' : 'muted'}>{label}</Txt>
    </View>
  );
}

export function ErrorState({
  message = 'Couldn’t reach Dhyaan. Check your connection and try again.', onRetry, night = false,
}: { message?: string; onRetry?: () => void; night?: boolean }) {
  return (
    <View style={{ paddingVertical: sp(8), alignItems: 'center', gap: sp(3) }}>
      <Txt kind="body" tone={night ? 'nightInk' : 'ink'} style={{ textAlign: 'center' }}>
        {message}
      </Txt>
      {onRetry && <Btn label="Try again" kind="quiet" night={night} onPress={onRetry} />}
    </View>
  );
}

// ---- Typography ---------------------------------------------------------------
// `mono`/`data`/`stamp`/`micro` are the MACHINE voice — telemetry, timestamps,
// counters. Never a sentence a person would say out loud. `quote` is the serif,
// and it is only ever her own words.

type TxtKind = keyof typeof type | 'mono' | 'data' | 'stamp' | 'micro';
type Tone =
  | 'ink' | 'muted' | 'ok' | 'warn' | 'alert' | 'slate' | 'paper' | 'amber' | 'white'
  | 'nightInk' | 'nightMuted';

const toneColor: Record<Tone, string> = {
  ink: palette.ink, muted: palette.inkMuted, ok: palette.moss, warn: palette.ochre,
  alert: palette.rust, slate: palette.slate, paper: palette.paper, amber: palette.amber,
  white: '#FFFFFF', nightInk: palette.nightInk, nightMuted: palette.nightMuted,
};

const kindStyle = (k: TxtKind): TextStyle =>
  k === 'mono' ? mono.data
  : k === 'data' ? mono.big
  : k === 'stamp' ? mono.stamp
  : k === 'micro' ? mono.micro
  : (type[k] as TextStyle);

export function Txt({
  kind = 'body', tone = 'ink', children, style, ...rest
}: {
  kind?: TxtKind; tone?: Tone; children: React.ReactNode; style?: TextStyle | TextStyle[];
} & React.ComponentProps<typeof Text>) {
  return (
    <Text {...rest} style={[kindStyle(kind), { color: toneColor[tone] }, style]}>
      {children}
    </Text>
  );
}

// ---- Buttons --------------------------------------------------------------------

export function Btn({
  label, onPress, kind = 'primary', disabled, busy, night = false, style,
}: {
  label: string; onPress: () => void;
  /** `glass` is for a button floating over content — a FloatingBar, a takeover. */
  kind?: 'primary' | 'quiet' | 'danger' | 'ghost' | 'glass';
  disabled?: boolean; busy?: boolean; night?: boolean; style?: ViewStyle;
}) {
  const press = usePressSpring();
  // quiet = iOS "tonal": filled wash, no border. Borders read as wireframe.
  const bg = {
    primary: palette.slate, danger: palette.rust,
    quiet: night ? palette.nightRaised : palette.slateWash,
    ghost: 'transparent', glass: 'transparent',
  }[kind];
  const pressedBg = {
    primary: palette.slateDeep, danger: palette.rustDeep,
    quiet: night ? palette.nightLine : '#DAE4EE',
    ghost: 'transparent', glass: 'transparent',
  }[kind];
  const fg =
    kind === 'primary' || kind === 'danger'
      ? '#FFFFFF'
      : night ? palette.nightInk : palette.slate;
  const content = busy
    ? <ActivityIndicator color={fg} />
    : <Text style={[styles.btnLabel, { color: fg }]}>{label}</Text>;

  const inner = (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[
        styles.btn,
        kind !== 'glass' && { backgroundColor: press.held ? pressedBg : bg },
        { opacity: disabled ? 0.45 : 1 },
        press.style,
        // Glass owns its own layout box, so the caller's style goes on the
        // wrapper instead — a margin inside the shadow wrapper offsets the shadow.
        kind !== 'glass' && style,
      ]}
    >
      {content}
    </AnimatedPressable>
  );

  if (kind !== 'glass') return inner;
  return (
    <View style={style}>
      <Glass tone={night ? 'night' : 'neutral'} radius={radius.card} lift="raised" interactive>
        {inner}
      </Glass>
    </View>
  );
}

// ---- Field ----------------------------------------------------------------------
// ponytail: one input style, one place. Every onboarding screen was about to
// copy the same six lines out of consent.tsx.
//
// Brutalist by design: a plate with an exposed rule under it, which goes 2px
// ink on focus. No box outline — a border on four sides reads as a wireframe.

export function Field({
  label, value, onChangeText, placeholder, multiline, maxLength, keyboardType,
  autoCapitalize, autoCorrect, secureTextEntry, hint, style, onSubmitEditing,
}: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; multiline?: boolean; maxLength?: number;
  keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType'];
  autoCapitalize?: React.ComponentProps<typeof TextInput>['autoCapitalize'];
  autoCorrect?: boolean; secureTextEntry?: boolean; hint?: string;
  style?: ViewStyle; onSubmitEditing?: () => void;
}) {
  const [focused, setFocused] = React.useState(false);
  return (
    <View style={style}>
      <Txt kind="label" tone="muted" style={{ marginBottom: sp(1.5) }}>{label}</Txt>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.inkMuted}
        multiline={multiline}
        maxLength={maxLength}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        secureTextEntry={secureTextEntry}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={onSubmitEditing}
        style={[styles.input, multiline && { minHeight: 76, textAlignVertical: 'top' }]}
      />
      <Rule
        weight={focused ? 'ink' : 'hair'}
        color={focused ? palette.ink : palette.line}
      />
      {!!hint && <Txt kind="caption" tone="muted" style={{ marginTop: sp(1) }}>{hint}</Txt>}
    </View>
  );
}

// ---- Layout helpers -----------------------------------------------------------

export const Row = ({ children, style, gap = 2 }: { children: React.ReactNode; style?: ViewStyle; gap?: number }) => (
  <View style={[{ flexDirection: 'row', alignItems: 'center', gap: sp(gap) }, style]}>{children}</View>
);

export const Hairline = ({ night = false, style }: { night?: boolean; style?: ViewStyle }) => (
  <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: night ? palette.nightLine : palette.line }, style]} />
);

// Section heading on a hard 2px ink rule. This is `Marquee` with the title as
// its only argument — reach for Marquee directly when the section has metadata.
export const SectionTitle = ({
  children, night = false, meta,
}: { children: React.ReactNode; night?: boolean; meta?: string }) => (
  <Marquee title={children} night={night} meta={meta} />
);

// Opaque card on the ground — the grouped-table look, now genuinely floating.
// Never add a border; separators live INSIDE cards as <Hairline/>. `glass` is
// opt-in and only correct when something scrolls beneath the card.
export const Card = ({
  children, style, night = false, lift = 'raised', glass = false,
}: {
  children: React.ReactNode; style?: ViewStyle; night?: boolean;
  lift?: keyof typeof elevation; glass?: boolean;
}) => {
  if (glass) {
    return (
      <Glass tone={night ? 'night' : 'neutral'} radius={radius.glass} lift={lift} style={[{ padding: sp(4) }, style]}>
        {children}
      </Glass>
    );
  }
  return (
    <View
      style={[
        {
          backgroundColor: night ? palette.nightRaised : palette.raised,
          borderRadius: radius.card,
          padding: sp(4),
        },
        night ? { borderWidth: 1, borderColor: palette.nightLine } : (elevation[lift] as ViewStyle),
        style,
      ]}
    >
      {children}
    </View>
  );
};

// ---- Status --------------------------------------------------------------------

export const StatusDot = ({ state, size = 10 }: { state: ResidentState; size?: number }) => (
  <View
    style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: stateColor[state].fg,
    }}
  />
);

export function StateChip({ state, label }: { state: ResidentState; label?: string }) {
  const c = stateColor[state];
  return (
    <View style={[styles.chip, { backgroundColor: c.wash }]}>
      <StatusDot state={state} size={8} />
      <Text style={[type.caption, { color: c.fg, fontWeight: '600' }]}>{label ?? c.word}</Text>
    </View>
  );
}

export function Chip({
  label, onPress, selected = false, night = false,
}: { label: string; onPress?: () => void; selected?: boolean; night?: boolean }) {
  const press = usePressSpring();
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      style={[
        styles.chip,
        {
          backgroundColor: selected
            ? palette.slate
            : press.held ? '#DAE4EE' : night ? palette.nightRaised : palette.slateWash,
        },
        press.style,
      ]}
    >
      <Text style={[type.caption, { fontWeight: '600', color: selected ? '#fff' : night ? palette.nightInk : palette.slate }]}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}

// ---- ADL stat tile ------------------------------------------------------------
// White card, tinted icon badge, BIG tabular value, tiny label — the Health-app
// grammar with the datum in the machine face. Color lives in the badge; the card
// stays white (washes read as murk).

export function StatTile({
  icon, state, value, label,
}: { icon: string; state: 'ok' | 'warn' | 'unknown'; value: string; label: string }) {
  const badge = state === 'ok' ? palette.moss : state === 'warn' ? palette.ochre : '#A9A192';
  return (
    <View style={[styles.tile, elevation.raised]}>
      <IconBadge name={icon} color={badge} size={30} />
      <Text
        style={[mono.big, { fontSize: 22, lineHeight: 26, color: palette.ink, marginTop: sp(2.5) }]}
        numberOfLines={1}
      >
        {value}
      </Text>
      <Text style={[type.caption, { color: palette.inkMuted, marginTop: 1 }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 52,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: sp(5),
  },
  btnLabel: { fontSize: 17, fontWeight: '600' as const },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(1.5),
    paddingHorizontal: sp(3),
    paddingVertical: sp(1.5),
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  tile: {
    flex: 1,
    backgroundColor: palette.raised,
    borderRadius: radius.tile,
    padding: sp(3.5),
  },
  input: {
    ...type.body,
    color: palette.ink,
    backgroundColor: palette.raised,
    borderTopLeftRadius: radius.badge,
    borderTopRightRadius: radius.badge,
    paddingHorizontal: sp(3),
    paddingVertical: sp(3),
    minHeight: 50,
  },
});
