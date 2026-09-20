// Staff tabs: Triage · Floor · Rounds. Each tab is its own native stack.
//
// This file also carries the small amount of triage math the three staff
// screens share. It lives here, and not in a neighbouring `staff.ts`, because
// expo-router treats every file under `app/` as a route except `_layout` and
// the `+`-prefixed specials (expo-router/build/matchers.js), and `src/lib` is
// owned by another agent this pass. Move it to `src/lib/staff.ts` the moment
// that lock lifts — nothing here is about layout.
import { Tabs } from 'expo-router';
import React from 'react';
import { ColorValue } from 'react-native';
import { Icon } from '@/components/icon';
import { ago } from '@/lib/format';
import type { Alert, Resident } from '@/lib/types';
import { palette } from '@/theme/tokens';
import type { ResidentState } from '@/theme/tokens';

// ---- the states the server can actually justify ---------------------------------
//
// `backend/app/routers/residents.py` computes exactly `"alerting" if alert
// else "ok"` — it never emits `attention`, `offline` or `learning`. Screens
// that sorted or filtered on those three were sorting on states that cannot
// occur, which is why Rounds was permanently "All quiet tonight".
//
// `offline` is the one richer tier with a real signal behind it: `last_seen`
// is the newest event for that resident, so a band that has stopped speaking
// is derivable client-side without the server inventing a state for it. The
// other two are passed through untouched — the mock sends them, the real
// backend does not, and neither is fabricated here.

/** A band that hasn't produced an event in this long has stopped talking. */
export const OFFLINE_AFTER_MIN = 20;

export const minutesSince = (isoTs: string | null | undefined): number | null =>
  isoTs ? Math.max(0, (Date.now() - new Date(isoTs).getTime()) / 60_000) : null;

/** Ranking for both the triage list and the rounds list. One order, one place. */
export const TIER: Record<ResidentState, number> = {
  alerting: 0, attention: 1, offline: 2, learning: 3, ok: 4,
};

/** States that mean "someone should look", as opposed to "carry on". */
export const NEEDS_EYES: ResidentState[] = ['alerting', 'attention', 'offline'];

export function deriveState(
  r: Resident, live: ResidentState | undefined, hasOpenAlert: boolean,
): ResidentState {
  const server = live ?? r.state;
  if (server === 'alerting' || hasOpenAlert) return 'alerting';
  const age = minutesSince(r.last_seen);
  if (age === null || age > OFFLINE_AFTER_MIN) return 'offline';
  return server;
}

const ALERT_WORD: Record<string, string> = {
  fall: 'Possible fall',
  bathroom: 'Long bathroom stay',
  sos: 'Help button pressed',
  inactivity: 'Unusually still',
  baseline_deviation: 'Change in routine',
};

/**
 * The one-line reason a row is where it is — derived from what the wire
 * actually carries (an open alert's kind and clock, the age of `last_seen`).
 * Returns null when there is no real reason: a row with nothing to say says
 * nothing. `attention_reason` is mock-only (`types.ts`), so it is used when
 * present and never stood in for.
 */
export function triageReason(
  r: Resident, state: ResidentState, alert: Alert | undefined,
): string | null {
  if (alert) return `${ALERT_WORD[alert.kind] ?? 'Alert'}, opened ${ago(alert.opened_at)}`;
  if (state === 'alerting') return 'An alert is open for this resident';
  if (state === 'offline') {
    return r.last_seen
      ? `No signal from the band since ${ago(r.last_seen)}`
      : 'The band has never checked in';
  }
  return r.attention_reason ?? null;
}

export const pad2 = (n: number) => String(n).padStart(2, '0');

const glyph = (name: string) => {
  function TabGlyph({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <Icon name={name} size={22} color={color} weight={focused ? 'semibold' : 'regular'} />;
  }
  return TabGlyph;
};

export default function StaffLayout() {
  return (
    <Tabs
      initialRouteName="triage"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.slate,
        tabBarInactiveTintColor: palette.inkMuted,
        tabBarStyle: {
          backgroundColor: palette.paper,
          borderTopColor: palette.line,
        },
      }}
    >
      <Tabs.Screen name="triage" options={{ title: 'Triage', tabBarIcon: glyph('list.bullet') }} />
      <Tabs.Screen name="floor" options={{ title: 'Floor', tabBarIcon: glyph('square.grid.2x2') }} />
      <Tabs.Screen name="rounds" options={{ title: 'Rounds', tabBarIcon: glyph('moon.stars') }} />
    </Tabs>
  );
}
