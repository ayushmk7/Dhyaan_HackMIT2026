// Settings, cut to what a hand actually reaches for: her name, the two rows
// that are the consent surface — her camera, and the record of what she agreed
// to — and, apart from all of it at the bottom under a heavy rule, the two
// buttons that undo it all.
//
// What was here and is gone: the notes Dhyaan was told and their add / edit /
// delete form, the statement of what happens when something happens, the call
// ladder, the care file row (Her day already opens it) and the JSON share.
// None of them were things a person touches while standing in front of this
// screen, and every one of them was a paragraph in the way of the two that are.
//
// The two rows that remain stand open. With only two of them, hiding either
// behind a tap buys nothing and costs the one thing this screen is for: seeing
// what she agreed to without asking for it.
//
// Every control here does exactly what its label says:
//   - Stop the camera turns consent off at the server; the worker stops within
//     ten seconds.
//   - Forget her profile deletes every fact, observation and camera event, and
//     makes you type her name first, because it cannot be undone.
//   - Delete everything and stop Dhyaan does that, AND turns all three consents
//     off, AND signs this phone out. Same typed-name gesture.
// The native header owns the title; long-press the heading for debug.
//
// Every sentence this screen says lives in lib/copy/family.ts under `settings`.
import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  Btn, Card, DataLabel, Entrance, ErrorState, Field, KeyValue, LoadingState, Row, RowGroup, Rule,
  Screen, Txt,
} from '@/components';
import { api } from '@/lib/api';
import { API_BASE, USE_MOCKS } from '@/lib/config';
import { family } from '@/lib/copy/family';
import { ago, timeOf, zoneLabel } from '@/lib/format';
import { useProfile } from '@/lib/hooks';
import { registerForPush, sendTestPush } from '@/lib/push';
import { useSession } from '@/store/session';
import { sp } from '@/theme/tokens';

const copy = family.settings;

// app.json's extra.eas.projectId. `npx eas init` writes the real one; until it
// does, push registration cannot succeed and the button says so rather than
// failing quietly. lib/push.ts refuses on exactly this prefix.
const EAS_PROJECT_ID = String(
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? '',
);
const PUSH_READY = EAS_PROJECT_ID.length > 0 && !EAS_PROJECT_ID.startsWith('REPLACE');

const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

