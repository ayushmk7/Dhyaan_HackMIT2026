// Her day. Sentences, in order, each one labelled with where it came from —
// what Dhyaan saw, what you told it, or what it has worked out from her
// pattern. Never a room, never a picture: `ActivityItem` carries a sentence
// and a kind and nothing else, and the server has already applied the family
// filter (§6.1) before any of this arrives. The native header owns the title.
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, Share, View } from 'react-native';
import {
  Card, Chip, ErrorState, Hairline, KindTag, LoadingState, Row, Screen, SectionTitle, Txt,
} from '@/components';
import { Icon } from '@/components/icon';
import { api } from '@/lib/api';
import { dayOf, timeOf } from '@/lib/format';
import { localDayKey, useActivity, useSummaries } from '@/lib/hooks';
import type { ActivityItem } from '@/lib/types';
import { useSession } from '@/store/session';
import { palette, sp } from '@/theme/tokens';

const FILTERS: { label: string; match: (t: string) => boolean }[] = [
  { label: 'All', match: () => true },
  { label: 'Meals', match: (t) => t.startsWith('meal') },
  { label: 'Visitors', match: (t) => t.startsWith('visitor') },
  {
    label: 'Out and about',
    match: (t) => t === 'room_exit' || t === 'room_entry' || t.startsWith('walk')
      || t === 'left_home' || t === 'returned_home',
  },
  { label: 'Nights', match: (t) => t === 'night_activity' || t === 'bed_exit' },
];

const shiftDay = (key: string, days: number) => {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return localDayKey(dt);
};

function ItemRow({ item, onPress }: { item: ActivityItem; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={`${item.sentence} ${timeOf(item.ts)}`}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({ paddingVertical: sp(3), opacity: pressed ? 0.6 : 1 })}
    >
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} gap={3}>
        <Txt kind="body" style={{ flex: 1 }}>{item.sentence}</Txt>
        <Txt kind="caption" tone="muted">{timeOf(item.ts)}</Txt>
      </Row>
      <View style={{ marginTop: sp(2) }}>
        <KindTag kind={item.kind} />
      </View>
    </Pressable>
  );
}

export default function HerDay() {
  const qc = useQueryClient();
  const { residentId } = useSession();
  const [date, setDate] = useState(localDayKey());
  const [filterIdx, setFilterIdx] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const { data: activity, isLoading, isError, refetch } = useActivity(residentId, date);
  const { data: summaries } = useSummaries(residentId);
  const summary = (summaries ?? []).find((s) => s.date_local === date);

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

  const isToday = date === localDayKey();
  const dayLabel = dayOf(`${date}T12:00:00`);

  const pager = (
    <Row style={{ justifyContent: 'space-between' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Previous day"
        onPress={() => setDate((d) => shiftDay(d, -1))}
        style={({ pressed }) => ({ padding: sp(2), opacity: pressed ? 0.5 : 1 })}
      >
        <Icon name="chevron.left" size={14} color={palette.slate} />
      </Pressable>
      <Txt kind="label">{dayLabel}</Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next day"
        disabled={isToday}
        onPress={() => setDate((d) => shiftDay(d, 1))}
        style={({ pressed }) => ({ padding: sp(2), opacity: isToday ? 0.25 : pressed ? 0.5 : 1 })}
      >
        <Icon name="chevron.right" size={14} color={palette.slate} />
      </Pressable>
    </Row>
  );

  if (isLoading && !activity) {
    return (
      <Screen native refreshControl={refreshControl}>
        <Stack.Screen options={{ headerRight }} />
        {pager}
        <LoadingState label="Reading her day…" />
      </Screen>
    );
  }
  if (isError && !activity) {
    return (
      <Screen native refreshControl={refreshControl}>
        <Stack.Screen options={{ headerRight }} />
        {pager}
        <ErrorState message="Couldn’t load her day." onRetry={refetch} />
      </Screen>
    );
  }

  const filter = FILTERS[filterIdx];
  const items = (activity?.items ?? []).filter((i) => filter.match(i.type));
  const total = activity?.items?.length ?? 0;

  return (
    <Screen native refreshControl={refreshControl}>
      <Stack.Screen options={{ headerRight }} />
      {pager}

      <Row style={{ marginTop: sp(4), flexWrap: 'wrap' }} gap={2}>
        {FILTERS.map((f, i) => (
          <Chip key={f.label} label={f.label} selected={i === filterIdx} onPress={() => setFilterIdx(i)} />
        ))}
      </Row>

      {summary ? (
        <Card style={{ marginTop: sp(5) }}>
          <KindTag kind="pattern" detail="the day’s story" />
          <Txt kind="body" style={{ marginTop: sp(2.5) }}>{summary.narrative}</Txt>
        </Card>
      ) : (
        <Txt kind="caption" tone="muted" style={{ marginTop: sp(5) }}>{/* voice-ok */}
          Dhyaan writes the day’s story each evening. {isToday ? 'Today’s isn’t written yet.' : 'There isn’t one for this day.'}
        </Txt>
      )}

      <SectionTitle>What it noticed</SectionTitle>

      {items.length === 0 ? (
        <Txt kind="body" tone="muted">{/* voice-ok */}
          {total === 0
            ? `No activity noticed ${isToday ? 'yet today' : 'on this day'}. Dhyaan only writes a line when it is confident enough to say a whole sentence.`
            : `Nothing filed under “${filter.label}” ${isToday ? 'today' : 'on this day'}.`}
        </Txt>
      ) : (
        items.map((item, i) => (
          <View key={item.id}>
            {i > 0 && <Hairline />}
            <ItemRow
              item={item}
              // Only an observation has an event behind it to open. A pattern
              // line and a told fact have no timeline entry, so they get no
              // tap target rather than one that leads nowhere.
              onPress={
                item.kind === 'observed'
                  ? () => router.push({
                    pathname: '/(family)/timeline/[eventId]',
                    params: { eventId: item.id },
                  })
                  : undefined
              }
            />
          </View>
        ))
      )}
    </Screen>
  );
}
