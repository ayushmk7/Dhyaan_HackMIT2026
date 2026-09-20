// Today. One answer at the top (is she okay, right now), the day's four
// figures on one plate under it, and a short list of rows for what is only
// sometimes relevant. Nothing on this screen is a paragraph, and nothing on
// it is decorated: no avatar, no glyph beside a label that already names the
// thing. Her day and Settings hold the rest.
//
// The answer is the server's presence sentence, room-free by design: a
// per-room breakdown is whereabouts, and whereabouts never reach a family
// screen (VLM_PLAN §1/§5.2, D-001). Same reason there is no room-time bar here.
//
// `activity.items` arrives newest-first (normalized in lib/http.ts), so
// `items[0]` is genuinely the last thing noticed. Do not re-sort it.
//
// The optional rows are grouped at the bottom, after everything with a fixed
// slot, so a query resolving late moves nothing above it.
//
// Every sentence this screen says lives in lib/copy/family.ts under `home`.
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Linking, Pressable, RefreshControl, View } from 'react-native';
import {
  Btn, Chevron, Entrance, ErrorState, LoadingState, PresenceHero, Row, RowGroup, Screen, Slab, Txt,
} from '@/components';
import { family } from '@/lib/copy/family';
import {
  useActivity, useContacts, useLatestMessage, useNow, usePresence, useResident, useTalkAbout,
} from '@/lib/hooks';
import { ago, displaySentence, residentNumber, timeOf } from '@/lib/format';
import type { ActivityItem, Presence } from '@/lib/types';
import { useCareFile } from '@/store/carefile';
import { LIVE_PRESENCE_MS, useLive } from '@/store/live';
import { useSession } from '@/store/session';
import { sp, useTheme } from '@/theme';

const copy = family.home;

/** The sentence a person reads; the band's fall record arrives as a log line. */
const familySentence = (item: ActivityItem): string => {
  if (item.type === 'fall_suspected') return family.shared.fallSuspected;
  if (item.type === 'fall_confirmed') return family.shared.fallConfirmed;
  return displaySentence(item.sentence);
};

/** What the camera is doing. Never where she is. */
function subline(p: Presence | undefined): string {
  if (!p) return ' ';
  if (p.status === 'no_camera') return copy.subline.noCamera;
  if (!p.camera.consent) return copy.subline.consentOff;
  if (p.status === 'paused') {
    const until = p.camera.paused_until ? timeOf(p.camera.paused_until) : null;
    // `paused_by` says whose hand did it. Only she pauses from her computer;
    // a pause from this app is not hers, and saying so would be a small lie.
    return p.camera.paused_by === 'family'
      ? copy.subline.pausedFromApp(until)
      : copy.subline.pausedByHer(until);
  }
  if (!p.camera.online) return copy.subline.offline;
  if (!p.last_observation_at) return copy.subline.on;
  return copy.subline.onNoticed(ago(p.last_observation_at));
}

/** When the server has no sentence yet, the answer says so plainly. */
function emptySentence(p: Presence | undefined, name: string): string {
  if (!p) return copy.empty.nothingYet;
  if (p.status === 'no_camera') return copy.empty.noCamera;
  if (!p.camera.consent) return copy.empty.cameraOff;
  if (p.status === 'paused') {
    return p.camera.paused_by === 'family' ? copy.empty.cameraPaused : copy.empty.pausedBy(name);
  }
  return copy.empty.nothingYet;
}

/** The missing-value glyph, for a figure nobody has counted yet. */
const NONE = '–';

/** Three missed 15 s polls. Past this the cached answer is not today's news,
 *  it is the last thing the hub said before it stopped answering. */
const PRESENCE_STALE_MS = 45_000;

/**
 * One quiet row: a small label, the sentence under it, and a time on the
 * right when there is one. No glyph; the label names the thing. A chevron
 * only where the row leaves this screen.
 */
function QuietRow({ label, sentence, time, lines = 1, onPress }: {
  label: string; sentence: string; time?: string; lines?: number; onPress?: () => void;
}) {
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [{ paddingVertical: sp(3.5) }, pressed && onPress ? { opacity: 0.55 } : null]}
    >
      <Row style={{ justifyContent: 'space-between' }} gap={3}>
        <Txt kind="tag" tone="muted">{label}</Txt>
        <Row gap={1.5}>
          {!!time && <Txt kind="stamp" tone="muted">{time}</Txt>}
          {!!onPress && <Chevron size={11} />}
        </Row>
      </Row>
      <Txt kind="body" numberOfLines={lines} style={{ marginTop: sp(1) }}>{sentence}</Txt>
    </Pressable>
  );
}

