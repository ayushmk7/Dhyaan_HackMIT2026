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
//     function of the countdown timer: a number drawn from a clock and
//     labelled as radio.
//
// The rooms are rows on the paper, not cards. The room being walked right now
// is the one thing on the screen: it lifts onto a tinted plate and the
// countdown is set in the readout face. Every other row ends in a real
// button, because "Map this room" is the thing to do here and a line of text
// did not look like it.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import {
  Btn, DataLabel, Entrance, Row, Rule, Screen, Txt,
} from '@/components';
import { api } from '@/lib/api';
import { onboard } from '@/lib/copy/staff';
import { homeZones } from '@/lib/mock/data';
import { radius, sp, useTheme } from '@/theme';
import { useSession } from '@/store/session';
import { StepHeader } from './_layout';

const copy = onboard.survey;

type RoomState =
  | { kind: 'idle' }
  | { kind: 'surveying'; left: number }
  | { kind: 'done'; scans: number; warning: string | null }
  | { kind: 'failed'; message: string };

const SURVEY_S = 30;
/** How many rooms must be mapped before the family may move on. */
const ROOMS_NEEDED = 3;

export default function Survey() {
  const t = useTheme();
  const { residentName, grants } = useSession();
  const [rooms, setRooms] = useState<Record<string, RoomState>>(
    Object.fromEntries(homeZones.map((z) => [z.id, { kind: 'idle' }])),
  );
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const set = (zoneId: string, s: RoomState) => setRooms((r) => ({ ...r, [zoneId]: s }));

  const doneCount = Object.values(rooms).filter((r) => r.kind === 'done').length;
  const surveying = Object.values(rooms).some((r) => r.kind === 'surveying');
  const remaining = ROOMS_NEEDED - doneCount;

  const stop = async (zoneId: string) => {
    try {
      const { n_scans, warning } = await api.surveyStop(zoneId);
      set(zoneId, { kind: 'done', scans: n_scans, warning });
    } catch (e) {
      set(zoneId, {
        kind: 'failed',
        message: e instanceof Error ? e.message : copy.stopError,
      });
    }
  };

  const start = async (zoneId: string) => {
    try {
      await api.surveyRoom(zoneId);
    } catch (e) {
      set(zoneId, {
        kind: 'failed',
        message: e instanceof Error ? e.message : copy.startError,
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
      native
      wash
      floatingBar={
        <Btn
          label={remaining <= 0 ? copy.continue : copy.mapMore(remaining)}
          disabled={remaining > 0}
          onPress={() => router.push(grants.camera ? '/onboard/camera' : '/onboard/contacts')}
        />
      }
    >
      <Entrance index={0}>
        <StepHeader
          step="survey"
          grants={grants}
          title={copy.title}
          meta={copy.progress(doneCount, ROOMS_NEEDED)}
          purpose={copy.intro(residentName)}
        />
      </Entrance>

      <View style={{ marginTop: sp(4) }}>
        {homeZones.map((z, i) => {
          const s = rooms[z.id];
          const live = s.kind === 'surveying';
          return (
            <Entrance key={z.id} index={1 + i}>
              {i > 0 && !live && <Rule weight="hair" />}
              <View
                style={live ? {
                  marginVertical: sp(2),
                  padding: sp(4.5),
                  borderRadius: radius.glass,
                  backgroundColor: t.accentWash,
                } : { paddingVertical: sp(3) }}
              >
                <Row style={{ justifyContent: 'space-between', alignItems: 'center' }} gap={3}>
                  <View style={{ flex: 1 }}>
                    <Txt kind={live ? 'title' : 'label'}>{z.label}</Txt>
                    {s.kind === 'done' && (
                      <Txt
                        kind="caption"
                        tone={s.warning ? 'warn' : 'muted'}
                        style={{ marginTop: sp(0.5) }}
                      >
                        {s.warning ?? copy.stored}
                      </Txt>
                    )}
                    {s.kind === 'failed' && (
                      <Txt kind="caption" style={{ marginTop: sp(0.5), fontWeight: '600' }}>
                        {s.message}
                      </Txt>
                    )}
                  </View>
                  {s.kind === 'idle' && (
                    <Btn kind="quiet" size="small" label={copy.mapRoom} disabled={surveying} onPress={() => start(z.id)} />
                  )}
                  {s.kind === 'done' && !s.warning && (
                    <DataLabel value={String(s.scans)}>{copy.readings}</DataLabel>
                  )}
                  {s.kind === 'done' && !!s.warning && (
                    <Btn kind="quiet" size="small" label={copy.walkAgain} disabled={surveying} onPress={() => start(z.id)} />
                  )}
                  {s.kind === 'failed' && (
                    <Btn kind="quiet" size="small" label={copy.tryAgain} disabled={surveying} onPress={() => start(z.id)} />
                  )}
                </Row>

                {live && (
                  <>
                    <Txt kind="readout" style={{ marginTop: sp(3) }}>{copy.secondsLeft(s.left)}</Txt>
                    <Txt kind="caption" tone="muted" style={{ marginTop: sp(2) }}>
                      {copy.walking}
                    </Txt>
                  </>
                )}
              </View>
            </Entrance>
          );
        })}
      </View>

      <Entrance index={1 + homeZones.length} style={{ marginTop: sp(6), gap: sp(3) }}>
        {/* Why the button is still grey, or why the other rooms are. */}
        {surveying ? (
          <Txt kind="body" accessibilityLiveRegion="polite">{copy.oneAtATime}</Txt>
        ) : remaining > 0 ? (
          <Txt kind="body" accessibilityLiveRegion="polite">{copy.needMore(remaining)}</Txt>
        ) : null}
        <Txt kind="caption" tone="muted">{/* voice-ok */}
          {copy.honesty}
        </Txt>
      </Entrance>
    </Screen>
  );
}
