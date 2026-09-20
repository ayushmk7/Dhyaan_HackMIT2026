// The escalation ladder. Order matters — this is who Dhyaan calls, in order,
// when she doesn’t answer.
//
// The list starts EMPTY. It used to open with a hardcoded "Priya Sharma,
// Daughter", rendered exactly like a person the user had added: tapping
// straight through saved a fictional daughter as contact #1, which is the
// first number Dhyaan dials in an emergency. A name on this screen may only
// ever be one somebody typed.
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  Btn, Card, Entrance, Field, Marquee, Row, Rule, Screen, Txt,
} from '@/components';
import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { api } from '@/lib/api';
import { mono, palette, sp } from '@/theme/tokens';
import { useSession } from '@/store/session';

const AVATAR_TONES = ['green', 'amber', 'blue'] as const;

type Draft = { name: string; phone: string; relationship: string };
const emptyDraft: Draft = { name: '', phone: '', relationship: '' };

export default function Contacts() {
  const { residentName } = useSession();
  const [contacts, setContacts] = useState<Draft[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    try {
      await api.saveContacts(contacts.map((c, i) => ({ ...c, ladder_order: i + 1 })));
      router.push('/onboard/done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save the call list. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      wash
      floatingBar={
        <Btn
          label="Continue"
          busy={busy}
          disabled={contacts.length < 1}
          onPress={finish}
        />
      }
    >
      <Entrance index={0}>
        <Marquee
          first
          title="Who should Dhyaan call?"
          meta={contacts.length ? `${contacts.length} on the list` : undefined}
        />
        <Txt kind="body">
          Called in order if {residentName} doesn’t answer.
        </Txt>
      </Entrance>

      {contacts.length === 0 && !adding && (
        <Entrance index={1}>
          <Card style={{ marginTop: sp(5) }}>
            <Txt kind="body">{/* voice-ok */}
              Add at least one person. If nobody is on this list, a call that she doesn’t
              answer has nowhere to go.
            </Txt>
            <Btn
              label="Add the first person"
              style={{ marginTop: sp(4) }}
              onPress={() => setAdding(true)}
            />
          </Card>
        </Entrance>
      )}

      <View style={{ marginTop: contacts.length ? sp(5) : 0, gap: sp(3) }}>
        {contacts.map((c, i) => (
          <Entrance key={`${c.name}-${i}`} index={1 + i}>
            <Card>
              <Row style={{ justifyContent: 'space-between' }}>
                <Row gap={3} style={{ flex: 1 }}>
                  {/* Numbered because this list is genuinely sequential — the
                      one place in the app where a number means an order. */}
                  <Txt style={[mono.stamp, { color: palette.inkMuted }]}>{i + 1}</Txt>
                  <Avatar name={c.name} size={34} tone={AVATAR_TONES[i % AVATAR_TONES.length]} />
                  <View style={{ flex: 1 }}>
                    <Txt kind="label">{c.name}</Txt>
                    <Txt kind="caption" tone="muted">{c.relationship} · {c.phone}</Txt>
                  </View>
                </Row>
                <Row gap={1}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Move ${c.name} earlier`} onPress={() => move(i, -1)} style={styles.arrow}>
                    <Icon name="chevron.up" size={13} color={i === 0 ? palette.line : palette.ink} />
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Move ${c.name} later`} onPress={() => move(i, 1)} style={styles.arrow}>
                    <Icon name="chevron.down" size={13} color={i === contacts.length - 1 ? palette.line : palette.ink} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${c.name}`}
                    onPress={() => setContacts((cs) => cs.filter((_, j) => j !== i))}
                    style={styles.arrow}
                  >
                    <Icon name="xmark" size={13} color={palette.inkMuted} />
                  </Pressable>
                </Row>
              </Row>
            </Card>
          </Entrance>
        ))}
      </View>

      {adding ? (
        <Card style={{ marginTop: sp(4) }}>
          <Field
            label="Name" placeholder="Their full name"
            value={draft.name} onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
          />
          <Field
            label="Phone number" placeholder="+1 617 555 0142" keyboardType="phone-pad"
            style={{ marginTop: sp(3) }}
            value={draft.phone} onChangeText={(phone) => setDraft((d) => ({ ...d, phone }))}
          />
          <Field
            label="Relationship" placeholder="Daughter, neighbour"
            style={{ marginTop: sp(3) }}
            value={draft.relationship} onChangeText={(relationship) => setDraft((d) => ({ ...d, relationship }))}
          />
          <Row gap={3} style={{ marginTop: sp(4) }}>
            <Btn kind="quiet" label="Cancel" onPress={() => setAdding(false)} style={{ flex: 1 }} />
            <Btn label="Add" onPress={addDraft} disabled={!draft.name.trim() || !draft.phone.trim()} style={{ flex: 1 }} />
          </Row>
        </Card>
      ) : contacts.length > 0 ? (
        <Btn kind="quiet" label="Add another person" onPress={() => setAdding(true)} style={{ marginTop: sp(4) }} />
      ) : null}

      {!!error && (
        <>
          <Rule style={{ marginTop: sp(6) }} />
          <Txt kind="caption" tone="alert" style={{ marginTop: sp(2) }} accessibilityLiveRegion="polite">
            {error}
          </Txt>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  arrow: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
});
