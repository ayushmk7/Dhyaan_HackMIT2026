// Today. A person, then dense grouped lists of one repeated row (MetricRow).
// Human apps are documents of rows, not columns of widget-posters (DESIGN.md).
// The status line is the server's presence sentence, room-free by design: a
// per-room breakdown is whereabouts, and whereabouts never reach a family
// screen (VLM_PLAN §1/§5.2, D-001). Same reason there is no room-time bar here.
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, ErrorState, Hairline, LoadingState, MetricRow, Row, SectionTitle, Txt } from '@/components';
import { Avatar } from '@/components/avatar';
import { Entrance } from '@/components/entrance';
import { Icon } from '@/components/icon';
import { useActivity, useLatestMessage, usePresence, useTalkAbout } from '@/lib/hooks';
import { ago, timeOf } from '@/lib/format';
import type { Presence } from '@/lib/types';
import { useCareFile } from '@/store/carefile';
import { useLive } from '@/store/live';
import { useSession } from '@/store/session';
import { hue, palette, sp } from '@/theme/tokens';

const openerSymbol = (text: string): string => {
  const t = text.toLowerCase();
  if (t.includes('walk')) return 'figure.walk';
  if (t.includes('dinner') || t.includes('meal') || t.includes('eat')) return 'fork.knife';
  if (t.includes('sleep') || t.includes('night')) return 'moon.zzz';
  return 'bubble.left';
};

/** What the camera is doing — never where she is. */
function subline(p: Presence | undefined): string {
  if (!p) return ' ';
  if (p.status === 'no_camera') return 'No camera set up yet';
  if (!p.camera.consent) return 'Camera off · falls still watched';
  if (p.status === 'paused') {
    const until = p.camera.paused_until ? ` until ${timeOf(p.camera.paused_until)}` : '';
    return `She paused the camera${until}`;
  }
  if (!p.camera.online) return 'Camera not running';
  if (!p.last_observation_at) return 'Camera on';
  return `Camera on · noticed ${ago(p.last_observation_at)}`;
}

/** When the server has no sentence yet, the card says so plainly. */
function statusLine(p: Presence | undefined, name: string): string {
  if (p?.sentence.trim()) return p.sentence;
  if (!p || p.status === 'no_camera') return 'Nothing yet today';
  if (!p.camera.consent) return 'The camera is off';
  if (p.status === 'paused') return `${name} paused the camera`;
  return 'Nothing yet today';
}

