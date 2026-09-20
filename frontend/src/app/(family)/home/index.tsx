// Home: one calm sentence about Eleanor, then cards — never a column of prose.
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, ErrorState, Hairline, LoadingState, RoomTimeBar, Row, SectionTitle, StatTile, Txt } from '@/components';
import { Avatar } from '@/components/avatar';
import { Entrance } from '@/components/entrance';
import { Icon, IconBadge } from '@/components/icon';
import { useLatestMessage, useLocationHistory, useResident, useTalkAbout, useTimeline } from '@/lib/hooks';
import { ago, dayOf, eventTitle, mins, timeOf, zoneLabel } from '@/lib/format';
import { useCareFile } from '@/store/carefile';
import { useLive } from '@/store/live';
import { useSession } from '@/store/session';
import { palette, sp, stateColor, type, type ResidentState } from '@/theme/tokens';

const RES = 'res_eleanor';

const localDayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const openerSymbol = (text: string): string => {
  const t = text.toLowerCase();
  if (t.includes('walk')) return 'figure.walk';
  if (t.includes('dinner') || t.includes('meal') || t.includes('eat')) return 'fork.knife';
  if (t.includes('sleep') || t.includes('night')) return 'moon.zzz';
  return 'bubble.left';
};

// Small tonal pill for in-card actions ("Reply by text") — bare text links read
// as a webpage; tonal pills read as iOS.
function PillBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? '#DAE4EE' : palette.slateWash,
        paddingHorizontal: sp(3.5), paddingVertical: sp(2), borderRadius: 999,
      })}
    >
      <Text style={[type.caption, { fontWeight: '600', color: palette.slate }]}>{label}</Text>
    </Pressable>
  );
}

