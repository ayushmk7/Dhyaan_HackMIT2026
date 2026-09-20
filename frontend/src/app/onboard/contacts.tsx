// The escalation ladder. Order matters — this is who Dhyaan calls, in order,
// when she doesn’t answer.
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Btn, Card, Hairline, Row, Screen, Txt } from '@/components';
import { Avatar } from '@/components/avatar';
import { api } from '@/lib/api';
import { palette, radius, sp, type } from '@/theme/tokens';
import { useSession } from '@/store/session';

const AVATAR_TONES = ['green', 'amber', 'blue'] as const;

type Draft = { name: string; phone: string; relationship: string };
const emptyDraft: Draft = { name: '', phone: '', relationship: '' };

export default function Contacts() {
  const { residentName, finishOnboarding } = useSession();
  const [contacts, setContacts] = useState<Draft[]>([
    { name: 'Priya Sharma', phone: '+1 617 555 0142', relationship: 'Daughter' },
  ]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= contacts.length) return;
    const next = [...contacts];
    [next[i], next[j]] = [next[j], next[i]];
    setContacts(next);
  };

  const addDraft = () => {
    if (!draft.name.trim() || !draft.phone.trim()) return;
    setContacts((c) => [...c, draft]);
    setDraft(emptyDraft);
    setAdding(false);
  };

  const finish = async () => {
    setBusy(true);
    await api.saveContacts(contacts.map((c, i) => ({ ...c, ladder_order: i + 1 })));
    finishOnboarding();
    router.replace('/(family)/home');
  };

  return (
    <Screen>
      <Txt kind="title">Who should Dhyaan call?</Txt>
      <Txt kind="body" style={{ marginTop: sp(2) }}>
        Called in order if {residentName} doesn’t answer.
      </Txt>

      <View style={{ marginTop: sp(5), gap: sp(3) }}>
        {contacts.map((c, i) => (
          <Card key={`${c.name}-${i}`}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Row gap={3} style={{ flex: 1 }}>
                <Avatar name={c.name} size={34} tone={AVATAR_TONES[i % AVATAR_TONES.length]} />
                <View style={{ flex: 1 }}>
                  <Txt kind="label">{c.name}</Txt>
                  <Txt kind="caption" tone="muted">{c.relationship} · {c.phone}</Txt>
                </View>
              </Row>
              <Row gap={1}>
                <Pressable accessibilityLabel={`Move ${c.name} earlier`} onPress={() => move(i, -1)} style={styles.arrow}>
                  <Txt kind="label" tone={i === 0 ? 'muted' : 'slate'}>↑</Txt>
                </Pressable>
                <Pressable accessibilityLabel={`Move ${c.name} later`} onPress={() => move(i, 1)} style={styles.arrow}>
                  <Txt kind="label" tone={i === contacts.length - 1 ? 'muted' : 'slate'}>↓</Txt>
                </Pressable>
                <Pressable
                  accessibilityLabel={`Remove ${c.name}`}
                  onPress={() => setContacts((cs) => cs.filter((_, j) => j !== i))}
                  style={styles.arrow}
                >
                  <Txt kind="label" tone="muted">✕</Txt>
                </Pressable>
              </Row>
            </Row>
          </Card>
        ))}
      </View>

      {adding ? (
        <Card style={{ marginTop: sp(4) }}>
          <TextInput
            style={styles.input} placeholder="Name" placeholderTextColor={palette.inkMuted}
            value={draft.name} onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
          />
          <TextInput
            style={[styles.input, { marginTop: sp(2) }]} placeholder="Phone number"
            placeholderTextColor={palette.inkMuted} keyboardType="phone-pad"
            value={draft.phone} onChangeText={(phone) => setDraft((d) => ({ ...d, phone }))}
          />
          <TextInput
            style={[styles.input, { marginTop: sp(2) }]} placeholder="Relationship"
            placeholderTextColor={palette.inkMuted}
            value={draft.relationship} onChangeText={(relationship) => setDraft((d) => ({ ...d, relationship }))}
          />
          <Row gap={3} style={{ marginTop: sp(3) }}>
            <Btn kind="quiet" label="Cancel" onPress={() => setAdding(false)} style={{ flex: 1 }} />
            <Btn label="Add" onPress={addDraft} disabled={!draft.name.trim() || !draft.phone.trim()} style={{ flex: 1 }} />
          </Row>
        </Card>
      ) : (
        <Btn kind="quiet" label="Add another person" onPress={() => setAdding(true)} style={{ marginTop: sp(4) }} />
      )}

      <Hairline style={{ marginVertical: sp(6) }} />

      <Btn
        label="Finish"
        busy={busy}
        disabled={contacts.length < 1}
        onPress={finish}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  arrow: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  input: {
    ...type.body,
    color: palette.ink,
    backgroundColor: palette.paper,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.tile,
    paddingHorizontal: sp(3),
    paddingVertical: sp(2.5),
  },
});
