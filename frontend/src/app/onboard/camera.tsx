// Where the camera goes. Four rooms, and only four — bedroom and bathroom are
// not options here, are not options on the wire (the API returns 422 for
// them), and there is no admin override (§5.1). A picker that could offer them
// would be the bug; this one cannot.
//
// The room chosen here is installer config. It rides on events for the
// baseline learner and never reaches a family screen as "where she is" (D-001).
import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { Btn, Card, Chip, Field, Row, Screen, Txt } from '@/components';
import { Icon } from '@/components/icon';
import { api } from '@/lib/api';
import { palette, sp } from '@/theme/tokens';
import { useSession } from '@/store/session';
import type { CameraZone } from '@/lib/types';

const ROOMS: { zone: CameraZone; label: string }[] = [
  { zone: 'kitchen', label: 'Kitchen' },
  { zone: 'living_room', label: 'Living room' },
  { zone: 'dining_room', label: 'Dining room' },
  { zone: 'hallway', label: 'Hallway' },
];

const CHECKLIST = [
  'It cannot see into a bedroom or bathroom, even through an open doorway.',
  'If a private door is in view, mask it on the computer first. Masked pixels never reach the detector.',
  'Point it at where she usually sits.',
  'She knows it is there, and knows she can pause it for two hours from the computer.',
];

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'online'; inView: boolean }
  | { kind: 'unreachable'; message: string };

export default function Camera() {
  const { residentId, camera, setCamera } = useSession();
  const [checked, setChecked] = useState<boolean[]>(CHECKLIST.map(() => false));
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  const allChecked = checked.every(Boolean);
  const ready = camera.zone != null && allChecked;

  // Polls GET /presence for up to 20 s. Never a preview — no endpoint returns
  // image bytes, and the API process never has one to return.
  const runTest = async () => {
    setTest({ kind: 'testing' });
    const deadline = Date.now() + 20_000;
    let lastError = 'Not reachable.';
    while (Date.now() < deadline) {
      try {
        const p = await api.getPresence(residentId);
        if (p.status === 'no_camera') {
          lastError = 'No camera is running on her computer yet.';
        } else if (p.camera.online) {
          setTest({ kind: 'online', inView: p.status === 'in_view' });
          return;
        } else {
          lastError = 'The camera is set up but is not running right now.';
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : 'Not reachable.';
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    setTest({ kind: 'unreachable', message: lastError });
  };

  return (
    <Screen>
      <Txt kind="display" accessibilityRole="header">Which room is the camera in?</Txt>
      <Row gap={2} style={{ flexWrap: 'wrap', marginTop: sp(5) }}>
        {ROOMS.map((r) => (
          <Chip
            key={r.zone}
            label={r.label}
            selected={camera.zone === r.zone}
            onPress={() => setCamera({ zone: r.zone })}
          />
        ))}
      </Row>

      <Field
        label="How is the room laid out?"
        value={camera.zoneHint}
        onChangeText={(zoneHint) => setCamera({ zoneHint })}
        placeholder="The dining table is on the left, her armchair by the window on the right."
        hint="So Dhyaan can name her spot: her armchair, the table."
        multiline
        maxLength={300}
        style={{ marginTop: sp(6) }}
      />

      <Card style={{ marginTop: sp(6) }}>
        <Txt kind="label">Before you point it anywhere, check each of these</Txt>
        {CHECKLIST.map((line, i) => (
          <Row
            key={line}
            gap={2}
            style={{ marginTop: sp(3), alignItems: 'flex-start' }}
          >
            <Chip
              label={checked[i] ? 'Checked' : 'Confirm'}
              selected={checked[i]}
              onPress={() => setChecked((c) => c.map((v, j) => (j === i ? !v : v)))}
            />
            <Txt kind="caption" tone="muted" style={{ flex: 1 }}>{line}</Txt>
          </Row>
        ))}
      </Card>

      <View style={{ marginTop: sp(6), gap: sp(2) }}>
        <Btn
          kind="quiet"
          label="Test the camera"
          busy={test.kind === 'testing'}
          onPress={runTest}
        />
        {test.kind === 'idle' && (
          <Txt kind="caption" tone="muted">{/* voice-ok */}
            Start the camera on her computer first.
          </Txt>
        )}
        {test.kind === 'testing' && (
          <Txt kind="caption" tone="muted">Listening for up to 20 seconds…</Txt>
        )}
        {test.kind === 'online' && (
          <Row gap={2}>
            <Icon name="checkmark.circle" size={14} color={palette.moss} />
            <Txt kind="caption" tone="ok">
              {test.inView
                ? 'Camera online, someone in view.'
                : 'Camera online, nothing in view yet.'}
            </Txt>
          </Row>
        )}
        {test.kind === 'unreachable' && (
          <View style={{ gap: sp(1) }}>
            <Txt kind="caption" tone="warn">Not reachable. {test.message}</Txt>
            <Txt kind="caption" tone="muted">{/* voice-ok */}
              You can finish setup without it and test later.
            </Txt>
          </View>
        )}
      </View>

      <Btn
        label="Continue"
        disabled={!ready}
        style={{ marginTop: sp(6) }}
        onPress={() => router.push('/onboard/contacts')}
      />
      {!ready && (
        <Txt kind="caption" tone="muted" style={{ marginTop: sp(2) }}>{/* voice-ok */}
          {camera.zone == null
            ? 'Pick the room the camera is in.'
            : 'Confirm each line of the checklist.'}
        </Txt>
      )}
    </Screen>
  );
}
