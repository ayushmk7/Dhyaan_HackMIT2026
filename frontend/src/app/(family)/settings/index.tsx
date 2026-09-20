// Settings. Her name at the top, the notes Dhyaan was told under it, then one
// quiet list of rows for everything that is only sometimes worth opening —
// and, apart from all of it at the bottom, the two buttons that undo it all.
//
// Every control on this screen does exactly what its label says, and nothing
// here is a placeholder dressed as a working switch:
//   - Stop the camera turns consent off at the server; the worker stops within
//     ten seconds.
//   - Forget her profile deletes every fact, observation and camera event, and
//     makes you type her name first, because it cannot be undone.
//   - Delete everything and stop Dhyaan does that, AND turns all three consents
//     off, AND signs this phone out. Same typed-name gesture.
//   - Delete this note is a real DELETE of one fact.
//   - Share her data as JSON is exactly that — JSON text into the share sheet,
//     not a report. It is built from the family-scoped routes only, so it
//     holds exactly what this app can show and nothing a family screen can't.
//   - What Dhyaan does when something happens is a STATEMENT, not a switch:
//     there is no alert-preferences endpoint, so there are no toggles to fake.
// The native header owns the title; long-press the notes heading for debug.
//
// Every sentence this screen says lives in lib/copy/family.ts under `settings`.
import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import {
  Btn, Card, DataLabel, EmptyState, Entrance, ErrorState, FactRow, Field, KeyValue,
  LoadingState, Marquee, MetricRow, Row, RowGroup, Rule, Screen, Txt,
} from '@/components';
import { Avatar } from '@/components/avatar';
import { api } from '@/lib/api';
import { API_BASE, USE_MOCKS } from '@/lib/config';
import { family } from '@/lib/copy/family';
import { ago, timeOf, zoneLabel } from '@/lib/format';
import { localDayKey, useContacts, useProfile } from '@/lib/hooks';
import { registerForPush, sendTestPush } from '@/lib/push';
import { useCareFile } from '@/store/carefile';
import { useSession } from '@/store/session';
import type { Fact } from '@/lib/types';
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

// Screen-only debug view, long-press the notes heading to reveal. Every demo
// control lives here so the visible app carries no demo chrome.
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

/** A row that opens in place: the collapsed one-liner, or its full body. */
type Opened = 'none' | 'camera' | 'happens' | 'consent';

