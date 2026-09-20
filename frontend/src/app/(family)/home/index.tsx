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
import { Linking, Pressable, RefreshControl, View } from 'react-native';
import {
  Card, DataLabel, Entrance, ErrorState, Hairline, LoadingState, Marquee, MetricRow,
  PresenceHero, Row, Screen, StatTile, StatusDot, Glass, Txt,
} from '@/components';
import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import {
  localDayKey, useActivity, useContacts, useLatestMessage, usePresence, useTalkAbout,
} from '@/lib/hooks';
import { ago, timeOf } from '@/lib/format';
import type { Contact, Presence } from '@/lib/types';
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

/**
 * Her own number, if her contact list actually holds it.
 *
 * `Contact` is the escalation ladder — the people Dhyaan rings when she needs
 * someone — and nothing in `lib/` exposes the resident's own `phone_e164`
 * (the backend has one on the resident document; `Resident` in lib/types.ts
 * does not carry it). So this looks for her among her own contacts and returns
 * null when she isn't there, and every call site says so rather than dialling
 * a number that belongs to nobody.
 */
const herNumber = (contacts: Contact[] | undefined, name: string): string | null => {
  const full = name.trim().toLowerCase();
  const first = full.split(/\s+/)[0];
  const self = (contacts ?? []).find((c) => {
    const rel = (c.relationship ?? '').toLowerCase();
    if (rel === 'self' || rel === 'resident' || rel === 'herself' || rel === 'himself') return true;
    const n = c.name.trim().toLowerCase();
    return !!first && (n === full || n.split(/\s+/)[0] === first);
  });
  return self?.phone_e164?.trim() || null;
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

/** When the server has no sentence yet, the hero says so plainly. */
function emptySentence(p: Presence | undefined, name: string): string {
  if (!p || p.status === 'no_camera') return 'Nothing yet today';
  if (!p.camera.consent) return 'The camera is off';
  if (p.status === 'paused') return `${name} paused the camera`;
  return 'Nothing yet today';
}

export default function Today() {
  const qc = useQueryClient();
  const { residentId, residentName } = useSession();
  const livePresence = useLive((s) => s.presence[residentId]);
  const { data: fetched, isLoading, isError, refetch } = usePresence(residentId);
  const { data: activity, isError: activityError, refetch: refetchActivity } = useActivity(residentId);
  const { data: contacts } = useContacts();
  // Real against the backend. `latestMessage` still legitimately resolves null
  // in live mode (no endpoint exists), so its section simply isn't rendered.
  const { data: prompts } = useTalkAbout();
  const { data: herMessage } = useLatestMessage();
  const nextAppt = useCareFile((s) => s.appointments[0]);

  // The websocket is the fast path; the 15 s refetch is the belt under it.
  const presence = livePresence ?? fetched;
  const phone = herNumber(contacts, residentName);

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
  const latest = activity?.items?.[0];
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={phone ? `Call ${residentName}` : `No phone number saved for ${residentName}`}
              accessibilityState={{ disabled: !phone }}
              disabled={!phone}
              onPress={() => phone && Linking.openURL(`tel:${phone}`)}
              style={({ pressed }) => ({
                width: 40, height: 40, borderRadius: 20,
                backgroundColor: pressed ? '#D6D6DB' : '#E5E5EA',
                opacity: phone ? 1 : 0.45,
                alignItems: 'center', justifyContent: 'center',
              })}
            >
              <Icon name="phone.fill" size={17} color={palette.slate} />
            </Pressable>
          </Row>

          <PresenceHero
            sentence={presence?.sentence ?? ''}
            emptySentence={emptySentence(presence, residentName)}
            style={{ marginTop: sp(4) }}
          />

          {!phone && (
            <Txt kind="caption" tone="muted" style={{ marginTop: sp(4) }}>
              Dhyaan doesn’t have a phone number for {residentName} — only for the people it calls
              if she needs someone. That’s why this button can’t dial her.
            </Txt>
          )}
        </Glass>
      </Entrance>

      {/* Beat 1 — the day, in figures. */}
      <Entrance index={1}>
        <Marquee title="Today" meta={localDayKey()} />
        {activityError && (
          <Pressable onPress={() => refetchActivity()} style={{ marginBottom: sp(3) }}>
            <Txt kind="caption" tone="warn">Couldn’t load today. Tap to try again.</Txt>
          </Pressable>
        )}
        <Row gap={3}>
          <StatTile
            icon="fork.knife"
            state={tiles ? 'ok' : 'unknown'}
            value={tiles ? String(tiles.meals) : '–'}
            label="Meals"
          />
          <StatTile
            icon="figure.walk"
            state={tiles ? 'ok' : 'unknown'}
            value={tiles ? String(tiles.in_view_minutes) : '–'}
            label="Minutes up"
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${latest.sentence}. Open her day.`}
            onPress={() => router.push('/(family)/timeline')}
            style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
          >
            <Card lift="float" style={{ backgroundColor: palette.ink }}>
              <Txt kind="title" tone="paper">{latest.sentence}</Txt>
              <Row style={{ justifyContent: 'space-between', marginTop: sp(4) }}>
                <DataLabel tone={palette.paper} value={timeOf(latest.ts)}>Dhyaan saw</DataLabel>
                <Icon name="chevron.right" size={12} color={palette.paper} />
              </Row>
            </Card>
          </Pressable>
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
          <Card style={{ paddingVertical: sp(1) }}>
            {prompts.map((p, i) => (
              <View key={p}>
                {i > 0 && <Hairline />}
                <MetricRow hue={hue.social} icon={openerSymbol(p)} label="Talk about" sentence={p} />
              </View>
            ))}
          </Card>
        </Entrance>
      )}

      {/* Beat 5 — from her care file, which the family typed in themselves. */}
      {nextAppt && (
        <Entrance index={5}>
          <Marquee title="Coming up" meta={nextAppt.when} />
          <Card style={{ paddingVertical: sp(1) }}>
            <MetricRow
              hue={hue.mind}
              icon="calendar"
              label="You told us"
              time={nextAppt.when}
              sentence={nextAppt.title}
              onPress={() => router.push('/(family)/settings/carefile')}
            />
          </Card>
        </Entrance>
      )}
    </Screen>
  );
}
