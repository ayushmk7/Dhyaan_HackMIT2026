// Floor view: room tiles. A glance answers "which rooms tonight?"
//
// Weight, not hue, does the ranking. The count of rooms that need someone is
// the one large number on the screen; an alerting room is the one inverted
// tile; a room worth a look or whose band is quiet carries a dot; a room that
// is fine carries nothing, so the tiles that matter are the only ones with
// anything on them. The dot key, the per-tile "seen" reading and the rule
// inside every tile are gone: decoration on forty tiles is what hid the one.
//
// The `res_eleanor` filter is gone for the same reason it is gone from triage:
// she is the only resident the real backend seeds, so excluding her left this
// grid permanently empty. A resident with no `room` (mock Eleanor, the B2C
// side of the world) now renders as a tile keyed on their name instead of a
// blank one. Whereabouts are legal here and only here: staff see rooms,
// family never do (DECISIONS.md D-001, TECHNICAL_PRD §12.4).
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import {
  DataLabel, EmptyState, ErrorState, LoadingState, Row, Rule, Screen, Slab, Stagger, StatusDot,
  Surface, Txt,
} from '@/components';
import { floor as copy } from '@/lib/copy/staff';
import { useResidents } from '@/lib/hooks';
import type { Resident } from '@/lib/types';
import { useLive } from '@/store/live';
import { elevation, radius, sp, useTheme } from '@/theme';
import type { ResidentState } from '@/theme/tokens';
import { NEEDS_EYES, deriveState, pad2 } from '../_layout';

type Tile = Resident & { state: ResidentState };

function RoomTile({ r, onPress }: { r: Tile; onPress: () => void }) {
  const t = useTheme();
  const alarm = r.state === 'alerting';
  const inOwnRoom = r.location?.zone === 'bedroom';
  const where = r.location ? (inOwnRoom ? copy.tile.inRoom : r.location.label) : copy.tile.noSignal;
  // A dot only where it says something: fine rooms carry nothing.
  const marked = !alarm && r.state !== 'ok';

  const body = (
    <>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center', minHeight: sp(3) }}>
        <Txt kind="data" numberOfLines={1}>
          {r.room ?? r.display_name.split(' ')[0].toUpperCase()}
        </Txt>
        {marked && <StatusDot state={r.state} size={9} />}
      </Row>
      <View style={{ flex: 1 }} />
      <Txt kind="label" style={{ marginTop: sp(4) }} numberOfLines={1}>
        {r.display_name.split(' ')[0]}
      </Txt>
      <Txt kind="caption" tone="muted" style={{ marginTop: 1 }} numberOfLines={1}>{/* voice-ok */}
        {where}
      </Txt>
    </>
  );

  const a11y = copy.tile.a11y(r.room, r.display_name, t.stateColor[r.state].word);

  // Alarm is inversion and nothing else, so exactly one kind of tile is
  // inverted, and that tile is this screen's high-contrast moment.
  if (alarm) {
    return (
      <Slab
        tone="alarm"
        lift="float"
        onPress={onPress}
        accessibilityLabel={a11y}
        style={{ width: '47.5%', padding: sp(3.5), minHeight: 112 }}
      >
        {body}
      </Slab>
    );
  }
  return (
    <Surface tone="paper">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={a11y}
        onPress={onPress}
        style={({ pressed }) => [
          {
            width: '47.5%',
            backgroundColor: t.raised,
            borderRadius: radius.card,
            padding: sp(3.5),
            minHeight: 112,
            ...(t.isDark ? { borderWidth: 1, borderColor: t.line } : elevation.raised),
          },
          pressed && { opacity: 0.7 },
        ]}
      >
        {body}
      </Pressable>
    </Surface>
  );
}

export default function Floor() {
  const t = useTheme();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useResidents();
  const liveStates = useLive((s) => s.states);
  const liveLocations = useLive((s) => s.locations);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await qc.invalidateQueries();
    setRefreshing(false);
  }, [qc]);

  const refreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.inkMuted} />
  );

  if (isLoading && !data) {
    return (
      <Screen native wash refreshControl={refreshControl}>
        <LoadingState label={copy.loading} />
      </Screen>
    );
  }
  if (isError && !data) {
    return (
      <Screen native wash refreshControl={refreshControl}>
        <ErrorState message={copy.loadError} onRetry={refetch} />
      </Screen>
    );
  }

  const rooms: Tile[] = (data ?? [])
    .map((r) => ({
      ...r,
      state: deriveState(r, liveStates[r.id], r.open_alerts > 0),
      location: liveLocations[r.id] ?? r.location,
    }))
    // Roomless residents sort last rather than to the top on an empty string.
    .sort((a, b) => (a.room ?? '\uffff').localeCompare(b.room ?? '\uffff'));

  const needing = rooms.filter((r) => NEEDS_EYES.includes(r.state)).length;

  return (
    <Screen native wash refreshControl={refreshControl}>
      <Stagger>
        {/* The screen's one instrument reading: how many rooms need someone. */}
        <View>
          <Txt kind="readout">{pad2(needing)}</Txt>
          <DataLabel style={{ marginTop: sp(1) }}>{copy.needSomeone}</DataLabel>
          <Rule weight="heavy" style={{ marginTop: sp(4) }} />
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp(4), marginTop: sp(8) }}>
          {rooms.map((r) => (
            <RoomTile
              key={r.id}
              r={r}
              onPress={() => router.push(`/(staff)/triage/resident/${r.id}`)}
            />
          ))}
        </View>

        {rooms.length === 0 && (
          <EmptyState style={{ marginTop: sp(6) }} title={copy.empty}>
            {copy.emptyHint}
          </EmptyState>
        )}
      </Stagger>
    </Screen>
  );
}
