// Dhyaan primitives. Every screen builds from these — see docs/frontend-DESIGN.md.
//
// The depth law in one line: content is opaque, chrome is glass. A card holds
// text, so it stays solid and legible; a bar, header or takeover has content
// travelling under it, so it earns <Glass>.
//
// Every primitive reads the <Surface> it sits on (text.tsx), so a Btn inside a
// Slab, a Rule on the night ground and a Chip on the alarm takeover pick their
// own colours. Explicit `night`/`tone`/`color` props still win.
import React from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControlProps, ScrollView,
  ScrollViewProps, StyleProp, StyleSheet, TextInput, TextStyle, View, ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  elevation, mono, motion, onDark, palette, radius, size as S, sp, stateColor, type, ResidentState,
} from '@/theme/tokens';
import { DataLabel, Marquee, Rule } from './brutal';
import { FLOATING_BAR_CLEARANCE, FloatingBar, Glass, GlassTone } from './glass';
import { Icon, IconBadge } from './icon';
import { isDarkSurface, Surface, surfaceColors, Tone, Txt, useSurface } from './text';
import { Wash, WashTone } from './wash';

// Txt and the surface context live in text.tsx; they are re-exported here so
// `import { Txt } from '@/components'` keeps working unchanged.
export { Surface, Txt, useSurface, surfaceColors, isDarkSurface } from './text';
export type { SurfaceTone, Tone, TxtKind } from './text';

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

/** `night` prop wins; otherwise the surface decides. */
const useNight = (night: boolean | undefined) => {
  const surface = useSurface();
  return night ?? surface === 'night';
};

/** The surface's colour set, with an explicit `night` prop taking precedence. */
const useColors = (night: boolean | undefined) => {
  const surface = useSurface();
  return surfaceColors(night === undefined ? surface : night ? 'night' : 'paper');
};

// ---- Screen -----------------------------------------------------------------

export type ScreenTone = 'paper' | 'night' | 'alarm';

export function Screen({
  children, scroll = true, night = false, style, padded = true, refreshControl, native = false,
  wash = false, floatingBar, floatingBarInset = true, tone, keyboard = false, scrollRef, scrollProps,
}: {
  children: React.ReactNode; scroll?: boolean;
  /** Legacy alias for `tone="night"`. */
  night?: boolean;
  /** The ground: paper (default), the night ground, or the alarm takeover. */
  tone?: ScreenTone;
  style?: ViewStyle; padded?: boolean;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  /** Screen sits under a native-stack header: let iOS manage the top inset. */
  native?: boolean;
  /** Atmospheric ground behind the content. `true` follows the tone. Spend it. */
  wash?: boolean | WashTone;
  /** Pinned bottom action. Content scrolls under it; clearance is automatic. */
  floatingBar?: React.ReactNode;
  /** false on a tab screen: the tab bar already owns the bottom safe area. */
  floatingBarInset?: boolean;
  /** Wrap in a KeyboardAvoidingView (a screen with a composer or a form). */
  keyboard?: boolean;
  /** Reach the ScrollView (scrollToEnd for a conversation). */
  scrollRef?: React.Ref<ScrollView>;
  /** Anything else the ScrollView needs (keyboardShouldPersistTaps, onContentSizeChange…). */
  scrollProps?: Omit<ScrollViewProps, 'contentContainerStyle' | 'refreshControl' | 'children'>;
}) {
  const insets = useSafeAreaInsets();
  const ground: ScreenTone = tone ?? (night ? 'night' : 'paper');
  const groundColor = { paper: palette.paper, night: palette.night, alarm: palette.rustDeep }[ground];
  const base: ViewStyle = { flex: 1, backgroundColor: groundColor };
  const pad: ViewStyle = padded
    ? {
        paddingHorizontal: sp(4),
        paddingBottom: insets.bottom + sp(6) + (floatingBar ? FLOATING_BAR_CLEARANCE : 0),
      }
    : {};
  const top = { paddingTop: native ? sp(2) : insets.top + sp(3) };
  const washTone: WashTone | null =
    wash === true ? (ground === 'paper' ? 'day' : ground) : wash === false ? null : wash;
  const barTone: GlassTone = ground === 'paper' ? 'neutral' : ground;

  const body = scroll ? (
    <ScrollView
      ref={scrollRef}
      contentInsetAdjustmentBehavior={native ? 'automatic' : 'never'}
      showsVerticalScrollIndicator={false}
      {...scrollProps}
      contentContainerStyle={[top, pad, style]}
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, top, pad, style]}>{children}</View>
  );

  const root = (
    <View style={base}>
      {washTone && <Wash tone={washTone} height="100%" />}
      {body}
      {!!floatingBar && (
        <FloatingBar tone={barTone} inset={floatingBarInset}>{floatingBar}</FloatingBar>
      )}
    </View>
  );

  return (
    <Surface tone={ground}>
      {keyboard ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {root}
        </KeyboardAvoidingView>
      ) : root}
    </Surface>
  );
}

