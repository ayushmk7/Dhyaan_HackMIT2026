// Dhyaan primitives. Every screen builds from these — see DESIGN.md.
import React from 'react';
import {
  ActivityIndicator, Pressable, RefreshControlProps, ScrollView, StyleSheet, Text, TextStyle,
  View, ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette, radius, sp, stateColor, type, ResidentState } from '@/theme/tokens';

// ---- Screen -----------------------------------------------------------------

export function Screen({
  children, scroll = true, night = false, style, padded = true, refreshControl,
}: {
  children: React.ReactNode; scroll?: boolean; night?: boolean;
  style?: ViewStyle; padded?: boolean;
  refreshControl?: React.ReactElement<RefreshControlProps>;
}) {
  const insets = useSafeAreaInsets();
  const base: ViewStyle = {
    flex: 1,
    backgroundColor: night ? palette.night : palette.paper,
  };
  const pad: ViewStyle = padded
    ? { paddingHorizontal: sp(5), paddingBottom: insets.bottom + sp(6) }
    : {};
  const top = { paddingTop: insets.top + sp(3) };
  if (!scroll) {
    return <View style={[base, top, pad, style]}>{children}</View>;
  }
  return (
    <View style={base}>
      <ScrollView
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

type TxtKind = 'display' | 'title' | 'stat' | 'body' | 'label' | 'caption';
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
  const bg = { primary: palette.slate, danger: palette.rust, quiet: 'transparent', ghost: 'transparent' }[kind];
  const pressedBg = { primary: palette.slateDeep, danger: palette.rustDeep, quiet: palette.line, ghost: 'transparent' }[kind];
  const fg =
    kind === 'primary' || kind === 'danger'
      ? '#FFFFFF'
      : night ? palette.nightInk : kind === 'quiet' ? palette.ink : palette.slate;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: pressed ? pressedBg : bg, opacity: disabled ? 0.45 : 1 },
        kind === 'quiet' && { borderWidth: 1, borderColor: night ? palette.nightLine : palette.line },
        style,
      ]}
    >
      {busy
        ? <ActivityIndicator color={fg} />
        : <Text style={[styles.btnLabel, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

// ---- Layout helpers -----------------------------------------------------------

export const Row = ({ children, style, gap = 2 }: { children: React.ReactNode; style?: ViewStyle; gap?: number }) => (
  <View style={[{ flexDirection: 'row', alignItems: 'center', gap: sp(gap) }, style]}>{children}</View>
);

export const Hairline = ({ night = false, style }: { night?: boolean; style?: ViewStyle }) => (
  <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: night ? palette.nightLine : palette.line }, style]} />
);

export const SectionTitle = ({ children, night = false }: { children: React.ReactNode; night?: boolean }) => (
  <Txt kind="title" tone={night ? 'nightInk' : 'ink'} style={{ marginTop: sp(7), marginBottom: sp(3) }}>
    {children}
  </Txt>
);

export const Card = ({ children, style, night = false }: { children: React.ReactNode; style?: ViewStyle; night?: boolean }) => (
  <View
    style={[
      {
        backgroundColor: night ? palette.nightRaised : palette.raised,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: night ? palette.nightLine : palette.line,
        padding: sp(4),
      },
      // HIG-style gentle elevation; borders alone read as wireframe.
      !night && {
        shadowColor: palette.ink, shadowOpacity: 0.05, shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
      },
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
          backgroundColor: selected ? palette.slate : pressed ? palette.line : night ? palette.nightRaised : palette.raised,
          borderWidth: 1,
          borderColor: selected ? palette.slate : night ? palette.nightLine : palette.line,
        },
      ]}
    >
      <Text style={[type.caption, { color: selected ? '#fff' : night ? palette.nightInk : palette.ink }]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ---- ADL tile --------------------------------------------------------------------

export function Tile({ title, state, detail }: { title: string; state: 'ok' | 'warn' | 'unknown'; detail: string }) {
  const fg = state === 'ok' ? palette.moss : state === 'warn' ? palette.ochre : palette.inkMuted;
  const wash = state === 'ok' ? palette.mossWash : state === 'warn' ? palette.ochreWash : palette.line;
  return (
    <View style={[styles.tile, { backgroundColor: wash }]}>
      <Text style={[type.label, { color: fg }]}>{title}</Text>
      <Text style={[type.caption, { color: palette.ink, marginTop: sp(1) }]} numberOfLines={2}>
        {detail === '' && state === 'unknown' ? 'No observations yet' : detail}
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
  btnLabel: { fontSize: 17, fontWeight: '600' },
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
    minHeight: 84,
    borderRadius: radius.tile,
    padding: sp(3),
  },
});
