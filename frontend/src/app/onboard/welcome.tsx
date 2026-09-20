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
import { Btn, DataLabel, Entrance, Mark, Screen, Txt } from '@/components';
import { seedDemoResident } from '@/lib/api';
import { USE_MOCKS } from '@/lib/config';
import { onboard } from '@/lib/copy/staff';
import { SEEDED_FACTS } from '@/lib/mock/camera';
import { useSession } from '@/store/session';
import { sp } from '@/theme/tokens';

const copy = onboard.welcome;

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
          {/* The screen's one uncompromising moment: the mark on its plate. */}
          <Mark size={116} />
        </Entrance>

        <Entrance index={1} style={{ alignSelf: 'stretch', marginTop: sp(8) }}>
          <Txt kind="hero" style={{ textAlign: 'center' }} accessibilityRole="header">
            {copy.title}
          </Txt>
          {/* No rule between the name and the line: the mark is the one hard
              shape on this screen, and the tagline is a whisper under it. */}
          <Txt kind="body" tone="muted" style={{ textAlign: 'center', marginTop: sp(3), paddingHorizontal: sp(6) }}>
            {copy.tagline}
          </Txt>
        </Entrance>
      </View>

      <Entrance index={2}>
        <Btn label={copy.getStarted} onPress={() => router.push('/onboard/consent')} />
        {/* The Pressable owns both gestures so the long-press dev affordance
            (staff demo) survives; the link inside it is the visible control
            and never the responder. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.exploreDemoA11y}
          onPress={familyDemo}
          onLongPress={staffDemo}
          style={{ paddingVertical: sp(3), alignItems: 'center', gap: sp(1.5) }}
        >
          <View pointerEvents="none" style={{ alignItems: 'center', gap: sp(1.5) }}>
            <Btn kind="link" label={copy.exploreDemo} onPress={familyDemo} style={{ alignSelf: 'center' }} />
            <DataLabel value={USE_MOCKS ? copy.sourceSample : copy.sourceLive}>{copy.source}</DataLabel>
          </View>
        </Pressable>
        <Txt kind="caption" tone="muted" style={{ textAlign: 'center' }}>{/* voice-ok */}
          {copy.disclaimer}
        </Txt>
      </Entrance>
    </Screen>
  );
}
