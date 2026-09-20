// Night rounds: 23:00 to 07:00 mode. Only what deviated tonight. Marcus
// reads this in a dim corridor, so it is the most instrument-like surface on
// the staff side: tabular figures, hard rules, no decoration. It is on paper
// like every other screen now (the app is light-only); size and position do
// the ranking, not a dark ground.
//
// The weights, top to bottom: one large count; whoever is alerting on the
// one plate; whoever is worth a look or has gone quiet as a row with the
// reason; and the roll call as one line per resident. When nothing has
// deviated, the sentence saying so is the large thing instead, and the roll
// call still shows each band's last signal, because a rounds screen that
// renders one line tells the night nurse nothing.
//
// Decluttered: the count's side column, the heading that repeated the count,
// the room/seen/battery strip on every card, the state word beside the dot
// that already carried it, and the chevrons are gone.
//
// It used to be permanently "All quiet tonight": it filtered `res_eleanor`
// (the only seeded resident) out, then filtered what was left down to
// `attention | alerting | offline`, and `backend/app/routers/residents.py`
// only ever sends `alerting` or `ok`. Now it ranks on states that can actually
// occur (see `(staff)/_layout.tsx`).
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import {
  DataLabel, EmptyState, ErrorState, LoadingState, Marquee, Row, RowGroup, Rule,
  Screen, Slab, Stagger, StatusDot, Txt,
} from '@/components';
import { readout, rounds as copy } from '@/lib/copy/staff';
import { timeOf } from '@/lib/format';
import { useResidents } from '@/lib/hooks';
import type { Resident } from '@/lib/types';
import { useLive } from '@/store/live';
import { sp, useTheme } from '@/theme';
import type { ResidentState } from '@/theme/tokens';
import { NEEDS_EYES, TIER, deriveState, pad2, triageReason } from '../_layout';

type RoundsItem = Resident & { state: ResidentState; reason: string | null };

const seen = (r: Resident) => (r.last_seen ? timeOf(r.last_seen) : readout.noTime);
// Staff-only whereabouts, D-001.
const stamp = (r: Resident) => (r.room ? copy.roomStamp(r.room) : readout.blank);

export default function Rounds() {
  const t = useTheme();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useResidents();
  const liveStates = useLive((s) => s.states);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await qc.invalidateQueries();
    setRefreshing(false);
  }, [qc]);

  const refreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.inkMuted} />
  );

  const rows: RoundsItem[] = (data ?? [])
    .map((r) => {
      const state = deriveState(r, liveStates[r.id], r.open_alerts > 0);
      return { ...r, state, reason: triageReason(r, state, undefined) };
    })
    .sort((a, b) => TIER[a.state] - TIER[b.state]);

  const urgent = rows.filter((r) => r.state === 'alerting');
  const watch = rows.filter((r) => r.state !== 'alerting' && NEEDS_EYES.includes(r.state));
  const quiet = rows.filter((r) => !NEEDS_EYES.includes(r.state));
  const deviating = urgent.length + watch.length;
  const open = (r: RoundsItem) => router.push(`/(staff)/triage/resident/${r.id}`);

  return (
    <Screen native wash refreshControl={refreshControl}>
      {isLoading && !data && <LoadingState label={copy.loading} />}
      {isError && !data && (
        <ErrorState message={copy.loadError} onRetry={refetch} />
      )}

      {!isLoading && !isError && (
        <Stagger>
          {/* The count and whoever deviated are one beat, so a late row does
              not replay the entrance. */}
          <View>
            <Txt kind="readout">{pad2(deviating)}</Txt>
            <DataLabel style={{ marginTop: sp(1) }}>{copy.needsLook}</DataLabel>
            <Rule weight="heavy" style={{ marginTop: sp(4) }} />

            {/* Whoever is alerting: the one plate on the screen. */}
            {urgent.map((r) => (
              <Slab
                key={r.id}
                lift="takeover"
                onPress={() => open(r)}
                accessibilityLabel={copy.card.a11y(r.display_name, r.room)}
                style={{ marginTop: sp(4) }}
              >
                <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} gap={3}>
                  <Txt kind="title" numberOfLines={1} style={{ flex: 1 }}>{r.display_name}</Txt>
                  <Txt kind="stamp" tone="muted">{stamp(r)}</Txt>
                </Row>
                {!!r.reason && <Txt kind="body" style={{ marginTop: sp(2) }}>{r.reason}</Txt>}
              </Slab>
            ))}

            {watch.length > 0 && (
              <RowGroup style={{ marginTop: sp(4) }}>
                {watch.map((r) => (
                  <Pressable
                    key={r.id}
                    accessibilityRole="button"
                    accessibilityLabel={copy.card.a11y(r.display_name, r.room)}
                    onPress={() => open(r)}
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
                ))}
              </RowGroup>
            )}

            {deviating === 0 && rows.length > 0 && (
              // The quiet night is one sentence; the roll call under it is
              // where to look next.
              <Txt kind="title" style={{ marginTop: sp(6), paddingRight: sp(8) }}>{copy.emptyQuiet}</Txt>
            )}
          </View>

          {quiet.length > 0 && (
            <View>
              <Marquee title={copy.rollCall} meta={copy.quietMeta(pad2(quiet.length))} style={{ marginTop: sp(12) }} />
              <RowGroup>
                {quiet.map((r) => (
                  <Pressable
                    key={r.id}
                    accessibilityRole="button"
                    accessibilityLabel={copy.quietA11y(r.display_name)}
                    onPress={() => open(r)}
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
                ))}
              </RowGroup>
            </View>
          )}

          {rows.length === 0 && (
            <EmptyState style={{ marginTop: sp(6) }} title={copy.emptyNoResidents}>
              {copy.emptyNoResidentsHint}
            </EmptyState>
          )}
        </Stagger>
      )}
    </Screen>
  );
}
