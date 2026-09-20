// Settings. What Dhyaan was told, where the camera is, who it calls — and the
// buttons that undo all of it.
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
// The native header owns the title; long-press the first section for debug.
import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import {
  Btn, Card, DataLabel, EmptyState, Entrance, ErrorState, FactRow, Field, Hairline, KeyValue,
  LoadingState, Marquee, Row, RowGroup, Rule, Screen, Stagger, Txt,
} from '@/components';
import { Avatar, avatarTone } from '@/components/avatar';
import { api } from '@/lib/api';
import { API_BASE, USE_MOCKS } from '@/lib/config';
import { ago, timeOf, zoneLabel } from '@/lib/format';
import { localDayKey, useContacts, useProfile } from '@/lib/hooks';
import { registerForPush, sendTestPush } from '@/lib/push';
import { useCareFile } from '@/store/carefile';
import { useSession } from '@/store/session';
import type { Fact } from '@/lib/types';
import { sp } from '@/theme/tokens';

// app.json's extra.eas.projectId. `npx eas init` writes the real one; until it
// does, push registration cannot succeed and the button says so rather than
// failing quietly. lib/push.ts refuses on exactly this prefix.
const EAS_PROJECT_ID = String(
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? '',
);
const PUSH_READY = EAS_PROJECT_ID.length > 0 && !EAS_PROJECT_ID.startsWith('REPLACE');

// Screen-only debug view, long-press the first section header to reveal. Every
// demo control lives here so the visible app carries no demo chrome.
function DebugPanel() {
  const qc = useQueryClient();
  const { setRole } = useSession();
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
      setTestResult(`Reached it · ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      setTestResult(`Failed: ${e instanceof Error ? e.message : 'unknown error'}`);
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
      setNote(e instanceof Error ? e.message : 'Couldn’t start the rehearsal.');
    } finally {
      setRehearsing(false);
    }
  };

  // No silent failure: without a real EAS project id this cannot work, so the
  // button carries the reason in its own label and the panel prints the id.
  const registerPush = async () => {
    if (!PUSH_READY) {
      setNote(
        'app.json still has extra.eas.projectId = ' + (EAS_PROJECT_ID || 'nothing') +
        '. Run npx eas init on a machine signed in to an Expo account, put the id it writes into app.json, and rebuild.',
      );
      return;
    }
    const { token, reason } = await registerForPush();
    setPushToken(token);
    setNote(token ? `Push registered · …${token.slice(-8)}` : reason ?? null);
  };

  // The on-stage fallback (§10.1): posts a canned observation sequence through
  // the real ingest path if the webcam misbehaves.
  const simulate = async (kind: 'meal' | 'visitor' | 'out_of_view') => {
    setSimulating(true);
    try {
      await api.simulateCamera(kind);
      await qc.invalidateQueries();
      setTestResult(`Simulated ${kind.replace(/_/g, ' ')}`);
    } catch (e) {
      setTestResult(`Failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setSimulating(false);
    }
  };

  return (
    <Card style={{ marginTop: sp(3) }}>
      <Rule weight="heavy" />
      <View style={{ gap: sp(1.5), marginTop: sp(3) }}>
        <DataLabel value={USE_MOCKS ? 'mock' : 'live'}>Mode</DataLabel>
        <DataLabel value={API_BASE}>API base</DataLabel>
        <DataLabel value={lastSuccess ? ago(new Date(lastSuccess).toISOString()) : 'none yet'}>
          Last ok
        </DataLabel>
        <DataLabel value={PUSH_READY ? EAS_PROJECT_ID : 'unset'}>EAS project</DataLabel>
      </View>
      {/* Stacked, not a row: side-by-side buttons clip their labels at SE width. */}
      <View style={{ gap: sp(2), marginTop: sp(3) }}>
        <Btn label="Test connection" kind="quiet" busy={testing} onPress={testConnection} />
        <Btn label="Rehearse a fall alert" kind="quiet" busy={rehearsing} onPress={rehearse} />
        <Btn label="Simulate a meal" kind="quiet" busy={simulating} onPress={() => simulate('meal')} />
        <Btn label="Simulate a visitor" kind="quiet" busy={simulating} onPress={() => simulate('visitor')} />
        <Btn label="Simulate out of view" kind="quiet" busy={simulating} onPress={() => simulate('out_of_view')} />
        <Btn
          label={PUSH_READY ? 'Register for push' : 'Push needs an EAS project id'}
          kind="quiet"
          onPress={registerPush}
        />
        {pushToken && (
          <Btn label="Send a test fall push" kind="quiet" onPress={() => sendTestPush(pushToken)} />
        )}
        <Btn
          label="Staff side"
          kind="quiet"
          onPress={() => { setRole('staff'); router.replace('/(staff)/triage'); }}
        />
      </View>
      {testResult && <Txt kind="caption" tone="muted" style={{ marginTop: sp(2) }}>{testResult}</Txt>}
      {note && <Txt kind="caption" tone="muted" style={{ marginTop: sp(1) }}>{note}</Txt>}
    </Card>
  );
}

