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
  DataLabel, EmptyState, ErrorState, LoadingState, Row, Rule, Screen, Slab, Stagger, StatusDot,
  Surface, Txt,
} from '@/components';
import { floor as copy, readout } from '@/lib/copy/staff';
import { timeOf } from '@/lib/format';
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

  const body = (
    <>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Txt kind="data" numberOfLines={1}>
          {r.room ?? r.display_name.split(' ')[0].toUpperCase()}
        </Txt>
        {!alarm && <StatusDot state={r.state} size={9} />}
      </Row>
      {/* The hard rule is the tile's exposed structure: a number, a line under
          it, then the human part. */}
      <Rule style={{ marginTop: sp(1.5) }} />
      <Txt kind="label" style={{ marginTop: sp(2.5) }} numberOfLines={1}>
        {r.display_name.split(' ')[0]}
      </Txt>
      <Txt kind="caption" tone="muted" style={{ marginTop: 1 }} numberOfLines={1}>{/* voice-ok */}
        {where}
      </Txt>
      <View style={{ flex: 1 }} />
      <DataLabel value={r.last_seen ? timeOf(r.last_seen) : readout.noTime} style={{ marginTop: sp(2) }}>
        {copy.tile.seen}
      </DataLabel>
    </>
  );

  const a11y = copy.tile.a11y(r.room, r.display_name, t.stateColor[r.state].word);

  // Rust is the alarm colour and nothing else, so exactly one kind of tile may
  // wear it, and that tile is this screen's high-contrast moment: an alarm
  // slab, which hands its children their colours. The normal tile is an
  // opaque plate at the raised tier, so it takes the raised radius.
  if (alarm) {
    return (
      <Slab
        tone="alarm"
        lift="float"
        onPress={onPress}
        accessibilityLabel={a11y}
        style={{ width: '47.5%', padding: sp(3.5), minHeight: 132 }}
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
            minHeight: 132,
            ...elevation.raised,
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
    .sort((a, b) => (a.room ?? '￿').localeCompare(b.room ?? '￿'));

  const needing = rooms.filter((r) => NEEDS_EYES.includes(r.state)).length;

  // Chrome the grid scrolls under: the colour key, which is the only way to
  // read a tile at a glance. Handed to Screen so the clearance is its contract,
  // and it rides the safe-area inset the floating tab bar raises.
  const key = (
    <Row gap={3} style={{ justifyContent: 'center', flexWrap: 'wrap', paddingVertical: sp(1) }}>
      {(['alerting', 'attention', 'offline', 'ok'] as ResidentState[]).map((s) => (
        <Row key={s} gap={1.5}>
          <StatusDot state={s} size={8} />
          <Txt kind="caption" tone="muted">{t.stateColor[s].word}</Txt>
        </Row>
      ))}
    </Row>
  );

  return (
    <Screen native wash refreshControl={refreshControl} floatingBar={key}>
      <Stagger>
        {/* The screen's one instrument reading, in the machine face. */}
        <Slab style={{ paddingVertical: sp(3.5) }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <DataLabel value={pad2(rooms.length)}>{copy.slab.rooms}</DataLabel>
            <DataLabel value={pad2(needing)}>{copy.slab.needSomeone}</DataLabel>
            <DataLabel value={dataUpdatedAt ? timeOf(new Date(dataUpdatedAt).toISOString()) : readout.noTime}>
              {copy.slab.updated}
            </DataLabel>
          </Row>
        </Slab>

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
          <EmptyState style={{ marginTop: sp(6) }}>{copy.empty}</EmptyState>
        )}
      </Stagger>
    </Screen>
  );
}
