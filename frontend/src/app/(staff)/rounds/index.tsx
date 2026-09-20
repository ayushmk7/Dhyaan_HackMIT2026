// Night rounds: 23:00 to 07:00 mode. Only what deviated tonight. Marcus
// reads this in a dim corridor, so it is the most instrument-like surface on
// the staff side: tabular figures, hard rules, no decoration. It is on paper
// like every other screen now (the app is light-only); size and position do
// the ranking, not a dark ground.
//
// The weights, top to bottom: one large count; whoever is alerting on a white
// plate (the only inversion on the night ground); whoever is worth a look or
// has gone quiet on a night card with the reason; and the roll call as one
// dense line per resident. When nothing has deviated, the sentence saying so
// is the large thing instead, and the roll call still shows each band's last
// signal, because a rounds screen that renders one line tells the night nurse
// nothing.
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
  Card, Chevron, DataLabel, EmptyState, ErrorState, LoadingState, Marquee, Row, RowGroup, Rule,
  Screen, Slab, Stagger, StatusDot, Txt,
} from '@/components';
import { readout, rounds as copy } from '@/lib/copy/staff';
import { timeOf } from '@/lib/format';
import { useResidents } from '@/lib/hooks';
import type { Resident } from '@/lib/types';
import { useLive } from '@/store/live';
import { sp, useTheme } from '@/theme';
import type { ResidentState } from '@/theme/tokens';
import { NEEDS_EYES, OFFLINE_AFTER_MIN, TIER, deriveState, pad2, triageReason } from '../_layout';

type RoundsItem = Resident & { state: ResidentState; reason: string | null };

const seen = (r: Resident) => (r.last_seen ? timeOf(r.last_seen) : readout.noTime);

function Telemetry({ r }: { r: Resident }) {
  return (
    <Row gap={3} style={{ flexWrap: 'wrap' }}>
      {/* Staff-only whereabouts, D-001. */}
      <DataLabel value={r.room ?? readout.none}>{copy.card.room}</DataLabel>
      <DataLabel value={seen(r)}>{copy.card.seen}</DataLabel>
      {r.band_battery_pct != null && (
        <DataLabel value={`${r.band_battery_pct}%`}>{copy.card.band}</DataLabel>
      )}
    </Row>
  );
}

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
          {/* The one large number, in the night ink. */}
          <View>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }} gap={4}>
              <View>
                <Txt kind="readout">{pad2(deviating)}</Txt>
                <DataLabel style={{ marginTop: sp(1) }}>{copy.slab.needsLook}</DataLabel>
              </View>
              <View style={{ alignItems: 'flex-end', gap: sp(1.5), paddingBottom: sp(0.5) }}>
                <DataLabel value={pad2(rows.length)}>{copy.slab.onFloor}</DataLabel>
                <DataLabel value={dataUpdatedAt ? timeOf(new Date(dataUpdatedAt).toISOString()) : readout.noTime}>
                  {copy.slab.updated}
                </DataLabel>
              </View>
            </Row>
            <Rule weight="heavy" style={{ marginTop: sp(3) }} />
          </View>

          <View>
            <Marquee title={copy.needsLookTonight} meta={pad2(deviating)} style={{ marginTop: sp(5) }} />

            {/* Whoever is alerting: the one focal plate on the screen, on
                the light blue step, lifted above everything else. */}
            {urgent.map((r) => (
              <Slab
                key={r.id}
                lift="takeover"
                onPress={() => open(r)}
                accessibilityLabel={copy.card.a11y(r.display_name, r.room)}
                style={{ marginBottom: sp(3) }}
              >
                <Txt kind="title" numberOfLines={1}>{r.display_name}</Txt>
                {!!r.reason && <Txt kind="body" style={{ marginTop: sp(1.5) }}>{r.reason}</Txt>}
                <Rule weight="hair" style={{ marginTop: sp(3.5) }} />
                <View style={{ marginTop: sp(3) }}><Telemetry r={r} /></View>
              </Slab>
            ))}

            {watch.length > 0 && (
              <View style={{ gap: sp(3) }}>
                {watch.map((r) => (
                  <Pressable
                    key={r.id}
                    accessibilityRole="button"
                    accessibilityLabel={copy.card.a11y(r.display_name, r.room)}
                    onPress={() => open(r)}
                  >
                    {({ pressed }) => (
                      <Card style={pressed ? { opacity: 0.7 } : undefined}>
                        <Row gap={2}>
                          <StatusDot state={r.state} size={10} />
                          <Txt kind="label" numberOfLines={1} style={{ flex: 1 }}>
                            {r.display_name}
                          </Txt>
                          <Txt kind="stamp" tone="muted">{t.stateColor[r.state].word}</Txt>
                          <Chevron />
                        </Row>
                        {!!r.reason && (
                          <Txt kind="body" style={{ marginTop: sp(2) }}>{r.reason}</Txt>
                        )}
                        <View style={{ marginTop: sp(2.5) }}><Telemetry r={r} /></View>
                      </Card>
                    )}
                  </Pressable>
                ))}
              </View>
            )}

            {deviating === 0 && rows.length > 0 && (
              // The quiet night is the large sentence, with what "quiet"
              // means and where to look next under it.
              <View style={{ marginTop: sp(2), paddingRight: sp(6), gap: sp(2) }}>
                <Txt kind="title">{copy.emptyQuiet}</Txt>
                <Txt kind="body" tone="muted">{copy.emptyQuietHint(OFFLINE_AFTER_MIN)}</Txt>
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
                    onPress={() => open(r)}
                    style={({ pressed }) => [
                      { paddingVertical: sp(2.5), minHeight: 44, justifyContent: 'center' },
                      pressed && { opacity: 0.6 },
                    ]}
                  >
                    <Row style={{ justifyContent: 'space-between' }} gap={3}>
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
                        <Txt kind="stamp" tone="muted">{seen(r)}</Txt>
                        <Chevron />
                      </Row>
                    </Row>
                  </Pressable>
                ))}
              </RowGroup>
            </View>
          )}

          {rows.length === 0 && (
            <EmptyState style={{ marginTop: sp(4) }} title={copy.emptyNoResidents}>
              {copy.emptyNoResidentsHint}
            </EmptyState>
          )}
        </Stagger>
      )}
    </Screen>
  );
}
