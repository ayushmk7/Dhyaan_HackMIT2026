// Today, as a board. Five panels, read in one pass: how she is (the one big
// plate), the one thing to do about it (Call), her day in four figures, what
// the camera is doing, and the short list of things that are only sometimes
// true. Each reading has edges of its own, so nothing on this screen is a
// paragraph with numbers buried in it.
//
// Panel order is the order a person needs it in, not the order the queries
// resolve in: the answer, then the action, then the figures the answer is
// drawn from, then the machine that drew them, then the occasional rows. The
// camera panel sits UNDER the figures on purpose — two of those figures go
// muted when nothing is watching, and the panel right below them is the
// sentence that explains why.
//
// The hero is a Slab because a board needs one focal plate and this is it;
// the figures, which used to be that plate, are four separate tiles now. One
// Slab per screen still holds. Call stays the screen's only accent-filled
// control, full width, directly under the answer: a board of readings still
// needs one obvious thing to do, and burying it under the readings would be
// the whole mistake.
//
// The sentence is set at `display` (30), not `hero` (40). The server keeps it
// short; a short sentence at 30 with room around it reads as calm, and the
// same words at 40 wrapping to three lines read as shouting. It is a plain
// Txt rather than PresenceHero because that component remounts on every new
// sentence to fade it in, and this screen is not allowed to move on its own.
//
// The answer is the server's presence sentence, room-free by design: a
// per-room breakdown is whereabouts, and whereabouts never reach a family
// screen (VLM_PLAN §1/§5.2, D-001). Same reason there is no location panel
// here, and no room-time bar.
//
// NOTHING ON THIS BOARD IS INVENTED. Every figure is a count the server sent;
// a figure nobody has counted is the missing-value glyph, never a plausible
// zero, and the two camera-counted figures go muted when nothing was watching
// so that "0 meals" can never be read as "she did not eat". A panel with no
// data says so in words.
//
// `activity.items` arrives newest-first (normalized in lib/http.ts), so
// `items[0]` is genuinely the last thing noticed. Do not re-sort it.
//
// The occasional rows are the last panel, after everything with a fixed slot,
// so a query resolving late moves nothing above it.
//
// Every sentence this screen says lives in lib/copy/family.ts under `home`.
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Linking, Pressable, RefreshControl, View } from 'react-native';
import {
  Btn, Card, Chevron, DataLabel, Entrance, ErrorState, LoadingState, Marquee, Row, RowGroup,
  Screen, Slab, Txt,
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
  // No presence at all is a state, not a blank line: the panel says it has
  // nothing rather than rendering an empty row that looks like a bug.
  if (!p) return copy.subline.unknown;
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
 * One figure tile: the count, the word under it. Four sit in one row and
 * stretch to the same height, so a two-word label wrapping makes the row
 * taller rather than making one tile look broken.
 *
 * `muted` is not decoration. It means this figure is the camera's to count
 * and the camera was not watching, so the number is an absence of looking,
 * not an absence of the thing.
 */
function FigureTile({ value, label, muted }: { value: string; label: string; muted: boolean }) {
  return (
    <Card style={{ flex: 1, padding: sp(3) }}>
      <Txt kind="data" tone={muted ? 'muted' : undefined} numberOfLines={1}>{value}</Txt>
      <Txt kind="caption" tone="muted" numberOfLines={2} style={{ marginTop: 2 }}>{label}</Txt>
    </Card>
  );
}

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

  const sentence = presence?.sentence?.trim() || emptySentence(presence, residentName);
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
      {/* Panel 1. The answer, on the board's one focal plate: her name, then
          the sentence. Nothing else goes on this plate — the freshness of it
          is the camera panel's job, and saying it twice would make the top of
          the board an argument with itself. The sentence is the screen's
          heading and announces itself when it changes. */}
      <Entrance index={0} distance={26}>
        <Slab>
          <Txt kind="label" numberOfLines={1}>{residentName}</Txt>
          <Txt
            kind="display"
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
            style={{ marginTop: sp(2.5) }}
          >
            {sentence}
          </Txt>
        </Slab>
      </Entrance>

      {/* Panel 2. Reach her. The most-used thing on the screen and the one
          that ends the worry, so it is the app's one accent-filled control,
          full width, directly under the answer. Emphasis is size, place and
          the plate; alarm keeps the only louder colour. With no number saved
          the same slot says so, at the same height, so nothing below moves. */}
      <Entrance index={1} style={{ marginTop: sp(5) }}>
        {phone ? (
          <Btn
            kind="primary"
            label={copy.call(residentName)}
            onPress={() => Linking.openURL(`tel:${phone}`)}
          />
        ) : (
          <Btn
            kind="quiet"
            disabled
            label={copy.noNumber(residentName)}
            onPress={() => {}}
          />
        )}
      </Entrance>

      {/* Panel 3. Her day in four figures, four tiles under one hard rule.
          The rule is the app's structural gesture and it is right here: these
          are machine counts, and the heading is the only thing that names
          them as a set. The detail is one tap away on the rule itself. */}
      <Entrance index={2} style={{ marginTop: sp(7) }}>
        {activityError && (
          <ErrorState
            inline
            message={copy.todayError}
            retryLabel={copy.tryAgain}
            onRetry={() => refetchActivity()}
            style={{ marginBottom: sp(3) }}
          />
        )}
        <Marquee
          first
          title={copy.panels.day}
          right={(
            <Btn
              kind="link"
              size="small"
              label={copy.seeHerDay}
              onPress={() => router.push('/(family)/timeline')}
            />
          )}
        />
        <Row gap={2} style={{ alignItems: 'stretch' }}>
          {figures.map((f) => (
            <FigureTile key={f.label} value={f.value} label={f.label} muted={f.camera && !watching} />
          ))}
        </Row>
      </Entrance>

      {/* Panel 4. The machine that wrote the rest of the board: what the
          camera is doing, and whether this screen is hearing from it live.
          A machine label, because that is what this panel is about; the
          sentence under it is still plain words. */}
      <Entrance index={3} style={{ marginTop: sp(6) }}>
        <Card>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.openCamera}
            onPress={() => router.push('/(family)/camera')}
            style={({ pressed }) => (pressed ? { opacity: 0.55 } : null)}
          >
            <Row style={{ justifyContent: 'space-between' }} gap={3}>
              <DataLabel>{copy.panels.camera}</DataLabel>
              <Chevron size={11} />
            </Row>
            <Txt kind="body" numberOfLines={2} style={{ marginTop: sp(1.5) }}>
              {subline(presence)}
            </Txt>
            {/* The socket is down: say so once, quietly, on the panel that is
                already about how fresh this board is. Nothing moves, nothing
                turns red — a family does not need a connection dashboard, it
                needs to know the screen may be behind. */}
            {socketDown && (
              <Txt kind="caption" tone="muted" style={{ marginTop: sp(1.5) }}>
                {copy.notLive}
              </Txt>
            )}
          </Pressable>
        </Card>
      </Entrance>

      {/* Panel 5. Everything occasional, one line each, absent when empty.
          What is coming leads, then what was last seen, then her words and
          the opener. Last on the board, so a late row moves nothing above. */}
      {hasRows && (
        <Entrance index={4} style={{ marginTop: sp(6) }}>
          <RowGroup>
            {nextAppt && (
              <QuietRow
                label={copy.appointment}
                time={nextAppt.when}
                sentence={nextAppt.title}
                onPress={() => router.push('/(family)/settings/carefile')}
              />
            )}
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
          </RowGroup>
        </Entrance>
      )}
    </Screen>
  );
}
