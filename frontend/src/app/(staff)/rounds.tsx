// Night rounds: 23:00–07:00 mode. Only what deviated tonight, darkest screen
// in the app — Marcus reads this in a dim corridor.
import { router } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';
import { Card, Row, Screen, StateChip, StatusDot, Txt } from '@/components';
import { ago } from '@/lib/format';
import { useResidents } from '@/lib/hooks';
import { useLive } from '@/store/live';
import { font, sp } from '@/theme/tokens';
import type { ResidentState } from '@/theme/tokens';

const SEVERITY: Record<ResidentState, number> = {
  alerting: 0, attention: 1, offline: 2, learning: 3, ok: 4,
};

export default function Rounds() {
  const { data } = useResidents();
  const liveStates = useLive((s) => s.states);

  const deviating = (data ?? [])
    .filter((r) => r.id !== 'res_eleanor')
    .map((r) => ({ ...r, state: liveStates[r.id] ?? r.state }))
    .filter((r) => r.state === 'attention' || r.state === 'alerting' || r.state === 'offline')
    .sort((a, b) => SEVERITY[a.state] - SEVERITY[b.state]);

  return (
    <Screen night>
      <Txt kind="display" tone="nightInk">Night rounds</Txt>
      <Txt kind="caption" tone="nightMuted" style={{ marginTop: sp(1) }}>
        Only what changed tonight
      </Txt>

      <View style={{ marginTop: sp(5), gap: sp(3) }}>
        {deviating.map((r) => (
          <Pressable
            key={r.id}
            accessibilityRole="button"
            onPress={() => router.push(`/(staff)/resident/${r.id}`)}
          >
            {({ pressed }) => (
              <Card night style={pressed ? { opacity: 0.7 } : undefined}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Row gap={2}>
                    {r.state === 'alerting' && <StatusDot state="alerting" />}
                    <Txt kind="label" tone="nightInk">{r.display_name}</Txt>
                    <Txt kind="caption" tone="nightMuted">· {r.room}</Txt>
                  </Row>
                  <StateChip state={r.state} />
                </Row>
                <Txt kind="body" tone="nightInk" style={{ marginTop: sp(2) }}>
                  {r.attention_reason ?? 'Needs a look'}
                </Txt>
                <Txt kind="caption" tone="nightMuted" style={{ marginTop: sp(1) }}>
                  Last signal {ago(r.last_seen)}
                </Txt>
              </Card>
            )}
          </Pressable>
        ))}
        {deviating.length === 0 && (
          <Txt
            kind="title"
            tone="nightMuted"
            style={{ fontFamily: font.serif, marginTop: sp(10), textAlign: 'center' }}
          >
            Nothing has deviated tonight. All quiet.
          </Txt>
        )}
      </View>
    </Screen>
  );
}
