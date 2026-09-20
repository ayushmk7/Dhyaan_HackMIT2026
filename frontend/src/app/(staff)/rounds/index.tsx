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
  Card, DataLabel, ErrorState, Hairline, LoadingState, Marquee, Row, Screen, Stagger,
  StateChip, StatusDot, Txt,
} from '@/components';
import { timeOf } from '@/lib/format';
import { useResidents } from '@/lib/hooks';
import type { Resident } from '@/lib/types';
import { useLive } from '@/store/live';
import { elevation, palette, radius, sp } from '@/theme/tokens';
import type { ResidentState } from '@/theme/tokens';
import { NEEDS_EYES, TIER, deriveState, pad2, triageReason } from '../_layout';

type RoundsItem = Resident & { state: ResidentState; reason: string | null };

export default function Rounds() {
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
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.nightMuted} />
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
    <Screen native night wash refreshControl={refreshControl}>
      {isLoading && !data && <LoadingState label="Loading tonight's rounds…" night />}
      {isError && !data && (
        <ErrorState message="Couldn’t reach the floor list." onRetry={refetch} night />
      )}

      {!isLoading && !isError && (
        <Stagger>
          {/* Inverted: cream slab on the night ground. One such moment, here. */}
          <View
            style={{
              backgroundColor: palette.nightInk,
              borderRadius: radius.glass,
              paddingHorizontal: sp(4.5),
              paddingVertical: sp(4),
              ...elevation.takeover,
            }}
          >
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <View>
                <DataLabel tone={palette.night}>Needs a look</DataLabel>
                <Txt kind="data" style={{ fontSize: 46, lineHeight: 50, color: palette.night, marginTop: sp(1) }}>
                  {pad2(deviating.length)}
                </Txt>
              </View>
              <View style={{ alignItems: 'flex-end', gap: sp(1.5) }}>
                <DataLabel tone={palette.night} value={pad2(rows.length)}>On the floor</DataLabel>
                <DataLabel
                  tone={palette.night}
                  value={dataUpdatedAt ? timeOf(new Date(dataUpdatedAt).toISOString()) : '--:--'}
                >
                  Updated
                </DataLabel>
              </View>
            </Row>
          </View>

          <View>
            <Marquee night title="Needs a look tonight" meta={pad2(deviating.length)} />
            {deviating.length === 0 ? (
              <Txt kind="body" tone="nightMuted">
                Nothing has deviated tonight. Every band is still reporting.
              </Txt>
            ) : (
              <View style={{ gap: sp(3) }}>
                {deviating.map((r) => (
                  <Pressable
                    key={r.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${r.display_name}, ${r.room ? `room ${r.room}` : 'no room'}`}
                    onPress={() => router.push(`/(staff)/triage/resident/${r.id}`)}
                  >
                    {({ pressed }) => (
                      <Card night style={pressed ? { opacity: 0.7 } : undefined}>
                        <Row style={{ justifyContent: 'space-between' }}>
                          <Row gap={2} style={{ flex: 1 }}>
                            <StatusDot state={r.state} />
                            <Txt kind="label" tone="nightInk" numberOfLines={1} style={{ flex: 1 }}>
                              {r.display_name}
                            </Txt>
                          </Row>
                          <StateChip state={r.state} />
                        </Row>
                        {!!r.reason && (
                          <Txt kind="body" tone="nightInk" style={{ marginTop: sp(2) }}>
                            {r.reason}
                          </Txt>
                        )}
                        <Row gap={3} style={{ marginTop: sp(2.5), flexWrap: 'wrap' }}>
                          {/* Staff-only whereabouts — D-001. */}
                          <DataLabel night value={r.room ?? 'NONE'}>Room</DataLabel>
                          <DataLabel night value={r.last_seen ? timeOf(r.last_seen) : '--:--'}>
                            Seen
                          </DataLabel>
                          {r.band_battery_pct != null && (
                            <DataLabel night value={`${r.band_battery_pct}%`}>Band</DataLabel>
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
              <Marquee night title="Roll call" meta={`${pad2(quiet.length)} quiet`} />
              <Card night style={{ paddingVertical: sp(1) }}>
                {quiet.map((r, i) => (
                  <View key={r.id}>
                    {i > 0 && <Hairline night />}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${r.display_name}, quiet`}
                      onPress={() => router.push(`/(staff)/triage/resident/${r.id}`)}
                      style={({ pressed }) => [{ paddingVertical: sp(2.5) }, pressed && { opacity: 0.6 }]}
                    >
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Row gap={2} style={{ flex: 1 }}>
                          <StatusDot state={r.state} size={8} />
                          <Txt kind="label" tone="nightInk" numberOfLines={1} style={{ flex: 1 }}>
                            {r.display_name}
                          </Txt>
                        </Row>
                        <Row gap={3}>
                          <Txt kind="stamp" tone="nightMuted">{r.room ? `RM ${r.room}` : '—'}</Txt>
                          <Txt kind="stamp" tone="nightMuted">
                            {r.last_seen ? timeOf(r.last_seen) : '--:--'}
                          </Txt>
                        </Row>
                      </Row>
                    </Pressable>
                  </View>
                ))}
              </Card>
            </View>
          )}

          {rows.length === 0 && (
            <Txt kind="body" tone="nightMuted" style={{ marginTop: sp(6) }}>
              No residents are set up on this floor yet.
            </Txt>
          )}
        </Stagger>
      )}
    </Screen>
  );
}
