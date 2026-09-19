// Room survey (§7.2): 30 seconds of walking per room teaches Dhyaan what each
// room sounds like in radio.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Btn, Card, Row, Screen, Txt } from '@/components';
import { api } from '@/lib/api';
import { homeZones } from '@/lib/mock/data';
import { sp } from '@/theme/tokens';
import { useSession } from '@/store/session';

type RoomState =
  | { kind: 'idle' }
  | { kind: 'surveying'; left: number; anchors: number }
  | { kind: 'done'; anchors: number };

const SURVEY_S = 30;

export default function Survey() {
  const { residentName } = useSession();
  const [rooms, setRooms] = useState<Record<string, RoomState>>(
    Object.fromEntries(homeZones.map((z) => [z.id, { kind: 'idle' }])),
  );
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const doneCount = Object.values(rooms).filter((r) => r.kind === 'done').length;
  const surveying = Object.values(rooms).some((r) => r.kind === 'surveying');

  const start = async (zoneId: string) => {
    await api.surveyRoom(zoneId);
    setRooms((r) => ({ ...r, [zoneId]: { kind: 'surveying', left: SURVEY_S, anchors: 2 } }));
    timer.current = setInterval(() => {
      setRooms((r) => {
        const s = r[zoneId];
        if (s.kind !== 'surveying') return r;
        if (s.left <= 1) {
          if (timer.current) clearInterval(timer.current);
          api.surveyStop(zoneId).then(({ n_anchors }) =>
            setRooms((r2) => ({ ...r2, [zoneId]: { kind: 'done', anchors: n_anchors } })),
          );
          return r;
        }
        return {
          ...r,
          [zoneId]: {
            kind: 'surveying',
            left: s.left - 1,
            anchors: Math.min(6, 2 + Math.floor((SURVEY_S - s.left) / 6)),
          },
        };
      });
    }, 1000);
  };

  return (
    <Screen>
      <Txt kind="title">Walk each room with the band</Txt>
      <Txt kind="body" tone="muted" style={{ marginTop: sp(2) }}>
        Take the band to a room, press start, and walk around for 30 seconds. That is
        how Dhyaan learns which room {residentName} is in.
      </Txt>

      <View style={{ marginTop: sp(5), gap: sp(3) }}>
        {homeZones.map((z) => {
          const s = rooms[z.id];
          return (
            <Card key={z.id}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt kind="label">{z.label}</Txt>
                {s.kind === 'done' && <Txt kind="caption" tone="ok">Mapped · {s.anchors} anchors</Txt>}
                {s.kind === 'surveying' && (
                  <Txt kind="stat" tone="slate" style={{ fontSize: 22, lineHeight: 26 }}>{s.left}s</Txt>
                )}
              </Row>
              {s.kind === 'surveying' && (
                <Txt kind="caption" tone="muted" style={{ marginTop: sp(1) }}>
                  Keep walking… {s.anchors} anchors heard
                </Txt>
              )}
              {s.kind === 'idle' && (
                <Btn
                  kind="quiet"
                  label="Start 30-second walk"
                  disabled={surveying}
                  onPress={() => start(z.id)}
                  style={{ marginTop: sp(3), minHeight: 44 }}
                />
              )}
            </Card>
          );
        })}
      </View>

      <Txt kind="caption" tone="muted" style={{ marginTop: sp(4) }}>
        Three rooms is enough to start — Dhyaan keeps refining as she lives her days.
        You can map the rest anytime from Settings.
      </Txt>

      <View style={{ marginTop: sp(5) }}>
        <Btn
          label={doneCount >= 3 ? 'Continue' : `Map ${3 - doneCount} more room${3 - doneCount === 1 ? '' : 's'}`}
          disabled={doneCount < 3}
          onPress={() => router.push('/onboard/contacts')}
        />
      </View>
    </Screen>
  );
}
