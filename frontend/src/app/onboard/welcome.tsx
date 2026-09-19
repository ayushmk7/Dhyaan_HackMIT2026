// The front door. One bold serif statement; everything else quiet.
import { router } from 'expo-router';
import { View } from 'react-native';
import { Btn, Card, Hairline, Screen, Txt } from '@/components';
import { sp } from '@/theme/tokens';
import { useSession } from '@/store/session';

export default function Welcome() {
  const { setRole, finishOnboarding } = useSession();

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'flex-end', minHeight: 320, paddingBottom: sp(8) }}>
        <Txt kind="display">Someone is{'\n'}looking out{'\n'}for her.</Txt>
        <Txt kind="body" tone="muted" style={{ marginTop: sp(4) }}>
          Kestrel learns your mother's everyday rhythm — when she's up, when she eats,
          when she walks. When something is different, it calls her first, then you.
        </Txt>
      </View>

      <Card style={{ marginBottom: sp(6) }}>
        <Txt kind="label">Kestrel is not a medical device and does not call 911.</Txt>
        <Txt kind="caption" tone="muted" style={{ marginTop: sp(1) }}>
          It notices, calls, and tells the people who love her.
        </Txt>
      </Card>

      <Btn label="Set up Kestrel" onPress={() => router.push('/onboard/consent')} />

      <Hairline style={{ marginVertical: sp(6) }} />

      <Btn
        kind="quiet"
        label="Explore the family demo"
        onPress={() => {
          setRole('family');
          finishOnboarding();
          router.replace('/(family)');
        }}
      />
      <Btn
        kind="quiet"
        label="Explore the staff demo"
        style={{ marginTop: sp(3) }}
        onPress={() => {
          setRole('staff');
          router.replace('/(staff)');
        }}
      />
    </Screen>
  );
}
