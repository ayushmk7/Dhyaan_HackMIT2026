// Settings. The native header owns the title; chrome stays mute.
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, Share, Switch, View } from 'react-native';
import { Btn, Card, ErrorState, Hairline, LoadingState, Row, Screen, SectionTitle, Txt } from '@/components';
import { Avatar } from '@/components/avatar';
import { api } from '@/lib/api';
import { API_BASE, USE_MOCKS } from '@/lib/config';
import { ago } from '@/lib/format';
import { useContacts } from '@/lib/hooks';
import { registerForPush, sendTestPush } from '@/lib/push';
import { useCareFile } from '@/store/carefile';
import { useSession } from '@/store/session';
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

// Screen-only debug view, long-press the People header to reveal. Every demo
// control lives here so the visible app carries no demo chrome.
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
      <View style={{ gap: sp(2), marginTop: sp(3) }}>
        <Btn label="Test connection" kind="quiet" busy={testing} onPress={testConnection} />
        <Btn label="Rehearse a fall alert" kind="quiet" busy={rehearsing} onPress={rehearse} />
        <Btn
          label="Staff side"
          kind="quiet"
          onPress={() => { setRole('staff'); router.replace('/(staff)/triage'); }}
        />
        <Btn label="Register for push" kind="quiet" onPress={registerPush} />
        {pushToken && (
          <Btn label="Send a test fall push" kind="quiet" onPress={() => sendTestPush(pushToken)} />
        )}
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
  const { data: contacts, isLoading: contactsLoading, isError: contactsError, refetch: refetchContacts } = useContacts();
  const { residentName, consentGivenBy, reset } = useSession();
  const [alerts, setAlerts] = useState({ falls: true, bathroom: true, routine: true });
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);

  // ponytail: real export is a backend job. This shares what the app already
  // holds so the control isn't a dead button.
  const exportData = async () => {
    setExportError(null);
    try {
      const [summaries, events] = await Promise.all([
        api.getSummaries('res_eleanor'), api.getEvents('res_eleanor'),
      ]);
      await Share.share({
        title: `${residentName} export`,
        message: JSON.stringify({ resident: residentName, summaries, events }, null, 2),
      });
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Couldn’t put that together. Try again.');
    }
  };

  return (
    <Screen native>
      <Pressable onLongPress={() => setDebugOpen((v) => !v)} delayLongPress={600}>
        <SectionTitle>People</SectionTitle>
      </Pressable>
      {debugOpen && <DebugPanel />}
      <Card style={{ paddingVertical: sp(2) }}>
        {contactsLoading && !contacts && <LoadingState label="Loading…" />}
        {contactsError && !contacts && (
          <ErrorState message="Couldn’t load her contacts." onRetry={refetchContacts} />
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

      <SectionTitle>Privacy</SectionTitle>
      <Card>
        <Txt kind="body">
          No video or audio ever leaves her home. Family sees sentences, never footage.
        </Txt>
        <Txt kind="caption" tone="muted" style={{ marginTop: sp(2) }}>
          Consent recorded{consentGivenBy ? ` by ${consentGivenBy}` : ''}.
        </Txt>
        <Hairline style={{ marginVertical: sp(3) }} />
        <Pressable onPress={exportData}>
          <Txt kind="label" tone="slate">Export her data</Txt>
        </Pressable>
        {exportError && <Txt kind="caption" tone="alert" style={{ marginTop: sp(1) }}>{exportError}</Txt>}
        <Pressable onPress={() => setConfirmingRevoke(true)} style={{ marginTop: sp(3) }}>
          <Txt kind="label" tone="alert">Delete everything</Txt>
        </Pressable>
        {confirmingRevoke && (
          <View style={{ marginTop: sp(3), gap: sp(2) }}>
            <Txt kind="body">
              This deletes {residentName}’s history and stops all sensing.
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
    </Screen>
  );
}
