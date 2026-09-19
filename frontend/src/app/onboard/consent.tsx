// Consent, in plain language. Cannot be skipped; the person consenting types
// both names themselves.
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Btn, Card, Screen, Txt } from '@/components';
import { palette, radius, sp, type } from '@/theme/tokens';
import { useSession } from '@/store/session';

const SENSED = [
  'Her band notices movement, stillness, and possible falls.',
  'Small room beacons tell Dhyaan which room she is in — not where in the room.',
  'No video ever leaves her home, and family never sees video. Ever.',
];

const FAMILY_SEES = [
  'Whether she is OK, and which room she is in',
  'Meals, walks, and nights — as sentences, never footage',
  'Every call Dhyaan makes, and why',
];

export default function Consent() {
  const session = useSession();
  const [resident, setResident] = useState(session.residentName);
  const [signer, setSigner] = useState('');
  const ready = resident.trim().length > 0 && signer.trim().length > 0;

  return (
    <Screen>
      <Txt kind="title">Her consent comes first</Txt>
      <Txt kind="body" tone="muted" style={{ marginTop: sp(2) }}>
        Dhyaan watches over one person. She — or the person legally able to decide
        with her — should agree to what it senses.
      </Txt>

      <Txt kind="label" style={{ marginTop: sp(6), marginBottom: sp(2) }}>Who is Dhyaan looking out for?</Txt>
      <TextInput
        style={styles.input}
        value={resident}
        onChangeText={setResident}
        placeholder="Her name"
        placeholderTextColor={palette.inkMuted}
        accessibilityLabel="Name of the person being monitored"
      />

      <Card style={{ marginTop: sp(5) }}>
        <Txt kind="label">What Dhyaan senses</Txt>
        {SENSED.map((line) => (
          <Txt key={line} kind="caption" tone="muted" style={{ marginTop: sp(2) }}>{line}</Txt>
        ))}
      </Card>

      <Card style={{ marginTop: sp(3) }}>
        <Txt kind="label">What family can see</Txt>
        {FAMILY_SEES.map((line) => (
          <Txt key={line} kind="caption" tone="muted" style={{ marginTop: sp(2) }}>{line}</Txt>
        ))}
        <Txt kind="caption" tone="muted" style={{ marginTop: sp(2) }}>
          What family cannot see: video, audio, or anything Dhyaan didn’t observe.
        </Txt>
      </Card>

      <Txt kind="label" style={{ marginTop: sp(6), marginBottom: sp(2) }}>
        Your name, as the person giving consent
      </Txt>
      <TextInput
        style={styles.input}
        value={signer}
        onChangeText={setSigner}
        placeholder="Type your full name"
        placeholderTextColor={palette.inkMuted}
        accessibilityLabel="Name of the person giving consent"
      />

      <View style={{ marginTop: sp(6) }}>
        <Btn
          label="Agree and continue"
          disabled={!ready}
          onPress={() => {
            session.setConsent(resident.trim(), signer.trim());
            router.push('/onboard/baseline');
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    ...type.body,
    color: palette.ink,
    backgroundColor: palette.raised,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.card,
    paddingHorizontal: sp(4),
    paddingVertical: sp(3.5),
  },
});