// ---- Loading / empty / error / refusal ------------------------------------------
// ponytail: one shape each for "still loading", "nothing here", "the request
// failed" and "Dhyaan declines", so every screen says the same thing the same
// way and no screen ever silently renders nothing.

export function LoadingState({ label = 'Loading…', night }: { label?: string; night?: boolean }) {
  const c = useColors(night);
  return (
    <View style={{ paddingVertical: sp(10), alignItems: 'center', gap: sp(3) }}>
      <ActivityIndicator color={c.muted} />
      <Txt kind="caption" tone="muted">{label}</Txt>
    </View>
  );
}

/**
 * A failed request. Block form (default) centres a sentence and a retry;
 * `inline` is the one-line form for a failed action inside a card or form.
 * Both are ink, not rust: rust means alarm, and a failed save is not one.
 */
export function ErrorState({
  message = 'Couldn’t reach Dhyaan. Check your connection and try again.', onRetry, night, inline = false,
  retryLabel = 'Try again', style,
}: {
  message?: string; onRetry?: () => void; night?: boolean; inline?: boolean; retryLabel?: string;
  style?: ViewStyle;
}) {
  if (inline) {
    return (
      <Row gap={3} style={[{ justifyContent: 'space-between', alignItems: 'flex-start' }, style]}>
        <Txt kind="caption" accessibilityLiveRegion="polite" style={{ flex: 1, fontWeight: '600' }}>
          {message}
        </Txt>
        {onRetry && <Btn kind="link" size="small" label={retryLabel} night={night} onPress={onRetry} />}
      </Row>
    );
  }
  return (
    <View style={[{ paddingVertical: sp(8), alignItems: 'center', gap: sp(3) }, style]}>
      <Txt kind="body" accessibilityLiveRegion="polite" style={{ textAlign: 'center' }}>
        {message}
      </Txt>
      {onRetry && <Btn label={retryLabel} kind="quiet" night={night} onPress={onRetry} />}
    </View>
  );
}

/**
 * Nothing here yet. The sentence is ink (a grey paragraph is the AI tell),
 * invites an action when there is one, and carries machine `meta` beneath.
 * Put it inside a <Card> when the section owns a plate; bare otherwise.
 */
export function EmptyState({
  children, title, action, meta, style,
}: {
  /** The one sentence. Write it before the full state. */
  children: React.ReactNode;
  title?: string;
  action?: React.ReactNode;
  /** Telemetry only (CAMERA cam_1, LAST HEARTBEAT 3 min ago). */
  meta?: string;
  style?: ViewStyle;
}) {
  return (
    <View style={[{ paddingVertical: sp(3) }, style]}>
      {!!title && <Txt kind="title">{title}</Txt>}
      <Txt kind="body" tone={title ? 'muted' : undefined} style={title ? { marginTop: sp(2) } : undefined}>
        {children}
      </Txt>
      {!!action && <View style={{ marginTop: sp(4) }}>{action}</View>}
      {!!meta && <DataLabel style={{ marginTop: sp(3) }}>{meta}</DataLabel>}
    </View>
  );
}

/**
 * A refusal is not an error. A raised hand, ink, a plain sentence, no retry,
 * no colour. `label` names why (Dhyaan doesn’t answer this, for anyone).
 */
export function Refusal({ children, label, style }: {
  children: React.ReactNode; label?: string; style?: ViewStyle;
}) {
  const c = surfaceColors(useSurface());
  return (
    <View style={style}>
      <Row gap={2} style={{ alignItems: 'flex-start' }}>
        <View style={{ paddingTop: 3 }}>
          <Icon name="hand.raised" size={15} color={c.ink} />
        </View>
        <View style={{ flex: 1 }}>
          {!!label && <Txt kind="label" style={{ marginBottom: sp(1) }}>{label}</Txt>}
          <Txt kind="body" style={{ opacity: label ? 0.8 : 1 }}>{children}</Txt>
        </View>
      </Row>
    </View>
  );
}

// ---- Buttons --------------------------------------------------------------------

