// Welcome: a mark, one line, one button. Real apps don't open with paragraphs.
//
// The demo entry seeds a signed-in session locally. It may only seed INVENTED
// facts when the app is running against the in-memory backend: against a real
// server those ten sentences about Eleanor would be posted by done.tsx as
// things "the family told us" about a real person. So the facts are gated on
// USE_MOCKS, hard, and a live demo starts with nothing told.
import { router } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';
import { Btn, DataLabel, Entrance, Rule, Screen, Txt } from '@/components';
import { Icon } from '@/components/icon';
import { seedDemoResident } from '@/lib/api';
import { USE_MOCKS } from '@/lib/config';
import { SEEDED_FACTS } from '@/lib/mock/camera';
import { useSession } from '@/store/session';
import { palette, radius, sp } from '@/theme/tokens';

export default function Welcome() {
  const { setRole, seedDemoSession } = useSession();

  const familyDemo = () => {
    seedDemoResident('Priya Sharma');
    // Mock backend only. Live: an empty profile, which is the honest opening
    // state of a real sign-up anyway.
    seedDemoSession(USE_MOCKS ? SEEDED_FACTS : []);
    router.replace('/(family)/home');
  };
  const staffDemo = () => {
    setRole('staff');
    router.replace('/(staff)/triage');
  };

  return (
    <Screen scroll={false} wash style={{ justifyContent: 'space-between' }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Entrance index={0} style={{ alignItems: 'center' }}>
          {/* The screen's one uncompromising moment: black plate, white mark. */}
          <View
            style={{
              width: 116, height: 116, borderRadius: radius.glass,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: palette.ink,
            }}
          >
            <Icon name="figure.2.arms.open" size={58} color={palette.raised} weight="semibold" />
          </View>
        </Entrance>

        <Entrance index={1} style={{ alignSelf: 'stretch', marginTop: sp(8) }}>
          <Txt kind="hero" style={{ textAlign: 'center' }} accessibilityRole="header">
            Dhyaan
          </Txt>
          <Rule style={{ marginTop: sp(3), marginHorizontal: sp(10) }} />
          <Txt kind="body" style={{ textAlign: 'center', marginTop: sp(3) }}>
            Keeps an eye on your mom and calls you if something’s wrong.
          </Txt>
        </Entrance>
      </View>

      <Entrance index={2}>
        <Btn label="Get started" onPress={() => router.push('/onboard/consent')} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Explore the demo. Long-press for the staff demo."
          onPress={familyDemo}
          onLongPress={staffDemo}
          style={{ paddingVertical: sp(4), alignItems: 'center', gap: sp(1.5) }}
        >
          <Txt kind="label">Explore the demo</Txt>
          <DataLabel value={USE_MOCKS ? 'sample data' : 'live backend'}>Source</DataLabel>
        </Pressable>
        <Txt kind="caption" tone="muted" style={{ textAlign: 'center' }}>{/* voice-ok */}
          Dhyaan is not a medical device and never dials 911.
        </Txt>
      </Entrance>
    </Screen>
  );
}
