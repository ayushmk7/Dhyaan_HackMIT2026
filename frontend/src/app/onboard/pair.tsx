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
// band id does, on the one tinted plate this screen ever draws. While the
// code is short the screen says how many digits are still to come, so a grey
// button is never a mystery.
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import {
  Btn, DataLabel, Entrance, ErrorState, Field, Txt,
  Screen,
} from '@/components';
import { api } from '@/lib/api';
import { onboard } from '@/lib/copy/staff';
import { radius, sp, useTheme } from '@/theme';
import { useSession } from '@/store/session';
import { StepHeader } from './_layout';

const copy = onboard.pair;
const CODE_LEN = 6;

export default function Pair() {
  const t = useTheme();
  const { residentName, grants } = useSession();
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

  const missing = CODE_LEN - code.length;

  return (
    <Screen
      native
      wash
      floatingBar={
        paired
          ? <Btn label={copy.toSurvey} onPress={() => router.push('/onboard/survey')} />
          : <Btn label={copy.pair} onPress={pair} busy={busy} disabled={missing > 0} />
      }
    >
      <Entrance index={0}>
        <StepHeader step="pair" grants={grants} title={copy.title(residentName)} purpose={copy.purpose} />
      </Entrance>

      <Entrance index={1}>
        <Txt kind="label" style={{ marginTop: sp(6) }}>{copy.intro}</Txt>
        {/* The code is a machine reading, so the field wears the machine face. */}
        <Field
          code
          value={code}
          onChangeText={(v) => { setCode(v.replace(/\D/g, '').slice(0, CODE_LEN)); setError(null); }}
          keyboardType="number-pad"
          maxLength={CODE_LEN}
          placeholder={copy.codePlaceholder}
          editable={!paired}
          accessibilityLabel={copy.codeA11y}
          style={{ marginTop: sp(3) }}
        />
        {!paired && missing > 0 && (
          <Txt kind="caption" tone="muted" accessibilityLiveRegion="polite" style={{ marginTop: sp(2) }}>
            {copy.needDigits(missing)}
          </Txt>
        )}
      </Entrance>

      {!!error && (
        <Entrance index={2}>
          <ErrorState inline message={error} onRetry={pair} style={{ marginTop: sp(3) }} />
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
            kind="quiet"
            size="small"
            label={copy.differentCode}
            style={{ marginTop: sp(3), alignSelf: 'flex-start' }}
            onPress={() => { setPaired(null); setCode(''); }}
          />
        </Entrance>
      )}
    </Screen>
  );
}
