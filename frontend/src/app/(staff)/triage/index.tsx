// Triage: residents ranked by who needs someone now. The top of this list is
// the product. Marcus covers 40 rooms and reads only the first few rows.
//
// The hierarchy is the point, so it is drawn in three weights:
//   1. The count. One large tabular number on paper, nothing else that size.
//   2. Whoever is alerting. Each one is an inverted plate (ink in light, white
//      in dark): the only inversion on the screen, and impossible to miss.
//      A count that was always inverted, even at 00, spent that gesture on
//      nothing, so the count no longer sits on a slab.
//   3. Everyone else. "Worth a look" and "band offline" get a full row with
//      the reason; "doing fine" collapses to one dense line per resident.
//
// Three things used to keep this screen permanently blank against the real
// backend, all fixed here:
//   1. It filtered out `res_eleanor`, who is the ONLY resident
//      `backend/scripts/seed.py` seeds. A roomless row now renders as one
//      (`NO ROOM`) instead of being deleted.
//   2. It sorted on `attention | offline | learning`, none of which the server
//      emits. The tiers are derived instead, see `(staff)/_layout.tsx`.
//   3. `attention_reason` is mock-only, so every live row read "Routine looks
//      normal", an assessment nobody made. The reason is derived from the
//      open alert and the age of `last_seen`, and rows with no real reason
//      show none.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import {
  Btn, Card, Chevron, Chip, DataLabel, ErrorState, LoadingState, Marquee, Row, RowGroup, Rule,
  Screen, Slab, Stagger, StatusDot, Txt,
} from '@/components';
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

const stamp = (r: Resident) => (r.room ? copy.row.roomStamp(r.room) : readout.noRoomStamp);
const seen = (r: Resident) => (r.last_seen ? timeOf(r.last_seen) : readout.noTime);

// The one large number on the screen. Ink on paper: a count is a reading, not
// an alarm, so it earns no inversion.
function Count({ needing, total, updatedAt }: { needing: number; total: number; updatedAt: number }) {
  return (
    <View>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }} gap={4}>
        <View>
          <Txt kind="readout">{pad2(needing)}</Txt>
          <DataLabel style={{ marginTop: sp(1) }}>{copy.slab.needsCheck}</DataLabel>
        </View>
        <View style={{ alignItems: 'flex-end', gap: sp(1.5), paddingBottom: sp(0.5) }}>
          <DataLabel value={pad2(total)}>{copy.slab.onFloor}</DataLabel>
          <DataLabel value={updatedAt ? timeOf(new Date(updatedAt).toISOString()) : readout.noTime}>
            {copy.slab.updated}
          </DataLabel>
        </View>
      </Row>
      <Rule weight="heavy" style={{ marginTop: sp(3) }} />
    </View>
  );
}

// An alerting resident: the inverted plate. The slab hands every child its
// colour, so nothing inside is told what it sits on.
function UrgentCard({ r, acking, onPress, onAck }: {
  r: TriageItem; acking?: boolean; onPress: () => void; onAck?: () => void;
}) {
  return (
    <Slab onPress={onPress} accessibilityLabel={copy.row.a11y(r.display_name, r.room)} style={{ marginTop: sp(3) }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} gap={3}>
        <Txt kind="title" numberOfLines={1} style={{ flex: 1 }}>{r.display_name}</Txt>
        {/* Staff MAY see whereabouts; family never may (D-001). */}
        <Txt kind="stamp" tone="muted">{stamp(r)}</Txt>
      </Row>
      {!!r.reason && (
        <Txt kind="body" style={{ marginTop: sp(1.5) }}>{r.reason}</Txt>
      )}
      <Rule weight="hair" style={{ marginTop: sp(3.5) }} />
      <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: sp(3) }} gap={3}>
        <Row gap={3} style={{ flexWrap: 'wrap', flex: 1 }}>
          <DataLabel value={seen(r)}>{copy.row.seen}</DataLabel>
          {!!r.location && <DataLabel value={r.location.label}>{copy.row.zone}</DataLabel>}
          {r.band_battery_pct != null && (
            <DataLabel value={`${r.band_battery_pct}%`}>{copy.row.band}</DataLabel>
          )}
        </Row>
        {onAck && (
          <Btn label={copy.row.acknowledge} kind="inverse" size="small" busy={acking} onPress={onAck} />
        )}
      </Row>
    </Slab>
  );
}

