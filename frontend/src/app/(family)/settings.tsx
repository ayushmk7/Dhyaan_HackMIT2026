// Settings: the ladder, what alerts fire, and the privacy promises — in plain words.
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { Btn, Card, Hairline, Row, Screen, SectionTitle, Txt } from '@/components';
import { api } from '@/lib/api';
import { useContacts } from '@/lib/hooks';
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

export default function Settings() {
  const { data: contacts } = useContacts();
  const { residentName, consentGivenBy, reset, setRole } = useSession();
  const [alerts, setAlerts] = useState({ falls: true, bathroom: true, routine: true });
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [rehearsing, setRehearsing] = useState(false);

  const rehearse = async () => {
    setRehearsing(true);
    await api.simulate('fall');
    setRehearsing(false);
  };

  return (
    <Screen>
      <Txt kind="display">Settings</Txt>

      <SectionTitle>Who gets called, in order</SectionTitle>
      <Card>
        {(contacts ?? []).map((c, i) => (
          <View key={c.id}>
            {i > 0 && <Hairline style={{ marginVertical: sp(2) }} />}
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt kind="body">{c.ladder_order}. {c.name}</Txt>
              <Txt kind="caption" tone="muted">{c.relationship}</Txt>
            </Row>
          </View>
        ))}
        <Txt kind="caption" tone="muted" style={{ marginTop: sp(3) }}>
          {residentName} is always called first. Change the order by re-running setup.
        </Txt>
      </Card>

      <SectionTitle>What Kestrel tells you about</SectionTitle>
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
          Kestrel senses movement from her band and which room she’s in. It never records
          audio or video you can watch — video never leaves the home, and no one in the
          family can view a feed. What you see are sentences about her day, nothing more.
        </Txt>
        <Hairline style={{ marginVertical: sp(3) }} />
        <Txt kind="caption" tone="muted">
          Consent for {residentName}
          {consentGivenBy ? ` was given by ${consentGivenBy}` : ' was recorded during setup'}.
          Kestrel is not a medical device and does not call 911.
        </Txt>
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
            <Btn label="Keep Kestrel running" kind="quiet" onPress={() => setConfirmingRevoke(false)} />
          </View>
        )}
      </Card>

      <Hairline style={{ marginTop: sp(8), marginBottom: sp(4) }} />
      <View style={{ gap: sp(2) }}>
        <Btn label="Rehearse a fall alert" kind="quiet" busy={rehearsing} onPress={rehearse} />
        <Txt kind="caption" tone="muted">
          Runs the real escalation ladder against the demo backend.
        </Txt>
        <Btn
          label="Switch to staff demo"
          kind="quiet"
          onPress={() => { setRole('staff'); router.replace('/(staff)'); }}
        />
      </View>
    </Screen>
  );
}
