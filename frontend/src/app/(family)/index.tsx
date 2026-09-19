// Home: one calm sentence about Eleanor, where she is, and how today is going.
import { useQueryClient } from '@tanstack/react-query';
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RoomTimeBar, Row, SectionTitle, StatusDot, Tile, Txt } from '@/components';
import { useLocationHistory, useResident, useTimeline } from '@/lib/hooks';
import { ago, dayOf, mins, zoneLabel } from '@/lib/format';
import { useLive } from '@/store/live';
import { useSession } from '@/store/session';
import { palette, sp, type ResidentState } from '@/theme/tokens';

const RES = 'res_eleanor';

const localDayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function headline(name: string, state: ResidentState): string {
  switch (state) {
    case 'ok': return `${name} is OK`;
    case 'attention': return `${name} is worth a look`;
    case 'alerting': return `${name} needs someone now`;
    case 'offline': return `${name}'s band is offline`;
    default: return `Kestrel is learning ${name}'s routine`;
  }
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { residentName } = useSession();
  const { data: resident } = useResident(RES);
  const { data: events } = useTimeline(RES);
  const todayKey = localDayKey();
  const { data: segments } = useLocationHistory(RES, todayKey);
  const live = useLive();

  // Dwell time ticks every 30 s; Date.now() in render is off-limits under the compiler.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await qc.invalidateQueries();
    setRefreshing(false);
  }, [qc]);

  const state: ResidentState = live.states[RES] ?? resident?.state ?? 'learning';
  const location = live.locations[RES] ?? resident?.location ?? null;
  const dwellS = location ? (now - new Date(location.since).getTime()) / 1000 : 0;

  const todays = (events ?? []).filter((e) => dayOf(e.ts) === 'Today');
  const meals = todays.filter((e) => e.type === 'meal_observed').length;
  const walks = todays.filter((e) => e.type === 'walk_completed').length;
  const upAtNight = todays.find((e) => e.type === 'night_activity');
  const wentOut = todays.some((e) => e.zone === 'outside');

  return (
    <View style={{ flex: 1, backgroundColor: palette.paper }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + sp(4),
          paddingHorizontal: sp(5),
          paddingBottom: insets.bottom + sp(8),
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.inkMuted} />
        }
        showsVerticalScrollIndicator={false}
      >
        <Txt kind="display">{headline(residentName, state)}</Txt>

        <Row style={{ marginTop: sp(4) }} gap={2}>
          <StatusDot state={state} />
          <Txt kind="body">
            {location
              ? `In the ${zoneLabel(location.zone).toLowerCase()} · ${mins(dwellS)}`
              : 'Kestrel isn’t sure which room she’s in right now'}
          </Txt>
        </Row>
        <Txt kind="caption" tone="muted" style={{ marginTop: sp(1) }}>
          {resident
            ? `Band last heard ${ago(resident.last_seen)}` +
              (resident.band_battery_pct != null ? ` · battery ${resident.band_battery_pct}%` : '')
            : ' '}
        </Txt>

        <SectionTitle>Today so far</SectionTitle>
        <Row gap={2}>
          <Tile
            title="Ate"
            state={meals >= 3 ? 'ok' : meals > 0 ? 'warn' : 'unknown'}
            detail={meals > 0 ? `${meals} of 3 meals` : 'No meals observed yet'}
          />
          <Tile
            title="Walked"
            state={walks >= 2 ? 'ok' : walks === 1 ? 'warn' : 'unknown'}
            detail={walks > 0 ? `${walks} ${walks === 1 ? 'walk' : 'walks'} so far` : 'No walks yet today'}
          />
        </Row>
        <Row gap={2} style={{ marginTop: sp(2) }}>
          <Tile
            title="Up at night"
            state={upAtNight ? 'warn' : 'ok'}
            detail={upAtNight ? 'Up during the night' : 'Slept through'}
          />
          <Tile
            title="Out of the house"
            state={wentOut ? 'ok' : 'unknown'}
            detail={wentOut ? 'Went out for her walk' : 'Hasn’t been out yet'}
          />
        </Row>

        <SectionTitle>Where her day went</SectionTitle>
        <RoomTimeBar segments={segments ?? []} />
      </ScrollView>
    </View>
  );
}
