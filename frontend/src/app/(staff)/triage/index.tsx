// Triage: residents ranked by who needs someone now. The top of this list is
// the product. Marcus covers 40 rooms and reads only the first few rows.
//
// The hierarchy is the point, so it is drawn in three weights:
//   1. The count. One large tabular number on paper, nothing else that size,
//      and nothing beside it.
//   2. Whoever is alerting. Each one is the plate: the only plate on the
//      screen, and impossible to miss.
//   3. Everyone else. "Worth a look" and "band offline" get a row with the
//      reason; "doing fine" collapses to one line per resident behind a button.
//
// Decluttered: the count's side column (total, updated-at) and the "N of M"
// heading that restated the count are gone; so are the seen/zone/battery
// strip on every row, the chevrons, and the dot on rows that were all the
// same dot. A care worker scans this, so what is left is the state, the name,
// the room and the reason.
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
  Btn, Card, DataLabel, ErrorState, LoadingState, Marquee, Row, RowGroup, Rule,
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

// The one large number on the screen, and the only thing at that size. It
// says how many need a check; the rows under it say who. Nothing else sits
// beside it: the total is on the "Doing fine" line, and "updated at" was a
// reading nobody acted on (pull to refresh is the action).
function Count({ needing, onLongPress }: { needing: number; onLongPress: () => void }) {
  return (
    <Pressable onLongPress={onLongPress} delayLongPress={600}>
      <Txt kind="readout">{pad2(needing)}</Txt>
      <DataLabel style={{ marginTop: sp(1) }}>{copy.needsCheck}</DataLabel>
      <Rule weight="heavy" style={{ marginTop: sp(4) }} />
    </Pressable>
  );
}

// An alerting resident: the one plate on the screen. Name, room, why, and the
// one thing to do about it. The seen/zone/battery strip is gone: the reason
// already carries the clock, and the rest is on the resident's own page.
function UrgentCard({ r, acking, onPress, onAck }: {
  r: TriageItem; acking?: boolean; onPress: () => void; onAck?: () => void;
}) {
  return (
    <Slab onPress={onPress} accessibilityLabel={copy.row.a11y(r.display_name, r.room)} style={{ marginTop: sp(4) }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} gap={3}>
        <Txt kind="title" numberOfLines={1} style={{ flex: 1 }}>{r.display_name}</Txt>
        {/* Staff MAY see whereabouts; family never may (D-001). */}
        <Txt kind="stamp" tone="muted">{stamp(r)}</Txt>
      </Row>
      {!!r.reason && (
        <Txt kind="body" style={{ marginTop: sp(2) }}>{r.reason}</Txt>
      )}
      {onAck && (
        <Row style={{ justifyContent: 'flex-end', marginTop: sp(5) }}>
          <Btn label={copy.row.acknowledge} kind="inverse" size="small" busy={acking} onPress={onAck} />
        </Row>
      )}
    </Slab>
  );
}

// A resident worth a look, or whose band has gone quiet: the dot carries the
// state, the line under the name carries the reason. That is the whole row.
function WatchRow({ r, onPress }: { r: TriageItem; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copy.row.a11y(r.display_name, r.room)}
      accessibilityHint={copy.openRowHint}
      onPress={onPress}
      style={({ pressed }) => [{ paddingVertical: sp(3.5), minHeight: 44 }, pressed && { opacity: 0.6 }]}
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
            <Txt kind="body" tone="muted" numberOfLines={2} style={{ marginTop: sp(1) }}>{r.reason}</Txt>
          )}
        </View>
      </Row>
    </Pressable>
  );
}

// Doing fine: name, room, last signal. No dot (every one would be the same
// dot) and no chevron (the whole row is the button).
function QuietRow({ r, onPress }: { r: TriageItem; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copy.row.a11y(r.display_name, r.room)}
      accessibilityHint={copy.openRowHint}
      onPress={onPress}
      style={({ pressed }) => [
        { paddingVertical: sp(3), minHeight: 44, justifyContent: 'center' },
        pressed && { opacity: 0.6 },
      ]}
    >
      <Row style={{ justifyContent: 'space-between' }} gap={3}>
        <Txt kind="label" numberOfLines={1} style={{ flex: 1 }}>{r.display_name}</Txt>
        <Row gap={4}>
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
  const { data, isLoading, isError, refetch } = useResidents();
  // ponytail: no useOpenAlerts hook in lib/hooks.ts, so the facade is called
  // directly here, the same pattern the alert screen's belt-and-braces poll uses.
  const { data: openAlerts } = useQuery({
    queryKey: ['openAlerts'],
    queryFn: api.listOpenAlerts,
    refetchInterval: 5000,
  });
  const liveStates = useLive((s) => s.states);
  const liveLocations = useLive((s) => s.locations);
  const { setRole, finishOnboarding, residentId } = useSession();
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
      await api.ack(alert.id, copy.ackActorFallback);
      await qc.invalidateQueries();
    } catch {
      setDemoNote(copy.demo.ackFailed);
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

  // The count and the rows under it are one beat of the entrance, so a row
  // that arrives with a later fetch does not replay the sequence. Optional
  // sections (Doing fine, the demo) come after everything that must not move.
  return (
    <Screen native wash refreshControl={refreshControl}>
      <Stagger>
        <View>
          {/* Long-press the count to reveal demo controls; no visible demo chrome. */}
          <Count needing={needing} onLongPress={() => setShowDemo((v) => !v)} />

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
            <RowGroup style={{ marginTop: sp(4) }}>
              {watch.map((r) => <WatchRow key={r.id} r={r} onPress={() => open(r)} />)}
            </RowGroup>
          )}

          {needing === 0 && (
            // The calm state is one sentence. The no-residents case keeps the
            // line that says how residents get here, because that is an action.
            <View style={{ marginTop: sp(6), paddingRight: sp(8), gap: sp(3) }}>
              <Txt kind="title">
                {residents.length === 0 ? copy.emptyNoResidents : copy.emptyNobody}
              </Txt>
              {residents.length === 0 && (
                <Txt kind="body" tone="muted">{copy.emptyNoResidentsHint}</Txt>
              )}
            </View>
          )}
        </View>

        {normal.length > 0 && (
          <View>
            <Marquee
              title={copy.doingFine}
              style={{ marginTop: sp(12) }}
              right={
                <Btn
                  kind="quiet"
                  size="small"
                  label={showOk ? copy.hide : copy.showN(String(normal.length))}
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
            <Marquee title={copy.demo.title} style={{ marginTop: sp(12) }} />
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
