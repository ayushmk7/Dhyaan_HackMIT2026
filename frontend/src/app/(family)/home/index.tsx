// Today. One floating sentence about her, then the day in figures, then the
// few things worth knowing — each section absent entirely when it has nothing
// to say, because "nothing yet today" is the state this app opens in.
//
// The status line is the server's presence sentence, room-free by design: a
// per-room breakdown is whereabouts, and whereabouts never reach a family
// screen (VLM_PLAN §1/§5.2, D-001). Same reason there is no room-time bar here.
//
// `activity.items` arrives newest-first (normalized in lib/http.ts), so
// `items[0]` is genuinely the last thing noticed. Do not re-sort it.
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Linking, RefreshControl, View } from 'react-native';
import {
  Card, Chevron, Entrance, ErrorState, Glass, Hairline, IconBtn, KindTag, LoadingState, Marquee,
  MetricRow, PresenceHero, Row, RowGroup, Screen, Slab, StatTile, StatusDot, Txt,
} from '@/components';
import { Avatar } from '@/components/avatar';
import {
  localDayKey, useActivity, useContacts, useLatestMessage, usePresence, useResident,
  useTalkAbout,
} from '@/lib/hooks';
import { ago, displaySentence, residentNumber, timeOf } from '@/lib/format';
import type { ActivityItem, Presence } from '@/lib/types';
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


/** The sentence a person reads; the band's fall record arrives as a log line. */
const familySentence = (item: ActivityItem): string => {
  if (item.type === 'fall_suspected') return 'Her band reported a possible fall.';
  if (item.type === 'fall_confirmed') return 'Her band confirmed a fall.';
  return displaySentence(item.sentence);
};

/** What the camera is doing — never where she is. */
function subline(p: Presence | undefined): string {
  if (!p) return ' ';
  if (p.status === 'no_camera') return 'No camera set up yet';
  if (!p.camera.consent) return 'Camera off · falls still watched';
  if (p.status === 'paused') {
    const until = p.camera.paused_until ? ` until ${timeOf(p.camera.paused_until)}` : '';
    // `paused_by` says whose hand did it. Only she pauses from her computer;
    // a pause from this app is not hers, and saying so would be a small lie.
    return p.camera.paused_by === 'family'
      ? `Paused from this app${until}`
      : `She paused the camera${until}`;
  }
  if (!p.camera.online) return 'Camera not running';
  if (!p.last_observation_at) return 'Camera on';
  return `Camera on · noticed ${ago(p.last_observation_at)}`;
}

/** When the server has no sentence yet, the hero says so plainly. */
function emptySentence(p: Presence | undefined, name: string): string {
  if (!p || p.status === 'no_camera') return 'Nothing yet today';
  if (!p.camera.consent) return 'The camera is off';
  if (p.status === 'paused') {
    return p.camera.paused_by === 'family' ? 'The camera is paused' : `${name} paused the camera`;
  }
  return 'Nothing yet today';
}