// A resident worth a look, or whose band has gone quiet: a full row with the
// reason in the reading weight.
function WatchRow({ r, onPress }: { r: TriageItem; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copy.row.a11y(r.display_name, r.room)}
      onPress={onPress}
      style={({ pressed }) => [{ paddingVertical: sp(3) }, pressed && { opacity: 0.6 }]}
    >
      <Row gap={3} style={{ alignItems: 'flex-start' }}>
        <View style={{ paddingTop: sp(1.5) }}>
          <StatusDot state={r.state} size={10} />
        </View>
        <View style={{ flex: 1 }}>
          <Row style={{ justifyContent: 'space-between' }} gap={3}>
            <Txt kind="label" numberOfLines={1} style={{ flex: 1 }}>{r.display_name}</Txt>
            <Txt kind="stamp" tone="muted">{stamp(r)}</Txt>
          </Row>
          {!!r.reason && (
            <Txt kind="body" numberOfLines={2} style={{ marginTop: 2 }}>{r.reason}</Txt>
          )}
          <Row gap={3} style={{ marginTop: sp(1.5), flexWrap: 'wrap' }}>
            <DataLabel value={seen(r)}>{copy.row.seen}</DataLabel>
            {!!r.location && <DataLabel value={r.location.label}>{copy.row.zone}</DataLabel>}
            {r.band_battery_pct != null && (
              <DataLabel value={`${r.band_battery_pct}%`}>{copy.row.band}</DataLabel>
            )}
          </Row>
        </View>
        <Chevron style={{ marginTop: sp(1.5) }} />
      </Row>
    </Pressable>
  );
}

// Doing fine: one dense line. Name, room, last signal. Nothing to read twice.
function QuietRow({ r, onPress }: { r: TriageItem; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copy.row.a11y(r.display_name, r.room)}
      onPress={onPress}
      style={({ pressed }) => [{ paddingVertical: sp(2.5) }, pressed && { opacity: 0.6 }]}
    >
      <Row style={{ justifyContent: 'space-between' }} gap={3}>
        <Row gap={2} style={{ flex: 1 }}>
          <StatusDot state={r.state} size={8} />
          <Txt kind="label" numberOfLines={1} style={{ flex: 1 }}>{r.display_name}</Txt>
        </Row>
        <Row gap={3}>
          <Txt kind="stamp" tone="muted">{stamp(r)}</Txt>
          <Txt kind="stamp" tone="muted">{seen(r)}</Txt>
        </Row>
      </Row>
    </Pressable>
  );
}

export default function Triage() {
  const t = useTheme();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, dataUpdatedAt } = useResidents();
  // ponytail: no useOpenAlerts hook in lib/hooks.ts, so the facade is called
  // directly here, the same pattern the alert screen's belt-and-braces poll uses.
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

  // The demo trigger runs against the resident this session signed in for.
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

  const urgent = residents.filter((r) => r.state === 'alerting');
  const watch = residents.filter((r) => r.state !== 'alerting' && NEEDS_EYES.includes(r.state));
  const normal = residents.filter((r) => !NEEDS_EYES.includes(r.state));
  const needing = urgent.length + watch.length;
  const open = (r: TriageItem) => router.push(`/(staff)/triage/resident/${r.id}`);

  return (
    <Screen native wash refreshControl={refreshControl}>
      <Stagger>
        <Count needing={needing} total={residents.length} updatedAt={dataUpdatedAt} />

        <View>
          {/* Long-press the heading to reveal demo controls; no visible demo chrome. */}
          <Pressable onLongPress={() => setShowDemo((v) => !v)} delayLongPress={600}>
            <Marquee
              title={copy.needsCheck}
              meta={copy.ofMeta(pad2(needing), pad2(residents.length))}
              style={{ marginTop: sp(5) }}
            />
          </Pressable>

          {urgent.map((r) => (
            <UrgentCard
              key={r.id}
              r={r}
              acking={ackingAlertId === r.alert?.id}
              onPress={() => open(r)}
              onAck={r.alert ? () => ack(r.alert!) : undefined}
            />
          ))}

          {watch.length > 0 && (
            <RowGroup style={{ marginTop: urgent.length ? sp(3) : 0 }}>
              {watch.map((r) => <WatchRow key={r.id} r={r} onPress={() => open(r)} />)}
            </RowGroup>
          )}

          {needing === 0 && (
            // The calm state is the one large sentence, not a grey line.
            <Txt kind="title" style={{ marginTop: sp(2), paddingRight: sp(6) }}>
              {residents.length === 0 ? copy.emptyNoResidents : copy.emptyNobody}
            </Txt>
          )}
        </View>

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
                {normal.map((r) => <QuietRow key={r.id} r={r} onPress={() => open(r)} />)}
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