function CareFileSummary() {
  const { medications, appointments, sources } = useCareFile();
  return (
    <View>
      {sources.length > 0 ? (
        <Txt kind="label">
          {medications.length} medication{medications.length === 1 ? '' : 's'} · {appointments.length} upcoming
        </Txt>
      ) : (
        <Txt kind="body">
          Med lists and letters become an emergency card for the alert screen and a note of
          what’s coming up on Today.
        </Txt>
      )}
      <Btn
        label={sources.length ? 'Open her care file' : 'Add the first document'}
        kind="quiet"
        onPress={() => router.push('/(family)/settings/carefile')}
        style={{ marginTop: sp(3) }}
      />
    </View>
  );
}

export default function Settings() {
  const qc = useQueryClient();
  const {
    residentId, residentName, consentGivenBy, consentRelationship, signOut,
  } = useSession();
  const {
    data: profile, isLoading: profileLoading, isError: profileError, refetch: refetchProfile,
  } = useProfile(residentId);
  const {
    data: contacts, isLoading: contactsLoading, isError: contactsError, refetch: refetchContacts,
  } = useContacts();

  const [editing, setEditing] = useState<Fact | null>(null);
  const [adding, setAdding] = useState(false);
  const [draftKey, setDraftKey] = useState('');
  const [draftText, setDraftText] = useState('');
  const [factBusy, setFactBusy] = useState(false);
  const [factError, setFactError] = useState<string | null>(null);
  const [confirmDeleteFact, setConfirmDeleteFact] = useState(false);

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
        await api.updateFact(residentId, editing.id, draftText, consentGivenBy || 'Family');
      } else {
        await api.addFacts(residentId, [{ key: draftKey.trim() || 'note', text: draftText }], consentGivenBy || 'Family');
      }
      await qc.invalidateQueries({ queryKey: ['profile', residentId] });
      closeFactForm();
    } catch (e) {
      setFactError(e instanceof Error ? e.message : 'Couldn’t save that.');
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
    } catch (e) {
      setFactError(e instanceof Error ? e.message : 'Couldn’t delete that note.');
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
    } catch (e) {
      setCameraError(e instanceof Error ? e.message : 'Couldn’t reach her home hub.');
    } finally {
      setCameraBusy(false);
    }
  };

  const forget = async () => {
    setForgetBusy(true);
    setForgetError(null);
    try {
      const deleted = await api.deleteMemory(residentId, 'all', confirmName);
      setForgetResult(
        `Deleted ${deleted.profile_facts} ${deleted.profile_facts === 1 ? 'note' : 'notes'}, ` +
        `${deleted.observations} observations and ${deleted.camera_events} camera events. ` +
        'There was never a picture to delete.',
      );
      setDestructive('none');
      setConfirmName('');
      await qc.invalidateQueries();
    } catch (e) {
      setForgetError(e instanceof Error ? e.message : 'Nothing was deleted.');
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
      } catch (e) {
        setForgetError(
          `Deleted ${deleted.profile_facts} notes, ${deleted.observations} observations and ` +
          `${deleted.camera_events} camera events, but Dhyaan is still running: ` +
          `${e instanceof Error ? e.message : 'the hub did not answer'}. Try again.`,
        );
        return;
      }
      qc.clear();
      signOut();
      router.replace('/login');
    } catch (e) {
      setForgetError(e instanceof Error ? e.message : 'Nothing was deleted.');
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
        title: `${name} export`,
        message: JSON.stringify({
          resident: name,
          exported_at: new Date().toISOString(),
          told_to_dhyaan: facts.map((f) => ({ key: f.key, text: f.text, at: f.created_at })),
          summaries,
          days: activity,
        }, null, 2),
      });
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Couldn’t put that together. Try again.');
    }
  };

  return (
    <Screen native wash>
      <Stagger>
        {/* ---- About her ---- */}
        <View>
          <Pressable onLongPress={() => setDebugOpen((v) => !v)} delayLongPress={600}>
            <Marquee
              first
              title="What Dhyaan was told about her"
              meta={profile ? `${facts.length} notes` : undefined}
            />
          </Pressable>
          {debugOpen && <DebugPanel />}
          {/* One plate of rows: RowGroup draws the hairlines between every child. */}
          <RowGroup>
            {profileLoading && !profile && <LoadingState label="Loading her profile…" />}
            {profileError && !profile && (
              <ErrorState message="Couldn’t load what Dhyaan was told." onRetry={refetchProfile} />
            )}
            {!!profile && facts.length === 0 && (
              <EmptyState>
                Nothing told to Dhyaan yet. Until you add what you know, it will say it
                wasn’t told, rather than guess.
              </EmptyState>
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
                <Txt kind="label" tone="muted">How you described her</Txt>
                <Txt kind="body" style={{ marginTop: 2 }}>{profile.appearance}</Txt>
              </View>
            )}
            {!!profile?.usual_spots?.length && (
              <View style={{ paddingVertical: sp(3) }}>
                <Txt kind="label" tone="muted">Her usual spots</Txt>
                {profile.usual_spots.map((spot) => (
                  <Txt key={spot} kind="body" style={{ marginTop: 2 }}>{spot}</Txt>
                ))}
              </View>
            )}

            {(editing || adding) && (
              <View style={{ paddingVertical: sp(3), gap: sp(3) }}>
                <Rule />
                {adding && (
                  <Field
                    label="About"
                    value={draftKey}
                    onChangeText={setDraftKey}
                    placeholder="breakfast, walk, visitors"
                    autoCapitalize="none"
                  />
                )}
                <Field
                  label={editing ? `About ${editing.key.replace(/_/g, ' ')}` : 'What Dhyaan should remember'}
                  value={draftText}
                  onChangeText={setDraftText}
                  placeholder="A whole sentence"
                  multiline
                  maxLength={300}
                />
                {!!factError && <ErrorState inline message={factError} />}
                <Row gap={2}>
                  <Btn
                    kind="quiet"
                    label="Cancel"
                    style={{ flex: 1 }}
                    onPress={closeFactForm}
                  />
                  <Btn
                    label="Save"
                    busy={factBusy}
                    disabled={!draftText.trim()}
                    style={{ flex: 1 }}
                    onPress={saveFact}
                  />
                </Row>
                {!!editing && (
                  confirmDeleteFact ? (
                    <View style={{ gap: sp(2) }}>
                      <Txt kind="caption">
                        Dhyaan will stop knowing this. Answers it already gave keep the
                        words they quoted.
                      </Txt>
                      <Btn
                        label="Delete this note"
                        kind="danger"
                        busy={factBusy}
                        onPress={removeFact}
                      />
                      <Btn
                        label="Keep it"
                        kind="quiet"
                        onPress={() => setConfirmDeleteFact(false)}
                      />
                    </View>
                  ) : (
                    <Btn
                      kind="link"
                      tone="alert"
                      label="Delete this note"
                      onPress={() => setConfirmDeleteFact(true)}
                    />
                  )
                )}
              </View>
            )}
            {!editing && !adding && !!profile && (
              <Btn
                kind="quiet"
                label="Add a note"
                style={{ marginVertical: sp(3) }}
                onPress={() => { setAdding(true); setDraftKey(''); setDraftText(''); setFactError(null); }}
              />
            )}
          </RowGroup>
        </View>

        {/* ---- Camera ---- */}
        <View>
          <Marquee
            title="Her camera"
            meta={profile?.camera ? profile.camera.state : undefined}
          />
          <Card>
            {!profile?.camera ? (
              <EmptyState>
                No camera is set up. Start it on the computer in her home, then finish
                setup from there.
              </EmptyState>
            ) : (
              <>
                {/* The only room name on a family screen, and it is allowed:
                    this is where the FAMILY installed the camera (they picked
                    it in onboarding), not where she is. Labelled "Where it's
                    installed" rather than "Room" so it cannot be misread as
                    whereabouts — D-001 bans her location, not the hardware's. */}
                <KeyValue label="Where it’s installed" value={zoneLabel(profile.camera.zone)} />
                <KeyValue
                  label="State"
                  value={
                    profile.camera.state === 'watching' ? 'Watching'
                      : profile.camera.state === 'paused'
                        ? `Paused${profile.camera.paused_until ? ` until ${timeOf(profile.camera.paused_until)}` : ''}`
                        : profile.camera.state === 'offline' ? 'Not running' : 'Consent off'
                  }
                  style={{ marginTop: sp(2) }}
                />
                <Hairline style={{ marginVertical: sp(3) }} />
                {!confirmStop ? (
                  <Btn kind="link" tone="alert" label="Stop the camera" onPress={() => setConfirmStop(true)} />
                ) : (
                  <View style={{ gap: sp(2) }}>
                    <Txt kind="body">
                      This turns the camera consent off. The camera on her computer stops
                      within ten seconds. Fall detection is unaffected. There is no switch
                      here to turn it back on; that takes setup again, with her.
                    </Txt>
                    {!!cameraError && <ErrorState inline message={cameraError} />}
                    <Btn label="Stop the camera" kind="danger" busy={cameraBusy} onPress={stopCamera} />
                    <Btn label="Leave it running" kind="quiet" onPress={() => setConfirmStop(false)} />
                  </View>
                )}
              </>
            )}
          </Card>
        </View>

        {/* ---- Ladder ---- */}
        <View>
          <Marquee
            title="Who Dhyaan calls, in order"
            meta={contacts ? `${contacts.length} contacts` : undefined}
          />
          <RowGroup>
            {contactsLoading && !contacts && <LoadingState label="Loading…" />}
            {contactsError && !contacts && (
              <ErrorState message="Couldn’t load her contacts." onRetry={refetchContacts} />
            )}
            {!!contacts && contacts.length === 0 && (
              <EmptyState>
                Nobody on the list yet, so a call she doesn’t answer has nowhere to go. The
                list is written during setup, and there isn’t a way to change it from here yet.
              </EmptyState>
            )}
            {(contacts ?? []).map((c, i) => (
              <Row key={c.id} gap={3} style={{ paddingVertical: sp(2.5) }}>
                <Avatar name={c.name} size={34} tone={avatarTone(i)} />
                <Txt kind="body" style={{ flex: 1 }}>{c.name}</Txt>
                <Txt kind="caption" tone="muted">{c.relationship}</Txt>
              </Row>
            ))}
          </RowGroup>
        </View>

        <View>
          <Marquee title="Care file" />
          <Card>
            <CareFileSummary />
          </Card>
        </View>

        {/* ---- What actually happens ----
            Not a preferences pane. There is no endpoint for alert preferences,
            so this states what Dhyaan does today rather than offering switches
            that would forget themselves on unmount. */}
        <View>
          <Marquee title="What Dhyaan does when something happens" />
          <Card>
            <Txt kind="label">If her band detects a fall</Txt>
            <Txt kind="body" style={{ marginTop: sp(1) }}>
              It gives her thirty seconds to cancel, then Dhyaan calls her. If she does
              not answer, it calls the people above, in order, and your phone is told
              at the same time.
            </Txt>
            <Hairline style={{ marginVertical: sp(3) }} />
            <Txt kind="label">Everything else</Txt>
            <Txt kind="body" style={{ marginTop: sp(1) }}>
              Meals, walks, visitors, a long stay in one place — these go on her
              timeline for you to read. Nobody is phoned about them.
            </Txt>
            <Hairline style={{ marginVertical: sp(3) }} />
            <Txt kind="caption" tone="muted">{/* voice-ok */}
              There is nothing to switch here. A fall always calls; nothing else ever
              does. If that ever becomes a choice, it will be made here.
            </Txt>
          </Card>
        </View>

        {/* ---- Consent record ---- */}
        <View>
          <Marquee title="Consent" />
          <Card>
            <Txt kind="caption" tone="muted">
              Recorded for {name}
              {signedBy ? ` by ${signedBy}` : ''}
              {relationship ? ` (${relationship})` : ''}
              {profile?.consent.signed_at ? ` on ${new Date(profile.consent.signed_at).toLocaleDateString()}` : ''}.
            </Txt>
            <View style={{ marginTop: sp(3), gap: sp(1.5) }}>
              {([
                ['Fall detection', profile?.consent.falls],
                ['Camera', profile?.consent.camera],
                ['Keeping a memory of her', profile?.consent.memory],
              ] as const).map(([label, on]) => (
                <KeyValue key={label} label={label} value={on ? 'Agreed' : 'Declined'} tone={on ? 'ok' : 'muted'} />
              ))}
            </View>
          </Card>
        </View>

        {/* ---- Memory / privacy ---- */}
        <View>
          <Marquee title="Her profile" />
          <Card>
            <Txt kind="body">
              Everything Dhyaan keeps about {name} lives on the computer in her home.
              No frame of video was ever kept.
            </Txt>
            {!!forgetResult && (
              <Txt kind="caption" tone="ok" style={{ marginTop: sp(3) }} accessibilityLiveRegion="polite">
                {forgetResult}
              </Txt>
            )}
            <Hairline style={{ marginVertical: sp(3) }} />
            <Btn kind="link" label="Share her data as JSON" onPress={exportData} />
            <Txt kind="caption" tone="muted" style={{ marginTop: sp(1) }}>{/* voice-ok */}
              Opens the share sheet with JSON text: her daily summaries, the last seven days
              of her timeline, and the notes you typed. It is not a printable report.
            </Txt>
            {exportError && <ErrorState inline message={exportError} style={{ marginTop: sp(1) }} />}

            <View style={{ marginTop: sp(4) }}>
              <Rule weight="heavy" />
            </View>

            {/* Irreversible, so each one makes you type her name (DESIGN rule 8). */}
            {destructive !== 'wipe' && (
              destructive !== 'forget' ? (
                <Btn
                  kind="link"
                  tone="alert"
                  label="Forget her profile"
                  onPress={() => openDestructive('forget')}
                  style={{ marginTop: sp(3) }}
                />
              ) : (
                <View style={{ gap: sp(3), marginTop: sp(3) }}>
                  <Txt kind="body">
                    This deletes every note, every observation and everything Dhyaan learned
                    about where she sits. It cannot be undone. Fall detection and the camera
                    keep running, and you stay signed in.
                  </Txt>
                  <Field
                    label={`Type “${name}” to confirm`}
                    value={confirmName}
                    onChangeText={setConfirmName}
                    placeholder={name}
                    autoCorrect={false}
                  />
                  {!!forgetError && <ErrorState inline message={forgetError} />}
                  <Btn
                    label="Forget everything about her"
                    kind="danger"
                    busy={forgetBusy}
                    disabled={!nameTyped}
                    onPress={forget}
                  />
                  <Btn
                    label="Keep her profile"
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
                  label="Delete everything and stop Dhyaan"
                  onPress={() => openDestructive('wipe')}
                  style={{ marginTop: sp(3) }}
                />
              ) : (
                <View style={{ gap: sp(3), marginTop: sp(3) }}>
                  <Txt kind="body">
                    This deletes everything above, then turns off fall detection, the
                    camera and her profile, and signs this phone out. Dhyaan stops
                    watching and stops calling. It cannot be undone.
                  </Txt>
                  <Field
                    label={`Type “${name}” to confirm`}
                    value={confirmName}
                    onChangeText={setConfirmName}
                    placeholder={name}
                    autoCorrect={false}
                  />
                  {!!forgetError && <ErrorState inline message={forgetError} />}
                  <Btn
                    label="Delete everything and stop Dhyaan"
                    kind="danger"
                    busy={forgetBusy}
                    disabled={!nameTyped}
                    onPress={wipeAndStop}
                  />
                  <Btn
                    label="Leave Dhyaan running"
                    kind="quiet"
                    onPress={() => { setDestructive('none'); setConfirmName(''); }}
                  />
                </View>
              )
            )}
          </Card>
        </View>

        {/* ---- Band ----
            No buttons into /onboard/pair or /onboard/survey. Those screens have
            no header and no way back; their only visible exit is Continue,
            which walks the whole setup again and ends by re-saving her consent
            from this session's blank answers, switching everything off. Until
            setup can be re-entered safely, this says what is true. */}
        <View>
          <Marquee title="Her band" />
          <Card>
            <Txt kind="body">
              Her band was paired during setup, and the rooms were walked then. There isn’t a
              way to pair a new band or walk the rooms again from here yet.
            </Txt>
          </Card>
        </View>
      </Stagger>

      <Entrance index={8} style={{ marginTop: sp(8) }}>
        <Btn
          kind="quiet"
          label="Sign out"
          onPress={() => { signOut(); qc.clear(); router.replace('/login'); }}
        />
        <Txt kind="caption" tone="muted" style={{ marginTop: sp(2), textAlign: 'center' }}>{/* voice-ok */}
          Signing out only clears this phone. Nothing about {name} is deleted.
        </Txt>
      </Entrance>
    </Screen>
  );
}
