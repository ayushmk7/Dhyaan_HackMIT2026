// Her day. Sentences, in order, each one labelled with where it came from —
// what Dhyaan saw, what you told it, or what it has worked out from her
// pattern. Never a room, never a picture: `ActivityItem` carries a sentence
// and a kind and nothing else, and the server has already applied the family
// filter (§6.1) before any of this arrives. The native header owns the title.
//
// Two honest affordances live here that used to be silent:
//   · "Share her week" now says so when there is no letter to share, instead
//     of swallowing the empty string `api.sundayLetter()` returns with no key.
//   · The day's story can be written on demand (`api.rollup()` runs the
//     nightly baseline + narrative pass). A freshly seeded backend has no
//     summaries at all, and "Today's isn't written yet" was a dead end.
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, Share, View } from 'react-native';
import {
  Btn, Card, Chip, DataLabel, Entrance, ErrorState, Glass, Hairline, KindTag, LoadingState,
  Marquee, Row, Screen, Txt,
} from '@/components';
import { Icon } from '@/components/icon';
import { api } from '@/lib/api';
import { dayOf, timeOf } from '@/lib/format';
import { localDayKey, useActivity, useSummaries } from '@/lib/hooks';
import type { ActivityItem } from '@/lib/types';
import { useSession } from '@/store/session';
import { palette, radius, sp } from '@/theme/tokens';

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
      style={({ pressed }) => ({ paddingVertical: sp(3.5), opacity: pressed ? 0.6 : 1 })}
    >
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} gap={3}>
        <Txt kind="body" style={{ flex: 1 }}>{item.sentence}</Txt>
        {/* Tabular, so a column of times reads as a column and not as ragged prose. */}
        <Txt kind="stamp" tone="muted">{timeOf(item.ts)}</Txt>
      </Row>
      <Row gap={2} style={{ marginTop: sp(2), justifyContent: 'space-between' }}>
        <KindTag kind={item.kind} />
        {!!onPress && <Icon name="chevron.right" size={11} color="#C7C7CC" />}
      </Row>
    </Pressable>
  );
}

