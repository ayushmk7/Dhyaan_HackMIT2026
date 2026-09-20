// The escalation ladder. Order matters: this is who Dhyaan calls, in order,
// when she doesn’t answer.
//
// The list starts EMPTY. It used to open with a hardcoded "Priya Sharma,
// Daughter", rendered exactly like a person the user had added: tapping
// straight through saved a fictional daughter as contact #1, which is the
// first number Dhyaan dials in an emergency. A name on this screen may only
// ever be one somebody typed.
//
// The people are rows, not cards, and the number is the loudest thing in each
// row because the number is the point. The add form is the same column of
// fields on the paper, not a box.
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import {
  Btn, Entrance, ErrorState, Field, IconBtn, Marquee, Row, Rule, Screen, Txt,
} from '@/components';
import { Avatar, avatarTone } from '@/components/avatar';
import { api } from '@/lib/api';
import { onboard } from '@/lib/copy/staff';
import { sp } from '@/theme/tokens';
import { useSession } from '@/store/session';

const copy = onboard.contacts;

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
      setError(e instanceof Error ? e.message : copy.saveError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      native
      wash
      floatingBar={
        <Btn
          label={copy.continue}
          busy={busy}
          disabled={contacts.length < 1}
          onPress={finish}
        />
      }
    >
      <Entrance index={0}>
        <Marquee
          first
          title={copy.title}
          meta={contacts.length ? copy.meta(contacts.length) : undefined}
        />
        <Txt kind="caption" tone="muted">
          {copy.calledInOrder(residentName)}
        </Txt>
      </Entrance>

      {contacts.length === 0 && !adding && (
        <Entrance index={1} style={{ marginTop: sp(8) }}>
          <Txt kind="body">{/* voice-ok */}
            {copy.emptyBody}
          </Txt>
          <Btn
            label={copy.addFirst}
            style={{ marginTop: sp(5) }}
            onPress={() => setAdding(true)}
          />
        </Entrance>
      )}

      <View style={{ marginTop: contacts.length ? sp(4) : 0 }}>
        {contacts.map((c, i) => (
          <Entrance key={`${c.name}-${i}`} index={1 + i}>
            {i > 0 && <Rule weight="hair" />}
            <Row style={{ justifyContent: 'space-between', paddingVertical: sp(3) }}>
              <Row gap={3} style={{ flex: 1 }}>
                {/* Numbered because this list is genuinely sequential: the
                    one place in the app where a number means an order. */}
                <Txt kind="title" style={{ minWidth: sp(6) }}>{i + 1}</Txt>
                <Avatar name={c.name} size={34} tone={avatarTone(i)} />
                <View style={{ flex: 1 }}>
                  <Txt kind="label">{c.name}</Txt>
                  <Txt kind="caption" tone="muted">{copy.contactLine(c.relationship, c.phone)}</Txt>
                </View>
              </Row>
              <Row gap={1}>
                <IconBtn
                  kind="ghost"
                  size={34}
                  name="chevron.up"
                  label={copy.moveEarlier(c.name)}
                  disabled={i === 0}
                  onPress={() => move(i, -1)}
                />
                <IconBtn
                  kind="ghost"
                  size={34}
                  name="chevron.down"
                  label={copy.moveLater(c.name)}
                  disabled={i === contacts.length - 1}
                  onPress={() => move(i, 1)}
                />
                <IconBtn
                  kind="ghost"
                  size={34}
                  name="xmark"
                  label={copy.remove(c.name)}
                  onPress={() => setContacts((cs) => cs.filter((_, j) => j !== i))}
                />
              </Row>
            </Row>
          </Entrance>
        ))}
      </View>

      {adding ? (
        <View style={{ marginTop: sp(6) }}>
          <Field
            label={copy.name} placeholder={copy.namePlaceholder}
            value={draft.name} onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
          />
          <Field
            label={copy.phone} placeholder={copy.phonePlaceholder} keyboardType="phone-pad"
            style={{ marginTop: sp(3) }}
            value={draft.phone} onChangeText={(phone) => setDraft((d) => ({ ...d, phone }))}
          />
          <Field
            label={copy.relationship} placeholder={copy.relationshipPlaceholder}
            style={{ marginTop: sp(3) }}
            value={draft.relationship} onChangeText={(relationship) => setDraft((d) => ({ ...d, relationship }))}
          />
          <Row gap={3} style={{ marginTop: sp(4) }}>
            <Btn kind="quiet" label={copy.cancel} onPress={() => setAdding(false)} style={{ flex: 1 }} />
            <Btn label={copy.add} onPress={addDraft} disabled={!draft.name.trim() || !draft.phone.trim()} style={{ flex: 1 }} />
          </Row>
        </View>
      ) : contacts.length > 0 ? (
        <Btn kind="link" label={copy.addAnother} onPress={() => setAdding(true)} style={{ marginTop: sp(4), alignSelf: 'flex-start' }} />
      ) : null}

      {!!error && <ErrorState inline message={error} style={{ marginTop: sp(6) }} />}
    </Screen>
  );
}
