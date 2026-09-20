// Triage: residents ranked by who needs someone now. The top of this list is
// the product — Marcus covers 40 rooms and reads only the first few rows.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import {
  Btn, Card, ErrorState, Hairline, LoadingState, Row, Screen, Txt,
} from '@/components';
import { Avatar } from '@/components/avatar';
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
  const urgent = r.state === 'alerting';
  return (
    <View style={{ paddingVertical: sp(2.5) }}>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [pressed && { opacity: 0.6 }]}
      >
        <Row gap={3}>
          <Avatar
            name={r.display_name}
            size={40}
            tone={r.state === 'attention' || urgent ? 'amber' : 'blue'}
          />
          <View style={{ flex: 1 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt kind="label">{r.display_name}</Txt>
              <Txt kind="caption" tone="muted">{r.room ?? ''}</Txt>
            </Row>
            <Row style={{ justifyContent: 'space-between', marginTop: 1 }}>
              <Txt
                kind="caption"
                tone={urgent ? 'alert' : undefined}
                style={urgent ? { flex: 1, paddingRight: sp(2) } : { flex: 1, paddingRight: sp(2), color: palette.ink, opacity: 0.9 }}
                numberOfLines={2}
              >
                {r.attention_reason ?? 'Routine looks normal'}
              </Txt>
              <Txt kind="caption" tone="muted">{r.last_seen ? ago(r.last_seen) : 'no signal'}</Txt>
            </Row>
          </View>
        </Row>
      </Pressable>
      {alert && onAck && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Acknowledge the alert for ${r.display_name}`}
          onPress={onAck}
          disabled={acking}
          style={({ pressed }) => [
            { marginTop: sp(1.5), marginLeft: sp(13) },
            pressed && { opacity: 0.6 },
          ]}
        >
          <Txt kind="label" tone="slate">
            {acking ? 'Acknowledging…' : 'Acknowledge'}
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
  const [showDemo, setShowDemo] = useState(false);
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
      <Screen native refreshControl={refreshControl}>
        <LoadingState label="Loading tonight's list…" />
      </Screen>
    );
  }
  if (isError && !data) {
    return (
      <Screen native refreshControl={refreshControl}>
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
    <Screen native refreshControl={refreshControl}>
      {/* Long-press the list to reveal demo controls; no visible demo chrome. */}
      <Pressable onLongPress={() => setShowDemo((v) => !v)} delayLongPress={600}>
        <Card style={{ paddingVertical: sp(1) }}>
          {needsEyes.map((r, i) => (
            <View key={r.id}>
              {i > 0 && <Hairline />}
              <TriageRow
                r={r}
                alert={alertByResident.get(r.id)}
                acking={ackingAlertId === alertByResident.get(r.id)?.id}
                onPress={() => router.push(`/(staff)/triage/resident/${r.id}`)}
                onAck={alertByResident.get(r.id) ? () => ack(alertByResident.get(r.id)!) : undefined}
              />
            </View>
          ))}
          {needsEyes.length === 0 && (
            <Txt kind="body" tone="muted" style={{ paddingVertical: sp(3) }}>
              Nobody needs a check right now.
            </Txt>
          )}
        </Card>
      </Pressable>

      {normal.length > 0 && (
        <View style={{ marginTop: sp(4) }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowOk((v) => !v)}
            style={{ paddingVertical: sp(2), paddingHorizontal: sp(1) }}
          >
            <Row gap={1.5}>
              <Icon name={showOk ? 'chevron.down' : 'chevron.right'} size={12} color={palette.inkMuted} />
              <Txt kind="caption" tone="muted">
                {showOk ? 'Hide' : `${normal.length} doing fine`}
              </Txt>
            </Row>
          </Pressable>
          {showOk && (
            <Card style={{ marginTop: sp(1), paddingVertical: sp(1) }}>
              {normal.map((r, i) => (
                <View key={r.id}>
                  {i > 0 && <Hairline />}
                  <TriageRow r={r} onPress={() => router.push(`/(staff)/triage/resident/${r.id}`)} />
                </View>
              ))}
            </Card>
          )}
        </View>
      )}

      {showDemo && (
        <Card style={{ marginTop: sp(5) }}>
          <Txt kind="label">Demo</Txt>
          <View style={{ gap: sp(2), marginTop: sp(2.5) }}>
            <Btn
              label="Simulate a fall in 214"
              kind="quiet"
              onPress={() => { api.simulate('fall', 'res_harold'); }}
            />
            <Btn
              label="Family app"
              kind="ghost"
              onPress={() => { setRole('family'); finishOnboarding(); router.replace('/(family)/home'); }}
            />
          </View>
        </Card>
      )}
    </Screen>
  );
}