// Screen-only debug view, long-press the heading to reveal. Every demo control
// lives here so the visible app carries no demo chrome.
function DebugPanel() {
  const d = copy.debug;
  const qc = useQueryClient();
  // The test push names whoever this install is actually watching, rather than
  // the seed's resident.
  const { setRole, residentId, residentName } = useSession();
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, []);
  const lastSuccess = Math.max(
    0,
    ...qc.getQueryCache().getAll().map((q) => q.state.dataUpdatedAt || 0),
  );
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [rehearsing, setRehearsing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await qc.fetchQuery({ queryKey: ['debug_ping'], queryFn: api.getContacts, staleTime: 0 });
      setTestResult(d.reached(new Date().toLocaleTimeString()));
    } catch (e) {
      setTestResult(d.failed(errorText(e, d.unknownError)));
    } finally {
      setTesting(false);
    }
  };

  const rehearse = async () => {
    setRehearsing(true);
    setNote(null);
    try {
      await api.simulate('fall');
    } catch (e) {
      setNote(errorText(e, d.rehearsalError));
    } finally {
      setRehearsing(false);
    }
  };

  // No silent failure: without a real EAS project id this cannot work, so the
  // button carries the reason in its own label and the panel prints the id.
  const registerPush = async () => {
    if (!PUSH_READY) {
      setNote(d.easMissing(EAS_PROJECT_ID));
      return;
    }
    const { token, reason } = await registerForPush();
    setPushToken(token);
    setNote(token ? d.pushRegistered(token.slice(-8)) : reason ?? null);
  };

  // The on-stage fallback (§10.1): posts a canned observation sequence through
  // the real ingest path if the webcam misbehaves.
  const simulate = async (kind: 'meal' | 'visitor' | 'out_of_view') => {
    setSimulating(true);
    try {
      await api.simulateCamera(kind);
      await qc.invalidateQueries();
      setTestResult(d.simulated(kind));
    } catch (e) {
      setTestResult(d.failed(errorText(e, d.unknownError)));
    } finally {
      setSimulating(false);
    }
  };

  return (
    <Card style={{ marginBottom: sp(3) }}>
      <Rule weight="heavy" />
      <View style={{ gap: sp(1.5), marginTop: sp(3) }}>
        {/* The readings are the machine's own identifiers, not words. */}
        <DataLabel value={USE_MOCKS ? 'mock' : 'live'}>{d.mode}</DataLabel>
        <DataLabel value={API_BASE}>{d.apiBase}</DataLabel>
        <DataLabel value={lastSuccess ? ago(new Date(lastSuccess).toISOString()) : d.noneYet}>
          {d.lastOk}
        </DataLabel>
        <DataLabel value={PUSH_READY ? EAS_PROJECT_ID : d.unset}>{d.easProject}</DataLabel>
      </View>
      {/* Stacked, not a row: side-by-side buttons clip their labels at SE width. */}
      <View style={{ gap: sp(2), marginTop: sp(3) }}>
        <Btn label={d.testConnection} kind="quiet" busy={testing} onPress={testConnection} />
        <Btn label={d.rehearseFall} kind="quiet" busy={rehearsing} onPress={rehearse} />
        <Btn label={d.simulateMeal} kind="quiet" busy={simulating} onPress={() => simulate('meal')} />
        <Btn label={d.simulateVisitor} kind="quiet" busy={simulating} onPress={() => simulate('visitor')} />
        <Btn label={d.simulateOutOfView} kind="quiet" busy={simulating} onPress={() => simulate('out_of_view')} />
        <Btn
          label={PUSH_READY ? d.registerPush : d.pushNeedsId}
          kind="quiet"
          onPress={registerPush}
        />
        {pushToken && (
          <Btn label={d.sendTestPush} kind="quiet" onPress={() => sendTestPush(pushToken, { id: residentId, name: residentName })} />
        )}
        <Btn
          label={d.staffSide}
          kind="quiet"
          onPress={() => { setRole('staff'); router.replace('/(staff)/triage'); }}
        />
      </View>
      {testResult && <Txt kind="caption" tone="muted" style={{ marginTop: sp(2) }}>{testResult}</Txt>}
      {note && <Txt kind="caption" tone="muted" style={{ marginTop: sp(1) }}>{note}</Txt>}
    </Card>
  );
}

/**
 * One row of the plate: a small label with an optional machine reading on the
 * right, the sentence under it, and whatever the row lets you do beneath that.
 * No glyph beside the label; the label names the thing.
 */
function SettingRow({ label, reading, sentence, children }: {
  label: string; reading?: string; sentence: string; children?: React.ReactNode;
}) {
  return (
    <View style={{ paddingVertical: sp(4), gap: sp(2) }}>
      <Row style={{ justifyContent: 'space-between' }} gap={3}>
        <Txt kind="tag" tone="muted" style={{ flexShrink: 1 }}>{label}</Txt>
        {!!reading && <Txt kind="stamp" tone="muted">{reading}</Txt>}
      </Row>
      <Txt kind="body">{sentence}</Txt>
      {children}
    </View>
  );
}

