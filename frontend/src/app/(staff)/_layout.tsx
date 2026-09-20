// Staff tabs: Triage · Floor · Rounds. Each tab is its own native stack.
//
// This file also carries the small amount of triage math the three staff
// screens share. It lives here, and not in a neighbouring `staff.ts`, because
// expo-router treats every file under `app/` as a route except `_layout` and
// the `+`-prefixed specials (expo-router/build/matchers.js), and `src/lib` is
// owned by another agent this pass. Move it to `src/lib/staff.ts` the moment
// that lock lifts — nothing here is about layout.
import { Tabs } from 'expo-router/js-tabs';
import React from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { reason, shell } from '@/lib/copy/staff';
import { ago } from '@/lib/format';
import type { Alert, Resident } from '@/lib/types';
import { useTheme } from '@/theme';
import type { ResidentState } from '@/theme/tokens';
// The floating glass bar and its inset provider are shared with the family
// shell. They live in that layout file, not in src/components, only because
// the design system is locked this pass — move them to
// `src/components/tab-bar.tsx` the moment it lifts.
import { FloatingTabBar, TabBarInsets, glyph } from '../(family)/_layout';

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

/**
 * The one-line reason a row is where it is — derived from what the wire
 * actually carries (an open alert's kind and clock, the age of `last_seen`).
 * Returns null when there is no real reason: a row with nothing to say says
 * nothing. `attention_reason` is mock-only (`types.ts`), so it is used when
 * present and never stood in for. The words are `copy/staff.ts`'s `reason`.
 */
export function triageReason(
  r: Resident, state: ResidentState, alert: Alert | undefined,
): string | null {
  if (alert) return reason.alertOpened(alert.kind, ago(alert.opened_at));
  if (state === 'alerting') return reason.alertOpen;
  if (state === 'offline') {
    return r.last_seen ? reason.noSignalSince(ago(r.last_seen)) : reason.neverCheckedIn;
  }
  return r.attention_reason ?? null;
}

export const pad2 = (n: number) => String(n).padStart(2, '0');

export default function StaffLayout() {
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const tabs = shell.staffTabs;
  return (
    <TabBarInsets>
      <Tabs
        initialRouteName="triage"
        tabBar={(props) => (
          // Every staff screen is on paper now, Rounds included; one bar tone.
          <FloatingTabBar {...props} bottomInset={insets.bottom} tone="neutral" />
        )}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: t.paper },
        }}
      >
        <Tabs.Screen name="triage" options={{ title: tabs.triage, tabBarIcon: glyph('list.bullet') }} />
        <Tabs.Screen name="floor" options={{ title: tabs.floor, tabBarIcon: glyph('square.grid.2x2') }} />
        <Tabs.Screen name="rounds" options={{ title: tabs.rounds, tabBarIcon: glyph('moon.stars') }} />
      </Tabs>
    </TabBarInsets>
  );
}
