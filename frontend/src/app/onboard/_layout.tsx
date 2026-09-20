// Onboarding: a native stack with the app's compact, centred, translucent
// header. The screens keep their own in-content headings (a Marquee on a hard
// rule), so the bar carries the back chevron and, when the stack was entered
// from inside the app, a Cancel that returns there. Welcome is the front door
// and has no header at all. Every other screen renders <Screen native> so its
// content starts below the bar.
//
// The Cancel is what lets Settings re-enter this stack safely (pair a new
// band, walk the rooms again): before it, the only exit was Continue, which
// walked the whole setup again. It is shown only once setup has finished at
// least once; on a first run the back chevron already leads to Welcome.
import { router, Stack, useNavigation } from 'expo-router';
import React from 'react';
import { Btn } from '@/components';
import { shell } from '@/lib/copy/staff';
import { sp, useTheme } from '@/theme';
import { useSession } from '@/store/session';

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
        headerBlurEffect: t.isDark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight',
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        headerTintColor: t.accent,
        // The size is the navigation bar's own default; only the weight and
        // colour are ours (the scale forbids an inline size).
        headerTitleStyle: { color: t.ink, fontWeight: '600' },
        contentStyle: { backgroundColor: t.paper },
        headerRight: onboarded
          ? () => <Btn kind="link" label={shell.onboard.cancel} onPress={leave} style={{ marginRight: sp(1) }} />
          : undefined,
      }}
    >
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
    </Stack>
  );
}
