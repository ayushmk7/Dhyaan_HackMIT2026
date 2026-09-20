// The one write. Everything onboarding collected — consent, her description,
// the camera's room, and every fact — goes to the server here, in one place,
// so there is exactly one thing that can fail and exactly one retry to build.
//
// It does not pretend to have succeeded: if the write fails you stay on this
// screen with the error and a Try again, and the only way past it says plainly
// that the answers live on this phone until it works.
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Btn, Card, DataLabel, Entrance, Rule, Screen, Txt } from '@/components';
import { api } from '@/lib/api';
import { sp } from '@/theme/tokens';
import { useSession } from '@/store/session';

const EXPECT = [
  'For the first few days it mostly repeats what you told it.',
  'It learns where she usually sits at each time of day from what it sees, and starts calling it "her usual spot" once it is sure.',
  'You will never see a room name for where she is, and there is no video to see. Ask it anything in the Ask tab.',
];

export default function Done() {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const facts = session.factDrafts.filter((f) => f.text.trim().length > 0);
  const appearance = facts.find((f) => f.key === 'appearance')?.text;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.putProfile(session.residentId, {
        name: session.residentName,
        ...(appearance ? { appearance: appearance.slice(0, 200) } : {}),
        consent: {
          falls: session.grants.falls === true,
          camera: session.grants.camera === true,
          memory: session.grants.memory === true,
          signed_by: session.consentGivenBy,
          relationship: session.consentRelationship,
        },
        ...(session.camera.zone
          ? { camera: { zone: session.camera.zone, zone_hint: session.camera.zoneHint } }
          : {}),
      });
      if (facts.length) {
        await api.addFacts(session.residentId, facts, session.consentGivenBy);
      }
      setSaved(true);
      session.finishOnboarding();
      router.replace('/(family)/home');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save that to her home hub.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      wash
      floatingBar={
        <Btn
          label={saved ? 'Open the app' : 'Save and open the app'}
          busy={busy}
          onPress={save}
        />
      }
    >
      <Entrance index={0}>
        <Txt kind="hero" accessibilityRole="header">
          That’s{'\n'}everything.
        </Txt>
        <Rule weight="heavy" style={{ marginTop: sp(4) }} />
        <Txt kind="body" tone="muted" style={{ marginTop: sp(4) }}>
          Dhyaan will get to know {session.residentName} over the next week.
        </Txt>
      </Entrance>

      <Entrance index={1}>
        <Card style={{ marginTop: sp(6) }}>
          <Txt kind="label">What to expect</Txt>
          {EXPECT.map((line) => (
            <Txt key={line.slice(0, 20)} kind="caption" tone="muted" style={{ marginTop: sp(2.5) }}>
              {line}
            </Txt>
          ))}
        </Card>
      </Entrance>

      <Entrance index={2}>
        <Card style={{ marginTop: sp(3) }}>
          <DataLabel value={String(facts.length)}>Notes to save</DataLabel>
          <Rule style={{ marginTop: sp(2) }} />
          <Txt kind="caption" tone="muted" style={{ marginTop: sp(2.5) }}>{/* voice-ok */}
            {facts.length === 0
              ? 'Nothing yet. You can add notes any time in Settings.'
              : 'Every one is editable in Settings, and Forget her profile removes all of them at once.'}
          </Txt>
        </Card>
      </Entrance>

      {!!error && (
        <Entrance index={3} style={{ marginTop: sp(4), gap: sp(2) }}>
          <Txt kind="caption" tone="alert" accessibilityLiveRegion="polite">
            {error}
          </Txt>
          <Txt kind="caption" tone="muted">{/* voice-ok */}
            Nothing was saved. Your answers are still on this phone.
          </Txt>
          <Btn
            kind="quiet"
            label="Skip in without saving"
            onPress={() => { session.finishOnboarding(); router.replace('/(family)/home'); }}
          />
        </Entrance>
      )}
    </Screen>
  );
}
