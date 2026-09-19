// Today. One sentence about how she is, and four small facts under it.
//
// This screen is for the adult child, not the grandparent: everything is
// framed as reassurance at a distance. It shows what she is doing and whether
// it is her usual spot, and it cannot show a room — `Presence` has no zone
// field, so there is nothing here to leak (§1, §5.2, D-001). The band battery
// and the room-time bar moved to Settings and staff respectively.
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Card, ErrorState, KindTag, LoadingState, PresenceHero, Row, SectionTitle, Tile, Txt,
} from '@/components';
import { Entrance } from '@/components/entrance';
import { Icon } from '@/components/icon';
import { Wash } from '@/components/wash';
import { ago, timeOf } from '@/lib/format';
import { useActivity, useLatestMessage, usePresence, useTalkAbout } from '@/lib/hooks';
import { useCareFile } from '@/store/carefile';
import type { Presence } from '@/lib/types';
import { useLive } from '@/store/live';
import { useSession } from '@/store/session';
import { palette, sp } from '@/theme/tokens';

/**
 * The line under the hero. It says what the camera is doing, never where she
 * is — "camera on", not "camera in the living room".
 */
function subline(p: Presence | undefined): string {
  if (!p) return ' ';
  if (p.status === 'no_camera') return 'No camera is set up for her yet.';
  if (!p.camera.consent) return 'Nothing is being observed. Fall detection is unaffected.';
  if (p.status === 'paused') {
    const until = p.camera.paused_until ? ` until ${timeOf(p.camera.paused_until)}` : '';
    return `She paused the camera${until}. Fall detection is unaffected.`;
  }
  if (!p.camera.online) return 'The camera isn’t running right now.';
  if (!p.last_observation_at) return 'Camera on · nothing noticed yet';
  return `Camera on · last noticed ${ago(p.last_observation_at)}`;
}

/** When the server has no sentence yet, the screen says so plainly. */
function heroFallback(p: Presence | undefined, name: string): string {
  if (!p) return 'Nothing yet today.';
  if (p.status === 'no_camera') return 'Nothing yet today.';
  if (!p.camera.consent) return 'The camera is off.';
  if (p.status === 'paused') return `${name} paused the camera.`;
  return 'Nothing yet today.';
}

