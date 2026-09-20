// Onboarding: a native stack with the app's compact, centred, translucent
// header. The screens keep their own in-content headings (one question at the
// display size, with air around it), so the bar carries the back chevron and,
// when the stack was entered from inside the app, a Cancel that returns there. Welcome is the front door
// and has no header at all. Every other screen renders <Screen native> so its
// content starts below the bar.
//
// The Cancel is what lets Settings re-enter this stack safely (pair a new
// band, walk the rooms again): before it, the only exit was Continue, which
// walked the whole setup again. It is shown only once setup has finished at
// least once; on a first run the back chevron already leads to Welcome.
//
// This file also carries the three things every onboarding screen shares:
// the step sequence (which depends on what was agreed to), the step header
// that says where you are and what the step is for, and a 44pt choice chip.
// They live here and not in a sibling file because expo-router treats every
// other file under `app/` as a route, and `src/components` is locked this
// pass. Move them to `src/components/onboard.tsx` when that lifts.
import { router, Stack, useNavigation } from 'expo-router';
import React from 'react';
import { Pressable, View, ViewStyle } from 'react-native';
import { Btn, DataLabel, Txt, useSurfaceColors } from '@/components';
import { onboard, shell } from '@/lib/copy/staff';
import { radius, size as S, sp, type as typeScale, useTheme } from '@/theme';
import { useSession, type Grants } from '@/store/session';

// ---- the sequence ---------------------------------------------------------------

export type StepName = 'consent' | 'about' | 'pair' | 'survey' | 'camera' | 'contacts' | 'done';

/**
 * The screens this setup will visit, given what has been agreed to. A grant
 * not yet answered counts as a yes, so the total shown on the consent screen
 * starts at its longest and shrinks as each no is given: saying no visibly
 * makes the setup shorter.
 */
export function stepsFor(grants: Grants): StepName[] {
  return [
    'consent',
    ...(grants.memory !== false ? (['about'] as const) : []),
    ...(grants.falls !== false ? (['pair', 'survey'] as const) : []),
    ...(grants.camera !== false ? (['camera'] as const) : []),
    'contacts',
    'done',
  ];
}

/** "3 of 6", for the step line. */
export function stepOf(step: StepName, grants: Grants): string {
  const steps = stepsFor(grants);
  return onboard.step.of(Math.max(1, steps.indexOf(step) + 1), steps.length);
}

/**
 * Where you are and the one question this step asks. Each step is one
 * question with a lot of air around it: a small machine line, the question at
 * the display size, and at most one quiet sentence under it when the question
 * genuinely needs one. No rule, no counter, no caption.
 */
export function StepHeader({ step, grants, title, purpose }: {
  step: StepName; grants: Grants; title: string; purpose?: string;
}) {
  return (
    <View>
      <DataLabel value={stepOf(step, grants)}>{onboard.step.label}</DataLabel>
      <Txt kind="display" style={{ marginTop: sp(3) }} accessibilityRole="header">{title}</Txt>
      {!!purpose && <Txt kind="body" tone="muted" style={{ marginTop: sp(3) }}>{purpose}</Txt>}
    </View>
  );
}

/**
 * A choice that is a full 44pt tall. The shared `Chip` is a 30pt tag and is
 * right for a citation; an answer someone taps with a thumb is not a tag.
 */
export function ChoiceChip({ label, selected = false, onPress, disabled, style }: {
  label: string; selected?: boolean; onPress: () => void; disabled?: boolean; style?: ViewStyle;
}) {
  const c = useSurfaceColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !!disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: S.hit,
          paddingHorizontal: sp(4),
          paddingVertical: sp(2),
          borderRadius: radius.pill,
          justifyContent: 'center',
          backgroundColor: selected ? c.accent : pressed ? c.pressed : c.wash,
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      <Txt kind="label" style={{ color: selected ? c.onAccent : c.ink }}>{label}</Txt>
    </Pressable>
  );
}

// ---- the stack ------------------------------------------------------------------

export default function OnboardLayout() {
  const onboarded = useSession((s) => s.onboarded);
  const t = useTheme();
  // The navigation prop here belongs to the ROOT stack's `onboard` route, so
  // goBack() pops the whole onboarding stack and lands where it was entered.
  const nav = useNavigation();
  const leave = () => {
    if (nav.canGoBack()) nav.goBack();
    else router.replace('/(family)/home');
  };

  return (
    <Stack
      screenOptions={{
        title: shell.onboard.title,
        headerLargeTitleEnabled: false,
        headerTitleAlign: 'center',
        headerTransparent: true,
        // No `headerBlurEffect`. On iOS 26 react-native-screens applies its own
        // scroll-edge effect to a transparent header, and setting both makes
        // them overlap — RNScreens warns about exactly this at runtime. The
        // system effect is the one Apple ships, so we take it and set nothing.
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        headerTintColor: t.accent,
        // The same title as every other stack (see TabStack in lib/nav.tsx):
        // the title size at the label weight, read off the scale, never a
        // literal, so the app has one header title and it moves with the scale.
        headerTitleStyle: {
          color: t.ink,
          fontSize: typeScale.title.fontSize,
          fontWeight: typeScale.label.fontWeight,
        },
        contentStyle: { backgroundColor: t.paper },
        headerRight: onboarded
          // A full-height target: the bar is 44pt and so is the button.
          ? () => (
            <Btn
              kind="link"
              label={shell.onboard.cancel}
              onPress={leave}
              style={{ marginRight: sp(1), paddingVertical: sp(3) }}
            />
          )
          : undefined,
      }}
    >
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
    </Stack>
  );
}