export default function Settings() {
  const qc = useQueryClient();
  const {
    residentId, residentName, consentGivenBy, consentRelationship, reset,
  } = useSession();
  const {
    data: profile, isLoading: profileLoading, isError: profileError, refetch: refetchProfile,
  } = useProfile(residentId);
  const {
    data: contacts, isLoading: contactsLoading, isError: contactsError, refetch: refetchContacts,
  } = useContacts();
  const { medications, appointments, sources } = useCareFile();

  const [editing, setEditing] = useState<Fact | null>(null);
  const [adding, setAdding] = useState(false);
  const [draftKey, setDraftKey] = useState('');
  const [draftText, setDraftText] = useState('');
  const [factBusy, setFactBusy] = useState(false);
  const [factError, setFactError] = useState<string | null>(null);
  const [confirmDeleteFact, setConfirmDeleteFact] = useState(false);

  // One disclosure row open at a time; the rest stay one line.
  const [opened, setOpened] = useState<Opened>('none');
  const toggle = (which: Opened) => setOpened((o) => (o === which ? 'none' : which));

  const [confirmStop, setConfirmStop] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Two irreversible controls, one typed-name gesture each, never both open.
  const [destructive, setDestructive] = useState<'none' | 'forget' | 'wipe'>('none');
  const [confirmName, setConfirmName] = useState('');
  const [forgetBusy, setForgetBusy] = useState(false);
  const [forgetError, setForgetError] = useState<string | null>(null);
  const [forgetResult, setForgetResult] = useState<string | null>(null);

  const [exportError, setExportError] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);

  const name = profile?.name ?? residentName;
  const facts = profile?.facts ?? [];
  // The server's consent record is the record. The session copy only exists
  // for the minutes between signing and the profile being saved.
  const signedBy = profile?.consent.signed_by || consentGivenBy;
  const relationship = profile?.consent.relationship || consentRelationship;
  const nameTyped = confirmName.trim().toLowerCase() === name.toLowerCase();
  const teller = consentGivenBy || copy.defaultTeller;

  const closeFactForm = () => {
    setEditing(null);
    setAdding(false);
    setDraftKey('');
    setDraftText('');
    setFactError(null);
    setConfirmDeleteFact(false);
  };

  const openDestructive = (which: 'forget' | 'wipe') => {
    setDestructive(which);
    setConfirmName('');
    setForgetError(null);
  };

  const saveFact = async () => {
    setFactBusy(true);
    setFactError(null);
    try {
      if (editing) {
        // A correction never overwrites: the old row is deactivated and a new
        // one supersedes it, so last week's answers still cite what they cited.
        await api.updateFact(residentId, editing.id, draftText, teller);
      } else {
        // 'note' is the fact's key when the family didn't name one, not a label.
        await api.addFacts(residentId, [{ key: draftKey.trim() || 'note', text: draftText }], teller);
      }
      await qc.invalidateQueries({ queryKey: ['profile', residentId] });
      closeFactForm();
    } catch {
      setFactError(copy.told.saveError);
    } finally {
      setFactBusy(false);
    }
  };

  // The other half of "you can correct it": a note the family typed can be
  // taken back out. Two taps, because it does not come back.
  const removeFact = async () => {
    if (!editing) return;
    setFactBusy(true);
    setFactError(null);
    try {
      await api.deleteFact(residentId, editing.id);
      await qc.invalidateQueries({ queryKey: ['profile', residentId] });
      closeFactForm();
    } catch {
      setFactError(copy.told.deleteError);
    } finally {
      setFactBusy(false);
    }
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

  // Not a report and not a file: JSON text into the share sheet, holding what
  // this app already has. The label says JSON for that reason.
  const exportData = async () => {
    setExportError(null);
    try {
      // The last seven days, from the same family-filtered route Her day
      // reads. The staff timeline this used to export carries room names.
      const days = Array.from({ length: 7 }, (_, i) => localDayKey(new Date(Date.now() - i * 86_400_000)));
      const [summaries, ...activity] = await Promise.all([
        api.getSummaries(residentId), ...days.map((d) => api.getActivity(residentId, d)),
      ]);
      await Share.share({
        title: copy.profile.exportTitle(name),
        message: JSON.stringify({
          resident: name,
          exported_at: new Date().toISOString(),
          told_to_dhyaan: facts.map((f) => ({ key: f.key, text: f.text, at: f.created_at })),
          summaries,
          days: activity,
        }, null, 2),
      });
    } catch {
      setExportError(copy.profile.exportError);
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
  const ladderNames = (contacts ?? []).map((c) => c.name);

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
      {/* Beat 0. Her. The one large thing on the screen, on bare paper. */}
      <Entrance index={0} distance={26}>
        <Row gap={3}>
          <Avatar name={name} size={56} />
          <Txt kind="display" numberOfLines={2} style={{ flex: 1 }}>{name}</Txt>
        </Row>
        <Txt kind="caption" tone="muted" style={{ marginTop: sp(3) }}>
          {copy.profile.livesAtHome(name)}
        </Txt>
      </Entrance>

      {/* Beat 1. What Dhyaan was told: the one list on the screen, and the
          only heading, because it is the only thing here that is a list. */}
      <Entrance index={1}>
        <Pressable onLongPress={() => setDebugOpen((v) => !v)} delayLongPress={600}>
          <Marquee
            title={copy.told.title}
            meta={profile ? copy.told.notes(facts.length) : undefined}
          />
        </Pressable>
        {debugOpen && <DebugPanel />}
        <RowGroup>
          {profileLoading && !profile && <LoadingState label={copy.told.loading} />}
          {profileError && !profile && (
            <ErrorState message={copy.told.loadError} onRetry={refetchProfile} />
          )}
          {!!profile && facts.length === 0 && (
            <EmptyState>{copy.told.empty}</EmptyState>
          )}
          {facts.map((f) => (
            <FactRow
              key={f.id}
              fact={f}
              onPress={() => {
                setEditing(f);
                setAdding(false);
                setDraftText(f.text);
                setFactError(null);
                setConfirmDeleteFact(false);
              }}
            />
          ))}
          {!!profile?.appearance && (
            <View style={{ paddingVertical: sp(3) }}>
              <Txt kind="label" tone="muted">{copy.told.howDescribed}</Txt>
              <Txt kind="body" style={{ marginTop: 2 }}>{profile.appearance}</Txt>
            </View>
          )}
          {!!profile?.usual_spots?.length && (
            <View style={{ paddingVertical: sp(3) }}>
              <Txt kind="label" tone="muted">{copy.told.usualSpots}</Txt>
              {profile.usual_spots.map((spot) => (
                <Txt key={spot} kind="body" style={{ marginTop: 2 }}>{spot}</Txt>
              ))}
            </View>
          )}

          {(editing || adding) && (
            <View style={{ paddingVertical: sp(3), gap: sp(3) }}>
              {adding && (
                <Field
                  label={copy.told.about}
                  value={draftKey}
                  onChangeText={setDraftKey}
                  placeholder={copy.told.keyPlaceholder}
                  autoCapitalize="none"
                />
              )}
              <Field
                label={editing ? copy.told.aboutKey(editing.key) : copy.told.whatToRemember}
                value={draftText}
                onChangeText={setDraftText}
                placeholder={copy.told.sentencePlaceholder}
                multiline
                maxLength={300}
              />
              {!!factError && <ErrorState inline message={factError} />}
              <Row gap={2}>
                <Btn
                  kind="quiet"
                  label={copy.told.cancel}
                  style={{ flex: 1 }}
                  onPress={closeFactForm}
                />
                <Btn
                  label={copy.told.save}
                  busy={factBusy}
                  disabled={!draftText.trim()}
                  style={{ flex: 1 }}
                  onPress={saveFact}
                />
              </Row>
              {!!editing && (
                confirmDeleteFact ? (
                  <View style={{ gap: sp(2) }}>
                    <Txt kind="caption">{copy.told.deleteWarning}</Txt>
                    <Btn
                      label={copy.told.deleteNote}
                      kind="danger"
                      busy={factBusy}
                      onPress={removeFact}
                    />
                    <Btn
                      label={copy.told.keepIt}
                      kind="quiet"
                      onPress={() => setConfirmDeleteFact(false)}
                    />
                  </View>
                ) : (
                  <Btn
                    kind="link"
                    tone="alert"
                    label={copy.told.deleteNote}
                    onPress={() => setConfirmDeleteFact(true)}
                  />
                )
              )}
            </View>
          )}
          {!editing && !adding && !!profile && (
            <Btn
              kind="quiet"
              label={copy.told.addNote}
              style={{ marginVertical: sp(3) }}
              onPress={() => { setAdding(true); setDraftKey(''); setDraftText(''); setFactError(null); }}
            />
          )}
        </RowGroup>
      </Entrance>

      {/* Beat 2. Everything else, one line each. A row that has more to say
          opens in place; a row that goes somewhere carries a chevron. */}
      <Entrance index={2} style={{ marginTop: sp(4) }}>
        <RowGroup>
          {/* Her camera. The only room name on a family screen, and it is
              allowed: this is where the FAMILY installed the camera (they
              picked it in onboarding), not where she is. The copy says
              "installed in" so it cannot be misread as whereabouts (D-001
              bans her location, not the hardware's). */}
          <View>
            <MetricRow
              icon="video"
              label={copy.camera.title}
              time={cameraState}
              sentence={
                opened === 'camera' ? undefined
                  : camera ? copy.camera.installedIn(zoneLabel(camera.zone)) : copy.camera.noCamera
              }
              lines={camera ? 1 : 3}
              onPress={camera ? () => toggle('camera') : undefined}
              expanded={camera ? opened === 'camera' : undefined}
            />
            {opened === 'camera' && !!camera && (
              <View style={{ paddingBottom: sp(3), gap: sp(2) }}>
                <KeyValue label={copy.camera.whereInstalled} value={zoneLabel(camera.zone)} />
                {!confirmStop ? (
                  <Btn kind="link" tone="alert" label={copy.camera.stop} onPress={() => setConfirmStop(true)} />
                ) : (
                  <View style={{ gap: sp(2) }}>
                    <Txt kind="body">{copy.camera.stopExplained}</Txt>
                    {!!cameraError && <ErrorState inline message={cameraError} />}
                    <Btn label={copy.camera.stop} kind="danger" busy={cameraBusy} onPress={stopCamera} />
                    <Btn label={copy.camera.leaveRunning} kind="quiet" onPress={() => setConfirmStop(false)} />
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Who it calls: the order is the point, so the names are the line. */}
          {contactsLoading && !contacts && <LoadingState label={copy.ladder.loading} />}
          {contactsError && !contacts && (
            <ErrorState message={copy.ladder.loadError} onRetry={refetchContacts} />
          )}
          {!!contacts && (
            <MetricRow
              icon="phone"
              label={copy.ladder.title}
              sentence={ladderNames.length ? copy.ladder.inOrder(ladderNames) : copy.ladder.empty}
              lines={ladderNames.length ? 2 : 4}
            />
          )}

          <MetricRow
            icon="doc.text"
            label={copy.careFile.title}
            sentence={sources.length ? copy.careFile.summary(medications.length, appointments.length) : copy.careFile.intro}
            lines={sources.length ? 1 : 3}
            onPress={() => router.push('/(family)/settings/carefile')}
          />

          {/* Not a preferences pane. There is no endpoint for alert
              preferences, so this states what Dhyaan does today rather than
              offering switches that would forget themselves on unmount. */}
          <View>
            <MetricRow
              icon="bell"
              label={copy.happens.title}
              sentence={opened === 'happens' ? undefined : copy.happens.short}
              lines={1}
              onPress={() => toggle('happens')}
              expanded={opened === 'happens'}
            />
            {opened === 'happens' && (
              <View style={{ paddingBottom: sp(3), gap: sp(2) }}>
                <Txt kind="label">{copy.happens.ifFall}</Txt>
                <Txt kind="body">{copy.happens.ifFallBody}</Txt>
                <Txt kind="label" style={{ marginTop: sp(1) }}>{copy.happens.everythingElse}</Txt>
                <Txt kind="body">{copy.happens.everythingElseBody}</Txt>
                <Txt kind="caption" tone="muted" style={{ marginTop: sp(1) }}>{copy.happens.nothingToSwitch}</Txt>
              </View>
            )}
          </View>

          <View>
            <MetricRow
              icon="checkmark.seal"
              label={copy.consent.title}
              sentence={opened === 'consent' ? undefined : consentLine}
              lines={1}
              onPress={() => toggle('consent')}
              expanded={opened === 'consent'}
            />
            {opened === 'consent' && (
              <View style={{ paddingBottom: sp(3), gap: sp(1.5) }}>
                <Txt kind="caption" tone="muted">{consentLine}</Txt>
                {([
                  [copy.consent.falls, profile?.consent.falls],
                  [copy.consent.camera, profile?.consent.camera],
                  [copy.consent.memory, profile?.consent.memory],
                ] as const).map(([label, on]) => (
                  <KeyValue
                    key={label}
                    label={label}
                    value={on ? copy.consent.agreed : copy.consent.declined}
                    tone={on ? 'ok' : 'muted'}
                  />
                ))}
              </View>
            )}
          </View>

          {/* No buttons into /onboard/pair or /onboard/survey. Those screens
              have no header and no way back; their only visible exit is
              Continue, which walks the whole setup again and ends by
              re-saving her consent from this session's blank answers,
              switching everything off. Until setup can be re-entered safely,
              this says what is true. */}
          <MetricRow
            icon="dot.radiowaves.left.and.right"
            label={copy.band.title}
            sentence={copy.band.body}
            lines={3}
          />

          <View>
            <MetricRow
              icon="square.and.arrow.up"
              label={copy.profile.shareJson}
              sentence={copy.profile.shareJsonNote}
              lines={2}
              onPress={exportData}
            />
            {exportError && (
              <ErrorState
                inline
                message={exportError}
                retryLabel={copy.profile.tryAgain}
                onRetry={exportData}
                style={{ marginBottom: sp(2) }}
              />
            )}
          </View>
        </RowGroup>
      </Entrance>

      {/* Beat 3. Apart from everything, under a hard rule: the two things
          that cannot be undone. Position and wording carry it; each one still
          makes you type her name (DESIGN rule 8). */}
      <Entrance index={3} style={{ marginTop: sp(12) }}>
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
