// Dhyaan primitives. Every screen builds from these — see DESIGN.md.
import React from 'react';
import {
  ActivityIndicator, Pressable, RefreshControlProps, ScrollView, StyleSheet, Text, TextInput,
  TextStyle, View, ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cardShadow, palette, radius, sp, stateColor, type, ResidentState } from '@/theme/tokens';
import { IconBadge } from './icon';

// ---- Screen -----------------------------------------------------------------

export function Screen({
  children, scroll = true, night = false, style, padded = true, refreshControl, native = false,
}: {
  children: React.ReactNode; scroll?: boolean; night?: boolean;
  style?: ViewStyle; padded?: boolean;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  /** Screen sits under a native-stack header: let iOS manage the top inset. */
  native?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const base: ViewStyle = {
    flex: 1,
    backgroundColor: night ? palette.night : palette.paper,
  };
  const pad: ViewStyle = padded
    ? { paddingHorizontal: sp(4), paddingBottom: insets.bottom + sp(6) }
    : {};
  const top = { paddingTop: native ? sp(2) : insets.top + sp(3) };
  if (!scroll) {
    return <View style={[base, top, pad, style]}>{children}</View>;
  }
  return (
    <View style={base}>
      <ScrollView
        contentInsetAdjustmentBehavior={native ? 'automatic' : 'never'}
        contentContainerStyle={[top, pad, style]}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
      >
        {children}
      </ScrollView>
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

type TxtKind = 'display' | 'title' | 'heading' | 'stat' | 'body' | 'label' | 'caption';
type Tone = 'ink' | 'muted' | 'ok' | 'warn' | 'alert' | 'slate' | 'paper' | 'nightInk' | 'nightMuted';

const toneColor: Record<Tone, string> = {
  ink: palette.ink, muted: palette.inkMuted, ok: palette.moss, warn: palette.ochre,
  alert: palette.rust, slate: palette.slate, paper: palette.paper,
  nightInk: palette.nightInk, nightMuted: palette.nightMuted,
};

export function Txt({
  kind = 'body', tone = 'ink', children, style, ...rest
}: {
  kind?: TxtKind; tone?: Tone; children: React.ReactNode; style?: TextStyle | TextStyle[];
} & React.ComponentProps<typeof Text>) {
  return (
    <Text {...rest} style={[type[kind] as TextStyle, { color: toneColor[tone] }, style]}>
      {children}
    </Text>
  );
}

// ---- Buttons --------------------------------------------------------------------

export function Btn({
  label, onPress, kind = 'primary', disabled, busy, night = false, style,
}: {
  label: string; onPress: () => void; kind?: 'primary' | 'quiet' | 'danger' | 'ghost';
  disabled?: boolean; busy?: boolean; night?: boolean; style?: ViewStyle;
}) {
  // quiet = iOS "tonal": filled wash, no border. Borders read as wireframe.
  const bg = {
    primary: palette.slate, danger: palette.rust,
    quiet: night ? palette.nightRaised : palette.slateWash, ghost: 'transparent',
  }[kind];
  const pressedBg = {
    primary: palette.slateDeep, danger: palette.rustDeep,
    quiet: night ? palette.nightLine : '#DAE4EE', ghost: 'transparent',
  }[kind];
  const fg =
    kind === 'primary' || kind === 'danger'
      ? '#FFFFFF'
      : night ? palette.nightInk : palette.slate;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: pressed ? pressedBg : bg, opacity: disabled ? 0.45 : 1 },
        style,
      ]}
    >
      {busy
        ? <ActivityIndicator color={fg} />
        : <Text style={[styles.btnLabel, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

// ---- Field ----------------------------------------------------------------------
// ponytail: one input style, one place. Every onboarding screen was about to
// copy the same six lines out of consent.tsx.

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
        onSubmitEditing={onSubmitEditing}
        style={[styles.input, multiline && { minHeight: 76, textAlignVertical: 'top' }]}
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

// SF semibold section header — Fraunces stays reserved for the screen's one hero.
export const SectionTitle = ({ children, night = false }: { children: React.ReactNode; night?: boolean }) => (
  <Txt kind="heading" tone={night ? 'nightInk' : 'ink'} style={{ marginTop: sp(7), marginBottom: sp(2.5) }}>
    {children}
  </Txt>
);

// Borderless white card on the warm ground — the grouped-table look. Never add
// a border to a card; separators live INSIDE cards as <Hairline/>.
export const Card = ({ children, style, night = false }: { children: React.ReactNode; style?: ViewStyle; night?: boolean }) => (
  <View
    style={[
      {
        backgroundColor: night ? palette.nightRaised : palette.raised,
        borderRadius: radius.card,
        padding: sp(4),
      },
      !night && cardShadow,
      night && { borderWidth: 1, borderColor: palette.nightLine },
      style,
    ]}
  >
    {children}
  </View>
);

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
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected
            ? palette.slate
            : pressed ? '#DAE4EE' : night ? palette.nightRaised : palette.slateWash,
        },
      ]}
    >
      <Text style={[type.caption, { fontWeight: '600', color: selected ? '#fff' : night ? palette.nightInk : palette.slate }]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ---- ADL stat tile ------------------------------------------------------------
// White card, tinted icon badge, BIG value, tiny label — the Health-app grammar.
// Color lives in the badge; the card stays white (washes read as murk).

export function StatTile({
  icon, state, value, label,
}: { icon: string; state: 'ok' | 'warn' | 'unknown'; value: string; label: string }) {
  const badge = state === 'ok' ? palette.moss : state === 'warn' ? palette.ochre : '#A9A192';
  return (
    <View style={[styles.tile, cardShadow]}>
      <IconBadge name={icon} color={badge} size={30} />
      <Text style={[type.stat, { color: palette.ink, marginTop: sp(2.5) }]} numberOfLines={1}>
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
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.card,
    paddingHorizontal: sp(4),
    paddingVertical: sp(3),
    minHeight: 50,
  },
});
