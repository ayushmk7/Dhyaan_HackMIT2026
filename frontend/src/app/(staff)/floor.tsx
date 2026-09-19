// Floor view: room tiles, colour = state. A glance answers "which rooms tonight?"
import { router } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';
import { ErrorState, LoadingState, Screen, Txt } from '@/components';
import { useResidents } from '@/lib/hooks';
import { useLive } from '@/store/live';
import { palette, radius, sp, stateColor } from '@/theme/tokens';

export default function Floor() {
  const { data, isLoading, isError, refetch } = useResidents();
  const liveStates = useLive((s) => s.states);
  const liveLocations = useLive((s) => s.locations);

  if (isLoading && !data) {
    return (
      <Screen>
        <Txt kind="display">Floor 2</Txt>
        <LoadingState label="Loading rooms…" />
      </Screen>
    );
  }
  if (isError && !data) {
    return (
      <Screen>
        <Txt kind="display">Floor 2</Txt>
        <ErrorState message="Couldn’t reach the floor list." onRetry={refetch} />
      </Screen>
    );
  }

  const rooms = (data ?? [])
    .filter((r) => r.id !== 'res_eleanor')
    .map((r) => ({
      ...r,
      state: liveStates[r.id] ?? r.state,
      location: liveLocations[r.id] ?? r.location,
    }))
    .sort((a, b) => (a.room ?? '').localeCompare(b.room ?? ''));

  return (
    <Screen>
      <Txt kind="display">Floor 2</Txt>
      <Txt kind="caption" tone="muted" style={{ marginTop: sp(1) }}>
        Tap a room to see the resident
      </Txt>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp(3), marginTop: sp(5) }}>
        {rooms.map((r) => {
          const c = stateColor[r.state];
          const inOwnRoom = r.location?.zone === 'bedroom';
          return (
            <Pressable
              key={r.id}
              accessibilityRole="button"
              accessibilityLabel={`Room ${r.room}, ${r.display_name}`}
              onPress={() => router.push(`/(staff)/resident/${r.id}`)}
              style={({ pressed }) => [
                {
                  width: '47.5%',
                  backgroundColor: c.wash,
                  borderRadius: radius.tile,
                  padding: sp(3.5),
                  minHeight: 108,
                  borderWidth: r.state === 'alerting' ? 2 : 1,
                  borderColor: r.state === 'alerting' ? palette.rust : palette.line,
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Txt kind="title" style={{ color: c.fg }}>{r.room}</Txt>
              <Txt kind="label" style={{ marginTop: sp(1) }}>
                {r.display_name.split(' ')[0]}
              </Txt>
              <Txt kind="caption" tone="muted" style={{ marginTop: 2 }} numberOfLines={1}>
                {r.location ? (inOwnRoom ? 'In room' : r.location.label) : 'No signal'}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}
