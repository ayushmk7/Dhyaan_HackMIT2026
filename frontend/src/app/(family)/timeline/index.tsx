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
//
// The story and the list are read off the same `/activity` feed the server
// already filters. The rollup writes every day's story as a `daily_summary`
// row; the server used to select those by the moment the rollup ran, so
// today's feed could carry a dozen other days' stories. It now selects them by
// the day they describe, but the matching below is kept: each story is shown
// on its own day and nowhere else, and never as a "noticed" row, whichever
// way it arrives. `/summaries` is the second source for the story, and
// whichever was written last wins, because the rollup can run more than once.
//
// Every sentence this screen says lives in lib/copy/family.ts under `timeline`.
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, Share } from 'react-native';
import {
  Btn, Card, Chip, EmptyState, Entrance, ErrorState, Glass, IconBtn, KindTag, LoadingState, Marquee,
  Row, RowGroup, Screen, Txt,
} from '@/components';
import { api } from '@/lib/api';
import { hasAI } from '@/lib/ai';
import { family } from '@/lib/copy/family';
import { dayOf, displaySentence, timeOf } from '@/lib/format';
import { localDayKey, useActivity, useSummaries } from '@/lib/hooks';
import type { ActivityItem } from '@/lib/types';
import { useSession } from '@/store/session';
import { radius, sp, useTheme } from '@/theme';

const copy = family.timeline;

const FILTERS: { label: string; match: (t: string) => boolean }[] = [
  { label: copy.filters.all, match: () => true },
  { label: copy.filters.meals, match: (t) => t.startsWith('meal') },
  { label: copy.filters.visitors, match: (t) => t.startsWith('visitor') },
  {
    label: copy.filters.outAndAbout,
    match: (t) => t === 'room_exit' || t === 'room_entry' || t.startsWith('walk')
      || t === 'left_home' || t === 'returned_home',
  },
  { label: copy.filters.nights, match: (t) => t === 'night_activity' || t === 'bed_exit' },
];

const shiftDay = (key: string, days: number) => {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return localDayKey(dt);
};

/** The rollup opens every story with its own date: "2026-09-19 — ...". */
const STORY_PREFIX = /^(\d{4}-\d{2}-\d{2})\s*[—–-]\s*/;
const storyDateOf = (text: string) => STORY_PREFIX.exec(text)?.[1] ?? null;
const storyBody = (text: string) => text.replace(STORY_PREFIX, '');

/**
 * The sentence a person reads. Almost every row arrives as one already; the
 * band's fall record is the exception ("Band band_a3f2 reported
 * fall_suspected" is a log line, not a sentence), and it is the one row a
 * family will actually go looking for. Nothing is added that the record does
 * not say.
 */
const familySentence = (item: ActivityItem): string => {
  if (item.type === 'fall_suspected') return family.shared.fallSuspected;
  if (item.type === 'fall_confirmed') return family.shared.fallConfirmed;
  return displaySentence(item.sentence);
};

function ItemRow({ item, onPress }: { item: ActivityItem; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={
        onPress
          ? copy.openRow(copy.rowLabel(familySentence(item), timeOf(item.ts)))
          : copy.rowLabel(familySentence(item), timeOf(item.ts))
      }
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({ paddingVertical: sp(4), opacity: pressed ? 0.6 : 1 })}
    >
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} gap={3}>
        <Txt kind="body" style={{ flex: 1 }}>{familySentence(item)}</Txt>
        {/* Tabular, so a column of times reads as a column and not as ragged prose. */}
        <Txt kind="stamp" tone="muted">{timeOf(item.ts)}</Txt>
      </Row>
      {/* The kind is the one mark a row keeps: it is the category in a dense
          list, and it is the only thing that tells a sighting from a pattern. */}
      <Row style={{ marginTop: sp(2) }}>
        <KindTag kind={item.kind} />
      </Row>
    </Pressable>
  );
}