export type BtnKind =
  | 'primary' | 'quiet' | 'danger' | 'ghost' | 'glass'
  /** A text link in the label weight. `tone="alert"` for a destructive opener. */
  | 'link'
  /** A white plate on a dark or alarm surface: the takeover's one commitment. */
  | 'inverse'
  /** A hairline outline, no fill: the takeover's secondary actions. */
  | 'outline';

export function Btn({
  label, onPress, kind = 'primary', disabled, busy, night, style, size = 'regular', tone,
}: {
  label: string; onPress: () => void;
  /** `glass` is for a button floating over content — a FloatingBar, a takeover. */
  kind?: BtnKind;
  disabled?: boolean; busy?: boolean; night?: boolean; style?: ViewStyle;
  /** `small` = 44pt, for a button beside a field or inside a row. */
  size?: 'regular' | 'small';
  /** `link` only: `alert` for the opener of a destructive, confirmed action. */
  tone?: 'ink' | 'alert';
}) {
  const press = usePressSpring();
  const surface = useSurface();
  const isNight = useNight(night);
  const c = useColors(night);

  if (kind === 'link') {
    const fg = tone === 'alert' ? palette.rust : c.ink;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!disabled || !!busy }}
        disabled={disabled || busy}
        onPress={onPress}
        hitSlop={8}
        style={({ pressed }) => [
          { alignSelf: 'flex-start', paddingVertical: sp(1), opacity: disabled ? 0.45 : pressed ? 0.55 : 1 },
          style,
        ]}
      >
        <Txt kind="label" style={{ color: fg }}>{label}</Txt>
      </Pressable>
    );
  }

  // quiet = iOS "tonal": filled wash, no border. Borders read as wireframe —
  // `outline` is the one exception, and it exists for the alarm takeover.
  const inverseFg = surface === 'alarm' ? palette.rustDeep : surface === 'night' ? palette.night : palette.ink;
  const bg = {
    primary: palette.slate, danger: palette.rust, quiet: c.wash,
    ghost: 'transparent', glass: 'transparent', inverse: onDark.ink, outline: 'transparent',
  }[kind];
  const pressedBg = {
    primary: palette.slateDeep, danger: palette.rustDeep, quiet: c.pressed,
    ghost: 'transparent', glass: 'transparent', inverse: palette.paper, outline: c.pressed,
  }[kind];
  const fg =
    kind === 'primary' || kind === 'danger' ? onDark.ink
    : kind === 'inverse' ? inverseFg
    : c.ink;
  const content = busy
    ? <ActivityIndicator color={fg} />
    : <Txt kind={size === 'small' ? 'label' : 'button'} style={{ color: fg }}>{label}</Txt>;

  const inner = (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[
        styles.btn,
        size === 'small' && styles.btnSmall,
        kind !== 'glass' && { backgroundColor: press.held ? pressedBg : bg },
        kind === 'outline' && { borderWidth: 1.5, borderColor: c.rule },
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
      <Glass tone={isNight ? 'night' : 'neutral'} radius={radius.card} lift="raised" interactive>
        {inner}
      </Glass>
    </View>
  );
}

/**
 * A round icon button: the call button, the composer's send, a reorder arrow.
 * `label` is the accessibility label and is required — an icon alone says
 * nothing to VoiceOver.
 */
export function IconBtn({
  name, label, onPress, kind = 'quiet', size = S.control, disabled, night, style, onLongPress,
}: {
  name: string; label: string; onPress: () => void; onLongPress?: () => void;
  kind?: 'quiet' | 'primary' | 'ghost';
  size?: number; disabled?: boolean; night?: boolean; style?: ViewStyle;
}) {
  const press = usePressSpring();
  const c = useColors(night);
  const bg = kind === 'primary' ? (press.held ? palette.slateDeep : palette.slate)
    : kind === 'quiet' ? (press.held ? c.pressed : c.wash)
    : 'transparent';
  const fg = kind === 'primary' ? onDark.ink : c.ink;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      hitSlop={size < S.hit ? (S.hit - size) / 2 : 0}
      style={[
        {
          width: size, height: size, borderRadius: size / 2, backgroundColor: bg,
          alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.45 : 1,
        },
        press.style,
        style,
      ]}
    >
      <Icon name={name} size={Math.round(size * 0.42)} color={fg} weight={kind === 'primary' ? 'bold' : 'semibold'} />
    </AnimatedPressable>
  );
}