export default function HerDay() {
  const qc = useQueryClient();
  const { residentId, residentName } = useSession();
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

  // ---- share her week --------------------------------------------------------
  // `api.sundayLetter()` resolves to '' when there is no Anthropic key behind
  // the backend. `if (letter)` used to swallow that, so the button did nothing
  // at all and said nothing about it.
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const shareWeek = useCallback(async () => {
    setSharing(true);
    setShareError(null);
    try {
      const letter = await api.sundayLetter();
      if (!letter.trim()) {
        setShareError(`Dhyaan couldn’t put ${residentName}’s week into words just now. Nothing was shared.`);
        return;
      }
      await Share.share({ message: letter });
    } catch {
      setShareError(`Dhyaan couldn’t reach far enough to write ${residentName}’s week. Nothing was shared.`);
    } finally {
      setSharing(false);
    }
  }, [residentName]);

  const headerRight = useCallback(
    () => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Share her week"
        accessibilityState={{ busy: sharing }}
        onPress={shareWeek}
        disabled={sharing}
        style={{ opacity: sharing ? 0.4 : 1, padding: sp(1) }}
      >
        <Icon name="square.and.arrow.up" size={20} color={palette.slate} />
      </Pressable>
    ),
    [shareWeek, sharing],
  );

  // ---- write the day's story now ---------------------------------------------
  // The nightly pass, on demand. It is offered where the story would be, in the
  // same voice as the story, because on a family screen it is a real thing to
  // want — not an admin button.
  const [writing, setWriting] = useState(false);
  const [wrote, setWrote] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const writeStory = useCallback(async () => {
    setWriting(true);
    setWriteError(null);
    try {
      await api.rollup();
      setWrote(true);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['summaries', residentId] }),
        qc.invalidateQueries({ queryKey: ['activity', residentId] }),
      ]);
    } catch {
      setWriteError('Dhyaan couldn’t write it just now. Try again in a moment.');
    } finally {
      setWriting(false);
    }
  }, [qc, residentId]);

  const isToday = date === localDayKey();
  const dayLabel = dayOf(`${date}T12:00:00`);
  const items = activity?.items ?? [];
  const total = items.length;
  // `lib/http.ts` normalizes newest-first, so the ends of the list are the ends
  // of the day. Don't re-sort it.
  const firstAt = total ? items[total - 1].ts : null;
  const lastAt = total ? items[0].ts : null;

  const pager = (
    <Entrance index={0}>
      {/* The day switcher floats; the day's own figures sit on a hard plate
          under it. Glass for the chrome you touch, ink for the record. */}
      <Glass radius={radius.bar} lift="float" interactive style={{ paddingHorizontal: sp(2) }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous day"
            onPress={() => setDate((d) => shiftDay(d, -1))}
            style={({ pressed }) => ({ padding: sp(3), opacity: pressed ? 0.5 : 1 })}
          >
            <Icon name="chevron.left" size={15} color={palette.slate} />
          </Pressable>
          <Txt kind="label">{dayLabel}</Txt>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next day"
            disabled={isToday}
            onPress={() => setDate((d) => shiftDay(d, 1))}
            style={({ pressed }) => ({ padding: sp(3), opacity: isToday ? 0.25 : pressed ? 0.5 : 1 })}
          >
            <Icon name="chevron.right" size={15} color={palette.slate} />
          </Pressable>
        </Row>
      </Glass>

      {total > 0 && (
        <Card lift="float" style={{ backgroundColor: palette.ink, marginTop: sp(3), paddingVertical: sp(3) }}>
          <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }} gap={3}>
            <DataLabel tone={palette.paper} value={String(total)}>Noticed</DataLabel>
            {!!firstAt && <DataLabel tone={palette.paper} value={timeOf(firstAt)}>First</DataLabel>}
            {!!lastAt && <DataLabel tone={palette.paper} value={timeOf(lastAt)}>Last</DataLabel>}
          </Row>
        </Card>
      )}

      {!!shareError && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          onPress={() => setShareError(null)}
          style={{ marginTop: sp(3) }}
        >
          <Txt kind="caption" tone="warn">{shareError}</Txt>
        </Pressable>
      )}
    </Entrance>
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
  const shown = items.filter((i) => filter.match(i.type));

  return (
    <Screen native refreshControl={refreshControl}>
      <Stack.Screen options={{ headerRight }} />
      {pager}

      <Entrance index={1}>
        <Row style={{ marginTop: sp(4), flexWrap: 'wrap' }} gap={2}>
          {FILTERS.map((f, i) => (
            <Chip key={f.label} label={f.label} selected={i === filterIdx} onPress={() => setFilterIdx(i)} />
          ))}
        </Row>
      </Entrance>

      <Entrance index={2}>
        <Marquee title="The day’s story" meta={dayLabel} />
        {summary ? (
          <Card>
            <KindTag kind="pattern" detail="the day’s story" />
            <Txt kind="body" style={{ marginTop: sp(2.5) }}>{summary.narrative}</Txt>
          </Card>
        ) : (
          <Card>
            <Txt kind="body" tone="muted">{/* voice-ok */}
              {wrote
                ? `Dhyaan went back through ${isToday ? 'today' : 'that day'} and didn’t have enough yet to write about.`
                : `Dhyaan writes the day’s story each evening. ${isToday ? 'Today’s isn’t written yet.' : 'There isn’t one for this day.'}`}
            </Txt>
            <Btn
              label={isToday ? 'Write today’s story now' : 'Write this day’s story now'}
              kind="quiet"
              busy={writing}
              onPress={writeStory}
              style={{ marginTop: sp(3) }}
            />
            <Txt kind="caption" tone="muted" style={{ marginTop: sp(2) }}>
              It takes a few seconds. Dhyaan normally does this overnight.
            </Txt>
            {!!writeError && (
              <Txt kind="caption" tone="alert" style={{ marginTop: sp(2) }}>{writeError}</Txt>
            )}
          </Card>
        )}
      </Entrance>

      <Entrance index={3}>
        <Marquee
          title="What it noticed"
          meta={shown.length === total ? String(total) : `${shown.length} of ${total}`}
        />
        {shown.length === 0 ? (
          <Txt kind="body" tone="muted">{/* voice-ok */}
            {total === 0
              ? `No activity noticed ${isToday ? 'yet today' : 'on this day'}. Dhyaan only writes a line when it is confident enough to say a whole sentence.`
              : `Nothing filed under “${filter.label}” ${isToday ? 'today' : 'on this day'}.`}
          </Txt>
        ) : (
          <Card style={{ paddingVertical: sp(1) }}>
            {shown.map((item, i) => (
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
            ))}
          </Card>
        )}
      </Entrance>
    </Screen>
  );
}