export default function Today() {
  const t = useTheme();
  const qc = useQueryClient();
  const { residentId, residentName } = useSession();
  const livePresence = useLive((s) => s.presence[residentId]);
  const livePresenceAt = useLive((s) => s.presenceAt[residentId]);
  // 'closed', not "not open": a cold start sits in 'connecting' for a moment
  // and that is not news. This line is for a socket that opened and went away,
  // or one that could not open at all — both of which land here.
  const socketDown = useLive((s) => s.status === 'closed');
  const { data: fetched, isLoading, isError, error, refetch, dataUpdatedAt } = usePresence(residentId);
  const { data: activity, isError: activityError, refetch: refetchActivity } = useActivity(residentId);
  const { data: contacts } = useContacts();
  // Her own line rides on the roster projection now, so no extra request.
  const { data: resident } = useResident(residentId);
  // Real against the backend. `latestMessage` still legitimately resolves null
  // in live mode (no endpoint exists), so its row simply isn't rendered.
  const { data: prompts } = useTalkAbout();
  const { data: herMessage } = useLatestMessage();
  const nextAppt = useCareFile((s) => s.appointments[0]);
  // What makes the two age gates below actually fire: without a clock they
  // would only be re-read when something else happened to re-render, which on
  // a dead worker over a live hub is the one case that has nothing to say.
  const now = useNow(5000);

  // The websocket is the fast path; the 15 s refetch is the belt under it.
  // Both are gated on age, because both go quiet in the one way this screen
  // must never look calm through:
  //   · the push only happens on ingest, a state POST or a pause, so a camera
  //     worker that dies sends nothing at all. Ungated, its last sentence won
  //     forever and the GET that would have said out_of_view was never read
  //     again — a hero sentence and "noticed just now" over a dead camera.
  //   · react-query hands back the last good answer while every refetch
  //     fails, so a hub that is gone reads as yesterday's day in full ink.
  // ponytail: both are read off a 5 s clock, so a sentence can outlive its
  // window by up to five seconds — not by an afternoon, which is what it did.
  const pushFresh = !!livePresenceAt && now - livePresenceAt < LIVE_PRESENCE_MS;
  const fetchFresh = !!dataUpdatedAt && now - dataUpdatedAt < PRESENCE_STALE_MS;
  const presence = (pushFresh ? livePresence : undefined) ?? (fetchFresh ? fetched : undefined);
  const phone = residentNumber(resident, contacts, residentName);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await qc.invalidateQueries();
    setRefreshing(false);
  }, [qc]);

  if (isLoading && !presence) {
    return (
      <Screen native wash>
        <LoadingState label={copy.loading(residentName)} />
      </Screen>
    );
  }
  // `isError && !data` was never true: react-query keeps the previous answer
  // through every failure, so the error branch never rendered and a dead hub
  // showed yesterday as now. `presence` is the gated value now, so this asks
  // the honest question — is there anything current to show.
  if ((isError || !fetchFresh) && !presence) {
    // The transport's message names the address it could not reach and why.
    // Showing only the friendly line meant the one fact that identifies the
    // problem never reached the person who could fix it.
    const detail = error instanceof Error ? error.message : null;
    return (
      <Screen native wash>
        <ErrorState message={copy.loadError(residentName)} onRetry={refetch} />
        {!!detail && (
          <Txt kind="caption" tone="muted" style={{ textAlign: 'center', marginTop: sp(3) }}>
            {detail}
          </Txt>
        )}
      </Screen>
    );
  }

  const tiles = activity?.tiles;
  // "Last noticed" is the last thing it SAW. The feed also carries lines
  // worked out from her pattern, and the nightly rollup stamps those with the
  // moment it ran, so `items[0]` is often a story about the day, not a sighting.
  const latest = activity?.items?.find((i) => i.kind === 'observed');
  const watching = !!presence && presence.status !== 'no_camera' && presence.camera.consent
    && presence.camera.online && presence.status !== 'paused';

  // Meals and minutes in view are counted by the camera. When nothing is
  // watching, a zero is not "she didn't eat", it is "nobody was looking", so
  // those two go muted rather than pretending to be a reading.
  const figures: { value: string; label: string; camera: boolean }[] = [
    { value: tiles ? String(tiles.meals) : NONE, label: copy.tiles.meals, camera: true },
    { value: tiles ? String(tiles.in_view_minutes) : NONE, label: copy.tiles.minutesInView, camera: true },
    { value: tiles ? String(tiles.night_ups) : NONE, label: copy.tiles.upAtNight, camera: false },
    { value: tiles ? String(tiles.out_of_house) : NONE, label: copy.tiles.timesOut, camera: false },
  ];

  const opener = prompts?.[0];
  const hasRows = !!latest || !!herMessage || !!opener || !!nextAppt;

  return (
    <Screen
      native
      wash
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.inkMuted} />
      }
    >
      {/* Beat 0. The answer: her name, the sentence, what the camera is doing.
          Big type on bare paper, nothing around it. The sentence leads. */}
      <Entrance index={0} distance={26}>
        <Row style={{ justifyContent: 'space-between' }} gap={3}>
          <Txt kind="label" numberOfLines={1} style={{ flexShrink: 1 }}>{residentName}</Txt>
          {/* The one thing a worried person wants at 3am, named. With no
              number saved there is nothing to dial, so there is no button. */}
          {!!phone && (
            <Btn
              kind="quiet"
              size="small"
              label={copy.call(residentName)}
              onPress={() => Linking.openURL(`tel:${phone}`)}
            />
          )}
        </Row>
        <PresenceHero
          sentence={presence?.sentence ?? ''}
          emptySentence={emptySentence(presence, residentName)}
          style={{ marginTop: sp(6) }}
        />
        <Txt kind="caption" tone="muted" numberOfLines={1} style={{ marginTop: sp(4) }}>
          {subline(presence)}
        </Txt>
        {/* The socket is down: say so once, quietly, under the line that is
            already about how fresh this screen is. Nothing moves, nothing
            turns red — a family does not need a connection dashboard, it
            needs to know the screen may be behind. */}
        {socketDown && (
          <Txt kind="caption" tone="muted" numberOfLines={1} style={{ marginTop: sp(2) }}>
            {copy.notLive}
          </Txt>
        )}
      </Entrance>

      {/* Beat 1. The day in four figures, on the screen's one plate. The
          figures are the summary, the tab is the detail. */}
      <Entrance index={1} style={{ marginTop: sp(10) }}>
        {activityError && (
          <ErrorState
            inline
            message={copy.todayError}
            retryLabel={copy.tryAgain}
            onRetry={() => refetchActivity()}
            style={{ marginBottom: sp(3) }}
          />
        )}
        <Slab
          onPress={() => router.push('/(family)/timeline')}
          accessibilityLabel={copy.openHerDay}
        >
          <Row gap={2} style={{ alignItems: 'flex-start' }}>
            {figures.map((f) => (
              <View key={f.label} style={{ flex: 1 }}>
                <Txt kind="data" tone={f.camera && !watching ? 'muted' : undefined} numberOfLines={1}>
                  {f.value}
                </Txt>
                <Txt kind="caption" tone="muted" numberOfLines={2} style={{ marginTop: 2 }}>
                  {f.label}
                </Txt>
              </View>
            ))}
          </Row>
          <Row gap={1} style={{ marginTop: sp(5), justifyContent: 'flex-end' }}>
            <Txt kind="label">{copy.seeHerDay}</Txt>
            <Chevron tone="ink" />
          </Row>
        </Slab>
      </Entrance>

      {/* Beat 2. Everything occasional, one line each, absent when empty.
          Last on the screen, so a late row moves nothing above it. */}
      {hasRows && (
        <Entrance index={2} style={{ marginTop: sp(8) }}>
          <RowGroup>
            {latest && (
              <QuietRow
                label={copy.lastNoticed}
                time={timeOf(latest.ts)}
                sentence={familySentence(latest)}
                // Straight to this observation, not to the top of a list it
                // may be halfway down.
                onPress={() => router.push({
                  pathname: '/(family)/timeline/[eventId]',
                  params: { eventId: latest.id },
                })}
              />
            )}
            {herMessage && (
              <View>
                {/* Her words are the row; the reply is its own named button
                    under them, so tapping her message never silently opens
                    the Messages app. */}
                <QuietRow
                  label={copy.fromHer(residentName)}
                  time={ago(herMessage.at)}
                  sentence={herMessage.text}
                  lines={2}
                />
                {!!phone && (
                  <Btn
                    kind="quiet"
                    size="small"
                    label={copy.replyByText}
                    style={{ alignSelf: 'flex-start', marginBottom: sp(3.5) }}
                    onPress={() => Linking.openURL(`sms:${phone}&body=${encodeURIComponent(copy.replyBody)}`)}
                  />
                )}
              </View>
            )}
            {/* One opener is enough to start a call. The rest were a list
                behind a disclosure that nobody opened at 3am. */}
            {!!opener && (
              <QuietRow label={copy.whenYouCall} sentence={opener} lines={2} />
            )}
            {nextAppt && (
              <QuietRow
                label={copy.appointment}
                time={nextAppt.when}
                sentence={nextAppt.title}
                onPress={() => router.push('/(family)/settings/carefile')}
              />
            )}
          </RowGroup>
        </Entrance>
      )}
    </Screen>
  );
}
