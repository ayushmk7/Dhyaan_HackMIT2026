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
import { Btn, DataLabel, Entrance, Mark, Rule, Screen, Txt } from '@/components';
import { seedDemoResident } from '@/lib/api';
import { USE_MOCKS } from '@/lib/config';
import { SEEDED_FACTS } from '@/lib/mock/camera';
import { useSession } from '@/store/session';
import { sp } from '@/theme/tokens';

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
          <Mark size={116} />
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
        {/* The Pressable owns both gestures so the long-press dev affordance
            (staff demo) survives; the link inside it is the visible control
            and never the responder. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Explore the demo. Long-press for the staff demo."
          onPress={familyDemo}
          onLongPress={staffDemo}
          style={{ paddingVertical: sp(3), alignItems: 'center', gap: sp(1.5) }}
        >
          <View pointerEvents="none" style={{ alignItems: 'center', gap: sp(1.5) }}>
            <Btn kind="link" label="Explore the demo" onPress={familyDemo} style={{ alignSelf: 'center' }} />
            <DataLabel value={USE_MOCKS ? 'sample data' : 'live backend'}>Source</DataLabel>
          </View>
        </Pressable>
        <Txt kind="caption" tone="muted" style={{ textAlign: 'center' }}>{/* voice-ok */}
          Dhyaan is not a medical device and never dials 911.
        </Txt>
      </Entrance>
    </Screen>
  );
}
