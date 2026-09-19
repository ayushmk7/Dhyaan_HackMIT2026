// Pair the band: the 6-digit code the band shows or reads aloud.
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Btn, Row, Screen, StatusDot, Txt } from '@/components';
import { api } from '@/lib/api';
import { font, palette, radius, sp } from '@/theme/tokens';
import { useSession } from '@/store/session';

export default function Pair() {
  const { residentName } = useSession();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paired, setPaired] = useState(false);

  const pair = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.pairBand(code);
      setPaired(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pairing failed — try the code again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Txt kind="title">Pair {residentName}'s band</Txt>
      <Txt kind="body" tone="muted" style={{ marginTop: sp(2) }}>
        The band shows a 6-digit code on its light — it will also read the code aloud.
        Type it here.
      </Txt>

      <TextInput
        style={styles.code}
        value={code}
        onChangeText={(t) => { setCode(t.replace(/\D/g, '').slice(0, 6)); setError(null); }}
        keyboardType="number-pad"
        maxLength={6}
        placeholder="000000"
        placeholderTextColor={palette.line}
        editable={!paired}
        accessibilityLabel="6-digit pairing code"
      />

      {error && (
        <Txt kind="caption" tone="alert" style={{ textAlign: 'center', marginTop: sp(2) }}>{error}</Txt>
      )}

      {paired ? (
        <View style={{ marginTop: sp(6) }}>
          <Row gap={2} style={{ justifyContent: 'center', marginBottom: sp(6) }}>
            <StatusDot state="ok" />
            <Txt kind="label" tone="ok">Band connected · signal good</Txt>
          </Row>
          <Btn label="Continue" onPress={() => router.push('/onboard/survey')} />
        </View>
      ) : (
        <View style={{ marginTop: sp(6) }}>
          <Btn label="Pair the band" onPress={pair} busy={busy} disabled={code.length !== 6} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: {
    fontFamily: font.displayBold,
    fontSize: 44,
    letterSpacing: 10,
    textAlign: 'center',
    color: palette.ink,
    backgroundColor: palette.raised,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.card,
    paddingVertical: sp(5),
    marginTop: sp(8),
  },
});
