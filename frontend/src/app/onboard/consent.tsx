// Consent. Cannot be skipped; the person consenting types both names themselves.
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Btn, Card, Row, Screen, Txt } from '@/components';
import { Icon } from '@/components/icon';
import { palette, radius, sp, type } from '@/theme/tokens';
import { useSession } from '@/store/session';

const SENSED = [
  { icon: 'figure.walk', text: 'Movement and stillness, from her band' },
  { icon: 'dot.radiowaves.left.and.right', text: 'Which room, from small beacons' },
  { icon: 'video.slash', text: 'Never video or audio' },
];

const FAMILY_SEES = [
  { icon: 'checkmark.circle', text: 'Whether she is OK, and where' },
  { icon: 'text.alignleft', text: 'Meals, walks, and nights, as sentences' },
  { icon: 'phone', text: 'Every call Dhyaan makes, and why' },
];

function InfoRow({ icon, text }: { icon: string; text: string }) {
  return (
    <Row gap={2.5} style={{ marginTop: sp(2.5) }}>
      <Icon name={icon} size={16} color={palette.slate} />
      <Txt kind="body" style={{ flex: 1 }}>{text}</Txt>
    </Row>
  );
}

export default function Consent() {
  const session = useSession();
  const [resident, setResident] = useState(session.residentName);
  const [signer, setSigner] = useState('');
  const ready = resident.trim().length > 0 && signer.trim().length > 0;

  return (
    <Screen>
      <Txt kind="title">Her consent comes first</Txt>
      <Txt kind="body" style={{ marginTop: sp(2) }}>
        Dhyaan watches one person, with her permission.
      </Txt>

      <Txt kind="label" style={{ marginTop: sp(6), marginBottom: sp(2) }}>Her name</Txt>
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
        {SENSED.map((s) => <InfoRow key={s.text} icon={s.icon} text={s.text} />)}
      </Card>

      <Card style={{ marginTop: sp(3) }}>
        <Txt kind="label">What family sees</Txt>
        {FAMILY_SEES.map((s) => <InfoRow key={s.text} icon={s.icon} text={s.text} />)}
      </Card>

      <Txt kind="label" style={{ marginTop: sp(6), marginBottom: sp(2) }}>Your name</Txt>
      <TextInput
        style={styles.input}
        value={signer}
        onChangeText={setSigner}
        placeholder="Full name"
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
    borderRadius: radius.card,
    paddingHorizontal: sp(4),
    paddingVertical: sp(3.5),
  },
});
