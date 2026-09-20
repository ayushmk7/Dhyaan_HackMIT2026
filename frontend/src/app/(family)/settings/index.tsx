// Settings. Her name at the top, then the list in runs, the way Her day's is:
// one white plate per run under a quiet heading, with air between the plates
// and hairlines between the rows. The notes Dhyaan was told, what she agreed
// to, what happens when something happens, her records — and, apart from all
// of it at the bottom under a heavy rule, the two buttons that undo it all.
//
// The rows keep a label over a sentence rather than Her day's time gutter:
// the labels here are sentence-length ("Who it calls, in order"), so a fixed
// left column would truncate them. What carries over is the alignment — every
// label and every sentence starts on the same vertical line, and a row's
// reading sits right-aligned on the label line in the machine voice.
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
  Btn, Card, Chevron, DataLabel, EmptyState, Entrance, ErrorState, FactRow, Field, KeyValue,
  LoadingState, Row, RowGroup, Rule, Screen, Txt,
} from '@/components';
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

/**
 * The quiet heading over a plate: the same tag Her day sets over each part of
 * the day, inset to the plate's text edge, with an optional machine reading
 * on the right (a count). Long-press is only wired on the notes heading,
 * where the debug panel hides.
 */
function GroupHeading({ title, meta, onLongPress, first = false }: {
  title: string; meta?: string; onLongPress?: () => void;
  /** The first plate in its beat; the rest carry Her day's gap above them. */
  first?: boolean;
}) {
  const heading = (
    <Row
      style={{
        justifyContent: 'space-between',
        marginTop: first ? 0 : sp(6), marginBottom: sp(2), marginHorizontal: sp(4),
      }}
      gap={3}
    >
      <Txt kind="tag" tone="muted" accessibilityRole="header" style={{ flexShrink: 1 }}>{title}</Txt>
      {!!meta && <Txt kind="stamp" tone="muted">{meta}</Txt>}
    </Row>
  );
  if (!onLongPress) return heading;
  return (
    <Pressable onLongPress={onLongPress} delayLongPress={600}>
      {heading}
    </Pressable>
  );
}

/**
 * One quiet row: a small label, the sentence under it, a reading on the right
 * when there is one. No glyph beside the label; the label names the thing. A
 * chevron only where the row leaves this screen. A row that opens in place
 * announces itself to VoiceOver and otherwise stays plain.
 */
function QuietRow({ label, sentence, time, lines = 1, onPress, expanded, navigates = false }: {
  label: string; sentence?: string; time?: string; lines?: number;
  onPress?: () => void; expanded?: boolean; navigates?: boolean;
}) {
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      style={({ pressed }) => [{ paddingVertical: sp(3.5) }, pressed && onPress ? { opacity: 0.55 } : null]}
    >
      <Row style={{ justifyContent: 'space-between' }} gap={3}>
        <Txt kind="tag" tone="muted">{label}</Txt>
        <Row gap={1.5}>
          {!!time && <Txt kind="stamp" tone="muted">{time}</Txt>}
          {navigates && <Chevron size={11} />}
        </Row>
      </Row>
      {!!sentence && (
        <Txt kind="body" numberOfLines={lines} style={{ marginTop: sp(1) }}>{sentence}</Txt>
      )}
    </Pressable>
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
      {/* Beat 0. Her name. The one large thing on the screen, on bare paper,
          with nothing beside it and nothing under it. The same sp(4) inset the
          headings carry, so her name starts on the text edge of the plates
          below it rather than 16pt to their left. */}
      <Entrance index={0} distance={26}>
        <Txt kind="display" numberOfLines={2} style={{ marginHorizontal: sp(4) }}>{name}</Txt>
      </Entrance>

      {/* Beat 1. What Dhyaan was told: the first plate, and the one whose
          rows are a list of her own. Its heading carries the count. */}
      <Entrance index={1} style={{ marginTop: sp(4) }}>
        <GroupHeading
          first
          title={copy.told.title}
          meta={profile ? copy.told.notes(facts.length) : undefined}
          onLongPress={() => setDebugOpen((v) => !v)}
        />
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

      {/* Beat 2. Everything else, in runs: one plate per run under a quiet
          heading, with the same air between plates as Her day. A row that has
          more to say opens in place; a row that goes somewhere carries a
          chevron. Rows inside a plate are parted by hairlines, never gaps. */}
      <Entrance index={2} style={{ marginTop: sp(6) }}>
        {/* What she agreed to: the camera is the agreement you can act on
            from here (stopping it withdraws that consent), and the consent
            row is the record of all three. */}
        <GroupHeading first title={copy.groups.agreed} />
        <RowGroup>
          {/* Her camera. The only room name on a family screen, and it is
              allowed: this is where the FAMILY installed the camera (they
              picked it in onboarding), not where she is. The copy says
              "installed in" so it cannot be misread as whereabouts (D-001
              bans her location, not the hardware's). */}
          <View>
            <QuietRow
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

          <View>
            <QuietRow
              label={copy.consent.title}
              sentence={consentLine}
              lines={opened === 'consent' ? 3 : 1}
              onPress={() => toggle('consent')}
              expanded={opened === 'consent'}
            />
            {opened === 'consent' && (
              <View style={{ paddingBottom: sp(3), gap: sp(1.5) }}>
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
        </RowGroup>

        {/* When something happens: what it does, then who it calls. The
            statement is first because it is always there; the ladder waits
            on a query, and a row that arrives late must not sit above one a
            person is already reading. */}
        <GroupHeading title={copy.groups.happens} />
        <RowGroup>
          {/* Not a preferences pane. There is no endpoint for alert
              preferences, so this states what Dhyaan does today rather than
              offering switches that would forget themselves on unmount. */}
          <View>
            <QuietRow
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

          {/* Who it calls: the order is the point, so the names are the line. */}
          {contactsLoading && !contacts && <LoadingState label={copy.ladder.loading} />}
          {contactsError && !contacts && (
            <ErrorState message={copy.ladder.loadError} onRetry={refetchContacts} />
          )}
          {!!contacts && (
            <QuietRow
              label={copy.ladder.title}
              sentence={ladderNames.length ? copy.ladder.inOrder(ladderNames) : copy.ladder.empty}
              lines={ladderNames.length ? 2 : 4}
            />
          )}

          {/* No row for her band. There is nothing to do to it from here
              (no way back into /onboard/pair), and a row that only says so
              is a row nobody acts on. */}
        </RowGroup>

        {/* Her records: the care file she keeps, and the copy you can take. */}
        <GroupHeading title={copy.groups.records} />
        <RowGroup>
          <QuietRow
            label={copy.careFile.title}
            sentence={sources.length ? copy.careFile.summary(medications.length, appointments.length) : copy.careFile.intro}
            lines={sources.length ? 1 : 3}
            navigates
            onPress={() => router.push('/(family)/settings/carefile')}
          />

          <View>
            <QuietRow
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
      <Entrance index={3} style={{ marginTop: sp(16) }}>
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