/** The passive "this row opens" mark. Faint, small, never interactive itself. */
export function Chevron({ size = 12, tone = 'faint', style }: {
  size?: number; tone?: 'faint' | 'ink'; style?: ViewStyle;
}) {
  const c = surfaceColors(useSurface());
  return (
    <View style={style}>
      <Icon name="chevron.right" size={size} color={tone === 'ink' ? c.ink : c.faint} />
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
  code = false, minHeight, maxHeight, editable, accessibilityLabel,
}: {
  /** Optional only for a `code` field or a paste area with its own sentence above it. */
  label?: string;
  value: string; onChangeText: (v: string) => void;
  placeholder?: string; multiline?: boolean; maxLength?: number;
  keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType'];
  autoCapitalize?: React.ComponentProps<typeof TextInput>['autoCapitalize'];
  autoCorrect?: boolean; secureTextEntry?: boolean; hint?: string;
  style?: ViewStyle; onSubmitEditing?: () => void;
  /** A machine reading (a pairing code): centred, mono, tabular, letter-spaced. */
  code?: boolean;
  /** A paste area: taller than a line. */
  minHeight?: number; maxHeight?: number;
  editable?: boolean;
  accessibilityLabel?: string;
}) {
  const [focused, setFocused] = React.useState(false);
  return (
    <View style={style}>
      {!!label && <Txt kind="label" tone="muted" style={{ marginBottom: sp(1.5) }}>{label}</Txt>}
      <TextInput
        accessibilityLabel={accessibilityLabel ?? label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={code ? palette.inkFaint : palette.inkMuted}
        multiline={multiline}
        maxLength={maxLength}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        secureTextEntry={secureTextEntry}
        editable={editable}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={onSubmitEditing}
        style={[
          styles.input,
          multiline && { minHeight: 76, textAlignVertical: 'top' },
          code && styles.inputCode,
          minHeight != null && { minHeight },
          maxHeight != null && { maxHeight },
        ]}
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

export const Row = ({ children, style, gap = 2 }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) => (
  <View style={[{ flexDirection: 'row', alignItems: 'center', gap: sp(gap) }, style]}>{children}</View>
);

export const Hairline = ({ night, style }: { night?: boolean; style?: ViewStyle }) => {
  const c = useColors(night);
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: c.line }, style]} />;
};

// Section heading on a hard 2px ink rule. This is `Marquee` with the title as
// its only argument — reach for Marquee directly when the section has metadata.
export const SectionTitle = ({
  children, night, meta,
}: { children: React.ReactNode; night?: boolean; meta?: string }) => (
  <Marquee title={children} night={night} meta={meta} />
);

// Opaque card on the ground — the grouped-table look, now genuinely floating.
// Never add a border; separators live INSIDE cards as <Hairline/>. `glass` is
// opt-in and only correct when something scrolls beneath the card.
export const Card = ({
  children, style, night, lift = 'raised', glass = false, list = false,
}: {
  children: React.ReactNode; style?: ViewStyle; night?: boolean;
  lift?: keyof typeof elevation; glass?: boolean;
  /** Holds a column of rows with Hairlines between them: tighter vertical padding. */
  list?: boolean;
}) => {
  const isNight = useNight(night);
  const pad: ViewStyle = list ? { paddingVertical: sp(1), paddingHorizontal: sp(4) } : { padding: sp(4) };
  if (glass) {
    return (
      <Glass tone={isNight ? 'night' : 'neutral'} radius={radius.glass} lift={lift} style={[pad, style]}>
        {children}
      </Glass>
    );
  }
  return (
    <Surface tone={isNight ? 'night' : 'paper'}>
      <View
        style={[
          { backgroundColor: isNight ? palette.nightRaised : palette.raised, borderRadius: radius.card },
          pad,
          isNight ? { borderWidth: 1, borderColor: palette.nightLine } : (elevation[lift] as ViewStyle),
          style,
        ]}
      >
        {children}
      </View>
    </Surface>
  );
};

/**
 * THE grouped list: a Card with a Hairline between every child. This is the
 * shape every "rows in a white plate" section in the app already has; use it
 * instead of mapping `{i > 0 && <Hairline />}` by hand.
 */
export function RowGroup({ children, night, style }: {
  children: React.ReactNode; night?: boolean; style?: ViewStyle;
}) {
  const kids = React.Children.toArray(children).filter(Boolean);
  return (
    <Card list night={night} style={style}>
      {kids.map((child, i) => (
        <React.Fragment key={i}>
          {i > 0 && <Hairline />}
          {child}
        </React.Fragment>
      ))}
    </Card>
  );
}

