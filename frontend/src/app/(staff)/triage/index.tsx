// Triage: residents ranked by who needs someone now. The top of this list is
// the product — Marcus covers 40 rooms and reads only the first few rows.
//
// Three things used to keep this screen permanently blank against the real
// backend, all fixed here:
//   1. It filtered out `res_eleanor`, who is the ONLY resident
//      `backend/scripts/seed.py` seeds. Hiding the only real row to preserve
//      the fiction of a full facility is backwards, so she is in the list now.
//      (The mock-era reason was cosmetic: mock Eleanor is the B2C resident and
//      carries no room, so she showed up roomless among the B2B rows. A
//      roomless row now renders as one — see `NO ROOM` below — instead of
//      being deleted.)
//   2. It sorted on `attention | offline | learning`, none of which the server
//      emits. The tiers are derived instead — see `(staff)/_layout.tsx`.
//   3. `attention_reason` is mock-only, so every live row read "Routine looks
//      normal" — an assessment nobody made. The reason is derived from the
//      open alert and the age of `last_seen`, and rows with no real reason
//      show none.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import {
  Btn, Card, Chevron, Chip, DataLabel, EmptyState, ErrorState, LoadingState, Marquee, Row,
  RowGroup, Screen, Slab, Stagger, StatusDot, Txt,
} from '@/components';
import { Avatar } from '@/components/avatar';
import { api } from '@/lib/api';
import { readout, triage as copy } from '@/lib/copy/staff';
import { timeOf } from '@/lib/format';
import { useResidents } from '@/lib/hooks';
import type { Alert, Resident } from '@/lib/types';
import { useLive } from '@/store/live';
import { useSession } from '@/store/session';
import { sp, useTheme } from '@/theme';
import type { ResidentState } from '@/theme/tokens';
import { NEEDS_EYES, TIER, deriveState, pad2, triageReason } from '../_layout';

type TriageItem = Resident & { state: ResidentState; alert?: Alert; reason: string | null };

