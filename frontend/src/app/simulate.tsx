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
//
// Every sentence this screen says lives in lib/copy/family.ts under `simulate`.
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Btn, DataLabel, Entrance, LoadingState, Rule, Screen, Txt } from '@/components';
import { api } from '@/lib/api';
import { family } from '@/lib/copy/family';
import { sp } from '@/theme/tokens';

const copy = family.simulate;

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
          why: e instanceof Error ? e.message : copy.requestFailed,
        });
      });
    return () => { live = false; };
  }, [attempt]);

  // The outcome, or the error the request came back with.
  const detail = outcome.t === 'no_alert' ? copy.recorded : outcome.t === 'failed' ? outcome.why : '';

  return (
    <Screen tone="night" wash scroll={false} style={{ justifyContent: 'center' }}>
      <Entrance index={0}>
        {/* The reading is the route itself, in the machine's voice. */}
        <DataLabel value="POST /admin/simulate">{copy.rehearsal}</DataLabel>
        <Rule style={{ marginTop: sp(2) }} />
      </Entrance>

      {outcome.t === 'running' ? (
        <Entrance index={1}>
          <LoadingState label={copy.sending} />
        </Entrance>
      ) : (
        <Entrance index={1}>
          <View style={{ marginTop: sp(6), gap: sp(3) }}>
            <Txt kind="title">
              {outcome.t === 'no_alert' ? copy.wentThrough : copy.didNotGoThrough}
            </Txt>
            <Txt kind="body" tone="muted">{detail}</Txt>
            <View style={{ gap: sp(2), marginTop: sp(4) }}>
              <Btn label={copy.backToToday} onPress={() => router.replace('/(family)/home')} />
              {outcome.t === 'failed' && (
                <Btn
                  label={copy.tryAgain}
                  kind="quiet"
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
