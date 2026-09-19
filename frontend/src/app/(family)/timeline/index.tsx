// Timeline: reverse-chron day sections — room-time bar, the day's story, then events.
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import {
  Chip, ErrorState, EventRow, Hairline, LoadingState, RoomTimeBar, Row, Screen, SectionTitle, Txt,
} from '@/components';
import { dayOf } from '@/lib/format';
import { useLocationHistory, useSummaries, useTimeline } from '@/lib/hooks';
import type { DaySummary, KEvent } from '@/lib/types';
import { palette, sp } from '@/theme/tokens';

const RES = 'res_eleanor';

const dateKeyOf = (isoTs: string) => {
  const d = new Date(isoTs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ponytail: the facade's getEvents(residentId) has no `types` param yet (PRD
// §10.5 shows one on the wire — `?types=`), so this filters client-side over
// whatever's already fetched. Wire it through as a query param once the API
// facade exposes it — no screen change needed then, just fewer rows over the network.
const KIND_FILTERS: { label: string; match: (t: string) => boolean }[] = [
  { label: 'All', match: () => true },
  { label: 'Falls', match: (t) => t.startsWith('fall') },
  { label: 'Meals', match: (t) => t.startsWith('meal') },
  { label: 'Walks', match: (t) => t === 'walk_completed' },
  { label: 'Location', match: (t) => t === 'zone_entered' },
  { label: 'Night', match: (t) => t === 'night_activity' },
];

function DaySection({ label, dateKey, events, summary }: {
  label: string; dateKey: string; events: KEvent[]; summary?: DaySummary;
}) {
  const { data: segments } = useLocationHistory(RES, dateKey);
  return (
    <View>
      <SectionTitle>{label}</SectionTitle>
      <RoomTimeBar segments={segments ?? []} />
      {summary && (
        <Txt kind="body" tone="muted" style={{ marginTop: sp(3), fontStyle: 'italic' }}>
          {summary.narrative}
        </Txt>
      )}
      <View style={{ marginTop: sp(2) }}>
        {events.map((e, i) => (
          <View key={e.id}>
            {i > 0 && <Hairline />}
            <EventRow
              event={e}
              onPress={() =>
                router.push({ pathname: '/(family)/timeline/[eventId]', params: { eventId: e.id } })
              }
            />
          </View>
        ))}
      </View>
    </View>
  );
}

export default function Timeline() {
  const qc = useQueryClient();
  const { data: events, isLoading, isError, refetch } = useTimeline(RES);
  const { data: summaries } = useSummaries(RES);
  const [filterIdx, setFilterIdx] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await qc.invalidateQueries();
    setRefreshing(false);
  }, [qc]);

  const refreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.inkMuted} />
  );

  if (isLoading && !events) {
    return (
      <Screen refreshControl={refreshControl}>
        <Txt kind="display">Her week</Txt>
        <LoadingState label="Loading her week…" />
      </Screen>
    );
  }
  if (isError && !events) {
    return (
      <Screen refreshControl={refreshControl}>
        <Txt kind="display">Her week</Txt>
        <ErrorState message="Couldn’t load her timeline." onRetry={refetch} />
      </Screen>
    );
  }

  const filter = KIND_FILTERS[filterIdx];
  const filtered = (events ?? []).filter((e) => filter.match(e.type));

  // Events arrive newest-first; group into day sections preserving that order.
  const sections: { label: string; dateKey: string; events: KEvent[] }[] = [];
  for (const e of filtered) {
    const label = dayOf(e.ts);
    const last = sections[sections.length - 1];
    if (last && last.label === label) last.events.push(e);
    else sections.push({ label, dateKey: dateKeyOf(e.ts), events: [e] });
  }
  const summaryByDate = new Map((summaries ?? []).map((s) => [s.date_local, s]));

  return (
    <Screen refreshControl={refreshControl}>
      <Txt kind="display">Her week</Txt>

      <Row style={{ marginTop: sp(4), flexWrap: 'wrap' }} gap={2}>
        {KIND_FILTERS.map((f, i) => (
          <Chip key={f.label} label={f.label} selected={i === filterIdx} onPress={() => setFilterIdx(i)} />
        ))}
      </Row>

      {sections.length === 0 && (
        <Txt kind="body" tone="muted" style={{ marginTop: sp(4) }}>
          {(events ?? []).length === 0
            ? 'Nothing observed yet — the timeline fills in as Dhyaan notices meals, walks and rooms.'
            : `Nothing filed under “${filter.label}” yet.`}
        </Txt>
      )}
      {sections.map((s) => (
        <DaySection
          key={s.dateKey}
          label={s.label}
          dateKey={s.dateKey}
          events={s.events}
          summary={summaryByDate.get(s.dateKey)}
        />
      ))}
    </Screen>
  );
}
