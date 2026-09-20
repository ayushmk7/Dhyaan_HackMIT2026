// Settings. What Dhyaan was told, where the camera is, who it calls — and the
// buttons that undo all of it. Stop the camera and Forget her profile are
// real: one turns consent off at the server (the worker stops within ten
// seconds), the other deletes every fact, observation and camera event and
// makes you type her name first, because it cannot be undone.
// The native header owns the title; long-press the first section for debug.
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, Share, Switch, View } from 'react-native';
import {
  Btn, Card, ErrorState, FactRow, Field, Hairline, LoadingState, Row, Screen,
  SectionTitle, Txt,
} from '@/components';
import { Avatar } from '@/components/avatar';
import { api } from '@/lib/api';
import { API_BASE, USE_MOCKS } from '@/lib/config';
import { ago, timeOf, zoneLabel } from '@/lib/format';
import { useContacts, useProfile } from '@/lib/hooks';
import { registerForPush, sendTestPush } from '@/lib/push';
import { useCareFile } from '@/store/carefile';
import { useSession } from '@/store/session';
import type { Fact } from '@/lib/types';
import { palette, sp } from '@/theme/tokens';

const AVATAR_TONES = ['green', 'amber', 'blue'] as const;

function Toggle({ label, value, onChange, disabled = false }: {
  label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: sp(2.5) }}>
      <Txt kind="body">{label}</Txt>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: palette.slate, false: palette.line }}
      />
    </Row>
  );
}

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

  const registerPush = async () => {
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
    <Card style={{ marginTop: sp(3), backgroundColor: palette.slateWash }}>
      <Txt kind="label">Debug</Txt>
      <Row style={{ justifyContent: 'space-between', marginTop: sp(2) }}>
        <Txt kind="caption" tone="muted">Mode</Txt>
        <Txt kind="caption">{USE_MOCKS ? 'Mock data' : 'Live backend'}</Txt>
      </Row>
      <Row style={{ justifyContent: 'space-between', marginTop: sp(1.5) }}>
        <Txt kind="caption" tone="muted">API base</Txt>
        <Txt kind="caption" style={{ flexShrink: 1, textAlign: 'right' }} numberOfLines={1}>
          {API_BASE}
        </Txt>
      </Row>
      <Row style={{ justifyContent: 'space-between', marginTop: sp(1.5) }}>
        <Txt kind="caption" tone="muted">Last successful request</Txt>
        <Txt kind="caption">{lastSuccess ? ago(new Date(lastSuccess).toISOString()) : 'none yet'}</Txt>
      </Row>
      {/* Stacked, not a row: side-by-side buttons clip their labels at SE width. */}
      <View style={{ gap: sp(2), marginTop: sp(3) }}>
        <Btn label="Test connection" kind="quiet" busy={testing} onPress={testConnection} />
        <Btn label="Rehearse a fall alert" kind="quiet" busy={rehearsing} onPress={rehearse} />
        <Btn label="Simulate a meal" kind="quiet" busy={simulating} onPress={() => simulate('meal')} />
        <Btn label="Simulate a visitor" kind="quiet" busy={simulating} onPress={() => simulate('visitor')} />
        <Btn label="Simulate out of view" kind="quiet" busy={simulating} onPress={() => simulate('out_of_view')} />
        <Btn label="Register for push" kind="quiet" onPress={registerPush} />
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
        <Txt kind="body">Med lists and letters become reminders and an emergency card.</Txt>
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
    residentId, residentName, consentGivenBy, consentRelationship, signOut, reset,
  } = useSession();
  const {
    data: profile, isLoading: profileLoading, isError: profileError, refetch: refetchProfile,
  } = useProfile(residentId);
  const {
    data: contacts, isLoading: contactsLoading, isError: contactsError, refetch: refetchContacts,
  } = useContacts();

  const [alerts, setAlerts] = useState({ falls: true, bathroom: true, routine: true });

  const [editing, setEditing] = useState<Fact | null>(null);
  const [adding, setAdding] = useState(false);
  const [draftKey, setDraftKey] = useState('');
  const [draftText, setDraftText] = useState('');
  const [factBusy, setFactBusy] = useState(false);
  const [factError, setFactError] = useState<string | null>(null);

  const [confirmStop, setConfirmStop] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [forgetOpen, setForgetOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [forgetBusy, setForgetBusy] = useState(false);
  const [forgetError, setForgetError] = useState<string | null>(null);
  const [forgetResult, setForgetResult] = useState<string | null>(null);

  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);

  const name = profile?.name ?? residentName;
  const facts = profile?.facts ?? [];

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
      setEditing(null);
      setAdding(false);
      setDraftKey('');
      setDraftText('');
    } catch (e) {
      setFactError(e instanceof Error ? e.message : 'Couldn’t save that.');
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
      setForgetOpen(false);
      setConfirmName('');
      await qc.invalidateQueries();
    } catch (e) {
      setForgetError(e instanceof Error ? e.message : 'Nothing was deleted.');
    } finally {
      setForgetBusy(false);
    }
  };

  // ponytail: real export is a backend job. This shares what the app already
  // holds so the control isn't a dead button.
  const exportData = async () => {
    setExportError(null);
    try {
      const [summaries, events] = await Promise.all([
        api.getSummaries(residentId), api.getEvents(residentId),
      ]);
      await Share.share({
        title: `${name} export`,
        message: JSON.stringify({ resident: name, summaries, events }, null, 2),
      });
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Couldn’t put that together. Try again.');
    }
  };

  return (
    <Screen native>
      {/* ---- About her ---- */}
      <Pressable onLongPress={() => setDebugOpen((v) => !v)} delayLongPress={600}>
        <SectionTitle>What Dhyaan was told about her</SectionTitle>
      </Pressable>
      {debugOpen && <DebugPanel />}
      <Card>
        {profileLoading && !profile && <LoadingState label="Loading her profile…" />}
        {profileError && !profile && (
          <ErrorState message="Couldn’t load what Dhyaan was told." onRetry={refetchProfile} />
        )}
        {!!profile && facts.length === 0 && (
          <Txt kind="body" tone="muted">{/* voice-ok */}
            Nothing told to Dhyaan yet. Until you add what you know, it will say it
            wasn’t told, rather than guess.
          </Txt>
        )}
        {facts.map((f, i) => (
          <View key={f.id}>
            {i > 0 && <Hairline />}
            <FactRow
              fact={f}
              onPress={() => {
                setEditing(f);
                setAdding(false);
                setDraftText(f.text);
                setFactError(null);
              }}
            />
          </View>
        ))}
        {!!profile?.appearance && (
          <>
            <Hairline style={{ marginVertical: sp(2) }} />
            <Txt kind="label" tone="muted">How you described her</Txt>
            <Txt kind="body" style={{ marginTop: 2 }}>{profile.appearance}</Txt>
          </>
        )}
        {!!profile?.usual_spots?.length && (
          <>
            <Hairline style={{ marginVertical: sp(2) }} />
            <Txt kind="label" tone="muted">Her usual spots</Txt>
            {profile.usual_spots.map((spot) => (
              <Txt key={spot} kind="body" style={{ marginTop: 2 }}>{spot}</Txt>
            ))}
          </>
        )}

        {(editing || adding) && (
          <View style={{ marginTop: sp(4), gap: sp(3) }}>
            <Hairline />
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
            {!!factError && <Txt kind="caption" tone="alert">{factError}</Txt>}
            <Row gap={2}>
              <Btn
                kind="quiet"
                label="Cancel"
                style={{ flex: 1 }}
                onPress={() => { setEditing(null); setAdding(false); setDraftText(''); setFactError(null); }}
              />
              <Btn
                label="Save"
                busy={factBusy}
                disabled={!draftText.trim()}
                style={{ flex: 1 }}
                onPress={saveFact}
              />
            </Row>
          </View>
        )}
        {!editing && !adding && !!profile && (
          <Btn
            kind="quiet"
            label="Add a note"
            style={{ marginTop: sp(4) }}
            onPress={() => { setAdding(true); setDraftKey(''); setDraftText(''); setFactError(null); }}
          />
        )}
      </Card>

      {/* ---- Camera ---- */}
      <SectionTitle>Her camera</SectionTitle>
      <Card>
        {!profile?.camera ? (
          <Txt kind="body" tone="muted">{/* voice-ok */}
            No camera is set up. Start it on the computer in her home, then finish
            setup from there.
          </Txt>
        ) : (
          <>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt kind="caption" tone="muted">Room</Txt>
              <Txt kind="caption">{zoneLabel(profile.camera.zone)}</Txt>
            </Row>
            <Row style={{ justifyContent: 'space-between', marginTop: sp(2) }}>
              <Txt kind="caption" tone="muted">State</Txt>
              <Txt kind="caption">
                {profile.camera.state === 'watching' ? 'Watching'
                  : profile.camera.state === 'paused'
                    ? `Paused${profile.camera.paused_until ? ` until ${timeOf(profile.camera.paused_until)}` : ''}`
                    : profile.camera.state === 'offline' ? 'Not running' : 'Consent off'}
              </Txt>
            </Row>
            <Hairline style={{ marginVertical: sp(3) }} />
            {!confirmStop ? (
              <Pressable accessibilityRole="button" onPress={() => setConfirmStop(true)}>
                <Txt kind="label" tone="alert">Stop the camera</Txt>
              </Pressable>
            ) : (
              <View style={{ gap: sp(2) }}>
                <Txt kind="body">
                  This turns the camera consent off. The camera on her computer stops
                  within ten seconds. Fall detection is unaffected.
                </Txt>
                {!!cameraError && <Txt kind="caption" tone="alert">{cameraError}</Txt>}
                <Btn label="Stop the camera" kind="danger" busy={cameraBusy} onPress={stopCamera} />
                <Btn label="Leave it running" kind="quiet" onPress={() => setConfirmStop(false)} />
              </View>
            )}
          </>
        )}
      </Card>

      {/* ---- Ladder ---- */}
      <SectionTitle>Who Dhyaan calls, in order</SectionTitle>
      <Card style={{ paddingVertical: sp(2) }}>
        {contactsLoading && !contacts && <LoadingState label="Loading…" />}
        {contactsError && !contacts && (
          <ErrorState message="Couldn’t load her contacts." onRetry={refetchContacts} />
        )}
        {!!contacts && contacts.length === 0 && (
          <Txt kind="body" tone="muted">{/* voice-ok */}
            Nobody on the list yet. A call she doesn’t answer has nowhere to go — add
            someone by running setup again.
          </Txt>
        )}
        {(contacts ?? []).map((c, i) => (
          <View key={c.id}>
            {i > 0 && <Hairline />}
            <Row gap={3} style={{ paddingVertical: sp(2.5) }}>
              <Avatar name={c.name} size={34} tone={AVATAR_TONES[i % AVATAR_TONES.length]} />
              <Txt kind="body" style={{ flex: 1 }}>{c.name}</Txt>
              <Txt kind="caption" tone="muted">{c.relationship}</Txt>
            </Row>
          </View>
        ))}
      </Card>

      <SectionTitle>Care file</SectionTitle>
      <Card>
        <CareFileSummary />
      </Card>

      <SectionTitle>Alerts</SectionTitle>
      <Card style={{ paddingVertical: sp(1.5) }}>
        <Toggle label="Falls" value={alerts.falls} disabled onChange={() => {}} />
        <Hairline />
        <Toggle
          label="Bathroom stays"
          value={alerts.bathroom}
          onChange={(v) => setAlerts((a) => ({ ...a, bathroom: v }))}
        />
        <Hairline />
        <Toggle
          label="Routine changes"
          value={alerts.routine}
          onChange={(v) => setAlerts((a) => ({ ...a, routine: v }))}
        />
      </Card>

      {/* ---- Consent record ---- */}
      <SectionTitle>Consent</SectionTitle>
      <Card>
        <Txt kind="caption" tone="muted">
          Recorded for {name}
          {consentGivenBy ? ` by ${consentGivenBy}` : ''}
          {consentRelationship ? ` (${consentRelationship})` : ''}
          {profile?.consent.signed_at ? ` on ${new Date(profile.consent.signed_at).toLocaleDateString()}` : ''}.
        </Txt>
        <View style={{ marginTop: sp(3), gap: sp(1.5) }}>
          {([
            ['Fall detection', profile?.consent.falls],
            ['Camera', profile?.consent.camera],
            ['Keeping a memory of her', profile?.consent.memory],
          ] as const).map(([label, on]) => (
            <Row key={label} style={{ justifyContent: 'space-between' }}>
              <Txt kind="caption" tone="muted">{label}</Txt>
              <Txt kind="caption" tone={on ? 'ok' : 'muted'}>{on ? 'Agreed' : 'Declined'}</Txt>
            </Row>
          ))}
        </View>
      </Card>

      {/* ---- Memory / privacy ---- */}
      <SectionTitle>Her profile</SectionTitle>
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
        <Pressable onPress={exportData}>
          <Txt kind="label" tone="slate">Export her data</Txt>
        </Pressable>
        {exportError && <Txt kind="caption" tone="alert" style={{ marginTop: sp(1) }}>{exportError}</Txt>}
        {!forgetOpen ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => { setForgetOpen(true); setForgetError(null); }}
            style={{ marginTop: sp(3) }}
          >
            <Txt kind="label" tone="alert">Forget her profile</Txt>
          </Pressable>
        ) : (
          <View style={{ gap: sp(3), marginTop: sp(3) }}>
            <Txt kind="body">
              This deletes every note, every observation and everything Dhyaan learned
              about where she sits. It cannot be undone.
            </Txt>
            <Field
              label={`Type “${name}” to confirm`}
              value={confirmName}
              onChangeText={setConfirmName}
              placeholder={name}
              autoCorrect={false}
            />
            {!!forgetError && <Txt kind="caption" tone="alert">{forgetError}</Txt>}
            <Btn
              label="Forget everything about her"
              kind="danger"
              busy={forgetBusy}
              disabled={confirmName.trim().toLowerCase() !== name.toLowerCase()}
              onPress={forget}
            />
            <Btn label="Keep her profile" kind="quiet" onPress={() => { setForgetOpen(false); setConfirmName(''); }} />
          </View>
        )}
        <Pressable onPress={() => setConfirmingRevoke(true)} style={{ marginTop: sp(3) }}>
          <Txt kind="label" tone="alert">Delete everything</Txt>
        </Pressable>
        {confirmingRevoke && (
          <View style={{ marginTop: sp(3), gap: sp(2) }}>
            <Txt kind="body">
              This deletes {name}’s history and stops all sensing.
            </Txt>
            <Btn
              label="Delete everything"
              kind="danger"
              onPress={() => { reset(); router.replace('/onboard/welcome'); }}
            />
            <Btn label="Cancel" kind="quiet" onPress={() => setConfirmingRevoke(false)} />
          </View>
        )}
      </Card>

      {/* ---- Band ---- */}
      <SectionTitle>Her band</SectionTitle>
      <View style={{ gap: sp(2) }}>
        <Btn kind="quiet" label="Pair a band" onPress={() => router.push('/onboard/pair')} />
        <Btn kind="quiet" label="Survey a room" onPress={() => router.push('/onboard/survey')} />
      </View>

      <Hairline style={{ marginVertical: sp(6) }} />
      <Btn
        kind="quiet"
        label="Sign out"
        onPress={() => { signOut(); qc.clear(); router.replace('/login'); }}
      />
    </Screen>
  );
}
