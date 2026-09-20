// Where the camera goes. Four rooms, and only four: bedroom and bathroom are
// not options here, are not options on the wire (the API returns 422 for
// them), and there is no admin override (§5.1). A picker that could offer them
// would be the bug; this one cannot.
//
// The room chosen here is installer config. It rides on events for the
// baseline learner and never reaches a family screen as "where she is" (D-001).
//
// The question owns the screen: the title and the four rooms under it. The
// layout note, the checklist and the test are quieter, in that order, and
// none of them sits in a card. The checklist lines are the rows; the
// confirmation is a 44pt choice at the end of each.
import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import {
  Btn, Entrance, ErrorState, Field, Row, Rule, Screen, Txt,
} from '@/components';
import { Icon } from '@/components/icon';
import { api } from '@/lib/api';
import { onboard } from '@/lib/copy/staff';
import { sp, useTheme } from '@/theme';
import { useSession } from '@/store/session';
import type { CameraZone } from '@/lib/types';
import { ChoiceChip, StepHeader } from './_layout';

const copy = onboard.camera;

/** The zones a camera may be placed in, in the order they are offered. */
const ROOMS = ['kitchen', 'living_room', 'dining_room', 'hallway'] as const satisfies readonly CameraZone[];

const CHECKLIST = copy.checklist;

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'online'; inView: boolean }
  | { kind: 'unreachable'; message: string };

export default function Camera() {
  const t = useTheme();
  const { residentId, camera, setCamera, grants } = useSession();
  const [checked, setChecked] = useState<boolean[]>(CHECKLIST.map(() => false));
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  const unchecked = checked.filter((v) => !v).length;
  const ready = camera.zone != null && unchecked === 0;

  // Polls GET /presence for up to 20 s. Never a preview: no endpoint returns
  // image bytes, and the API process never has one to return.
  const runTest = async () => {
    setTest({ kind: 'testing' });
    const deadline = Date.now() + 20_000;
    let lastError: string = copy.notReachable;
    while (Date.now() < deadline) {
      try {
        const p = await api.getPresence(residentId);
        if (p.status === 'no_camera') {
          lastError = copy.noCameraYet;
        } else if (p.camera.online) {
          setTest({ kind: 'online', inView: p.status === 'in_view' });
          return;
        } else {
          lastError = copy.notRunning;
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : copy.notReachable;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    setTest({ kind: 'unreachable', message: lastError });
  };

  return (
    <Screen
      native
      wash
      floatingBar={
        <Btn label={copy.continue} disabled={!ready} onPress={() => router.push('/onboard/contacts')} />
      }
    >
      <Entrance index={0}>
        <StepHeader step="camera" grants={grants} title={copy.title} purpose={copy.purpose} />
        <Row gap={2} style={{ flexWrap: 'wrap', marginTop: sp(4) }}>
          {ROOMS.map((zone) => (
            <ChoiceChip
              key={zone}
              label={copy.rooms[zone]}
              selected={camera.zone === zone}
              onPress={() => setCamera({ zone })}
            />
          ))}
        </Row>
      </Entrance>

      <Entrance index={1}>
        <Field
          label={copy.layoutLabel}
          value={camera.zoneHint}
          onChangeText={(zoneHint) => setCamera({ zoneHint })}
          placeholder={copy.layoutPlaceholder}
          hint={copy.layoutHint}
          multiline
          maxLength={300}
          style={{ marginTop: sp(7) }}
        />
      </Entrance>

      <Entrance index={2} style={{ marginTop: sp(7) }}>
        <Txt kind="label">{copy.checklistTitle}</Txt>
        {CHECKLIST.map((line, i) => (
          <React.Fragment key={line}>
            {i > 0 && <Rule weight="hair" />}
            <Row gap={3} style={{ paddingVertical: sp(3), alignItems: 'center' }}>
              <Txt kind="body" tone={checked[i] ? 'ink' : 'muted'} style={{ flex: 1 }}>{line}</Txt>
              <ChoiceChip
                label={checked[i] ? copy.checked : copy.confirm}
                selected={checked[i]}
                onPress={() => setChecked((c) => c.map((v, j) => (j === i ? !v : v)))}
              />
            </Row>
          </React.Fragment>
        ))}
      </Entrance>

      <Entrance index={3} style={{ marginTop: sp(5), gap: sp(2) }}>
        <Btn
          kind="quiet"
          label={copy.test}
          busy={test.kind === 'testing'}
          onPress={runTest}
        />
        {test.kind === 'idle' && (
          <Txt kind="caption" tone="muted">{/* voice-ok */}
            {copy.startFirst}
          </Txt>
        )}
        {test.kind === 'testing' && (
          <Txt kind="caption" tone="muted" accessibilityLiveRegion="polite">{copy.listening}</Txt>
        )}
        {test.kind === 'online' && (
          <Row gap={2}>
            {/* OK has no colour: the tick is ink. */}
            <Icon name="checkmark.circle" size={14} color={t.ink} />
            <Txt kind="caption" tone="ok" accessibilityLiveRegion="polite">
              {test.inView ? copy.onlineInView : copy.onlineEmpty}
            </Txt>
          </Row>
        )}
        {test.kind === 'unreachable' && (
          <View style={{ gap: sp(1) }}>
            <ErrorState inline message={copy.notReachableWith(test.message)} onRetry={runTest} />
            <Txt kind="caption" tone="muted">{/* voice-ok */}
              {copy.finishLater}
            </Txt>
          </View>
        )}
      </Entrance>

      {!ready && (
        // Why the button is still grey, in ink, above it.
        <Entrance index={4}>
          <Txt kind="body" accessibilityLiveRegion="polite" style={{ marginTop: sp(5) }}>{/* voice-ok */}
            {camera.zone == null ? copy.pickRoom : copy.confirmChecklist(unchecked)}
          </Txt>
        </Entrance>
      )}
    </Screen>
  );
}
