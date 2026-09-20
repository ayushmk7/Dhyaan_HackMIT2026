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
// none of them sits in a card. The checklist is four lines and ONE 44pt
// confirmation under them: four chips down the right edge were four buttons
// competing with the question. The explanatory paragraph under the title, the
// hint under the layout field, the "start the camera first" caption and the
// tick glyph beside the online line are gone.
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  Btn, Entrance, ErrorState, Field, Icon, Row, Rule, Screen, Txt,
} from '@/components';
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
  // One confirmation per line, not one for all four. The declutter pass
  // collapsed these into a single "I have checked all four", which is the
  // pattern that produces click-through: the fourth line is not an
  // installation detail, it is a claim that SHE knows the camera is there and
  // knows she can pause it, and PRODUCT_SPEC §8.4 requires that be taken from
  // her in plain language. Four taps is the point, not friction to be removed.
  const [checked, setChecked] = useState<boolean[]>(() => copy.checklist.map(() => false));
  const allChecked = checked.every(Boolean);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  const ready = camera.zone != null && allChecked;

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
        <StepHeader step="camera" grants={grants} title={copy.title} />
        <Row gap={2} style={{ flexWrap: 'wrap', marginTop: sp(8) }}>
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
          multiline
          maxLength={300}
          style={{ marginTop: sp(10) }}
        />
      </Entrance>

      <Entrance index={2} style={{ marginTop: sp(10) }}>
        <Txt kind="label">{copy.checklistTitle}</Txt>
        <View style={{ marginTop: sp(2) }}>
          {CHECKLIST.map((line, i) => (
            <React.Fragment key={line}>
              {i > 0 && <Rule weight="hair" />}
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: checked[i] }}
                accessibilityLabel={line}
                onPress={() => setChecked((v) => v.map((c, j) => (j === i ? !c : c)))}
                style={{ paddingVertical: sp(3), minHeight: 44, justifyContent: 'center' }}
              >
                <Row gap={2.5} style={{ alignItems: 'flex-start' }}>
                  <Icon
                    name={checked[i] ? 'checkmark.circle.fill' : 'circle'}
                    size={20}
                    color={checked[i] ? t.accent : t.inkFaint}
                  />
                  <Txt kind="body" tone={checked[i] ? 'ink' : 'muted'} style={{ flex: 1 }}>{line}</Txt>
                </Row>
              </Pressable>
            </React.Fragment>
          ))}
        </View>
      </Entrance>

      <Entrance index={3} style={{ marginTop: sp(10), gap: sp(2) }}>
        <Btn
          kind="quiet"
          label={copy.test}
          busy={test.kind === 'testing'}
          onPress={runTest}
        />
        {test.kind === 'testing' && (
          <Txt kind="caption" tone="muted" accessibilityLiveRegion="polite">{copy.listening}</Txt>
        )}
        {test.kind === 'online' && (
          <Txt kind="caption" accessibilityLiveRegion="polite">
            {test.inView ? copy.onlineInView : copy.onlineEmpty}
          </Txt>
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
          <Txt kind="body" accessibilityLiveRegion="polite" style={{ marginTop: sp(8) }}>{/* voice-ok */}
            {camera.zone == null ? copy.pickRoom : copy.confirmChecklist}
          </Txt>
        </Entrance>
      )}
    </Screen>
  );
}
