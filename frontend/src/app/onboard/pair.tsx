// Pair the band: the 6-digit code the band shows or reads aloud.
//
// What the server actually does with that code (POST /bands/pair): it upserts
// a band row with that id against this resident, and refuses only when the id
// already belongs to SOMEONE ELSE. It cannot check that a band with those six
// digits exists, because nothing has heard from it yet. So this screen does
// not say "Band connected". It says what is true: the hub has this id on
// file, here is the id it recorded, check it against the band, and it counts
// as connected the moment the band sends its first reading.
//
// The code field owns the screen until the hub answers; then the recorded
// band id does, on the one tinted plate this screen ever draws.
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import {
  Btn, DataLabel, Entrance, ErrorState, Field, Marquee, Screen, Txt,
} from '@/components';
import { api } from '@/lib/api';
import { onboard } from '@/lib/copy/staff';
import { radius, sp, useTheme } from '@/theme';
import { useSession } from '@/store/session';

const copy = onboard.pair;

export default function Pair() {
  const t = useTheme();
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
      setError(e instanceof Error ? e.message : copy.rejected);
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
          ? <Btn label={copy.continue} onPress={() => router.push('/onboard/survey')} />
          : <Btn label={copy.pair} onPress={pair} busy={busy} disabled={code.length !== 6} />
      }
    >
      <Entrance index={0}>
        <Marquee first title={copy.title(residentName)} />
        <Txt kind="caption" tone="muted">
          {copy.intro}
        </Txt>
      </Entrance>

      <Entrance index={1}>
        {/* The code is a machine reading, so the field wears the machine face. */}
        <Field
          code
          value={code}
          onChangeText={(v) => { setCode(v.replace(/\D/g, '').slice(0, 6)); setError(null); }}
          keyboardType="number-pad"
          maxLength={6}
          placeholder={copy.codePlaceholder}
          editable={!paired}
          accessibilityLabel={copy.codeA11y}
          style={{ marginTop: sp(8) }}
        />
      </Entrance>

      {!!error && (
        <Entrance index={2}>
          <ErrorState inline message={error} style={{ marginTop: sp(3) }} />
        </Entrance>
      )}

      {!!paired && (
        <Entrance index={2}>
          <View
            style={{
              marginTop: sp(6),
              padding: sp(4.5),
              borderRadius: radius.glass,
              backgroundColor: t.accentWash,
            }}
          >
            <DataLabel value={paired.bandId}>{copy.bandOnFile}</DataLabel>
            <Txt kind="body" style={{ marginTop: sp(3) }}>
              {copy.recorded(residentName)}
            </Txt>
          </View>
          <Txt kind="caption" tone="muted" style={{ marginTop: sp(3) }}>{/* voice-ok */}
            {copy.checkDigits}
          </Txt>
          <Btn
            kind="link"
            label={copy.differentCode}
            style={{ marginTop: sp(2), alignSelf: 'flex-start' }}
            onPress={() => { setPaired(null); setCode(''); }}
          />
        </Entrance>
      )}
    </Screen>
  );
}