export default function HerDay() {
  const t = useTheme();
  const qc = useQueryClient();
  const { residentId, residentName } = useSession();
  const [date, setDate] = useState(localDayKey());
  const [filterIdx, setFilterIdx] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const { data: activity, isLoading, isError, refetch } = useActivity(residentId, date);
  const { data: summaries } = useSummaries(residentId);
  // Today's feed used to be where the rollup filed every day's story, so it is
  // still read for any day; on today itself it is the same query and costs nothing.
  const { data: todayActivity } = useActivity(residentId);

  const items = activity?.items ?? [];
  const storyRows = [...items, ...(todayActivity?.items ?? [])]
    .filter((i) => i.type === 'daily_summary' && storyDateOf(i.sentence) === date)
    .sort((a, b) => (a.ts < b.ts ? 1 : -1));
  const fromSummaries = (summaries ?? []).find((s) => s.date_local === date);
  const summary = storyRows[0]
    ? { narrative: storyBody(storyRows[0].sentence), at: storyRows[0].ts }
    : fromSummaries
      ? { narrative: storyBody(fromSummaries.narrative), at: null }
      : null;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await qc.invalidateQueries();
    setRefreshing(false);
  }, [qc]);

  const refreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.inkMuted} />
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
    if (!hasAI) {
      setShareError(copy.share.needsAI);
      setSharing(false);
      return;
    }
    try {
      const letter = await api.sundayLetter();
      if (!letter.trim()) {
        setShareError(copy.share.noLetter(residentName));
        return;
      }
      await Share.share({ message: letter });
    } catch {
      setShareError(copy.share.unreachable(residentName));
    } finally {
      setSharing(false);
    }
  }, [residentName]);

  const headerRight = useCallback(
    () => (
      <IconBtn
        name="square.and.arrow.up"
        label={copy.shareWeek}
        kind="ghost"
        size={32}
        disabled={sharing}
        onPress={shareWeek}
      />
    ),
    [shareWeek, sharing],
  );

  // ---- write the day's story now ---------------------------------------------
  // The nightly pass, on demand. It is offered where the story would be, in the
  // same voice as the story, because on a family screen it is a real thing to
  // want — not an admin button.
  const [writing, setWriting] = useState(false);
  // Both are held against the day they belong to, so paging to another day
  // doesn't inherit the last day's outcome.
  const [wroteFor, setWroteFor] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<{ date: string; text: string } | null>(null);
  const writeStory = useCallback(async () => {
    setWriting(true);
    setWriteError(null);
    try {
      await api.rollup();
      setWroteFor(date);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['summaries', residentId] }),
        qc.invalidateQueries({ queryKey: ['activity', residentId] }),
      ]);
    } catch {
      setWriteError({ date, text: copy.writeError });
    } finally {
      setWriting(false);
    }
  }, [date, qc, residentId]);

  const isToday = date === localDayKey();
  const dayLabel = dayOf(`${date}T12:00:00`);
  // What goes in the list: never a story (it has its own card above), never
  // the same pattern line twice. Each rollup used to write its deviations
  // again with the baseline moved on a little ("about 4.2" then "about 3.6");
  // the server now deduplicates per feature, but the key stays the claim up to
  // its figures. Newest first, as `lib/http.ts` hands it over, so the first
  // occurrence is the one that was written last.
  const seen = new Set<string>();
  const rows = items.filter((i) => {
    if (i.type === 'daily_summary') return false;
    if (i.kind !== 'observed') {
      const key = `${i.type}:${i.sentence.split(',').slice(0, 2).join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key);
    }
    return true;
  });
  const total = rows.length;

  const pager = (
    <Entrance index={0}>
      {/* The day switcher floats. Nothing else sits up here: the day's count
          used to have its own plate, and it said what the list already says. */}
      <Glass radius={radius.bar} lift="float" interactive style={{ paddingHorizontal: sp(2) }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <IconBtn
            name="chevron.left"
            label={copy.previousDay}
            kind="ghost"
            onPress={() => setDate((d) => shiftDay(d, -1))}
          />
          <Txt kind="label">{dayLabel}</Txt>
          <IconBtn
            name="chevron.right"
            label={copy.nextDay}
            kind="ghost"
            disabled={isToday}
            onPress={() => setDate((d) => shiftDay(d, 1))}
          />
        </Row>
      </Glass>

      {!!shareError && (
        <ErrorState
          inline
          message={shareError}
          retryLabel={copy.dismiss}
          onRetry={() => setShareError(null)}
          style={{ marginTop: sp(3) }}
        />
      )}
    </Entrance>
  );

  if (isLoading && !activity) {
    return (
      <Screen native wash refreshControl={refreshControl}>
        <Stack.Screen options={{ headerRight }} />
        {pager}
        <LoadingState label={copy.loading} />
      </Screen>
    );
  }
  if (isError && !activity) {
    return (
      <Screen native wash refreshControl={refreshControl}>
        <Stack.Screen options={{ headerRight }} />
        {pager}
        <ErrorState message={copy.loadError} onRetry={refetch} />
      </Screen>
    );
  }

  const filter = FILTERS[filterIdx];
  const shown = rows.filter((i) => filter.match(i.type));

  return (
    <Screen native wash refreshControl={refreshControl}>
      <Stack.Screen options={{ headerRight }} />
      {pager}

      <Entrance index={1}>
        <Row style={{ marginTop: sp(6), flexWrap: 'wrap' }} gap={2}>
          {FILTERS.map((f, i) => (
            <Chip key={f.label} label={f.label} selected={i === filterIdx} onPress={() => setFilterIdx(i)} />
          ))}
        </Row>
      </Entrance>

      {/* The story leads: the one paragraph on the screen, on its own card,
          with the heading and nothing else around it. The day is already
          named in the pager, and the story is a pattern by definition. */}
      <Entrance index={2} style={{ marginTop: sp(4) }}>
        <Marquee title={copy.story} />
        {summary ? (
          <Card>
            <Txt kind="body">{summary.narrative}</Txt>
          </Card>
        ) : (
          <Card>
            <EmptyState
              action={
                <Btn
                  label={copy.writeStory(isToday)}
                  kind="quiet"
                  busy={writing}
                  onPress={writeStory}
                />
              }
            >
              {wroteFor === date ? copy.nothingToWrite(isToday) : copy.notWritten(isToday)}
            </EmptyState>
            {writeError?.date === date && (
              <ErrorState
                inline
                message={writeError.text}
                retryLabel={copy.tryAgain}
                onRetry={writeStory}
                style={{ marginTop: sp(2) }}
              />
            )}
          </Card>
        )}
      </Entrance>

      <Entrance index={3} style={{ marginTop: sp(4) }}>
        {/* The count only appears when a filter is hiding something; a bare
            total was a figure nobody acted on. */}
        <Marquee
          title={copy.whatItNoticed}
          meta={shown.length === total ? undefined : copy.shownOf(shown.length, total)}
        />
        {shown.length === 0 ? (
          <EmptyState
            action={
              total > 0
                ? <Btn kind="quiet" label={copy.showAll} onPress={() => setFilterIdx(0)} />
                : undefined
            }
          >
            {total === 0 ? copy.noActivity(isToday) : copy.nothingUnder(filter.label, isToday)}
          </EmptyState>
        ) : (
          <RowGroup>
            {shown.map((item) => (
              <ItemRow
                key={item.id}
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
            ))}
          </RowGroup>
        )}
      </Entrance>
    </Screen>
  );
}
