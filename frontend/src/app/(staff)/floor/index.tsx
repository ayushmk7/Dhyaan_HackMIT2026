// Floor view: room tiles, colour = state. A glance answers "which rooms tonight?"
//
// The `res_eleanor` filter is gone for the same reason it is gone from triage:
// she is the only resident the real backend seeds, so excluding her left this
// grid permanently empty. A resident with no `room` (mock Eleanor, the B2C
// side of the world) now renders as a tile keyed on their name instead of a
// blank one. Whereabouts are legal here and only here — staff see rooms,
// family never do (DECISIONS.md D-001, TECHNICAL_PRD §12.4).
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import {
  DataLabel, ErrorState, FLOATING_BAR_CLEARANCE, FloatingBar, LoadingState, Row, Rule, Screen,
  Stagger, StatusDot, Txt,
} from '@/components';
import { timeOf } from '@/lib/format';
import { useResidents } from '@/lib/hooks';
import type { Resident } from '@/lib/types';
import { useLive } from '@/store/live';
import { elevation, palette, radius, sp, stateColor } from '@/theme/tokens';
import type { ResidentState } from '@/theme/tokens';
import { NEEDS_EYES, deriveState, pad2 } from '../_layout';

type Tile = Resident & { state: ResidentState };

function RoomTile({ r, onPress }: { r: Tile; onPress: () => void }) {
  const alarm = r.state === 'alerting';
  // Rust is the alarm colour and nothing else, so exactly one kind of tile
  // may wear it — and that tile is this screen's high-contrast moment.
  const ink = alarm ? '#FFFFFF' : palette.ink;
  const dim = alarm ? 'rgba(255,255,255,0.72)' : palette.inkMuted;
  const inOwnRoom = r.location?.zone === 'bedroom';
  const where = r.location ? (inOwnRoom ? 'In room' : r.location.label) : 'No signal';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${r.room ? `Room ${r.room}` : 'No room'}, ${r.display_name}, ${stateColor[r.state].word}`}
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: '47.5%',
          backgroundColor: alarm ? palette.rust : palette.raised,
          borderRadius: radius.glass,
          padding: sp(3.5),
          minHeight: 132,
          ...(alarm ? elevation.float : elevation.raised),
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Txt kind="data" style={{ color: ink }} numberOfLines={1}>
          {r.room ?? r.display_name.split(' ')[0].toUpperCase()}
        </Txt>
        {!alarm && <StatusDot state={r.state} size={9} />}
      </Row>
      {/* The hard rule is the tile's exposed structure: a number, a line under
          it, then the human part. */}
      <Rule color={alarm ? 'rgba(255,255,255,0.85)' : palette.ink} style={{ marginTop: sp(1.5) }} />
      <Txt kind="label" style={{ color: ink, marginTop: sp(2.5) }} numberOfLines={1}>
        {r.display_name.split(' ')[0]}
      </Txt>
      <Txt kind="caption" style={{ color: dim, marginTop: 1 }} numberOfLines={1}>{/* voice-ok */}
        {where}
      </Txt>
      <View style={{ flex: 1 }} />
      <DataLabel tone={dim} value={r.last_seen ? timeOf(r.last_seen) : '--:--'} style={{ marginTop: sp(2) }}>
        Seen
      </DataLabel>
    </Pressable>
  );
}

export default function Floor() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, dataUpdatedAt } = useResidents();
  const liveStates = useLive((s) => s.states);
  const liveLocations = useLive((s) => s.locations);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await qc.invalidateQueries();
    setRefreshing(false);
  }, [qc]);

  const refreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.inkMuted} />
  );

  if (isLoading && !data) {
    return (
      <Screen native wash refreshControl={refreshControl}>
        <LoadingState label="Loading rooms…" />
      </Screen>
    );
  }
  if (isError && !data) {
    return (
      <Screen native wash refreshControl={refreshControl}>
        <ErrorState message="Couldn’t reach the floor list." onRetry={refetch} />
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
    .sort((a, b) => (a.room ?? '￿').localeCompare(b.room ?? '￿'));

  const needing = rooms.filter((r) => NEEDS_EYES.includes(r.state)).length;

  return (
    <View style={{ flex: 1 }}>
      <Screen
        native
        wash
        refreshControl={refreshControl}
        style={{ paddingBottom: FLOATING_BAR_CLEARANCE + sp(6) }}
      >
        <Stagger>
          {/* The screen's one instrument reading, in the machine face. */}
          <View
            style={{
              backgroundColor: palette.ink,
              borderRadius: radius.glass,
              paddingHorizontal: sp(4.5),
              paddingVertical: sp(3.5),
              ...elevation.float,
            }}
          >
            <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <DataLabel tone="rgba(255,255,255,0.55)" value={pad2(rooms.length)}>Rooms</DataLabel>
              <DataLabel tone="rgba(255,255,255,0.55)" value={pad2(needing)}>Need someone</DataLabel>
              <DataLabel
                tone="rgba(255,255,255,0.55)"
                value={dataUpdatedAt ? timeOf(new Date(dataUpdatedAt).toISOString()) : '--:--'}
              >
                Updated
              </DataLabel>
            </Row>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp(3), marginTop: sp(4) }}>
            {rooms.map((r) => (
              <RoomTile
                key={r.id}
                r={r}
                onPress={() => router.push(`/(staff)/triage/resident/${r.id}`)}
              />
            ))}
          </View>

          {rooms.length === 0 && (
            <Txt kind="body" tone="muted" style={{ marginTop: sp(6) }}>
              {/* voice-ok: an empty state, which DESIGN.md exempts. */}
              No rooms are set up on this floor yet.
            </Txt>
          )}
        </Stagger>
      </Screen>

      {/* Chrome the grid scrolls under: the colour key, which is the only way
          to read a tile at a glance. inset={false} — the tab bar already owns
          the bottom safe area. */}
      <FloatingBar inset={false}>
        <Row gap={3} style={{ justifyContent: 'center', flexWrap: 'wrap', paddingVertical: sp(1) }}>
          {(['alerting', 'attention', 'offline', 'ok'] as ResidentState[]).map((s) => (
            <Row key={s} gap={1.5}>
              <StatusDot state={s} size={8} />
              <Txt kind="caption" tone="muted">{stateColor[s].word}</Txt>
            </Row>
          ))}
        </Row>
      </FloatingBar>
    </View>
  );
}
