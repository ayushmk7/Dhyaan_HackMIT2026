// Night rounds: 23:00–07:00 mode. Only what deviated tonight, darkest screen
// in the app — Marcus reads this in a dim corridor, so it is the most
// instrument-like surface on the staff side: cream-on-black, tabular figures,
// hard rules, no decoration.
//
// It used to be permanently "All quiet tonight": it filtered `res_eleanor`
// (the only seeded resident) out, then filtered what was left down to
// `attention | alerting | offline` — and `backend/app/routers/residents.py`
// only ever sends `alerting` or `ok`. Now it ranks on states that can actually
// occur (see `(staff)/_layout.tsx`), and when nothing deviates it still shows
// the roll call with each band's last signal, because a rounds screen that
// renders one sentence tells the night nurse nothing.
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import {
  Card, DataLabel, EmptyState, ErrorState, LoadingState, Marquee, Row, RowGroup, Screen, Slab,
  Stagger, StateChip, StatusDot, Txt,
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

export default function Rounds() {
  const t = useTheme();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, dataUpdatedAt } = useResidents();
  const liveStates = useLive((s) => s.states);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await qc.invalidateQueries();
    setRefreshing(false);
  }, [qc]);

  const refreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.nightMuted} />
  );

  const rows: RoundsItem[] = (data ?? [])
    .map((r) => {
      const state = deriveState(r, liveStates[r.id], r.open_alerts > 0);
      return { ...r, state, reason: triageReason(r, state, undefined) };
    })
    .sort((a, b) => TIER[a.state] - TIER[b.state]);

  const deviating = rows.filter((r) => NEEDS_EYES.includes(r.state));
  const quiet = rows.filter((r) => !NEEDS_EYES.includes(r.state));

  return (
    <Screen native tone="night" wash refreshControl={refreshControl}>
      {isLoading && !data && <LoadingState label={copy.loading} />}
      {isError && !data && (
        <ErrorState message={copy.loadError} onRetry={refetch} />
      )}

      {!isLoading && !isError && (
        <Stagger>
          {/* Inverted: cream slab on the night ground. One such moment, here,
              and the only takeover-tier surface outside the alert. */}
          <Slab tone="cream" lift="takeover" style={{ paddingVertical: sp(4) }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <View>
                <DataLabel>{copy.slab.needsLook}</DataLabel>
                <Txt kind="readout" style={{ marginTop: sp(1) }}>{pad2(deviating.length)}</Txt>
              </View>
              <View style={{ alignItems: 'flex-end', gap: sp(1.5) }}>
                <DataLabel value={pad2(rows.length)}>{copy.slab.onFloor}</DataLabel>
                <DataLabel value={dataUpdatedAt ? timeOf(new Date(dataUpdatedAt).toISOString()) : readout.noTime}>
                  {copy.slab.updated}
                </DataLabel>
              </View>
            </Row>
          </Slab>

          <View>
            <Marquee title={copy.needsLookTonight} meta={pad2(deviating.length)} />
            {deviating.length === 0 ? (
              <EmptyState>{copy.emptyQuiet}</EmptyState>
            ) : (
              <View style={{ gap: sp(3) }}>
                {deviating.map((r) => (
                  <Pressable
                    key={r.id}
                    accessibilityRole="button"
                    accessibilityLabel={copy.card.a11y(r.display_name, r.room)}
                    onPress={() => router.push(`/(staff)/triage/resident/${r.id}`)}
                  >
                    {({ pressed }) => (
                      <Card style={pressed ? { opacity: 0.7 } : undefined}>
                        <Row style={{ justifyContent: 'space-between' }}>
                          <Row gap={2} style={{ flex: 1 }}>
                            <StatusDot state={r.state} />
                            <Txt kind="label" numberOfLines={1} style={{ flex: 1 }}>
                              {r.display_name}
                            </Txt>
                          </Row>
                          <StateChip state={r.state} />
                        </Row>
                        {!!r.reason && (
                          <Txt kind="body" style={{ marginTop: sp(2) }}>
                            {r.reason}
                          </Txt>
                        )}
                        <Row gap={3} style={{ marginTop: sp(2.5), flexWrap: 'wrap' }}>
                          {/* Staff-only whereabouts — D-001. */}
                          <DataLabel value={r.room ?? readout.none}>{copy.card.room}</DataLabel>
                          <DataLabel value={r.last_seen ? timeOf(r.last_seen) : readout.noTime}>
                            {copy.card.seen}
                          </DataLabel>
                          {r.band_battery_pct != null && (
                            <DataLabel value={`${r.band_battery_pct}%`}>{copy.card.band}</DataLabel>
                          )}
                        </Row>
                      </Card>
                    )}
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {quiet.length > 0 && (
            <View>
              <Marquee title={copy.rollCall} meta={copy.quietMeta(pad2(quiet.length))} />
              <RowGroup>
                {quiet.map((r) => (
                  <Pressable
                    key={r.id}
                    accessibilityRole="button"
                    accessibilityLabel={copy.quietA11y(r.display_name)}
                    onPress={() => router.push(`/(staff)/triage/resident/${r.id}`)}
                    style={({ pressed }) => [{ paddingVertical: sp(2.5) }, pressed && { opacity: 0.6 }]}
                  >
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Row gap={2} style={{ flex: 1 }}>
                        <StatusDot state={r.state} size={8} />
                        <Txt kind="label" numberOfLines={1} style={{ flex: 1 }}>
                          {r.display_name}
                        </Txt>
                      </Row>
                      <Row gap={3}>
                        <Txt kind="stamp" tone="muted">
                          {r.room ? copy.roomStamp(r.room) : readout.blank}
                        </Txt>
                        <Txt kind="stamp" tone="muted">
                          {r.last_seen ? timeOf(r.last_seen) : readout.noTime}
                        </Txt>
                      </Row>
                    </Row>
                  </Pressable>
                ))}
              </RowGroup>
            </View>
          )}

          {rows.length === 0 && (
            <EmptyState style={{ marginTop: sp(6) }}>{copy.emptyNoResidents}</EmptyState>
          )}
        </Stagger>
      )}
    </Screen>
  );
}
