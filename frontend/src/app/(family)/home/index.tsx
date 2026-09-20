// Today. A person card, then cards — never a column of prose. The status line
// is the server's presence sentence, which is room-free by design: a per-room
// breakdown is whereabouts, and whereabouts never reach a family screen
// (VLM_PLAN §1/§5.2, D-001). That is also why there is no room-time bar here.
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, ErrorState, Hairline, KindTag, LoadingState, Row, SectionTitle, StatTile, Txt } from '@/components';
import { Avatar } from '@/components/avatar';
import { Entrance } from '@/components/entrance';
import { Icon, IconBadge } from '@/components/icon';
import { useActivity, useLatestMessage, usePresence, useTalkAbout } from '@/lib/hooks';
import { ago, timeOf } from '@/lib/format';
import type { Presence } from '@/lib/types';
import { useCareFile } from '@/store/carefile';
import { useLive } from '@/store/live';
import { useSession } from '@/store/session';
import { palette, sp, type } from '@/theme/tokens';

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
          <Txt kind="label" style={{ marginTop: 1 }} numberOfLines={2}>{subtitle}</Txt>
        </View>
        <Icon name="chevron.right" size={13} color="#C4BCAD" />
      </Row>
    </Pressable>
  );
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
          <Card style={{ paddingVertical: sp(3.5) }}>
            <Row gap={3} style={{ alignItems: 'flex-start' }}>
              <Avatar name={residentName} size={54} />
              <View style={{ flex: 1 }}>
                <Txt kind="heading" numberOfLines={1}>{residentName}</Txt>
                <Row gap={1.5} style={{ marginTop: 3, alignItems: 'flex-start' }}>
                  <View style={{
                    width: 8, height: 8, borderRadius: 4, marginTop: 6,
                    backgroundColor: watching ? palette.moss : '#A9A192',
                  }} />
                  <Txt kind="label" style={{ flex: 1 }} numberOfLines={2}>
                    {statusLine(presence, residentName)}
                  </Txt>
                </Row>
                <Txt kind="caption" tone="muted" style={{ marginTop: 2 }} numberOfLines={1}>
                  {subline(presence)}
                </Txt>
                {presence?.spot_is_usual && presence.status === 'in_view' && (
                  <View style={{ marginTop: sp(2) }}>
                    <KindTag kind="observed" detail="her usual spot" />
                  </View>
                )}
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
          <Entrance index={1}>
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
        {activityError && (
          <Pressable onPress={() => refetchActivity()} style={{ marginBottom: sp(2) }}>
            <Txt kind="caption" tone="warn">
              Couldn’t load today. Tap to try again.
            </Txt>
          </Pressable>
        )}
        <Row gap={2.5} style={{ alignItems: 'stretch' }}>
          <StatTile
            icon="fork.knife"
            state={tiles && tiles.meals > 0 ? 'ok' : 'unknown'}
            value={tiles ? `${tiles.meals}` : '–'}
            label={tiles?.meals === 1 ? 'meal so far' : 'meals so far'}
          />
          <StatTile
            icon="figure.walk"
            state={tiles && tiles.in_view_minutes > 0 ? 'ok' : 'unknown'}
            value={tiles ? `${tiles.in_view_minutes}m` : '–'}
            label="up and about"
          />
        </Row>
        <Row gap={2.5} style={{ marginTop: sp(2.5), alignItems: 'stretch' }}>
          <StatTile
            icon="moon.zzz.fill"
            state={tiles && tiles.night_ups > 0 ? 'warn' : 'ok'}
            value={tiles == null ? '–' : tiles.night_ups > 0 ? `Up ${tiles.night_ups}×` : 'Slept'}
            label="overnight"
          />
          <StatTile
            icon="figure.walk.motion"
            state={tiles && tiles.out_of_house > 0 ? 'ok' : 'unknown'}
            value={tiles && tiles.out_of_house > 0 ? `${tiles.out_of_house}×` : 'Home'}
            label={tiles && tiles.out_of_house > 0 ? 'went out' : 'so far today'}
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

        {(nextAppt || latest) && (
          <Card style={{ marginTop: sp(5), paddingVertical: sp(1) }}>
            {latest && (
              <LinkRow
                icon="clock"
                color={palette.slate}
                title={`Last noticed · ${timeOf(latest.ts)}`}
                subtitle={latest.sentence}
                onPress={() => router.push('/(family)/timeline')}
              />
            )}
            {nextAppt && latest && <Hairline />}
            {nextAppt && (
              <LinkRow
                icon="calendar"
                color={palette.ochre}
                title="Coming up"
                subtitle={`${nextAppt.title} · ${nextAppt.when}`}
                onPress={() => router.push('/(family)/settings/carefile')}
              />
            )}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}
