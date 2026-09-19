// Settings: the ladder, what alerts fire, and the privacy promises — in plain words.
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, Share, Switch, View } from 'react-native';
import { Btn, Card, ErrorState, Hairline, LoadingState, Row, Screen, SectionTitle, Txt } from '@/components';
import { api } from '@/lib/api';
import { API_BASE, USE_MOCKS } from '@/lib/config';
import { ago } from '@/lib/format';
import { useContacts } from '@/lib/hooks';
import { registerForPush, sendTestPush } from '@/lib/push';
import { useSession } from '@/store/session';
import { palette, sp } from '@/theme/tokens';

function Toggle({ label, caption, value, onChange }: {
  label: string; caption: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: sp(2) }}>
      <View style={{ flex: 1, paddingRight: sp(3) }}>
        <Txt kind="label">{label}</Txt>
        <Txt kind="caption" tone="muted">{caption}</Txt>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: palette.slate, false: palette.line }}
      />
    </Row>
  );
}

// ponytail: a screen-only debug view, long-press to reveal — not worth a
// component in components/ since nothing else will ever mount it.
function DebugPanel() {
  const qc = useQueryClient();
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

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // Routed through react-query so this also counts toward "last successful request".
      await qc.fetchQuery({ queryKey: ['debug_ping'], queryFn: api.getContacts, staleTime: 0 });
      setTestResult(`Reached it · ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      setTestResult(`Failed — ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setTesting(false);
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
      <Btn
        label="Test connection"
        kind="quiet"
        busy={testing}
        onPress={testConnection}
        style={{ marginTop: sp(3) }}
      />
      {testResult && <Txt kind="caption" tone="muted" style={{ marginTop: sp(2) }}>{testResult}</Txt>}
    </Card>
  );
}

