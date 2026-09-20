// Demo trigger, deep-linkable: dhyaan://simulate (PRD §10.5 /admin/simulate twin).
// It walks the real ingest path and the root AlertWatcher takes over the moment
// an alert opens — so the happy path is a redirect and this screen is never seen.
//
// It has three endings, not one, because the route genuinely has three:
//   1. an alert opened  -> replace() into the takeover
//   2. no alert opened  -> `api.simulate` resolves null (bathroom and walk are
//                          benign by design, and a fall can be cancelled)
//   3. the call failed  -> a rejected promise, which used to leave a blank screen
// This is machine chrome, not a family screen, so it is the one place the
// uppercase mono voice is allowed to describe the request itself.
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Btn, DataLabel, Entrance, LoadingState, Rule, Screen, Txt } from '@/components';
import { api } from '@/lib/api';
import { sp } from '@/theme/tokens';

type Outcome = { t: 'running' } | { t: 'no_alert' } | { t: 'failed'; why: string };

export default function Simulate() {
  const [outcome, setOutcome] = useState<Outcome>({ t: 'running' });
  // Bumping this re-runs the request. The retry button owns the reset back to
  // 'running', so the effect body itself never calls setState.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .simulate('fall')
      .then((alert) => {
        if (!live) return;
        // `Alert | null` — a rehearsal that opens nothing is a real outcome,
        // not a crash, so never reach into `alert.id` without checking first.
        if (alert) router.replace(`/alert/${alert.id}`);
        else setOutcome({ t: 'no_alert' });
      })
      .catch((e: unknown) => {
        if (!live) return;
        setOutcome({
          t: 'failed',
          why: e instanceof Error ? e.message : 'The request didn’t go through.',
        });
      });
    return () => { live = false; };
  }, [attempt]);

  return (
    <Screen night wash="night" scroll={false} style={{ justifyContent: 'center' }}>
      <Entrance index={0}>
        <DataLabel night value="POST /admin/simulate">Rehearsal</DataLabel>
        <Rule night style={{ marginTop: sp(2) }} />
      </Entrance>

      {outcome.t === 'running' ? (
        <Entrance index={1}>
          <LoadingState night label="Sending a rehearsal fall through the real pipeline…" />
        </Entrance>
      ) : (
        <Entrance index={1}>
          <View style={{ marginTop: sp(6), gap: sp(3) }}>
            <Txt kind="title" tone="nightInk">
              {outcome.t === 'no_alert'
                ? 'The rehearsal went through, and nothing needed an alert.'
                : 'The rehearsal didn’t go through.'}
            </Txt>
            <Txt kind="body" tone="nightMuted">
              {outcome.t === 'no_alert'
                ? 'Dhyaan recorded the event. It only opens an alert when the ladder has a reason to start, so there is nothing here to take over the screen.'
                : outcome.why}
            </Txt>
            <View style={{ gap: sp(2), marginTop: sp(4) }}>
              <Btn label="Back to Today" night onPress={() => router.replace('/(family)/home')} />
              {outcome.t === 'failed' && (
                <Btn
                  label="Try the rehearsal again"
                  kind="quiet"
                  night
                  onPress={() => { setOutcome({ t: 'running' }); setAttempt((n) => n + 1); }}
                />
              )}
            </View>
          </View>
        </Entrance>
      )}
    </Screen>
  );
}