export default function Today() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { residentId, residentName } = useSession();
  const livePresence = useLive((s) => s.presence[residentId]);
  const {
    data: fetched, isLoading, isError, refetch,
  } = usePresence(residentId);
  const {
    data: activity, isError: activityError, refetch: refetchActivity,
  } = useActivity(residentId);
  // Ported from the connection lane: her last message, the call openers, and the
  // next care-file appointment. Their room-time bar is deliberately NOT ported —
  // a per-room breakdown is room-level whereabouts on a family screen, which
  // VLM_PLAN §1/§5.2 forbids. The zone still rides on the event for staff.
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
      <View style={{
        flex: 1, backgroundColor: palette.paper,
        paddingTop: insets.top + sp(6), paddingHorizontal: sp(5),
      }}>
        <ErrorState
          message={`Couldn’t reach Dhyaan to check on ${residentName}.`}
          onRetry={refetch}
        />
      </View>
    );
  }

  const tiles = activity?.tiles;
  const latest = activity?.items?.[0];

  return (
    <View style={{ flex: 1, backgroundColor: palette.paper }}>
      <Wash height={320} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + sp(5),
          paddingHorizontal: sp(5),
          paddingBottom: insets.bottom + sp(10),
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.inkMuted} />
        }
        showsVerticalScrollIndicator={false}
      >
        <Entrance index={0}>
          <Txt kind="label" tone="muted">Today</Txt>
          <PresenceHero
            style={{ marginTop: sp(3) }}
            sentence={presence?.sentence ?? ''}
            emptySentence={heroFallback(presence, residentName)}
            sub={subline(presence)}
          />
        </Entrance>

        {presence?.spot_is_usual && presence.status === 'in_view' && (
          <Entrance index={1} style={{ marginTop: sp(4) }}>
            <KindTag kind="observed" detail="in her usual spot" />
          </Entrance>
        )}

        {herMessage && (
          <Entrance index={2}>
            <Card style={{ marginTop: sp(5) }}>
              <Row gap={1.5}>
                <Icon name="quote.opening" size={13} color={palette.inkMuted} />
                <Txt kind="caption" tone="muted">
                  From her last call with Dhyaan &middot; {ago(herMessage.at)}
                </Txt>
              </Row>
              <Txt kind="title" style={{ marginTop: sp(2) }}>
                &ldquo;{herMessage.text}&rdquo;
              </Txt>
              <Row gap={2} style={{ marginTop: sp(3) }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    Linking.openURL(`sms:+16175550100&body=${encodeURIComponent('Got your message! ')}`)
                  }
                >
                  <Txt kind="label" tone="slate">Reply by text</Txt>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => Linking.openURL('tel:+16175550100')}>
                  <Txt kind="label" tone="slate">Call her back</Txt>
                </Pressable>
              </Row>
            </Card>
          </Entrance>
        )}

        <Entrance index={2}>
          <SectionTitle>Today so far</SectionTitle>
          {activityError && (
            <Pressable
              accessibilityRole="button"
              onPress={() => refetchActivity()}
              style={{ marginBottom: sp(2) }}
            >
              <Txt kind="caption" tone="warn">
                Couldn’t load today’s activity — tap to try again.
              </Txt>
            </Pressable>
          )}
          <Row gap={2}>
            <Tile
              title="Ate"
              state={tiles && tiles.meals > 0 ? 'ok' : 'unknown'}
              detail={
                tiles && tiles.meals > 0
                  ? `${tiles.meals} ${tiles.meals === 1 ? 'meal' : 'meals'} so far`
                  : 'No meals noticed yet'
              }
            />
            <Tile
              title="Moved about"
              state={tiles && tiles.in_view_minutes > 0 ? 'ok' : 'unknown'}
              detail={
                tiles && tiles.in_view_minutes > 0
                  ? `${tiles.in_view_minutes} min in view`
                  : 'Nothing noticed yet'
              }
            />
          </Row>
          <Row gap={2} style={{ marginTop: sp(2) }}>
            <Tile
              title="Up at night"
              state={tiles && tiles.night_ups > 0 ? 'warn' : 'ok'}
              detail={
                tiles == null
                  ? 'Nothing noticed yet'
                  : tiles.night_ups > 0
                    ? `Up ${tiles.night_ups} ${tiles.night_ups === 1 ? 'time' : 'times'}`
                    : 'Slept through'
              }
            />
            <Tile
              title="Out of the house"
              state={tiles && tiles.out_of_house > 0 ? 'ok' : 'unknown'}
              detail={
                tiles && tiles.out_of_house > 0
                  ? `Out of view ${tiles.out_of_house}×`
                  : 'Hasn’t been out of view yet'
              }
            />
          </Row>
        </Entrance>

        <Entrance index={3}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open her day"
            onPress={() => router.push('/(family)/timeline')}
            style={({ pressed }) => [{
              marginTop: sp(7), paddingVertical: sp(3),
              borderTopWidth: 1, borderTopColor: palette.line,
              opacity: pressed ? 0.6 : 1,
            }]}
          >
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt kind="label" tone="muted">Last noticed</Txt>
              <Icon name="chevron.right" size={12} color={palette.inkMuted} />
            </Row>
            {latest ? (
              <>
                <Txt kind="body" style={{ marginTop: sp(1) }}>{latest.sentence}</Txt>
                <View style={{ marginTop: sp(2) }}>
                  <KindTag kind={latest.kind} detail={timeOf(latest.ts)} />
                </View>
              </>
            ) : (
              <Txt kind="body" tone="muted" style={{ marginTop: sp(1) }}>
                Nothing yet today. Dhyaan writes a line here the first time it notices
                something.
              </Txt>
            )}
          </Pressable>
        </Entrance>

        {!!prompts?.length && (
          <>
            <SectionTitle>Worth mentioning when you call</SectionTitle>
            <View style={{ gap: sp(3) }}>
              {prompts.map((pr) => (
                <Row key={pr} gap={2.5} style={{ alignItems: 'flex-start' }}>
                  <View style={{ marginTop: 9, width: 5, height: 5, borderRadius: 3, backgroundColor: palette.slate }} />
                  <Txt kind="body" style={{ flex: 1 }}>{pr}</Txt>
                </Row>
              ))}
            </View>
            <Txt kind="caption" tone="muted" style={{ marginTop: sp(2) }}>
              So the call can be about her day &mdash; Dhyaan already handled &ldquo;is she okay&rdquo;.
            </Txt>
          </>
        )}

        {nextAppt && (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/(family)/carefile')}
            style={({ pressed }) => [{
              marginTop: sp(6), paddingVertical: sp(3),
              borderTopWidth: 1, borderTopColor: palette.line,
              opacity: pressed ? 0.6 : 1,
            }]}
          >
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt kind="caption" tone="muted">Coming up</Txt>
              <Icon name="chevron.right" size={12} color={palette.inkMuted} />
            </Row>
            <Txt kind="body" style={{ marginTop: sp(1) }}>
              {nextAppt.title} &middot; {nextAppt.when}
            </Txt>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}
