// Dhyaan primitives. Every screen builds from these. See docs/frontend-DESIGN.md.
//
// The depth law in one line: content is opaque, chrome is glass. A card holds
// text, so it stays solid and legible; a bar, header or takeover has content
// travelling under it, so it earns <Glass>.
//
// Every primitive reads the <Surface> it sits on (text.tsx) and the scheme it
// is drawn in (`useTheme`), so a Btn inside a Slab, a Rule on the night ground
// and a Chip on the alarm takeover pick their own colours, in light and in
// dark. Explicit `night`/`tone`/`color` props still win.
import React from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControlProps, ScrollView,
  ScrollViewProps, StyleProp, StyleSheet, TextInput, TextStyle, View, ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/theme';
import { elevation, mono, motion, radius, size as S, sp, type, ResidentState } from '@/theme/tokens';
import { DataLabel, Marquee, Rule } from './brutal';
import { FLOATING_BAR_CLEARANCE, FloatingBar, Glass, GlassTone } from './glass';
import { Icon, IconBadge } from './icon';
import { Surface, surfaceColors, Tone, Txt, useSurface, useSurfaceColors } from './text';
import { Wash, WashTone } from './wash';

// Txt and the surface context live in text.tsx; they are re-exported here so
// `import { Txt } from '@/components'` keeps working unchanged.
export { Surface, Txt, useSurface, useSurfaceColors, surfaceColors, isDarkSurface, toneColor } from './text';
export type { SurfaceTone, SurfaceColors, Tone, TxtKind } from './text';

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
const useColors = (night: boolean | undefined) =>
  useSurfaceColors(night === undefined ? undefined : night ? 'night' : 'paper');

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
  const t = useTheme();
  const ground: ScreenTone = tone ?? (night ? 'night' : 'paper');
  // The takeover is the inverse of the scheme: black in light, white in dark.
  // It is the only screen drawn that way, which is how alarm stays unmistakable.
  const groundColor = { paper: t.paper, night: t.night, alarm: t.inverse }[ground];
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
 * Both are ink: a failed save is not an alarm, and alarm is not a colour anyway.
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
  const c = useSurfaceColors();
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
  /** The inverse plate on the surface: white on a dark surface, ink on a light one. */
  | 'inverse'
  /** A hairline outline, no fill: the takeover's secondary actions. */
  | 'outline';

export function Btn({
  label, onPress, kind = 'primary', disabled, busy, night, style, size = 'regular', tone,
}: {
  label: string; onPress: () => void;
  /** `glass` is for a button floating over content: a FloatingBar, a takeover. */
  kind?: BtnKind;
  disabled?: boolean; busy?: boolean; night?: boolean; style?: ViewStyle;
  /** `small` = 44pt, for a button beside a field or inside a row. */
  size?: 'regular' | 'small';
  /** `link` only: `alert` for the opener of a destructive, confirmed action. */
  tone?: 'ink' | 'alert';
}) {
  const press = usePressSpring();
  const isNight = useNight(night);
  const c = useColors(night);

  if (kind === 'link') {
    // A destructive opener is heavier, not redder: weight is the only tool a
    // line of text has, and it is enough when the words say what happens.
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
        <Txt kind="label" style={{ color: c.ink, fontWeight: tone === 'alert' ? '700' : '600' }}>{label}</Txt>
      </Pressable>
    );
  }

  // primary = the accent. quiet = iOS "tonal": filled wash, no border. danger
  // and inverse are the same gesture, the surface's INVERSE plate: the only
  // black button on a light screen, the only white one on a dark screen. That
  // is what the final button of an irreversible act, and every button on the
  // takeover, has instead of red. Borders read as wireframe; `outline` is the
  // one exception, and it exists for the takeover's secondary actions.
  const bg = {
    primary: c.accent, danger: c.plate, quiet: c.wash,
    ghost: 'transparent', glass: 'transparent', inverse: c.plate, outline: 'transparent',
  }[kind];
  const pressedBg = {
    primary: isNight ? c.accent : c.accent, danger: c.platePressed, quiet: c.pressed,
    ghost: 'transparent', glass: 'transparent', inverse: c.platePressed, outline: c.pressed,
  }[kind];
  const fg =
    kind === 'primary' ? c.onAccent
    : kind === 'danger' || kind === 'inverse' ? c.onPlate
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
        kind === 'primary' && press.held && { opacity: 0.85 },
        kind === 'outline' && { borderWidth: 1.5, borderColor: c.rule },
        { opacity: disabled ? 0.45 : 1 },
        press.style,
        // Glass owns its own layout box, so the caller's style goes on the
        // wrapper instead: a margin inside the shadow wrapper offsets the shadow.
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
 * `label` is the accessibility label and is required: an icon alone says
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
  const bg = kind === 'primary' ? c.accent
    : kind === 'quiet' ? (press.held ? c.pressed : c.wash)
    : 'transparent';
  const fg = kind === 'primary' ? c.onAccent : c.ink;
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
          alignItems: 'center', justifyContent: 'center',
          opacity: disabled ? 0.45 : kind === 'primary' && press.held ? 0.85 : 1,
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
  const c = useSurfaceColors();
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
// ink on focus. No box outline: a border on four sides reads as a wireframe.

