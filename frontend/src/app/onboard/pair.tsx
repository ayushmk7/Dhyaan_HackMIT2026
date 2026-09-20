// Pair the band: the 6-digit code the band shows or reads aloud.
//
// What the server actually does with that code (POST /bands/pair): it upserts
// a band row with that id against this resident, and refuses only when the id
// already belongs to SOMEONE ELSE. It cannot check that a band with those six
// digits exists, because nothing has heard from it yet. So this screen does
// not say "Band connected" — it says what is true: the hub has this id on
// file, here is the id it recorded, check it against the band, and it counts
// as connected the moment the band sends its first reading.
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import {
  Btn, Card, DataLabel, Entrance, ErrorState, Field, Marquee, Rule, Screen, Txt,
} from '@/components';
import { api } from '@/lib/api';
import { sp } from '@/theme/tokens';
import { useSession } from '@/store/session';

export default function Pair() {
  const { residentName } = useSession();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paired, setPaired] = useState<{ bandId: string } | null>(null);

  const pair = async () => {
    setBusy(true);
    setError(null);
    try {
      const band = await api.pairBand(code);
      setPaired({ bandId: band.band_id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The hub didn’t accept that code.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      native
      wash
      floatingBar={
        paired
          ? <Btn label="Continue" onPress={() => router.push('/onboard/survey')} />
          : <Btn label="Pair the band" onPress={pair} busy={busy} disabled={code.length !== 6} />
      }
    >
      <Entrance index={0}>
        <Marquee first title={`Pair ${residentName}’s band`} />
        <Txt kind="body">
          Type the 6-digit code the band shows.
        </Txt>
      </Entrance>

      <Entrance index={1}>
        {/* The code is a machine reading, so the field wears the machine face. */}
        <Field
          code
          value={code}
          onChangeText={(t) => { setCode(t.replace(/\D/g, '').slice(0, 6)); setError(null); }}
          keyboardType="number-pad"
          maxLength={6}
          placeholder="000000"
          editable={!paired}
          accessibilityLabel="6-digit pairing code"
          style={{ marginTop: sp(7) }}
        />
      </Entrance>

      {!!error && (
        <Entrance index={2}>
          <ErrorState inline message={error} style={{ marginTop: sp(3) }} />
        </Entrance>
      )}

      {!!paired && (
        <Entrance index={2}>
          <Card style={{ marginTop: sp(6) }}>
            <DataLabel value={paired.bandId}>Band on file</DataLabel>
            <Rule style={{ marginTop: sp(2.5) }} />
            <Txt kind="body" style={{ marginTop: sp(3) }}>
              Her hub recorded that band as {residentName}’s. It has not heard from the
              band itself yet — it will count as connected the moment the band sends its
              first reading.
            </Txt>
            <Txt kind="caption" tone="muted" style={{ marginTop: sp(3) }}>{/* voice-ok */}
              Check those digits against the ones printed on the band. The hub accepts
              any six digits, so a typo here would file her falls under a band nobody
              is wearing.
            </Txt>
            <Btn
              kind="quiet"
              label="Type a different code"
              style={{ marginTop: sp(4) }}
              onPress={() => { setPaired(null); setCode(''); }}
            />
          </Card>
        </Entrance>
      )}

      <View style={{ height: sp(6) }} />
    </Screen>
  );
}