export default function Today() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { residentId, residentName } = useSession();
  const livePresence = useLive((s) => s.presence[residentId]);
  const { data: fetched, isLoading, isError, refetch } = usePresence(residentId);
  const { data: activity, isError: activityError, refetch: refetchActivity } = useActivity(residentId);
  const { data: prompts } = useTalkAbout();
  const { data: herMessage } = useLatestMessage();
  const nextAppt = useCareFile((s) => s.appointments[0]);

  // The websocket is the fast path; the 15 s refetch is the belt under it.
  const presence = livePresence ?? fetched;

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await qc.invalidateQueries();
    setRefreshing(false);
  }, [qc]);

  if (isLoading && !presence) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.paper, paddingTop: insets.top + sp(6) }}>
        <LoadingState label={`Checking on ${residentName}…`} />
      </View>
    );
  }
  if (isError && !presence) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.paper, paddingTop: insets.top + sp(6), paddingHorizontal: sp(5) }}>
        <ErrorState
          message={`Couldn’t reach Dhyaan to check on ${residentName}.`}
          onRetry={refetch}
        />
      </View>
    );
  }

  const tiles = activity?.tiles;
  const latest = activity?.items?.[0];
  const watching = !!presence && presence.status !== 'no_camera' && presence.camera.consent
    && presence.camera.online && presence.status !== 'paused';

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
          <Row gap={3} style={{ paddingVertical: sp(2), alignItems: 'flex-start' }}>
            <Avatar name={residentName} size={48} />
            <View style={{ flex: 1 }}>
              <Txt kind="title" numberOfLines={1}>{residentName}</Txt>
              <Row gap={1.5} style={{ marginTop: 2, alignItems: 'flex-start' }}>
                <View style={{
                  width: 7, height: 7, borderRadius: 4, marginTop: 6,
                  backgroundColor: watching ? palette.moss : '#A8A8AD',
                }} />
                <Txt kind="body" style={{ flex: 1, fontSize: 16 }} numberOfLines={2}>
                  {statusLine(presence, residentName)}
                </Txt>
              </Row>
              <Txt kind="caption" tone="muted" style={{ marginTop: 2 }} numberOfLines={1}>
                {subline(presence)}
              </Txt>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Call ${residentName}`}
              onPress={() => Linking.openURL('tel:+16175550100')}
              style={({ pressed }) => ({
                width: 40, height: 40, borderRadius: 20,
                backgroundColor: pressed ? '#D6D6DB' : '#E5E5EA',
                alignItems: 'center', justifyContent: 'center',
              })}
            >
              <Icon name="phone.fill" size={17} color={palette.slate} />
            </Pressable>
          </Row>
        </Entrance>

        <SectionTitle>Today</SectionTitle>
        {activityError && (
          <Pressable onPress={() => refetchActivity()} style={{ marginBottom: sp(2) }}>
            <Txt kind="caption" tone="warn">
              Couldn’t load today. Tap to try again.
            </Txt>
          </Pressable>
        )}
        <Card style={{ paddingVertical: sp(1) }}>
          <MetricRow
            hue={hue.nutrition}
            icon="fork.knife"
            label="Meals"
            value={tiles ? `${tiles.meals}` : '–'}
          />
          <Hairline />
          <MetricRow
            hue={hue.activity}
            icon="figure.walk"
            label="Up and about"
            value={tiles ? `${tiles.in_view_minutes}` : '–'}
            unit="min"
          />
          <Hairline />
          <MetricRow
            hue={hue.sleep}
            icon="moon.zzz.fill"
            label="Overnight"
            sentence={tiles == null ? '–' : tiles.night_ups > 0 ? `Up ${tiles.night_ups} time${tiles.night_ups === 1 ? '' : 's'}` : 'Slept through'}
          />
          <Hairline />
          <MetricRow
            hue={hue.location}
            icon="figure.walk.motion"
            label="Out of the house"
            sentence={tiles && tiles.out_of_house > 0 ? `Went out ${tiles.out_of_house}×` : 'Home so far'}
          />
        </Card>

        {(herMessage || !!prompts?.length || nextAppt || latest) && (
          <Card style={{ marginTop: sp(3), paddingVertical: sp(1) }}>
            {herMessage && (
              <>
                <MetricRow
                  hue={hue.social}
                  icon="quote.bubble"
                  label={`From ${residentName}`}
                  time={ago(herMessage.at)}
                  sentence={`“${herMessage.text}”`}
                  lines={3}
                  onPress={() =>
                    Linking.openURL(`sms:+16175550100&body=${encodeURIComponent('Got your message! ')}`)
                  }
                />
                <Hairline />
              </>
            )}
            {(prompts ?? []).map((p) => (
              <View key={p}>
                <MetricRow hue={hue.social} icon={openerSymbol(p)} label="When you call" sentence={p} />
                <Hairline />
              </View>
            ))}
            {latest && (
              <>
                <MetricRow
                  hue={hue.presence}
                  icon="clock"
                  label="Last noticed"
                  time={timeOf(latest.ts)}
                  sentence={latest.sentence}
                  onPress={() => router.push('/(family)/timeline')}
                />
                {nextAppt && <Hairline />}
              </>
            )}
            {nextAppt && (
              <MetricRow
                hue={hue.mind}
                icon="calendar"
                label="Coming up"
                time={nextAppt.when}
                sentence={nextAppt.title}
                onPress={() => router.push('/(family)/settings/carefile')}
              />
            )}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}