// Card row with badge + chevron (Settings-list grammar).
function LinkRow({ icon, color, title, subtitle, onPress }: {
  icon: string; color: string; title: string; subtitle: string; onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [{ paddingVertical: sp(3), opacity: pressed ? 0.55 : 1 }]}
    >
      <Row gap={3}>
        <IconBadge name={icon} color={color} size={30} />
        <View style={{ flex: 1 }}>
          <Txt kind="caption" tone="muted">{title}</Txt>
          <Txt kind="label" style={{ marginTop: 1 }} numberOfLines={1}>{subtitle}</Txt>
        </View>
        <Icon name="chevron.right" size={13} color="#C4BCAD" />
      </Row>
    </Pressable>
  );
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { residentName } = useSession();
  const { data: resident, isLoading: residentLoading, isError: residentError, refetch: refetchResident } = useResident(RES);
  const { data: events, isError: eventsError, refetch: refetchEvents } = useTimeline(RES);
  const { data: prompts } = useTalkAbout();
  const { data: herMessage } = useLatestMessage();
  const nextAppt = useCareFile((s) => s.appointments[0]);
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

  // Nothing to show at all yet — don't render a headline built on guesses.
  if (residentLoading && !resident) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.paper, paddingTop: insets.top + sp(6) }}>
        <LoadingState label={`Loading ${residentName}’s day…`} />
      </View>
    );
  }
  if (residentError && !resident) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.paper, paddingTop: insets.top + sp(6), paddingHorizontal: sp(5) }}>
        <ErrorState
          message={`Couldn’t reach Dhyaan to load ${residentName}’s day.`}
          onRetry={refetchResident}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.paper }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingTop: sp(2),
          paddingHorizontal: sp(4),
          paddingBottom: insets.bottom + sp(8),
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.inkMuted} />
        }
        showsVerticalScrollIndicator={false}
      >
        <Entrance index={0}>
          <Card style={{ paddingVertical: sp(3.5) }}>
            <Row gap={3}>
              <Avatar name={residentName} size={54} />
              <View style={{ flex: 1 }}>
                <Txt kind="heading" numberOfLines={1}>{residentName}</Txt>
                <Row gap={1.5} style={{ marginTop: 3 }}>
                  <View style={{
                    width: 8, height: 8, borderRadius: 4,
                    backgroundColor: stateColor[state].fg,
                  }} />
                  <Txt kind="label" numberOfLines={1}>
                    {location ? `${zoneLabel(location.zone)} · ${mins(dwellS)}` : stateColor[state].word}
                  </Txt>
                </Row>
                <Txt kind="caption" tone="muted" style={{ marginTop: 2 }} numberOfLines={1}>
                  {resident
                    ? `Band ${resident.last_seen ? ago(resident.last_seen) : 'off'}` +
                      (resident.band_battery_pct != null ? ` · ${resident.band_battery_pct}%` : '')
                    : ' '}
                </Txt>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Call ${residentName}`}
                onPress={() => Linking.openURL('tel:+16175550100')}
                style={({ pressed }) => ({
                  width: 44, height: 44, borderRadius: 22,
                  backgroundColor: pressed ? '#CBE9DA' : palette.slateWash,
                  alignItems: 'center', justifyContent: 'center',
                })}
              >
                <Icon name="phone.fill" size={19} color={palette.slate} />
              </Pressable>
            </Row>
          </Card>
        </Entrance>

        {herMessage && (
          <Entrance index={2}>
            <Card style={{ marginTop: sp(3) }}>
              <Row gap={2.5}>
                <Avatar name={residentName} size={30} />
                <Txt kind="caption" tone="muted">
                  {residentName}, on her last call · {ago(herMessage.at)}
                </Txt>
              </Row>
              <Txt kind="title" style={{ marginTop: sp(2.5) }}>
                “{herMessage.text}”
              </Txt>
              <Row gap={2} style={{ marginTop: sp(3.5) }}>
                <PillBtn
                  label="Reply by text"
                  onPress={() =>
                    Linking.openURL(`sms:+16175550100&body=${encodeURIComponent('Got your message! ')}`)
                  }
                />
                <PillBtn label="Call her" onPress={() => Linking.openURL('tel:+16175550100')} />
              </Row>
            </Card>
          </Entrance>
        )}

        <SectionTitle>Today</SectionTitle>
        {eventsError && (
          <Pressable onPress={() => refetchEvents()} style={{ marginBottom: sp(2) }}>
            <Txt kind="caption" tone="warn">
              Couldn’t load today’s activity — tap to try again.
            </Txt>
          </Pressable>
        )}
        <Row gap={2.5} style={{ alignItems: 'stretch' }}>
          <StatTile
            icon="fork.knife"
            state={meals >= 3 ? 'ok' : meals > 0 ? 'warn' : 'unknown'}
            value={`${meals} of 3`}
            label="meals"
          />
          <StatTile
            icon="figure.walk"
            state={walks >= 2 ? 'ok' : walks === 1 ? 'warn' : 'unknown'}
            value={`${walks}`}
            label={walks === 1 ? 'walk so far' : 'walks so far'}
          />
        </Row>
        <Row gap={2.5} style={{ marginTop: sp(2.5), alignItems: 'stretch' }}>
          <StatTile
            icon="moon.zzz.fill"
            state={upAtNight ? 'warn' : 'ok'}
            value={upAtNight ? 'Up 1×' : 'Slept'}
            label="overnight"
          />
          <StatTile
            icon="figure.walk.motion"
            state={wentOut ? 'ok' : 'unknown'}
            value={wentOut ? 'Out' : 'Home'}
            label={wentOut ? 'went outside' : 'so far today'}
          />
        </Row>

        {!!prompts?.length && (
          <>
            <SectionTitle>When you call her</SectionTitle>
            <Card style={{ paddingVertical: sp(1) }}>
              {prompts.map((p, i) => (
                <View key={p}>
                  {i > 0 && <Hairline />}
                  <Row gap={3} style={{ paddingVertical: sp(3) }}>
                    <Icon name={openerSymbol(p)} size={17} color={palette.slate} />
                    <Txt kind="body" style={{ flex: 1 }} numberOfLines={2}>{p}</Txt>
                  </Row>
                </View>
              ))}
            </Card>
          </>
        )}

        <SectionTitle>Where her day went</SectionTitle>
        <Card>
          <RoomTimeBar segments={segments ?? []} />
        </Card>

        {(nextAppt || events?.[0]) && (
          <Card style={{ marginTop: sp(3), paddingVertical: sp(1) }}>
            {nextAppt && (
              <LinkRow
                icon="calendar"
                color={palette.ochre}
                title="Coming up"
                subtitle={`${nextAppt.title} · ${nextAppt.when}`}
                onPress={() => router.push('/(family)/settings/carefile')}
              />
            )}
            {nextAppt && events?.[0] && <Hairline />}
            {events?.[0] && (
              <LinkRow
                icon="clock"
                color={palette.slate}
                title="Last noticed"
                subtitle={`${eventTitle(events[0].type)} · ${timeOf(events[0].ts)}`}
                onPress={() => router.push('/(family)/timeline')}
              />
            )}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}