export default function Settings() {
  const { data: contacts, isLoading: contactsLoading, isError: contactsError, refetch: refetchContacts } = useContacts();
  const { residentName, consentGivenBy, reset, setRole } = useSession();
  const [alerts, setAlerts] = useState({ falls: true, bathroom: true, routine: true });
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [rehearsing, setRehearsing] = useState(false);
  const [rehearseError, setRehearseError] = useState<string | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [pushNote, setPushNote] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);

  const rehearse = async () => {
    setRehearsing(true);
    setRehearseError(null);
    try {
      await api.simulate('fall');
    } catch (e) {
      setRehearseError(e instanceof Error ? e.message : 'Couldn’t reach Dhyaan to start it.');
    } finally {
      setRehearsing(false);
    }
  };

  const registerPush = async () => {
    const { token, reason } = await registerForPush();
    setPushToken(token);
    setPushNote(token ? `Registered · …${token.slice(-8)}` : reason ?? null);
  };

  // ponytail: real export is a backend job (§10.5 has no endpoint yet) —
  // this shares what the app already knows so the control isn't a dead button.
  const exportData = async () => {
    setExportError(null);
    try {
      const [summaries, events] = await Promise.all([
        api.getSummaries('res_eleanor'), api.getEvents('res_eleanor'),
      ]);
      await Share.share({
        title: `${residentName} — Dhyaan export`,
        message: JSON.stringify({ resident: residentName, summaries, events }, null, 2),
      });
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Couldn’t put that together — try again.');
    }
  };

  return (
    <Screen>
      <Pressable onLongPress={() => setDebugOpen((v) => !v)} delayLongPress={600}>
        <Txt kind="display">Settings</Txt>
      </Pressable>
      {debugOpen && <DebugPanel />}

      <SectionTitle>Who gets called, in order</SectionTitle>
      <Card>
        {contactsLoading && !contacts && <LoadingState label="Loading contacts…" />}
        {contactsError && !contacts && (
          <ErrorState message="Couldn’t load her contacts." onRetry={refetchContacts} />
        )}
        {(contacts ?? []).map((c, i) => (
          <View key={c.id}>
            {i > 0 && <Hairline style={{ marginVertical: sp(2) }} />}
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt kind="body">{c.ladder_order}. {c.name}</Txt>
              <Txt kind="caption" tone="muted">{c.relationship}</Txt>
            </Row>
          </View>
        ))}
        {!contactsLoading && !contactsError && (
          <Txt kind="caption" tone="muted" style={{ marginTop: sp(3) }}>
            {residentName} is always called first. Change the order by re-running setup.
          </Txt>
        )}
      </Card>

      <SectionTitle>What Dhyaan tells you about</SectionTitle>
      <Card>
        <Toggle
          label="Falls"
          caption="A call to her, then the ladder. This one can’t be turned off."
          value={alerts.falls}
          onChange={() => { /* falls stay on — the caption says why */ }}
        />
        <Hairline />
        <Toggle
          label="Long bathroom stays"
          caption="When she’s in far longer than her usual"
          value={alerts.bathroom}
          onChange={(v) => setAlerts((a) => ({ ...a, bathroom: v }))}
        />
        <Hairline />
        <Toggle
          label="Changes in routine"
          caption="Missed meals, fewer walks, up at night — next morning, never at 2 AM"
          value={alerts.routine}
          onChange={(v) => setAlerts((a) => ({ ...a, routine: v }))}
        />
      </Card>
      <Txt kind="caption" tone="muted" style={{ marginTop: sp(2) }}>
        Quiet hours 9 PM – 7 AM · routine nudges wait until morning.
      </Txt>

      <SectionTitle>Privacy</SectionTitle>
      <Card>
        <Txt kind="body">
          Dhyaan senses movement from her band and which room she’s in. It never records
          audio or video you can watch — video never leaves the home, and no one in the
          family can view a feed. What you see are sentences about her day, nothing more.
        </Txt>
        <Hairline style={{ marginVertical: sp(3) }} />
        <Txt kind="caption" tone="muted">
          Consent for {residentName}
          {consentGivenBy ? ` was given by ${consentGivenBy}` : ' was recorded during setup'}.
          Dhyaan is not a medical device and does not call 911.
        </Txt>
        <Pressable onPress={exportData} style={{ marginTop: sp(3) }}>
          <Txt kind="label" tone="slate">Export her data</Txt>
        </Pressable>
        {exportError && <Txt kind="caption" tone="alert" style={{ marginTop: sp(1) }}>{exportError}</Txt>}
        <Pressable onPress={() => setConfirmingRevoke(true)} style={{ marginTop: sp(3) }}>
          <Txt kind="label" tone="alert">Revoke consent and delete everything</Txt>
        </Pressable>
        {confirmingRevoke && (
          <View style={{ marginTop: sp(3), gap: sp(2) }}>
            <Txt kind="body" tone="muted">
              This removes {residentName}’s history and stops all sensing. There’s no undo.
            </Txt>
            <Btn
              label="Yes — delete everything"
              kind="danger"
              onPress={() => { reset(); router.replace('/onboard/welcome'); }}
            />
            <Btn label="Keep Dhyaan running" kind="quiet" onPress={() => setConfirmingRevoke(false)} />
          </View>
        )}
      </Card>

      <SectionTitle>Try it</SectionTitle>
      <Txt kind="caption" tone="muted" style={{ marginBottom: sp(3) }}>
        Safe to press — nothing here calls a real phone.
      </Txt>
      <View style={{ gap: sp(2) }}>
        <Btn label="Rehearse a fall alert" kind="quiet" busy={rehearsing} onPress={rehearse} />
        <Txt kind="caption" tone="muted">
          Plays the whole escalation, start to finish, with simulated calls.
        </Txt>
        {rehearseError && <Txt kind="caption" tone="alert">{rehearseError}</Txt>}
        <Btn
          label="See the staff side"
          kind="quiet"
          onPress={() => { setRole('staff'); router.replace('/(staff)'); }}
        />
        <Btn label="Register this phone for push" kind="quiet" onPress={registerPush} />
        {pushNote && <Txt kind="caption" tone="muted">{pushNote}</Txt>}
        {pushToken && (
          <Btn label="Send a test fall push" kind="quiet" onPress={() => sendTestPush(pushToken)} />
        )}
      </View>
    </Screen>
  );
}
