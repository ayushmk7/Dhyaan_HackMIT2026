// Search. One field over one feed.
//
// There is no search endpoint on the backend, and this screen does not pretend
// there is. It filters the activity feed the app already holds open for today
// (`useActivity`, the same query Her day reads) in the browser, on the strings
// that are already on screen. So the scope is exactly "today", and every
// sentence on the screen says so: an empty result here means today had no
// match, and it is not allowed to read as "that did not happen".
//
// The sentence a row is matched on is the sentence a person is shown, run
// through the same helpers Her day and Details use (`displaySentence`, then
// `scrubRooms` as the second lock, §5.2 / D-001). Nothing can be found by a
// room name because no room name is ever in the text being searched.
//
// Every sentence this screen says lives in lib/copy/family.ts under `search`.
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  Card, EmptyState, ErrorState, Field, KindTag, LoadingState, Marquee, Row, RowGroup, Screen, Txt,
} from '@/components';
import { family } from '@/lib/copy/family';
import { displaySentence, scrubRooms, timeOf } from '@/lib/format';
import { useActivity } from '@/lib/hooks';
import type { ActivityItem } from '@/lib/types';
import { useSession } from '@/store/session';
import { sp } from '@/theme';

const copy = family.search;

/** The same sentence Her day shows, so the search matches what the eye reads. */
const familySentence = (item: ActivityItem): string => {
  if (item.type === 'fall_suspected') return family.shared.fallSuspected;
  if (item.type === 'fall_confirmed') return family.shared.fallConfirmed;
  return scrubRooms(displaySentence(item.sentence));
};

/** The time gutter, the same width Her day uses, so a result reads like a row. */
const TIME_COL = sp(18);

function ResultRow({ item, onPress }: { item: ActivityItem; onPress?: () => void }) {
  const sentence = familySentence(item);
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={
        onPress
          ? copy.openRow(copy.rowLabel(sentence, timeOf(item.ts)))
          : copy.rowLabel(sentence, timeOf(item.ts))
      }
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({ paddingVertical: sp(3.5), opacity: pressed ? 0.6 : 1 })}
    >
      <Row style={{ alignItems: 'flex-start' }} gap={3}>
        <Txt kind="stamp" tone="muted" style={{ width: TIME_COL, paddingTop: sp(0.5) }}>
          {timeOf(item.ts)}
        </Txt>
        <View style={{ flex: 1 }}>
          <Txt kind="body">{sentence}</Txt>
          <Row style={{ marginTop: sp(2) }}>
            <KindTag kind={item.kind} />
          </Row>
        </View>
      </Row>
    </Pressable>
  );
}

export default function Search() {
  const { residentId } = useSession();
  const [query, setQuery] = useState('');

  // Today's feed, the one query Her day already keeps warm. No new endpoint,
  // no second cache key, nothing fetched that the app was not fetching anyway.
  const { data: activity, isLoading, isError, refetch } = useActivity(residentId);

  // The day's story has its own place on Her day and is not a thing Dhyaan
  // "noticed"; everything else in the feed is searchable.
  const rows = (activity?.items ?? []).filter((i) => i.type !== 'daily_summary');
  const needle = query.trim().toLowerCase();
  const hits = needle
    ? rows.filter((i) => familySentence(i).toLowerCase().includes(needle))
    : [];

  const results = () => {
    // Order matters: until the feed is in, this screen has no opinion at all.
    // An empty list here would be a claim, and it is one Dhyaan cannot make.
    if (isLoading && !activity) return <LoadingState label={copy.loading} />;
    if (isError && !activity) {
      return <ErrorState message={copy.loadError} retryLabel={copy.tryAgain} onRetry={refetch} />;
    }
    if (!needle) return <Card><EmptyState>{copy.prompt}</EmptyState></Card>;
    if (rows.length === 0) return <Card><EmptyState>{copy.nothingToSearch}</EmptyState></Card>;
    if (hits.length === 0) return <Card><EmptyState>{copy.noMatch(query.trim())}</EmptyState></Card>;
    return (
      <View>
        <Marquee title={copy.results} meta={copy.matches(hits.length)} />
        <RowGroup>
          {hits.map((item) => (
            <ResultRow
              key={item.id}
              item={item}
              // Only an observation has an event record behind it to open.
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
      </View>
    );
  };

  return (
    <Screen native wash keyboard scrollProps={{ keyboardShouldPersistTaps: 'handled' }}>
      <Field
        accessibilityLabel={copy.fieldLabel}
        placeholder={copy.placeholder}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <View style={{ marginTop: sp(5) }}>{results()}</View>
    </Screen>
  );
}
