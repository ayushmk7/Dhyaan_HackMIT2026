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
import { Pressable, RefreshControl, Share, StyleSheet, View } from 'react-native';
import {
  Btn, Card, Chip, EmptyState, Entrance, ErrorState, Glass, IconBtn, LoadingState,
  Row, Screen, Txt,
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
    label: copy.filters.out,
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

/** The Sunday-to-Saturday week a day key falls in, as seven dates. */
const weekOf = (key: string): Date[] => {
  const [y, m, d] = key.split('-').map(Number);
  const start = new Date(y, m - 1, d - new Date(y, m - 1, d).getDay());
  return Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
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

// ---------------------------------------------------------------------------
// The calendar
// ---------------------------------------------------------------------------

/** The hour labels' gutter, and the height of one hour of the day. */
const HOUR_COL = sp(14);
const HOUR_H = sp(16);
/** An observation is an instant, not a span, so every block is one size. */
const EVENT_H = sp(13);
/** The day always shows at least these hours, so an empty day is still a day. */
const DAY_FROM = 7;
const DAY_TO = 22;

const minutesOf = (ts: string) => {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
};

/**
 * Lane packing, the way a calendar does it: two things at the same moment sit
 * side by side rather than on top of each other. An event takes the first lane
 * whose last block has ended before this one starts; failing that, a new lane,
 * and every block in the row shares the width.
 *
 * "Ends" is by pixel, not by clock: these are instants, so what actually
 * overlaps is the BLOCKS, and a block is `EVENT_H` tall whatever its sentence.
 */
function lanes(items: ActivityItem[], top: (i: ActivityItem) => number) {
  const ends: number[] = [];
  const lane = new Map<string, number>();
  for (const item of [...items].sort((a, b) => (a.ts < b.ts ? -1 : 1))) {
    const y = top(item);
    let k = ends.findIndex((end) => end <= y);
    if (k === -1) k = ends.length;
    ends[k] = y + EVENT_H;
    lane.set(item.id, k);
  }
  return { lane, count: Math.max(ends.length, 1) };
}

/** One weekday in the strip: its initial, its date, and the selection. */
function DayCell({ date, selected, today, onPress }: {
  date: Date; selected: boolean; today: boolean; onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={copy.pickDay(dayOf(date.toISOString()))}
      onPress={onPress}
      style={{ flex: 1, alignItems: 'center', gap: sp(1) }}
    >
      <Txt kind="micro" tone="muted">
        {date.toLocaleDateString(undefined, { weekday: 'narrow' })}
      </Txt>
      <View
        style={[
          styles.dayDot,
          selected ? { backgroundColor: t.accent } : null,
        ]}
      >
        <Txt
          kind="label"
          style={{ color: selected ? t.onAccent : today ? t.accent : t.ink }}
        >
          {String(date.getDate())}
        </Txt>
      </View>
    </Pressable>
  );
}

/**
 * The day, drawn as hours. An hour rule every `HOUR_H`, its label in the
 * gutter, and each observation as a block positioned by its own minute — so a
 * quiet morning LOOKS quiet, which is the whole reason to draw a day this way
 * rather than list it. A list of five rows tells you five things happened; a
 * grid tells you when, and that nothing happened in between.
 */
function DayGrid({ items, now, onOpen }: {
  items: ActivityItem[]; now: Date | null; onOpen: (item: ActivityItem) => void;
}) {
  const t = useTheme();
  const mins = items.map((i) => minutesOf(i.ts));
  const from = Math.min(DAY_FROM, ...mins.map((m) => Math.floor(m / 60)));
  const to = Math.max(DAY_TO, ...mins.map((m) => Math.ceil((m + 30) / 60)));
  const hours = Array.from({ length: to - from }, (_, i) => from + i);
  const yOf = (ts: string) => ((minutesOf(ts) - from * 60) / 60) * HOUR_H;
  const { lane, count } = lanes(items, (i) => yOf(i.ts));
  const nowY = now ? ((now.getHours() * 60 + now.getMinutes() - from * 60) / 60) * HOUR_H : null;

  return (
    <View style={{ height: hours.length * HOUR_H }}>
      {hours.map((h, i) => (
        <View key={h} style={[styles.hourRow, { top: i * HOUR_H }]}>
          <Txt kind="micro" tone="muted" style={styles.hourLabel}>
            {new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' })}
          </Txt>
          <View style={[styles.hourRule, { backgroundColor: t.line }]} />
        </View>
      ))}

      {items.map((item) => {
        const k = lane.get(item.id) ?? 0;
        const width = `${100 / count}%` as const;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={copy.openRow(copy.rowLabel(familySentence(item), timeOf(item.ts)))}
            onPress={() => onOpen(item)}
            style={({ pressed }) => [
              styles.event,
              {
                top: yOf(item.ts),
                left: HOUR_COL,
                right: 0,
                opacity: pressed ? 0.6 : 1,
              },
              count > 1 ? { width, right: undefined, marginLeft: `${(100 / count) * k}%` } : null,
            ]}
          >
            <View style={[styles.eventBody, { backgroundColor: t.accentWash }]}>
              {/* The leading bar is the calendar's own grammar for "this block
                  belongs to that calendar". Here there is one calendar, so it
                  is simply the accent, and it is what makes a block read as a
                  block at a glance rather than as a tinted rectangle. */}
              <View style={[styles.eventBar, { backgroundColor: t.accent }]} />
              <View style={{ flex: 1, paddingLeft: sp(2.5) }}>
                <Txt kind="stamp" tone="muted" numberOfLines={1}>{timeOf(item.ts)}</Txt>
                <Txt kind="caption" numberOfLines={2}>{familySentence(item)}</Txt>
              </View>
            </View>
          </Pressable>
        );
      })}

      {/* Where "now" is, the way every calendar draws it. Blue, not red: this
          product's alarm is depth on the blue ramp and a red line here would
          be the one hue on the screen, saying something it does not mean. */}
      {nowY !== null && nowY >= 0 && nowY <= hours.length * HOUR_H && (
        <View pointerEvents="none" style={[styles.nowLine, { top: nowY }]}>
          <View style={[styles.nowDot, { backgroundColor: t.accent }]} />
          <View style={{ flex: 1, height: 1, backgroundColor: t.accent }} />
        </View>
      )}
    </View>
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

  // Search sits next to Share, in the header, rather than in the tab bar: it
  // searches the day's own feed, so the screen it belongs to is this one, and
  // a sixth tab on a phone is a tab nobody hits.
  const headerRight = useCallback(
    () => (
      <Row gap={0}>
        <IconBtn
          name="magnifyingglass"
          label={family.search.open}
          kind="ghost"
          size={32}
          onPress={() => router.push('/(family)/search')}
        />
        <IconBtn
          name="square.and.arrow.up"
          label={copy.shareWeek}
          kind="ghost"
          size={32}
          disabled={sharing}
          onPress={shareWeek}
        />
      </Row>
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
      // The day on screen, not today: paging back and tapping this used to
      // run the rollup over today and then label the result as that past day's.
      await api.rollup(residentId, date);
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

  const week = weekOf(date);
  const todayKey = localDayKey();
  const pager = (
    <Entrance index={0}>
      {/* The month, then the week. Apple's own order, and the reason the day
          switcher stopped being two chevrons around a label: a week you can
          see is a week you can land on in one tap, and paging a day at a time
          to reach Tuesday was four taps and no sense of where you were. */}
      <Row style={{ justifyContent: 'space-between', marginBottom: sp(2), paddingHorizontal: sp(2) }}>
        <Txt kind="title">
          {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </Txt>
        <Row gap={0}>
          <IconBtn
            name="chevron.left"
            label={copy.previousDay}
            kind="ghost"
            onPress={() => setDate((d) => shiftDay(d, -7))}
          />
          <IconBtn
            name="chevron.right"
            label={copy.nextDay}
            kind="ghost"
            disabled={shiftDay(date, 7) > todayKey}
            onPress={() => setDate((d) => shiftDay(d, 7))}
          />
        </Row>
      </Row>

      <Glass radius={radius.bar} lift="float" interactive style={{ paddingVertical: sp(2.5), paddingHorizontal: sp(1) }}>
        <Row gap={0}>
          {week.map((d) => {
            const key = localDayKey(d);
            return (
              <DayCell
                key={key}
                date={d}
                selected={key === date}
                today={key === todayKey}
                onPress={() => setDate(key)}
              />
            );
          })}
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
  // A calendar reads DOWN the day, so this one is sorted forwards. The feed
  // arrives newest first, which is right for a list and backwards for a grid.
  const shown = rows.filter((i) => filter.match(i.type)).sort((a, b) => (a.ts < b.ts ? -1 : 1));

  return (
    <Screen native wash refreshControl={refreshControl}>
      <Stack.Screen options={{ headerRight }} />
      {pager}

      <Entrance index={1}>
        <Row style={{ marginTop: sp(5) }} gap={1.5}>
          {FILTERS.map((f, i) => (
            <Chip key={f.label} compact label={f.label} selected={i === filterIdx} onPress={() => setFilterIdx(i)} />
          ))}
        </Row>
      </Entrance>

      {/* The all-day row. A calendar puts above the hours the one thing that
          has no hour of its own, and for this day that is its story. */}
      <Entrance index={2} style={{ marginTop: sp(5) }}>
        <Row gap={3} style={{ alignItems: 'flex-start' }}>
          <Txt kind="micro" tone="muted" style={{ width: HOUR_COL, paddingTop: sp(3.5) }}>
            {copy.allDay}
          </Txt>
          <View style={{ flex: 1 }}>
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
          </View>
        </Row>
      </Entrance>

      <Entrance index={3} style={{ marginTop: sp(5) }}>
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
          <DayGrid
            items={shown}
            // The now line belongs to today and to no other day. Drawing it on
            // Tuesday's page would say something about Tuesday that is not true.
            now={isToday ? new Date() : null}
            onOpen={(item) => {
              // Only an observation has an event behind it to open. A pattern
              // line and a told fact have no timeline entry, so tapping one
              // does nothing rather than leading nowhere.
              if (item.kind !== 'observed') return;
              router.push({
                pathname: '/(family)/timeline/[eventId]',
                params: { eventId: item.id },
              });
            }}
          />
        )}
      </Entrance>
    </Screen>
  );
}

// Geometry only; every colour is resolved through useTheme() where it is drawn.
const styles = StyleSheet.create({
  dayDot: {
    width: sp(8),
    height: sp(8),
    borderRadius: sp(4),
    alignItems: 'center',
    justifyContent: 'center',
  },
  hourRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2),
  },
  hourLabel: { width: HOUR_COL - sp(2), textAlign: 'right' },
  hourRule: { flex: 1, height: StyleSheet.hairlineWidth },
  event: { position: 'absolute', height: EVENT_H, paddingRight: sp(1) },
  eventBody: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: radius.badge,
    overflow: 'hidden',
    paddingVertical: sp(1.5),
    paddingRight: sp(2),
  },
  eventBar: { width: 3 },
  nowLine: {
    position: 'absolute',
    left: HOUR_COL - sp(1),
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  nowDot: { width: sp(2), height: sp(2), borderRadius: sp(1) },
});
