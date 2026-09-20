// Today. A dashboard, not a wall: one answer at the top (is she okay, right
// now), the day's four figures on one plate under it, and everything that is
// only sometimes relevant folded into a short list of rows. Nothing on this
// screen is a paragraph. Her day and Settings hold the rest.
//
// The answer is the server's presence sentence, room-free by design: a
// per-room breakdown is whereabouts, and whereabouts never reach a family
// screen (VLM_PLAN §1/§5.2, D-001). Same reason there is no room-time bar here.
//
// `activity.items` arrives newest-first (normalized in lib/http.ts), so
// `items[0]` is genuinely the last thing noticed. Do not re-sort it.
//
// Every sentence this screen says lives in lib/copy/family.ts under `home`.
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Linking, RefreshControl, View } from 'react-native';
import {
  Btn, Chevron, DataLabel, Entrance, ErrorState, IconBtn, LoadingState, MetricRow, PresenceHero, Row,
  RowGroup, Screen, Slab, StatusDot, Txt,
} from '@/components';
import { Avatar } from '@/components/avatar';
import { family } from '@/lib/copy/family';
import {
  localDayKey, useActivity, useContacts, useLatestMessage, usePresence, useResident,
  useTalkAbout,
} from '@/lib/hooks';
import { ago, displaySentence, residentNumber, timeOf } from '@/lib/format';
import type { ActivityItem, Presence } from '@/lib/types';
import { useCareFile } from '@/store/carefile';
import { useLive } from '@/store/live';
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

export default function Today() {
  const t = useTheme();
  const qc = useQueryClient();
  const { residentId, residentName } = useSession();
  const livePresence = useLive((s) => s.presence[residentId]);
  const { data: fetched, isLoading, isError, error, refetch } = usePresence(residentId);
  const { data: activity, isError: activityError, refetch: refetchActivity } = useActivity(residentId);
  const { data: contacts } = useContacts();
  // Her own line rides on the roster projection now, so no extra request.
  const { data: resident } = useResident(residentId);
  // Real against the backend. `latestMessage` still legitimately resolves null
  // in live mode (no endpoint exists), so its row simply isn't rendered.
  const { data: prompts } = useTalkAbout();
  const { data: herMessage } = useLatestMessage();
  const nextAppt = useCareFile((s) => s.appointments[0]);
  // The openers are one row until asked for.
  const [openersShown, setOpenersShown] = useState(false);

  // The websocket is the fast path; the 15 s refetch is the belt under it.
  const presence = livePresence ?? fetched;
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
  if (isError && !presence) {
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

  const hasRows = !!latest || !!herMessage || !!prompts?.length || !!nextAppt;

  return (
    <Screen
      native
      wash
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.inkMuted} />
      }
    >
      {/* Beat 0. The answer: her name, the sentence, what the camera is doing.
          Big type on bare paper, nothing around it. */}
      <Entrance index={0} distance={26}>
        <Row style={{ justifyContent: 'space-between' }} gap={3}>
          <Row gap={2.5} style={{ flex: 1 }}>
            <Avatar name={residentName} size={32} />
            <Txt kind="label" numberOfLines={1} style={{ flexShrink: 1 }}>{residentName}</Txt>
          </Row>
          {/* The one thing a worried person wants at 3am, named: not a bare
              phone glyph. With no number saved, the glyph stays, disabled,
              and VoiceOver says why. */}
          {phone ? (
            <Btn
              kind="quiet"
              size="small"
              label={copy.call(residentName)}
              onPress={() => Linking.openURL(`tel:${phone}`)}
            />
          ) : (
            <IconBtn
              name="phone.fill"
              label={copy.noPhoneFor(residentName)}
              disabled
              onPress={() => {}}
            />
          )}
        </Row>
        <PresenceHero
          sentence={presence?.sentence ?? ''}
          emptySentence={emptySentence(presence, residentName)}
          style={{ marginTop: sp(5) }}
        />
        <Row gap={1.5} style={{ marginTop: sp(3) }}>
          <StatusDot state={watching ? 'ok' : 'offline'} size={7} />
          <Txt kind="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
            {subline(presence)}
          </Txt>
        </Row>
      </Entrance>

      {/* Beat 1. The day in four figures, on the screen's one hard plate. */}
      <Entrance index={1} style={{ marginTop: sp(7) }}>
        {activityError && (
          <ErrorState
            inline
            message={copy.todayError}
            retryLabel={copy.tryAgain}
            onRetry={() => refetchActivity()}
            style={{ marginBottom: sp(3) }}
          />
        )}
        {/* The plate opens her day: the figures are the summary, the tab is
            the detail, and the label on the plate says so. */}
        <Slab
          onPress={() => router.push('/(family)/timeline')}
          accessibilityLabel={copy.openHerDay}
        >
          <Row style={{ justifyContent: 'space-between' }} gap={3}>
            <DataLabel>{localDayKey()}</DataLabel>
            <Row gap={1}>
              <Txt kind="label">{copy.seeHerDay}</Txt>
              <Chevron tone="ink" />
            </Row>
          </Row>
          <Row gap={2} style={{ marginTop: sp(3.5), alignItems: 'flex-start' }}>
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
        </Slab>
      </Entrance>

      {/* Beat 2. Everything occasional, one line each, absent when empty. */}
      {hasRows && (
        <Entrance index={2} style={{ marginTop: sp(4) }}>
          <RowGroup>
            {latest && (
              <MetricRow
                icon="eye"
                label={copy.lastNoticed}
                time={timeOf(latest.ts)}
                sentence={familySentence(latest)}
                lines={1}
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
                <MetricRow
                  icon="bubble.left"
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
                    style={{ alignSelf: 'flex-start', marginBottom: sp(3) }}
                    onPress={() => Linking.openURL(`sms:${phone}&body=${encodeURIComponent(copy.replyBody)}`)}
                  />
                )}
              </View>
            )}
            {!!prompts?.length && (
              <View>
                <MetricRow
                  icon="phone"
                  label={copy.whenYouCall}
                  sentence={openersShown ? undefined : prompts[0]}
                  lines={1}
                  onPress={() => setOpenersShown((v) => !v)}
                  expanded={openersShown}
                />
                {openersShown && (
                  <View style={{ paddingBottom: sp(3), gap: sp(2) }}>
                    {prompts.map((p) => (
                      <Txt key={p} kind="body">{p}</Txt>
                    ))}
                    <Txt kind="caption" tone="muted">{copy.whenYouCallNote}</Txt>
                    {!!phone && (
                      <Btn
                        kind="quiet"
                        size="small"
                        label={copy.call(residentName)}
                        style={{ alignSelf: 'flex-start', marginTop: sp(1) }}
                        onPress={() => Linking.openURL(`tel:${phone}`)}
                      />
                    )}
                  </View>
                )}
              </View>
            )}
            {nextAppt && (
              <MetricRow
                icon="calendar"
                label={copy.appointment}
                time={nextAppt.when}
                sentence={nextAppt.title}
                lines={1}
                onPress={() => router.push('/(family)/settings/carefile')}
              />
            )}
          </RowGroup>
        </Entrance>
      )}
    </Screen>
  );
}
