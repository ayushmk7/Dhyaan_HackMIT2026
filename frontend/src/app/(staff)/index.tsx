// Triage: residents ranked by who needs someone now. The top of this list is
// the product — Marcus covers 40 rooms and reads only the first few rows.
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Btn, Hairline, Row, Screen, StatusDot, Txt } from '@/components';
import { api } from '@/lib/api';
import { ago } from '@/lib/format';
import { useResidents } from '@/lib/hooks';
import type { Resident } from '@/lib/types';
import { useLive } from '@/store/live';
import { sp } from '@/theme/tokens';
import type { ResidentState } from '@/theme/tokens';

const TIER: Record<ResidentState, number> = {
  alerting: 0, attention: 1, offline: 2, learning: 3, ok: 4,
};

function TriageRow({ r, onPress }: { r: Resident; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [{ paddingVertical: sp(3) }, pressed && { opacity: 0.6 }]}
    >
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={2}>
          <StatusDot state={r.state} />
          <Txt kind="label">{r.display_name}</Txt>
        </Row>
        <Txt kind="caption" tone="muted">{r.room ?? ''}</Txt>
      </Row>
      <Row style={{ justifyContent: 'space-between', marginTop: 2, paddingLeft: sp(4.5) }}>
        <Txt
          kind="caption"
          tone={r.state === 'alerting' ? 'alert' : r.state === 'attention' ? 'warn' : 'muted'}
          style={{ flex: 1, paddingRight: sp(2) }}
          numberOfLines={2}
        >
          {r.attention_reason ?? 'Routine looks normal'}
        </Txt>
        <Txt kind="caption" tone="muted">{ago(r.last_seen)}</Txt>
      </Row>
    </Pressable>
  );
}

export default function Triage() {
  const { data } = useResidents();
  const liveStates = useLive((s) => s.states);
  const liveLocations = useLive((s) => s.locations);
  const [showOk, setShowOk] = useState(false);

  const residents = (data ?? [])
    .filter((r) => r.id !== 'res_eleanor')
    .map((r) => ({
      ...r,
      state: liveStates[r.id] ?? r.state,
      location: liveLocations[r.id] ?? r.location,
    }))
    .sort((a, b) => {
      const t = TIER[a.state] - TIER[b.state];
      if (t !== 0) return t;
      return a.last_seen < b.last_seen ? 1 : -1;
    });

  const needsEyes = residents.filter((r) => r.state !== 'ok');
  const normal = residents.filter((r) => r.state === 'ok');

  return (
    <Screen>
      <Txt kind="display">Tonight</Txt>
      <Txt kind="caption" tone="muted" style={{ marginTop: sp(1) }}>
        {residents.length} residents · floor 2 · Marcus
      </Txt>

      <View style={{ marginTop: sp(5) }}>
        {needsEyes.map((r, i) => (
          <View key={r.id}>
            {i > 0 && <Hairline />}
            <TriageRow r={r} onPress={() => router.push(`/(staff)/resident/${r.id}`)} />
          </View>
        ))}
        {needsEyes.length === 0 && (
          <Txt kind="body" tone="muted">Nobody needs a check right now.</Txt>
        )}
      </View>

      {normal.length > 0 && (
        <View style={{ marginTop: sp(5) }}>
          <Pressable accessibilityRole="button" onPress={() => setShowOk((v) => !v)}>
            <Txt kind="caption" tone="muted">
              {showOk ? 'Hide' : `${normal.length} residents look normal`}
            </Txt>
          </Pressable>
          {showOk && (
            <View style={{ marginTop: sp(2) }}>
              {normal.map((r, i) => (
                <View key={r.id}>
                  {i > 0 && <Hairline />}
                  <TriageRow r={r} onPress={() => router.push(`/(staff)/resident/${r.id}`)} />
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      <Btn
        label="Simulate a fall in 214"
        kind="quiet"
        onPress={() => { api.simulate('fall', 'res_harold'); }}
        style={{ marginTop: sp(8) }}
      />
    </Screen>
  );
}
