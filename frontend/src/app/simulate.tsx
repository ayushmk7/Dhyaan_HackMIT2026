// Demo trigger, deep-linkable: dhyaan://simulate (PRD §10.5 /admin/simulate twin).
// It walks the real ingest path and the root AlertWatcher takes over the moment
// an alert opens — so the happy path is a redirect and this screen is never seen.
//
// It has three endings, not one, because the route genuinely has three:
//   1. an alert opened  -> replace() into the takeover
//   2. no alert opened  -> `api.simulate` resolves null (bathroom and walk are
//                          benign by design, and a fall can be cancelled)
//   3. the call failed  -> a rejected promise, which used to leave a blank screen
// It sits on the ordinary paper ground: a rehearsal is not an alarm, and it
// is not night. The outcome sentence is the screen; the route readout and
// the rule that used to head it were chrome describing the request to
// someone who only wants to know what happened.
//
// Every sentence this screen says lives in lib/copy/family.ts under `simulate`.
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Btn, Entrance, LoadingState, Screen, Txt } from '@/components';
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
      .catch(() => {
        if (!live) return;
        // The transport's own words never reach the screen; this says what
        // did not happen and the button under it offers the retry.
        setOutcome({ t: 'failed', why: copy.requestFailed });
      });
    return () => { live = false; };
  }, [attempt]);

  // The outcome, or the error the request came back with.
  const detail = outcome.t === 'no_alert' ? copy.recorded : outcome.t === 'failed' ? outcome.why : '';

  return (
    <Screen wash scroll={false} style={{ justifyContent: 'center' }}>
      {outcome.t === 'running' ? (
        <Entrance index={0}>
          <LoadingState label={copy.sending} />
        </Entrance>
      ) : (
        <Entrance index={0}>
          {/* The outcome is the whole screen, so it takes the display step;
              the detail under it is the machine explaining itself. */}
          <View style={{ gap: sp(4) }}>
            <Txt kind="display">
              {outcome.t === 'no_alert' ? copy.wentThrough : copy.didNotGoThrough}
            </Txt>
            <Txt kind="body" tone="muted">{detail}</Txt>
            <View style={{ gap: sp(2), marginTop: sp(8) }}>
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