export default function Today() {
  const qc = useQueryClient();
  const { residentId, residentName } = useSession();
  const livePresence = useLive((s) => s.presence[residentId]);
  const { data: fetched, isLoading, isError, refetch } = usePresence(residentId);
  const { data: activity, isError: activityError, refetch: refetchActivity } = useActivity(residentId);
  const { data: contacts } = useContacts();
  // Her own line rides on the roster projection now, so no extra request.
  const { data: resident } = useResident(residentId);
  // Real against the backend. `latestMessage` still legitimately resolves null
  // in live mode (no endpoint exists), so its section simply isn't rendered.
  const { data: prompts } = useTalkAbout();
  const { data: herMessage } = useLatestMessage();
  const nextAppt = useCareFile((s) => s.appointments[0]);

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
        <LoadingState label={`Checking on ${residentName}…`} />
      </Screen>
    );
  }
  if (isError && !presence) {
    return (
      <Screen native wash>
        <ErrorState message={`Couldn’t reach Dhyaan to check on ${residentName}.`} onRetry={refetch} />
      </Screen>
    );
  }

  const tiles = activity?.tiles;
  // "Last noticed" is the last thing it SAW. The feed also carries lines
  // worked out from her pattern (the day's story, a deviation), and the
  // nightly rollup stamps those with the moment it ran, so `items[0]` is
  // often a story about the day rather than a sighting in it.
  const latest = activity?.items?.find((i) => i.kind === 'observed');
  const watching = !!presence && presence.status !== 'no_camera' && presence.camera.consent
    && presence.camera.online && presence.status !== 'paused';

  return (
    <Screen
      native
      wash
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.inkMuted} />
      }
    >
      {/* Beat 0 — the one sentence, floating over the ground. */}
      <Entrance index={0} distance={26}>
        <Glass lift="float" interactive style={{ padding: sp(5) }}>
          <Row style={{ justifyContent: 'space-between' }} gap={3}>
            <Row gap={2.5} style={{ flex: 1 }}>
              <Avatar name={residentName} size={38} />
              <View style={{ flex: 1 }}>
                <Txt kind="label" numberOfLines={1}>{residentName}</Txt>
                <Row gap={1.5} style={{ marginTop: 1 }}>
                  <StatusDot state={watching ? 'ok' : 'offline'} size={7} />
                  <Txt kind="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
                    {subline(presence)}
                  </Txt>
                </Row>
              </View>
            </Row>
            <IconBtn
              name="phone.fill"
              label={phone ? `Call ${residentName}` : `No phone number saved for ${residentName}`}
              disabled={!phone}
              onPress={() => phone && Linking.openURL(`tel:${phone}`)}
            />
          </Row>

          {!!presence?.sentence.trim() && !!presence.last_observation_at && (
            <View style={{ marginTop: sp(4) }}>
              <KindTag kind="observed" detail={ago(presence.last_observation_at)} />
            </View>
          )}
          <PresenceHero
            sentence={presence?.sentence ?? ''}
            emptySentence={emptySentence(presence, residentName)}
            style={{ marginTop: sp(3) }}
          />
        </Glass>

        {/* Below the glass, not inside it: glass holds the heading, never prose. */}
        {!phone && (
          <Txt kind="caption" tone="muted" style={{ marginTop: sp(3) }}>
            {/* voice-ok: an empty state, which DESIGN.md exempts. */}
            Dhyaan doesn’t have a phone number for {residentName}, only for the people it calls
            if she needs someone. That’s why this button can’t dial her.
          </Txt>
        )}
      </Entrance>

      {/* Beat 1 — the day, in figures. */}
      <Entrance index={1}>
        <Marquee title="Today" meta={localDayKey()} />
        {activityError && (
          <ErrorState
            inline
            message="Couldn’t load today."
            onRetry={() => refetchActivity()}
            style={{ marginBottom: sp(3) }}
          />
        )}
        <Row gap={3}>
          {/* Both of these are counted by the camera. When nothing is
              watching, a zero is not "she didn't eat", it is "nobody was
              looking", so the badge goes grey instead of green. */}
          <StatTile
            icon="fork.knife"
            state={tiles ? (watching ? 'ok' : 'unknown') : 'unknown'}
            value={tiles ? String(tiles.meals) : '–'}
            label="Meals"
          />
          <StatTile
            icon="figure.walk"
            state={tiles ? (watching ? 'ok' : 'unknown') : 'unknown'}
            value={tiles ? String(tiles.in_view_minutes) : '–'}
            label="Minutes in view"
          />
        </Row>
        <Row gap={3} style={{ marginTop: sp(3) }}>
          <StatTile
            icon="moon.zzz.fill"
            state={tiles ? 'ok' : 'unknown'}
            value={tiles ? String(tiles.night_ups) : '–'}
            label="Up at night"
          />
          <StatTile
            icon="figure.walk.motion"
            state={tiles ? 'ok' : 'unknown'}
            value={tiles ? String(tiles.out_of_house) : '–'}
            label="Times out"
          />
        </Row>
      </Entrance>

      {/* Beat 2 — the screen's one uncompromising surface: the last thing it
          saw, printed hard. Absent when it hasn't seen anything. */}
      {latest && (
        <Entrance index={2}>
          <Marquee title="Last noticed" meta={timeOf(latest.ts)} />
          <Slab
            accessibilityLabel={`${familySentence(latest)}. Open the details.`}
            // Straight to this observation, not to the top of a list it may
            // be halfway down.
            onPress={() => router.push({
              pathname: '/(family)/timeline/[eventId]',
              params: { eventId: latest.id },
            })}
          >
            <Txt kind="title">{familySentence(latest)}</Txt>
            <Row style={{ justifyContent: 'space-between', marginTop: sp(4) }}>
              {/* The three kinds stay labelled even here — especially here. */}
              <KindTag kind={latest.kind} detail={timeOf(latest.ts)} />
              <Chevron />
            </Row>
          </Slab>
        </Entrance>
      )}

      {/* Beat 3 — her own words. Null in live mode until an endpoint exists,
          and a section with nothing in it is a section that isn't drawn. */}
      {herMessage && (
        <Entrance index={3}>
          <Marquee title={`From ${residentName}`} meta={ago(herMessage.at)} />
          <Card>
            <Txt kind="quote">“{herMessage.text}”</Txt>
            {phone && (
              <>
                <Hairline style={{ marginTop: sp(3.5) }} />
                <MetricRow
                  hue={hue.social}
                  icon="arrowshape.turn.up.left"
                  label="Reply"
                  sentence={`Text ${residentName} back`}
                  onPress={() =>
                    Linking.openURL(`sms:${phone}&body=${encodeURIComponent('Got your message! ')}`)
                  }
                />
              </>
            )}
          </Card>
        </Entrance>
      )}

      {/* Beat 4 — openers, drafted from today's real observations. Empty array
          when there is no key behind the backend, and then no section. */}
      {!!prompts?.length && (
        <Entrance index={4}>
          <Marquee title="When you call" meta={String(prompts.length)} />
          <Txt kind="caption" tone="muted" style={{ marginBottom: sp(2.5) }}>
            {/* voice-ok: an empty state, which DESIGN.md exempts. */}
            Drafted from what Dhyaan saw today, not from things she has said.
          </Txt>
          <RowGroup>
            {prompts.map((p) => (
              <MetricRow key={p} hue={hue.social} icon={openerSymbol(p)} label="Talk about" sentence={p} />
            ))}
          </RowGroup>
        </Entrance>
      )}

      {/* Beat 5 — from her care file, which the family typed in themselves. */}
      {nextAppt && (
        <Entrance index={5}>
          <Marquee title="Coming up" right={<KindTag kind="told" />} />
          <RowGroup>
            <MetricRow
              hue={hue.mind}
              icon="calendar"
              label="Appointment"
              time={nextAppt.when}
              sentence={nextAppt.title}
              onPress={() => router.push('/(family)/settings/carefile')}
            />
          </RowGroup>
        </Entrance>
      )}
    </Screen>
  );
}
