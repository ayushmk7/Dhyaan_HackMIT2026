// Room survey (§7.2): 30 seconds of walking per room teaches Dhyaan what each
// room sounds like in radio.
//
// What this screen may show, and what it may not:
//   - It MAY show the countdown, and the numbers the SERVER reports when the
//     survey stops: how many readings it stored, and its own warning when it
//     did not get enough.
//   - It may NOT show an anchor count. A phone in Expo's managed workflow has
//     no wifi or BLE scan API (see lib/http.ts's surveyRoom), so nothing on
//     this device has heard a single beacon. The old "N anchors heard" was a
//     function of the countdown timer — a number drawn from a clock and
//     labelled as radio.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import {
  Btn, Card, DataLabel, Entrance, Marquee, Row, Rule, Screen, Txt,
} from '@/components';
import { api } from '@/lib/api';
import { homeZones } from '@/lib/mock/data';
import { sp } from '@/theme/tokens';
import { useSession } from '@/store/session';

type RoomState =
  | { kind: 'idle' }
  | { kind: 'surveying'; left: number }
  | { kind: 'done'; scans: number; warning: string | null }
  | { kind: 'failed'; message: string };

const SURVEY_S = 30;

export default function Survey() {
  const { residentName, grants } = useSession();
  const [rooms, setRooms] = useState<Record<string, RoomState>>(
    Object.fromEntries(homeZones.map((z) => [z.id, { kind: 'idle' }])),
  );
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const set = (zoneId: string, s: RoomState) => setRooms((r) => ({ ...r, [zoneId]: s }));

  const doneCount = Object.values(rooms).filter((r) => r.kind === 'done').length;
  const surveying = Object.values(rooms).some((r) => r.kind === 'surveying');

  const stop = async (zoneId: string) => {
    try {
      const { n_scans, warning } = await api.surveyStop(zoneId);
      set(zoneId, { kind: 'done', scans: n_scans, warning });
    } catch (e) {
      set(zoneId, {
        kind: 'failed',
        message: e instanceof Error ? e.message : 'Her hub didn’t confirm that walk.',
      });
    }
  };

  const start = async (zoneId: string) => {
    try {
      await api.surveyRoom(zoneId);
    } catch (e) {
      set(zoneId, {
        kind: 'failed',
        message: e instanceof Error ? e.message : 'Couldn’t start. Is her hub running?',
      });
      return;
    }
    // The countdown lives in this closure, not in the state updater: firing
    // surveyStop from inside a setState callback fires it twice under React's
    // double-invoked updaters.
    let left = SURVEY_S;
    set(zoneId, { kind: 'surveying', left });
    timer.current = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        if (timer.current) clearInterval(timer.current);
        stop(zoneId);
        return;
      }
      set(zoneId, { kind: 'surveying', left });
    }, 1000);
  };

  return (
    <Screen
      wash
      floatingBar={
        <Btn
          label={doneCount >= 3 ? 'Continue' : `Map ${3 - doneCount} more room${3 - doneCount === 1 ? '' : 's'}`}
          disabled={doneCount < 3}
          onPress={() => router.push(grants.camera ? '/onboard/camera' : '/onboard/contacts')}
        />
      }
    >
      <Entrance index={0}>
        <Marquee first title="Walk each room with the band" meta={`${doneCount}/3`} />
        <Txt kind="body">
          30 seconds per room teaches Dhyaan where {residentName} is.
        </Txt>
        <Txt kind="caption" tone="muted" style={{ marginTop: sp(3) }}>{/* voice-ok */}
          This phone cannot read radio signal strength, so what it sends is only the
          timing of each reading. Her band’s own readings are what teach the map.
        </Txt>
      </Entrance>

      <View style={{ marginTop: sp(5), gap: sp(3) }}>
        {homeZones.map((z, i) => {
          const s = rooms[z.id];
          return (
            <Entrance key={z.id} index={1 + i}>
              <Card>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Txt kind="label">{z.label}</Txt>
                  {s.kind === 'surveying' && (
                    <Txt kind="data">{s.left}s</Txt>
                  )}
                  {s.kind === 'done' && (
                    <DataLabel value={String(s.scans)}>Readings</DataLabel>
                  )}
                </Row>

                {s.kind === 'surveying' && (
                  <>
                    <Rule style={{ marginTop: sp(2.5) }} />
                    <Txt kind="caption" style={{ marginTop: sp(2) }}>
                      Walking now. A reading goes to her hub every two seconds.
                    </Txt>
                  </>
                )}

                {s.kind === 'done' && (
                  <>
                    <Rule style={{ marginTop: sp(2.5) }} />
                    <Txt
                      kind="caption"
                      tone={s.warning ? 'warn' : 'ok'}
                      style={{ marginTop: sp(2) }}
                    >
                      {s.warning ?? 'Her hub stored this walk.'}
                    </Txt>
                    {!!s.warning && (
                      <Btn
                        kind="quiet"
                        label="Walk it again"
                        disabled={surveying}
                        onPress={() => start(z.id)}
                        style={{ marginTop: sp(3), minHeight: 44 }}
                      />
                    )}
                  </>
                )}

                {s.kind === 'failed' && (
                  <>
                    <Txt kind="caption" tone="alert" style={{ marginTop: sp(2) }}>
                      {s.message}
                    </Txt>
                    <Btn
                      kind="quiet"
                      label="Try this room again"
                      disabled={surveying}
                      onPress={() => start(z.id)}
                      style={{ marginTop: sp(3), minHeight: 44 }}
                    />
                  </>
                )}

                {s.kind === 'idle' && (
                  <Btn
                    kind="quiet"
                    label="Map this room"
                    disabled={surveying}
                    onPress={() => start(z.id)}
                    style={{ marginTop: sp(3), minHeight: 44 }}
                  />
                )}
              </Card>
            </Entrance>
          );
        })}
      </View>
    </Screen>
  );
}
