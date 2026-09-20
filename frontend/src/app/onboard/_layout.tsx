// Onboarding: a native stack with a transparent header. The screens keep
// their own in-content headings (a Marquee on a hard rule), so the bar carries
// the back chevron — on iOS 26 that is a glass circle floating over the wash,
// and the system's scroll-edge effect blurs content passing under it — and,
// when the stack was entered from inside the app, a Cancel that returns
// there. Welcome is the front door and has no header at all. Every other
// screen renders <Screen native> so its content starts below the bar.
//
// The Cancel is what lets Settings re-enter this stack safely (pair a new
// band, walk the rooms again): before it, the only exit was Continue, which
// walked the whole setup again. It is shown only once setup has finished at
// least once; on a first run the back chevron already leads to Welcome.
import { router, Stack, useNavigation } from 'expo-router';
import React from 'react';
import { Btn } from '@/components';
import { palette, sp } from '@/theme/tokens';
import { useSession } from '@/store/session';

export default function OnboardLayout() {
  const onboarded = useSession((s) => s.onboarded);
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
        title: '',
        headerTransparent: true,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        headerTintColor: palette.ink,
        contentStyle: { backgroundColor: palette.paper },
        headerRight: onboarded
          ? () => <Btn kind="link" label="Cancel" onPress={leave} style={{ marginRight: sp(1) }} />
          : undefined,
      }}
    >
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
    </Stack>
  );
}