/**
 * The screen's one uncompromising contrast moment: an opaque dark plate at the
 * float tier, with paper-coloured text. Every Txt, Rule, DataLabel, Chip and Btn
 * inside picks the right colour on its own — pass no tones.
 *
 * `ink` (black) is the default. `cream` is the inverted plate on the night
 * ground (Rounds). `alarm` is the deep-rust plate on the takeover, which is
 * what the takeover's readouts should be instead of a second glass layer.
 * One per screen; two is noise.
 */
export function Slab({
  children, tone = 'ink', lift = 'float', style, onPress, accessibilityLabel,
}: {
  children: React.ReactNode;
  tone?: 'ink' | 'cream' | 'alarm';
  lift?: keyof typeof elevation;
  style?: ViewStyle;
  /** Makes the whole slab a button, on the shared press spring. */
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const press = usePressSpring();
  const bg = { ink: palette.ink, cream: palette.nightInk, alarm: palette.rustDeep }[tone];
  const plate: ViewStyle = { backgroundColor: bg, borderRadius: radius.glass, padding: sp(4.5) };
  const body = onPress ? (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[plate, elevation[lift] as ViewStyle, press.style, style]}
    >
      {children}
    </AnimatedPressable>
  ) : (
    <View style={[plate, elevation[lift] as ViewStyle, style]}>{children}</View>
  );
  return <Surface tone={tone}>{body}</Surface>;
}

/** A human key/value line inside a card: "Room  Kitchen", "Camera  Agreed". */
export function KeyValue({ label, value, tone, style }: {
  label: string; value: string; tone?: Tone; style?: ViewStyle;
}) {
  return (
    <Row style={[{ justifyContent: 'space-between' }, style]} gap={3}>
      <Txt kind="caption" tone="muted">{label}</Txt>
      <Txt kind="caption" tone={tone} style={{ textAlign: 'right', flexShrink: 1 }}>{value}</Txt>
    </Row>
  );
}

/** The app's mark: white figure on a black plate. Login and Welcome share it. */
export function Mark({ size = 88, style }: { size?: number; style?: ViewStyle }) {
  return (
    <View
      accessible={false}
      style={[{
        width: size, height: size, borderRadius: radius.glass,
        alignItems: 'center', justifyContent: 'center', backgroundColor: palette.ink,
      }, style]}
    >
      <Icon name="figure.2.arms.open" size={Math.round(size * 0.5)} color={palette.raised} weight="semibold" />
    </View>
  );
}

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
      <Txt kind="tag" style={{ color: c.fg }}>{label ?? c.word}</Txt>
    </View>
  );
}

export function Chip({
  label, onPress, selected = false, night,
}: { label: string; onPress?: () => void; selected?: boolean; night?: boolean }) {
  const press = usePressSpring();
  const surface = useSurface();
  const isNight = useNight(night);
  const c = useColors(night);
  const dark = isNight || isDarkSurface(surface);
  const bg = selected ? (dark ? onDark.ink : palette.slate) : press.held ? c.pressed : c.wash;
  const fg = selected ? (dark ? palette.ink : onDark.ink) : c.ink;
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, { backgroundColor: bg }, press.style]}
    >
      <Txt kind="tag" style={{ color: fg }}>{label}</Txt>
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
  const badge = state === 'ok' ? palette.moss : state === 'warn' ? palette.ochre : palette.inkMuted;
  return (
    <Surface tone="paper">
      <View style={[styles.tile, elevation.raised]}>
        <IconBadge name={icon} color={badge} size={30} />
        {/* mono.big, one step down: the tile is half a screen wide. */}
        <Txt kind="data" style={{ fontSize: type.stat.fontSize, lineHeight: type.stat.lineHeight, marginTop: sp(2.5) }} numberOfLines={1}>
          {value}
        </Txt>
        <Txt kind="caption" tone="muted" style={{ marginTop: 1 }} numberOfLines={1}>
          {label}
        </Txt>
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: S.button,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: sp(5),
  },
  btnSmall: { minHeight: S.buttonSmall, paddingHorizontal: sp(4) },
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
  // The code is a machine reading, so it wears the machine face: Menlo,
  // tabular, centred, on the same plate-and-rule as every other field.
  inputCode: {
    ...(mono.big as TextStyle),
    fontSize: 38,
    lineHeight: 46,
    letterSpacing: 8,
    textAlign: 'center',
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingVertical: sp(5),
  },
});