export function Field({
  label, value, onChangeText, placeholder, multiline, maxLength, keyboardType,
  autoCapitalize, autoCorrect, secureTextEntry, hint, style, onSubmitEditing,
  code = false, minHeight, maxHeight, editable, accessibilityLabel, autoComplete, textContentType,
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
  /**
   * Autofill hint for the keychain and password manager: `"username"` and
   * `"password"` on a sign-in form. Set this OR `textContentType`, not both:
   * per the RN 0.86 docs they conflict on the same input.
   */
  autoComplete?: React.ComponentProps<typeof TextInput>['autoComplete'];
  /** iOS-only escape hatch for a content type `autoComplete` does not name. */
  textContentType?: React.ComponentProps<typeof TextInput>['textContentType'];
}) {
  const [focused, setFocused] = React.useState(false);
  const t = useTheme();
  const c = useSurfaceColors();
  return (
    <View style={style}>
      {!!label && <Txt kind="label" tone="muted" style={{ marginBottom: sp(1.5) }}>{label}</Txt>}
      <TextInput
        accessibilityLabel={accessibilityLabel ?? label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={code ? t.inkFaint : t.inkMuted}
        keyboardAppearance={t.scheme}
        multiline={multiline}
        maxLength={maxLength}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        secureTextEntry={secureTextEntry}
        autoComplete={autoComplete}
        textContentType={textContentType}
        editable={editable}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={onSubmitEditing}
        style={[
          styles.input,
          { color: t.ink, backgroundColor: t.raised },
          multiline && { minHeight: 76, textAlignVertical: 'top' },
          code && styles.inputCode,
          minHeight != null && { minHeight },
          maxHeight != null && { maxHeight },
        ]}
      />
      <Rule
        weight={focused ? 'ink' : 'hair'}
        color={focused ? c.rule : c.line}
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
// its only argument. Reach for Marquee directly when the section has metadata.
export const SectionTitle = ({
  children, night, meta,
}: { children: React.ReactNode; night?: boolean; meta?: string }) => (
  <Marquee title={children} night={night} meta={meta} />
);

// Opaque card on the ground: the grouped-table look, genuinely floating.
// Never add a border in light mode; separators live INSIDE cards as
// <Hairline/>. On a dark ground a shadow is invisible, so the card takes a
// hairline edge instead. `glass` is opt-in and only correct when something
// scrolls beneath the card.
export const Card = ({
  children, style, night, lift = 'raised', glass = false, list = false,
}: {
  children: React.ReactNode; style?: ViewStyle; night?: boolean;
  lift?: keyof typeof elevation; glass?: boolean;
  /** Holds a column of rows with Hairlines between them: tighter vertical padding. */
  list?: boolean;
}) => {
  const isNight = useNight(night);
  const t = useTheme();
  const pad: ViewStyle = list ? { paddingVertical: sp(1), paddingHorizontal: sp(4) } : { padding: sp(4) };
  if (glass) {
    return (
      <Glass tone={isNight ? 'night' : 'neutral'} radius={radius.glass} lift={lift} style={[pad, style]}>
        {children}
      </Glass>
    );
  }
  const onDarkGround = isNight || t.isDark;
  return (
    <Surface tone={isNight ? 'night' : 'paper'}>
      <View
        style={[
          { backgroundColor: isNight ? t.nightRaised : t.raised, borderRadius: radius.card },
          pad,
          onDarkGround
            ? { borderWidth: 1, borderColor: isNight ? t.nightLine : t.line }
            : (elevation[lift] as ViewStyle),
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
 * The screen's one uncompromising contrast moment: an opaque plate at the
 * float tier in the OPPOSITE scheme. Every Txt, Rule, DataLabel, Chip and Btn
 * inside picks the right colour on its own; pass no tones.
 *
 * `ink` (the default) is the inverse of the scheme: black in light, white in
 * dark. `cream` is always the white plate (the Rounds counter on the night
 * ground). `alarm` is the takeover's readout plate: one step back from the
 * takeover ground, with an outline so it reads as a plate on either scheme.
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
  const t = useTheme();
  const c = surfaceColors(tone, t.scheme);
  const bg = { ink: t.inverse, cream: t.white, alarm: t.inverseRaised }[tone];
  const plate: ViewStyle = {
    backgroundColor: bg, borderRadius: radius.glass, padding: sp(4.5),
    ...(tone === 'alarm' ? { borderWidth: 1.5, borderColor: c.line } : null),
  };
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

/** The app's mark: a figure on the inverse plate. Login and Welcome share it. */
export function Mark({ size = 88, style }: { size?: number; style?: ViewStyle }) {
  const t = useTheme();
  return (
    <View
      accessible={false}
      style={[{
        width: size, height: size, borderRadius: radius.glass,
        alignItems: 'center', justifyContent: 'center', backgroundColor: t.inverse,
      }, style]}
    >
      <Icon name="figure.2.arms.open" size={Math.round(size * 0.5)} color={t.onInverse} weight="semibold" />
    </View>
  );
}

// ---- Status --------------------------------------------------------------------
// A state is a FORM, not a colour: a hollow ring is "nothing to point at", a
// filled accent dot is "worth a look", a bullseye in the surface's ink is
// "needs someone now", a flat grey dot is "no signal". The word always rides
// alongside (StateChip), so none of this has to be seen in colour to be read.

export const StatusDot = ({ state, size = 10 }: { state: ResidentState; size?: number }) => {
  const t = useTheme();
  const c = useSurfaceColors();
  const s = t.stateColor[state];
  const round = { width: size, height: size, borderRadius: size / 2 };
  switch (s.form) {
    case 'filled':
      return <View style={[round, { backgroundColor: c.accent }]} />;
    case 'flat':
      return <View style={[round, { backgroundColor: c.faint }]} />;
    case 'inverse': {
      // A bullseye: ring, gap, dot, all in the surface's ink. The gap is the
      // real ground showing through, so it works on any plate.
      const ring = Math.max(1.5, size * 0.18);
      const core = Math.max(2, size - ring * 2 - Math.max(2, size * 0.24));
      return (
        <View style={[round, { borderWidth: ring, borderColor: c.ink, alignItems: 'center', justifyContent: 'center' }]}>
          <View style={{ width: core, height: core, borderRadius: core / 2, backgroundColor: c.ink }} />
        </View>
      );
    }
    default:
      return <View style={[round, { borderWidth: 1.5, borderColor: state === 'ok' ? c.muted : c.faint }]} />;
  }
};

export function StateChip({ state, label }: { state: ResidentState; label?: string }) {
  const t = useTheme();
  const c = useSurfaceColors();
  const s = t.stateColor[state];
  // The alerting chip is the surface's inverse plate; everything else is a
  // wash. Same rule as the buttons: the gravest thing is the inverted one.
  const bg = s.form === 'inverse' ? c.plate : s.form === 'filled' ? c.accentWash : c.wash;
  const fg = s.form === 'inverse' ? c.onPlate : s.form === 'filled' ? c.accent : state === 'ok' ? c.ink : c.muted;
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      {s.form === 'inverse'
        ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.onPlate }} />
        : <StatusDot state={state} size={8} />}
      <Txt kind="tag" style={{ color: fg }}>{label ?? s.word}</Txt>
    </View>
  );
}

export function Chip({
  label, onPress, selected = false, night,
}: { label: string; onPress?: () => void; selected?: boolean; night?: boolean }) {
  const press = usePressSpring();
  const c = useColors(night);
  const bg = selected ? c.accent : press.held ? c.pressed : c.wash;
  const fg = selected ? c.onAccent : c.ink;
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
// Card, icon badge, BIG tabular value, tiny label: the Health-app grammar with
// the datum in the machine face. The badge carries the state by FORM: an
// outline ring for ok (nothing to point at), a filled accent plate for warn
// (worth a look), a faint outline for unknown. The card stays plain.

export function StatTile({
  icon, state, value, label,
}: { icon: string; state: 'ok' | 'warn' | 'unknown'; value: string; label: string }) {
  const t = useTheme();
  return (
    <Surface tone="paper">
      <View style={[styles.tile, { backgroundColor: t.raised }, t.isDark ? { borderWidth: 1, borderColor: t.line } : elevation.raised]}>
        {state === 'warn'
          ? <IconBadge name={icon} color={t.accent} size={30} />
          : <IconBadge name={icon} color={state === 'ok' ? t.inkMuted : t.inkFaint} size={30} outline />}
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
    borderRadius: radius.tile,
    padding: sp(3.5),
  },
  input: {
    ...type.body,
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
