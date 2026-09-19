// Timeline: reverse-chron day sections — room-time bar, the day's story, then events.
import { router } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { EventRow, Hairline, RoomTimeBar, Screen, SectionTitle, Txt } from '@/components';
import { dayOf } from '@/lib/format';
import { useLocationHistory, useSummaries, useTimeline } from '@/lib/hooks';
import type { DaySummary, KEvent } from '@/lib/types';
import { sp } from '@/theme/tokens';

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

  return (
    <Screen>
      <Txt kind="display">Her week</Txt>
      {sections.length === 0 && (
        <Txt kind="body" tone="muted" style={{ marginTop: sp(4) }}>
          Nothing observed yet — the timeline fills in as Kestrel notices meals, walks and rooms.
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
