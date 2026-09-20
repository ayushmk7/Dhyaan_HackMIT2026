// Welcome: a mark, one line, one button. Real apps don't open with paragraphs.
//
// The demo entry seeds a signed-in session locally. The invented resident,
// her facts and the daughter who "signed" live entirely inside the mock
// backend (`seedDemoResident` is a no-op unless USE_MOCKS), so nothing on this
// screen names a person: against a real server the demo opens on whatever the
// server has, and the onboarding draft starts empty either way.
import { router } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';
import { Btn, DataLabel, Entrance, Mark, Screen, Txt } from '@/components';
import { seedDemoResident } from '@/lib/api';
import { USE_MOCKS } from '@/lib/config';
import { onboard } from '@/lib/copy/staff';
import { useSession } from '@/store/session';
import { sp } from '@/theme/tokens';

const copy = onboard.welcome;

export default function Welcome() {
  const { setRole, seedDemoSession } = useSession();

  const familyDemo = () => {
    seedDemoResident();
    seedDemoSession([]);
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

      <Entrance index={2} style={{ gap: sp(3) }}>
        {/* What pressing the button starts, before it is pressed. */}
        <Txt kind="caption" tone="muted" style={{ textAlign: 'center', paddingHorizontal: sp(4) }}>{/* voice-ok */}
          {onboard.step.overview}
        </Txt>
        <Btn label={copy.getStarted} onPress={() => router.push('/onboard/consent')} />
        {/* The Pressable owns both gestures so the long-press dev affordance
            (staff demo) survives; the button inside it is the visible control
            and never the responder. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.exploreDemoA11y}
          onPress={familyDemo}
          onLongPress={staffDemo}
          style={{ alignItems: 'center', gap: sp(2) }}
        >
          <View pointerEvents="none" style={{ alignSelf: 'stretch', alignItems: 'center', gap: sp(2) }}>
            <Btn kind="quiet" label={copy.exploreDemo} onPress={familyDemo} style={{ alignSelf: 'stretch' }} />
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
