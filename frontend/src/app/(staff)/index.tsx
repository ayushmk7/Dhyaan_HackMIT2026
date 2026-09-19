// Triage: residents ranked by who needs someone now. The top of this list is
// the product — Marcus covers 40 rooms and reads only the first few rows.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import {
  Btn, ErrorState, Hairline, LoadingState, Row, Screen, StatusDot, Txt,
} from '@/components';
import { Icon } from '@/components/icon';
import { api } from '@/lib/api';
import { ago } from '@/lib/format';
import { useResidents } from '@/lib/hooks';
import type { Alert, Resident } from '@/lib/types';
import { useLive } from '@/store/live';
import { useSession } from '@/store/session';
import { palette, sp } from '@/theme/tokens';
import type { ResidentState } from '@/theme/tokens';

const TIER: Record<ResidentState, number> = {
  alerting: 0, attention: 1, offline: 2, learning: 3, ok: 4,
};

function TriageRow({ r, alert, acking, onPress, onAck }: {
  r: Resident; alert?: Alert; acking?: boolean; onPress: () => void; onAck?: () => void;
}) {
  return (
    <View style={{ paddingVertical: sp(3) }}>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [pressed && { opacity: 0.6 }]}
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
          <Txt kind="caption" tone="muted">{r.last_seen ? ago(r.last_seen) : 'no signal yet'}</Txt>
        </Row>
      </Pressable>
      {alert && onAck && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Acknowledge the alert for ${r.display_name}`}
          onPress={onAck}
          disabled={acking}
          style={({ pressed }) => [
            { marginTop: sp(1.5), paddingLeft: sp(4.5) },
            pressed && { opacity: 0.6 },
          ]}
        >
          <Txt kind="label" tone="slate">
            {acking ? 'Acknowledging…' : 'Acknowledge — I’ve got it'}
          </Txt>
        </Pressable>
      )}
    </View>
  );
}

export default function Triage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useResidents();
  // ponytail: no useOpenAlerts hook in lib/hooks.ts — calling the facade directly
  // here, same pattern the alert screen's belt-and-braces poll already uses.
  const { data: openAlerts } = useQuery({
    queryKey: ['openAlerts'],
    queryFn: api.listOpenAlerts,
    refetchInterval: 5000,
  });
  const liveStates = useLive((s) => s.states);
  const liveLocations = useLive((s) => s.locations);
  const { setRole, finishOnboarding } = useSession();
  const [showOk, setShowOk] = useState(false);
  const [ackingAlertId, setAckingAlertId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await qc.invalidateQueries();
    setRefreshing(false);
  }, [qc]);

  const refreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.inkMuted} />
  );

  if (isLoading && !data) {
    return (
      <Screen refreshControl={refreshControl}>
        <Txt kind="display">Tonight</Txt>
        <LoadingState label="Loading tonight's list…" />
      </Screen>
    );
  }
  if (isError && !data) {
    return (
      <Screen refreshControl={refreshControl}>
        <Txt kind="display">Tonight</Txt>
        <ErrorState message="Couldn’t reach the floor list." onRetry={refetch} />
      </Screen>
    );
  }

  const alertByResident = new Map((openAlerts ?? []).map((a) => [a.resident_id, a]));

  const ack = async (alert: Alert) => {
    setAckingAlertId(alert.id);
    try {
      await api.ack(alert.id, 'Marcus');
      await qc.invalidateQueries();
    } finally {
      setAckingAlertId(null);
    }
  };

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
      // Newest first within a severity: an open alert's own clock beats the
      // band's last heartbeat, which is all we have for non-alerting rows.
      const aKey = alertByResident.get(a.id)?.opened_at ?? a.last_seen ?? '';
      const bKey = alertByResident.get(b.id)?.opened_at ?? b.last_seen ?? '';
      return aKey < bKey ? 1 : -1;
    });

  const needsEyes = residents.filter((r) => r.state !== 'ok');
  const normal = residents.filter((r) => r.state === 'ok');

  return (
    <Screen refreshControl={refreshControl}>
      <Txt kind="display">Tonight</Txt>
      <Txt kind="caption" tone="muted" style={{ marginTop: sp(1) }}>
        {residents.length} residents · floor 2 · Marcus
      </Txt>

      <View style={{ marginTop: sp(5) }}>
        {needsEyes.map((r, i) => (
          <View key={r.id}>
            {i > 0 && <Hairline />}
            <TriageRow
              r={r}
              alert={alertByResident.get(r.id)}
              acking={ackingAlertId === alertByResident.get(r.id)?.id}
              onPress={() => router.push(`/(staff)/resident/${r.id}`)}
              onAck={alertByResident.get(r.id) ? () => ack(alertByResident.get(r.id)!) : undefined}
            />
          </View>
        ))}
        {needsEyes.length === 0 && (
          <Txt kind="body" tone="muted">Nobody needs a check right now.</Txt>
        )}
      </View>

      {normal.length > 0 && (
        <View style={{ marginTop: sp(5) }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowOk((v) => !v)}
            style={{ paddingVertical: sp(2) }}
          >
            <Row gap={1.5}>
              <Icon name={showOk ? 'chevron.down' : 'chevron.right'} size={12} color={palette.inkMuted} />
              <Txt kind="caption" tone="muted">
                {showOk ? 'Hide the quiet ones' : `${normal.length} more look normal tonight`}
              </Txt>
            </Row>
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

      <Hairline style={{ marginTop: sp(9), marginBottom: sp(4) }} />
      <View style={{ gap: sp(2) }}>
        <Btn
          label="Simulate a fall in 214"
          kind="quiet"
          onPress={() => { api.simulate('fall', 'res_harold'); }}
        />
        <Txt kind="caption" tone="muted">
          Plays the whole escalation for Harold, with simulated calls. Safe to press.
        </Txt>
        <Btn
          label="Back to the family app"
          kind="ghost"
          onPress={() => { setRole('family'); finishOnboarding(); router.replace('/(family)'); }}
        />
      </View>
    </Screen>
  );
}
