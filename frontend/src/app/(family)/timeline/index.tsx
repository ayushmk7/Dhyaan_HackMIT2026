// Timeline: reverse-chron day sections — room-time bar, the day's story, then events.
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import { EventRow, Hairline, RoomTimeBar, Row, Screen, SectionTitle, Txt } from '@/components';
import { Icon } from '@/components/icon';
import { api } from '@/lib/api';
import { dayOf } from '@/lib/format';
import { palette , sp } from '@/theme/tokens';
import { useLocationHistory, useSummaries, useTimeline } from '@/lib/hooks';
import type { DaySummary, KEvent } from '@/lib/types';

const RES = 'res_eleanor';

const dateKeyOf = (isoTs: string) => {
  const d = new Date(isoTs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

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
  const { data: events } = useTimeline(RES);
  const { data: summaries } = useSummaries(RES);

  // Events arrive newest-first; group into day sections preserving that order.
  const sections: { label: string; dateKey: string; events: KEvent[] }[] = [];
  for (const e of events ?? []) {
    const label = dayOf(e.ts);
    const last = sections[sections.length - 1];
    if (last && last.label === label) last.events.push(e);
    else sections.push({ label, dateKey: dateKeyOf(e.ts), events: [e] });
  }
  const summaryByDate = new Map((summaries ?? []).map((s) => [s.date_local, s]));

  const [sharing, setSharing] = useState(false);
  const shareWeek = async () => {
    setSharing(true);
    const letter = await api.sundayLetter();
    setSharing(false);
    if (letter) Share.share({ message: letter });
  };

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Txt kind="display">Her week</Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Share her week with the family"
          onPress={shareWeek}
          disabled={sharing}
          style={{ paddingVertical: sp(2), opacity: sharing ? 0.5 : 1 }}
        >
          <Row gap={1}>
            <Icon name="square.and.arrow.up" size={16} color={palette.slate} />
            <Txt kind="label" tone="slate">{sharing ? 'Writing…' : 'Share'}</Txt>
          </Row>
        </Pressable>
      </Row>
      <Txt kind="caption" tone="muted" style={{ marginTop: sp(1) }}>
        Share sends the week as a short letter to your family thread.
      </Txt>
      {sections.length === 0 && (
        <Txt kind="body" tone="muted" style={{ marginTop: sp(4) }}>
          Nothing observed yet — the timeline fills in as Dhyaan notices meals, walks and rooms.
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
