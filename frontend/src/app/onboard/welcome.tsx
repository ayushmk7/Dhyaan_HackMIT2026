// What Dhyaan is, before anyone agrees to anything. One bold statement, the
// disclaimer card, and — quietly at the bottom — the developer skip.
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Btn, Card, Screen, Txt } from '@/components';
import { Entrance } from '@/components/entrance';
import { seedDemoResident } from '@/lib/api';
import { SEEDED_FACTS } from '@/lib/mock/camera';
import { sp, type } from '@/theme/tokens';
import { useSession } from '@/store/session';

const WHAT_TO_EXPECT = [
  'Three things to agree to, separately — you can say yes to one and no to another.',
  'A few questions about her day. Dhyaan starts from your answers and learns from there.',
  'Where the camera goes, and who Dhyaan should call.',
];

export default function Welcome() {
  const seedDemoSession = useSession((s) => s.seedDemoSession);
  // The skip is hidden in a release build unless you tap the wordmark five
  // times — it writes nothing to the server, so it must never be one stray
  // thumb away from a real setup.
  const [taps, setTaps] = useState(0);
  const showSkip = __DEV__ || taps >= 5;

  const skip = () => {
    seedDemoResident('Priya Sharma');
    seedDemoSession(SEEDED_FACTS);
    router.replace('/(family)');
  };

  return (
    <Screen>
      <Entrance index={0}>
        <Pressable
          accessibilityLabel="Dhyaan"
          onPress={() => setTaps((n) => n + 1)}
        >
          <Txt kind="label" tone="muted">Dhyaan</Txt>
        </Pressable>
        <View style={{ justifyContent: 'flex-end', minHeight: 260, paddingBottom: sp(6) }}>
          <Txt style={type.hero} accessibilityRole="header">
            Let’s set{'\n'}Dhyaan up{'\n'}for her.
          </Txt>
          <Txt kind="body" tone="muted" style={{ marginTop: sp(4) }}>
            Dhyaan learns your mother’s everyday rhythm — when she’s up, when she eats,
            when she’s settled. When something is different, it calls her first, then you.
          </Txt>
        </View>
      </Entrance>

      <Entrance index={1}>
        <Card>
          <Txt kind="label">What setup involves</Txt>
          {WHAT_TO_EXPECT.map((line) => (
            <Txt key={line} kind="caption" tone="muted" style={{ marginTop: sp(2) }}>{line}</Txt>
          ))}
        </Card>

        <Card style={{ marginTop: sp(3) }}>
          <Txt kind="label">Dhyaan is not a medical device and does not call 911.</Txt>
          <Txt kind="caption" tone="muted" style={{ marginTop: sp(1) }}>
            It notices, calls, and tells the people who love her.
          </Txt>
        </Card>
      </Entrance>

      <Entrance index={2} style={{ marginTop: sp(6) }}>
        <Btn label="Set up Dhyaan" onPress={() => router.push('/onboard/consent')} />
      </Entrance>

      {showSkip && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Skip setup, developer shortcut"
          accessibilityHint="Jumps straight into the app with a seeded resident. Nothing is saved to the server."
          onPress={skip}
          style={({ pressed }) => ({
            marginTop: sp(6), alignItems: 'center', opacity: pressed ? 0.6 : 1,
          })}
        >
          <Txt kind="label" tone="muted" style={{ letterSpacing: 1 }}>SKIP SETUP (DEV)</Txt>
          <Txt kind="caption" tone="muted" style={{ marginTop: sp(1), textAlign: 'center' }}>
            Signs in as Priya with Eleanor already set up. Writes nothing to the server.
          </Txt>
        </Pressable>
      )}
    </Screen>
  );
}