export default function Settings() {
  const qc = useQueryClient();
  const {
    residentId, residentName, consentGivenBy, consentRelationship, reset,
  } = useSession();
  const {
    data: profile, isLoading: profileLoading, isError: profileError, refetch: refetchProfile,
  } = useProfile(residentId);

  const [confirmStop, setConfirmStop] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Two irreversible controls, one typed-name gesture each, never both open.
  const [destructive, setDestructive] = useState<'none' | 'forget' | 'wipe'>('none');
  const [confirmName, setConfirmName] = useState('');
  const [forgetBusy, setForgetBusy] = useState(false);
  const [forgetError, setForgetError] = useState<string | null>(null);
  const [forgetResult, setForgetResult] = useState<string | null>(null);

  const [debugOpen, setDebugOpen] = useState(false);

  const name = profile?.name ?? residentName;
  // The server's consent record is the record. The session copy only exists
  // for the minutes between signing and the profile being saved.
  const signedBy = profile?.consent.signed_by || consentGivenBy;
  const relationship = profile?.consent.relationship || consentRelationship;
  const nameTyped = confirmName.trim().toLowerCase() === name.toLowerCase();

  const openDestructive = (which: 'forget' | 'wipe') => {
    setDestructive(which);
    setConfirmName('');
    setForgetError(null);
  };

  const stopCamera = async () => {
    setCameraBusy(true);
    setCameraError(null);
    try {
      await api.putProfile(residentId, { consent: { camera: false } });
      await qc.invalidateQueries();
      setConfirmStop(false);
    } catch {
      setCameraError(copy.camera.stopError);
    } finally {
      setCameraBusy(false);
    }
  };

  const forget = async () => {
    setForgetBusy(true);
    setForgetError(null);
    try {
      const deleted = await api.deleteMemory(residentId, 'all', confirmName);
      setForgetResult(copy.profile.forgot(deleted.profile_facts, deleted.observations, deleted.camera_events));
      setDestructive('none');
      setConfirmName('');
      await qc.invalidateQueries();
    } catch {
      setForgetError(copy.profile.nothingDeleted);
    } finally {
      setForgetBusy(false);
    }
  };

  // Delete, THEN stop — deleting first is what returns real counts (turning
  // consent_memory off server-side already deletes the facts, §4.5). If the
  // second call fails the message says exactly how far it got, rather than
  // claiming a clean stop.
  const wipeAndStop = async () => {
    setForgetBusy(true);
    setForgetError(null);
    try {
      const deleted = await api.deleteMemory(residentId, 'all', confirmName);
      try {
        await api.putProfile(residentId, {
          consent: { falls: false, camera: false, memory: false },
        });
      } catch {
        setForgetError(copy.profile.stillRunning(
          deleted.profile_facts, deleted.observations, deleted.camera_events,
          copy.profile.hubNoAnswer,
        ));
        return;
      }
      // Her memory is gone; this phone's session goes with it, back to setup.
      qc.clear();
      reset();
      router.replace('/');
    } catch {
      setForgetError(copy.profile.nothingDeleted);
    } finally {
      setForgetBusy(false);
    }
  };

  const consentLine = copy.consent.recorded(
    name,
    signedBy,
    relationship,
    profile?.consent.signed_at ? new Date(profile.consent.signed_at).toLocaleDateString() : '',
  );

  const camera = profile?.camera;
  const cameraState = camera
    ? copy.camera.stateWord(camera.state, camera.paused_until ? timeOf(camera.paused_until) : null)
    : undefined;

  const confirmField = (
    <Field
      label={copy.profile.typeToConfirm(name)}
      value={confirmName}
      onChangeText={setConfirmName}
      placeholder={name}
      autoCorrect={false}
    />
  );

  return (
    <Screen native wash>
      {/* Beat 0. Her name. The one large thing on the screen, on bare paper,
          with nothing beside it and nothing under it. The same sp(4) inset the
          heading carries, so her name starts on the text edge of the plate
          below it rather than 16pt to its left. */}
      <Entrance index={0} distance={26}>
        <Txt kind="display" numberOfLines={2} style={{ marginHorizontal: sp(4) }}>{name}</Txt>
      </Entrance>

      {/* Beat 1. The whole middle of the screen: what she agreed to. The
          camera is the agreement you can act on from here (stopping it
          withdraws that consent), and the consent row is the record of all
          three. The heading is also where the debug panel hides. */}
      <Entrance index={1} style={{ marginTop: sp(10) }}>
        <Pressable onLongPress={() => setDebugOpen((v) => !v)} delayLongPress={600}>
          <Txt
            kind="tag"
            tone="muted"
            accessibilityRole="header"
            style={{ marginHorizontal: sp(4), marginBottom: sp(2) }}
          >
            {copy.agreed}
          </Txt>
        </Pressable>
        {debugOpen && <DebugPanel />}
        <RowGroup>
          {profileLoading && !profile && <LoadingState label={copy.loading} />}
          {profileError && !profile && (
            <ErrorState message={copy.loadError} onRetry={refetchProfile} />
          )}
          {/* Her camera. The only room name on a family screen, and it is
              allowed: this is where the FAMILY installed the camera (they
              picked it in onboarding), not where she is. The copy says
              "installed in" so it cannot be misread as whereabouts (D-001
              bans her location, not the hardware's). */}
          {!!profile && (
            <SettingRow
              label={copy.camera.title}
              reading={cameraState}
              sentence={camera ? copy.camera.installedIn(zoneLabel(camera.zone)) : copy.camera.noCamera}
            >
              {!!camera && (
                !confirmStop ? (
                  <Btn kind="link" tone="alert" label={copy.camera.stop} onPress={() => setConfirmStop(true)} />
                ) : (
                  <View style={{ gap: sp(2), marginTop: sp(1) }}>
                    <Txt kind="body">{copy.camera.stopExplained}</Txt>
                    {!!cameraError && <ErrorState inline message={cameraError} />}
                    <Btn label={copy.camera.stop} kind="danger" busy={cameraBusy} onPress={stopCamera} />
                    <Btn label={copy.camera.leaveRunning} kind="quiet" onPress={() => setConfirmStop(false)} />
                  </View>
                )
              )}
            </SettingRow>
          )}

          {!!profile && (
            <SettingRow label={copy.consent.title} sentence={consentLine}>
              <View style={{ gap: sp(1.5), marginTop: sp(1) }}>
                {([
                  [copy.consent.falls, profile.consent.falls],
                  [copy.consent.camera, profile.consent.camera],
                  [copy.consent.memory, profile.consent.memory],
                ] as const).map(([label, on]) => (
                  <KeyValue
                    key={label}
                    label={label}
                    value={on ? copy.consent.agreed : copy.consent.declined}
                    tone={on ? 'ok' : 'muted'}
                  />
                ))}
              </View>
            </SettingRow>
          )}
        </RowGroup>
      </Entrance>

      {/* Beat 2. Apart from everything, under a hard rule: the two things
          that cannot be undone. Position and wording carry it; each one still
          makes you type her name (DESIGN rule 8). */}
      <Entrance index={2} style={{ marginTop: sp(16) }}>
        <Rule weight="heavy" />
        <Txt kind="label" style={{ marginTop: sp(3) }}>{copy.profile.cannotUndo}</Txt>
        {!!forgetResult && (
          <Txt kind="caption" tone="ok" style={{ marginTop: sp(2) }} accessibilityLiveRegion="polite">
            {forgetResult}
          </Txt>
        )}

        {destructive !== 'wipe' && (
          destructive !== 'forget' ? (
            <Btn
              kind="link"
              tone="alert"
              label={copy.profile.forget}
              onPress={() => openDestructive('forget')}
              style={{ marginTop: sp(3) }}
            />
          ) : (
            <View style={{ gap: sp(3), marginTop: sp(3) }}>
              <Txt kind="body">{copy.profile.forgetExplained}</Txt>
              {confirmField}
              {!!forgetError && <ErrorState inline message={forgetError} />}
              <Btn
                label={copy.profile.forgetEverything}
                kind="danger"
                busy={forgetBusy}
                disabled={!nameTyped}
                onPress={forget}
              />
              <Btn
                label={copy.profile.keepProfile}
                kind="quiet"
                onPress={() => { setDestructive('none'); setConfirmName(''); }}
              />
            </View>
          )
        )}

        {destructive !== 'forget' && (
          destructive !== 'wipe' ? (
            <Btn
              kind="link"
              tone="alert"
              label={copy.profile.wipe}
              onPress={() => openDestructive('wipe')}
              style={{ marginTop: sp(3) }}
            />
          ) : (
            <View style={{ gap: sp(3), marginTop: sp(3) }}>
              <Txt kind="body">{copy.profile.wipeExplained}</Txt>
              {confirmField}
              {!!forgetError && <ErrorState inline message={forgetError} />}
              <Btn
                label={copy.profile.wipe}
                kind="danger"
                busy={forgetBusy}
                disabled={!nameTyped}
                onPress={wipeAndStop}
              />
              <Btn
                label={copy.profile.leaveRunning}
                kind="quiet"
                onPress={() => { setDestructive('none'); setConfirmName(''); }}
              />
            </View>
          )
        )}
      </Entrance>
    </Screen>
  );
}