// The one uncompromising contrast moment on this screen: black slab, white
// tabular figures. Everything below it stays quiet paper. The slab supplies
// the colours; nothing inside it is told what it is sitting on.
function CountSlab({ needing, total, updatedAt }: {
  needing: number; total: number; updatedAt: number;
}) {
  return (
    <Slab style={{ paddingVertical: sp(4) }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <View>
          <DataLabel>{copy.slab.needsCheck}</DataLabel>
          <Txt kind="readout" style={{ marginTop: sp(1) }}>{pad2(needing)}</Txt>
        </View>
        <View style={{ alignItems: 'flex-end', gap: sp(1.5) }}>
          <DataLabel value={pad2(total)}>{copy.slab.onFloor}</DataLabel>
          <DataLabel value={updatedAt ? timeOf(new Date(updatedAt).toISOString()) : readout.noTime}>
            {copy.slab.updated}
          </DataLabel>
        </View>
      </Row>
    </Slab>
  );
}

function TriageRow({ r, acking, onPress, onAck }: {
  r: TriageItem; acking?: boolean; onPress: () => void; onAck?: () => void;
}) {
  const urgent = r.state === 'alerting';
  return (
    <View style={{ paddingVertical: sp(2.5) }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.row.a11y(r.display_name, r.room)}
        onPress={onPress}
        style={({ pressed }) => [pressed && { opacity: 0.6 }]}
      >
        <Row gap={3} style={{ alignItems: 'flex-start' }}>
          <Avatar
            name={r.display_name}
            size={40}
            tone={urgent || r.state === 'attention' ? 'amber' : 'blue'}
          />
          <View style={{ flex: 1 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Row gap={1.5} style={{ flex: 1 }}>
                <StatusDot state={r.state} size={8} />
                <Txt kind="label" numberOfLines={1} style={{ flex: 1 }}>{r.display_name}</Txt>
              </Row>
              {/* Staff MAY see whereabouts; family never may (D-001). */}
              <Txt kind="stamp" tone="muted">
                {r.room ? copy.row.roomStamp(r.room) : readout.noRoomStamp}
              </Txt>
            </Row>
            {!!r.reason && (
              <Txt
                kind="caption"
                tone={urgent ? 'alert' : 'ink'}
                numberOfLines={2}
                style={{ marginTop: 2 }}
              >
                {r.reason}
              </Txt>
            )}
            <Row gap={3} style={{ marginTop: sp(1.5), flexWrap: 'wrap' }}>
              <DataLabel value={r.last_seen ? timeOf(r.last_seen) : readout.noTime}>
                {copy.row.seen}
              </DataLabel>
              {!!r.location && <DataLabel value={r.location.label}>{copy.row.zone}</DataLabel>}
              {r.band_battery_pct != null && (
                <DataLabel value={`${r.band_battery_pct}%`}>{copy.row.band}</DataLabel>
              )}
            </Row>
          </View>
          <Chevron />
        </Row>
      </Pressable>
      {onAck && (
        <Btn
          label={copy.row.acknowledge}
          kind="quiet"
          size="small"
          busy={acking}
          onPress={onAck}
          style={{ alignSelf: 'flex-start', marginTop: sp(2), marginLeft: sp(13) }}
        />
      )}
    </View>
  );
}

export default function Triage() {
  const t = useTheme();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, dataUpdatedAt } = useResidents();
  // ponytail: no useOpenAlerts hook in lib/hooks.ts — calling the facade directly
  // here, same pattern the alert screen's belt-and-braces poll already uses.
  const { data: openAlerts } = useQuery({
    queryKey: ['openAlerts'],
    queryFn: api.listOpenAlerts,
    refetchInterval: 5000,
  });
  const liveStates = useLive((s) => s.states);
  const liveLocations = useLive((s) => s.locations);
  const { setRole, finishOnboarding, residentId, user } = useSession();
  const [showOk, setShowOk] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const [ackingAlertId, setAckingAlertId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [demoNote, setDemoNote] = useState<string | null>(null);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await qc.invalidateQueries();
    setRefreshing(false);
  }, [qc]);

  const refreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.inkMuted} />
  );

  if (isLoading && !data) {
    return (
      <Screen native wash refreshControl={refreshControl}>
        <LoadingState label={copy.loading} />
      </Screen>
    );
  }
  if (isError && !data) {
    return (
      <Screen native wash refreshControl={refreshControl}>
        <ErrorState message={copy.loadError} onRetry={refetch} />
      </Screen>
    );
  }

  const alertByResident = new Map((openAlerts ?? []).map((a) => [a.resident_id, a]));

  const ack = async (alert: Alert) => {
    setAckingAlertId(alert.id);
    try {
      await api.ack(alert.id, user?.name ?? copy.ackActorFallback);
      await qc.invalidateQueries();
    } finally {
      setAckingAlertId(null);
    }
  };

  // The demo trigger runs against the resident this session signed in for —
  // `res_harold` was hardcoded here and exists only in the mock, so against
  // the real backend this was a 404 thrown into a promise nobody awaited.
  const simulateFall = async () => {
    setSimulating(true);
    setDemoNote(null);
    try {
      const alert = await api.simulate('fall', residentId);
      await qc.invalidateQueries();
      // `simulate` returns Alert | null: a bathroom dwell or a walk may
      // legitimately open nothing, and a fall can too if the FSM declines.
      if (alert) router.push(`/alert/${alert.id}`);
      else setDemoNote(copy.demo.nothingCrossed);
    } catch (e) {
      setDemoNote(e instanceof Error ? e.message : copy.demo.backendError);
    } finally {
      setSimulating(false);
    }
  };

  const residents: TriageItem[] = (data ?? [])
    .map((r) => {
      const alert = alertByResident.get(r.id);
      const state = deriveState(r, liveStates[r.id], !!alert);
      return {
        ...r,
        state,
        location: liveLocations[r.id] ?? r.location,
        alert,
        reason: triageReason(r, state, alert),
      };
    })
    .sort((a, b) => {
      const t = TIER[a.state] - TIER[b.state];
      if (t !== 0) return t;
      // Newest first within a severity: an open alert's own clock beats the
      // band's last heartbeat, which is all we have for non-alerting rows.
      const aKey = a.alert?.opened_at ?? a.last_seen ?? '';
      const bKey = b.alert?.opened_at ?? b.last_seen ?? '';
      return aKey < bKey ? 1 : -1;
    });

  const needsEyes = residents.filter((r) => NEEDS_EYES.includes(r.state));
  const normal = residents.filter((r) => !NEEDS_EYES.includes(r.state));

  return (
    <Screen native wash refreshControl={refreshControl}>
      <Stagger>
        <CountSlab needing={needsEyes.length} total={residents.length} updatedAt={dataUpdatedAt} />

        {/* Long-press the heading to reveal demo controls; no visible demo chrome. */}
        <Pressable onLongPress={() => setShowDemo((v) => !v)} delayLongPress={600}>
          <Marquee
            title={copy.needsCheck}
            meta={copy.ofMeta(pad2(needsEyes.length), pad2(residents.length))}
          />
        </Pressable>

        <RowGroup>
          {needsEyes.map((r) => (
            <TriageRow
              key={r.id}
              r={r}
              acking={ackingAlertId === r.alert?.id}
              onPress={() => router.push(`/(staff)/triage/resident/${r.id}`)}
              onAck={r.alert ? () => ack(r.alert!) : undefined}
            />
          ))}
          {needsEyes.length === 0 && (
            <EmptyState>
              {residents.length === 0 ? copy.emptyNoResidents : copy.emptyNobody}
            </EmptyState>
          )}
        </RowGroup>

        {normal.length > 0 && (
          <View>
            <Marquee
              title={copy.doingFine}
              right={
                <Chip
                  label={showOk ? copy.hide : copy.showN(pad2(normal.length))}
                  onPress={() => setShowOk((v) => !v)}
                />
              }
            />
            {showOk && (
              <RowGroup>
                {normal.map((r) => (
                  <TriageRow
                    key={r.id}
                    r={r}
                    onPress={() => router.push(`/(staff)/triage/resident/${r.id}`)}
                  />
                ))}
              </RowGroup>
            )}
          </View>
        )}

        {showDemo && (
          <View>
            <Marquee title={copy.demo.title} meta={copy.demo.meta} />
            <Card style={{ gap: sp(2) }}>
              <Btn
                label={copy.demo.simulateFall}
                kind="quiet"
                busy={simulating}
                onPress={simulateFall}
              />
              <Btn
                label={copy.demo.familyApp}
                kind="ghost"
                onPress={() => { setRole('family'); finishOnboarding(); router.replace('/(family)/home'); }}
              />
              {!!demoNote && <Txt kind="caption" tone="muted">{demoNote}</Txt>}
            </Card>
          </View>
        )}
      </Stagger>
    </Screen>
  );
}
