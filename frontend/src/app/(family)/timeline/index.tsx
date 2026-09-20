// Timeline: reverse-chron day sections. The native header owns the title.
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, Share, View } from 'react-native';
import {
  Card, Chip, ErrorState, EventRow, Hairline, LoadingState, RoomTimeBar, Row, Screen, SectionTitle, Txt,
} from '@/components';
import { Icon } from '@/components/icon';
import { api } from '@/lib/api';
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
// §10.5 shows one on the wire), so this filters client-side over whatever's
// already fetched. Wire it through as a query param once the API facade
// exposes it. No screen change needed then, just fewer rows over the network.
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
      <Card>
        <RoomTimeBar segments={segments ?? []} />
        {summary && (
          <>
            <Hairline style={{ marginTop: sp(3), marginBottom: sp(3) }} />
            <Txt style={{ fontSize: 15, lineHeight: 21, color: palette.ink }}>
              {summary.narrative}
            </Txt>
          </>
        )}
      </Card>
      <Card style={{ marginTop: sp(2.5), paddingVertical: sp(1) }}>
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
      </Card>
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

  const [sharing, setSharing] = useState(false);
  const shareWeek = useCallback(async () => {
    setSharing(true);
    const letter = await api.sundayLetter();
    setSharing(false);
    if (letter) Share.share({ message: letter });
  }, []);

  const headerRight = useCallback(
    () => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Share her week"
        onPress={shareWeek}
        disabled={sharing}
        style={{ opacity: sharing ? 0.4 : 1, padding: sp(1) }}
      >
        <Icon name="square.and.arrow.up" size={20} color={palette.slate} />
      </Pressable>
    ),
    [shareWeek, sharing],
  );

  if (isLoading && !events) {
    return (
      <Screen native refreshControl={refreshControl}>
        <Stack.Screen options={{ headerRight }} />
        <LoadingState label="Loading her week…" />
      </Screen>
    );
  }
  if (isError && !events) {
    return (
      <Screen native refreshControl={refreshControl}>
        <Stack.Screen options={{ headerRight }} />
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
    <Screen native refreshControl={refreshControl}>
      <Stack.Screen options={{ headerRight }} />

      <Row style={{ flexWrap: 'wrap' }} gap={2}>
        {KIND_FILTERS.map((f, i) => (
          <Chip key={f.label} label={f.label} selected={i === filterIdx} onPress={() => setFilterIdx(i)} />
        ))}
      </Row>

      {sections.length === 0 && (
        <Txt kind="body" tone="muted" style={{ marginTop: sp(4) }}>{/* voice-ok */}
          {(events ?? []).length === 0
            ? 'Nothing here yet. The timeline fills in as Dhyaan notices meals, walks and rooms.'
            : `No ${filter.label.toLowerCase()} this week.`}
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
