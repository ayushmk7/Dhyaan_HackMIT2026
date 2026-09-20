// Her care file — the paper folder, turned into action (Dropbox: files → action).
// Paste or photograph a care document; medications, appointments, and the
// emergency card come out the other side and show up where they matter.
//
// Every sentence this screen says lives in lib/copy/family.ts under `carefile`.
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { Btn, Card, ErrorState, Field, Row, RowGroup, Screen, SectionTitle, Slab, Txt } from '@/components';
import { family } from '@/lib/copy/family';
import { EXAMPLE_DISCHARGE } from '@/lib/example-docs';
import { ago } from '@/lib/format';
import { useContacts } from '@/lib/hooks';
import { useCareFile } from '@/store/carefile';
import { useSession } from '@/store/session';
import { sp } from '@/theme/tokens';

const copy = family.carefile;

export default function CareFileScreen() {
  const file = useCareFile();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // dhyaan://carefile?demo=1 — loads the example document (demo + headless testing,
  // same precedent as /simulate).
  const { demo } = useLocalSearchParams<{ demo?: string }>();

  // Who to ask about driving her: a real person off her call list, never a
  // number typed into the source. The signed-in person is skipped, because a
  // text to yourself is not a plan. No list, no button.
  const { residentName, user } = useSession();
  const { data: contacts } = useContacts();
  const me = user?.name?.trim().toLowerCase().split(/\s+/)[0] ?? '';
  const driver = (contacts ?? []).find((c) => c.name.trim().toLowerCase().split(/\s+/)[0] !== me)
    ?? contacts?.[0];
  useEffect(() => {
    if (demo && !file.sources.length && !file.busy) {
      file.addDocument({ text: EXAMPLE_DISCHARGE }).then((r) => {
        if ('added' in r) setNote({ kind: 'ok', text: copy.added(r.added) });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  const finish = (result: { added: string } | { error: string }) => {
    if ('added' in result) {
      setNote({ kind: 'ok', text: copy.added(result.added) });
      setDraft('');
      setAdding(false);
    } else {
      setNote({ kind: 'error', text: result.error });
    }
  };

  const addText = async () => {
    if (!draft.trim() || file.busy) return;
    setNote(null);
    finish(await file.addDocument({ text: draft }));
  };

  const addPhoto = async () => {
    setNote(null);
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      base64: true,
      quality: 0.7,
    });
    const asset = picked.assets?.[0];
    if (!asset?.base64) return;
    finish(
      await file.addDocument({
        imageBase64: asset.base64,
        mediaType: asset.mimeType ?? 'image/jpeg',
      }),
    );
  };

  const empty = !file.medications.length && !file.appointments.length && !file.sources.length;

  return (
    <Screen native keyboard>
      {(empty || adding) && (
        <View>
          {empty && (
            <View style={{ marginBottom: sp(3) }}>
              <Txt kind="body">{copy.intro}</Txt>
              <Txt kind="caption" tone="muted" style={{ marginTop: sp(2) }}>{copy.introNote}</Txt>
            </View>
          )}
          {/* The sentence above names the field, so it carries no label of its own. */}
          <Field
            value={draft}
            onChangeText={setDraft}
            placeholder={copy.placeholder}
            multiline
            minHeight={120}
            maxHeight={220}
          />
          <View style={{ gap: sp(2), marginTop: sp(3) }}>
            <Btn label={copy.readIt} onPress={addText} busy={file.busy} disabled={!draft.trim()} />
            <Btn label={copy.addPhoto} kind="quiet" onPress={addPhoto} busy={file.busy} />
            {!draft && (
              <Btn
                label={copy.tryExample}
                kind="quiet"
                onPress={() => setDraft(EXAMPLE_DISCHARGE)}
              />
            )}
          </View>
        </View>
      )}
      {note && (
        note.kind === 'ok' ? (
          <Txt kind="body" tone="ok" style={{ marginTop: sp(3) }}>{note.text}</Txt>
        ) : (
          <ErrorState inline message={note.text} style={{ marginTop: sp(3) }} />
        )
      )}

      {file.medications.length > 0 && (
        <>
          <SectionTitle>{copy.medications}</SectionTitle>
          <RowGroup>
            {file.medications.map((m) => (
              <Row key={m.name} style={{ justifyContent: 'space-between', paddingVertical: sp(2.5) }}>
                {/* Name and dose are the document's own values, joined, not a sentence. */}
                <Txt kind="label">{m.name}{m.dose ? ` · ${m.dose}` : ''}</Txt>
                <Txt kind="caption" tone="muted">{m.timing ?? ''}</Txt>
              </Row>
            ))}
          </RowGroup>
        </>
      )}

      {file.appointments.length > 0 && (
        <>
          <SectionTitle>{copy.comingUp}</SectionTitle>
          {file.appointments.map((a) => (
            <Card key={`${a.title}${a.when}`} style={{ marginBottom: sp(2) }}>
              <Txt kind="label">{a.title}</Txt>
              <Txt kind="body" style={{ marginTop: 2 }}>{a.when}</Txt>
              {!!a.where && <Txt kind="caption" tone="muted" style={{ marginTop: 2 }}>{a.where}</Txt>}
              {!!a.note && <Txt kind="caption" tone="muted" style={{ marginTop: 2 }}>{a.note}</Txt>}
              {!!driver && (
                <Btn
                  kind="link"
                  label={copy.textAboutDriving(driver.name)}
                  onPress={() =>
                    Linking.openURL(
                      `sms:${driver.phone_e164}&body=${encodeURIComponent(
                        copy.drivingMessage(residentName, a.title, a.when),
                      )}`,
                    )
                  }
                  style={{ marginTop: sp(2.5) }}
                />
              )}
            </Card>
          ))}
        </>
      )}

      {(file.emergency.allergies.length > 0 || file.emergency.conditions.length > 0 || file.emergency.doctor) && (
        <>
          {/* The one thing on this screen a paramedic would need, on the
              screen's one hard plate. Inversion, not a colour. */}
          <SectionTitle>{copy.inEmergency}</SectionTitle>
          <Slab>
            {file.emergency.allergies.length > 0 && (
              <Txt kind="body">{copy.allergicTo(file.emergency.allergies)}</Txt>
            )}
            {file.emergency.conditions.length > 0 && (
              <Txt kind="body" style={{ marginTop: sp(1) }}>
                {file.emergency.conditions.join(', ')}
              </Txt>
            )}
            {file.emergency.doctor && (
              <Txt kind="body" style={{ marginTop: sp(1) }}>
                {file.emergency.doctor.name}
                {file.emergency.doctor.phone ? ` · ${file.emergency.doctor.phone}` : ''}
              </Txt>
            )}
          </Slab>
        </>
      )}

      {file.sources.length > 0 && (
        <>
          <SectionTitle>{copy.documentsRead}</SectionTitle>
          {file.sources.map((s) => (
            <Row key={s.id} style={{ paddingVertical: sp(1.5), justifyContent: 'space-between' }}>
              <Txt kind="caption" tone="muted" style={{ flex: 1, paddingRight: sp(2) }}>
                {copy.source(s.kind, s.summary)}
              </Txt>
              <Txt kind="caption" tone="muted">{ago(s.added_at)}</Txt>
            </Row>
          ))}
          {!adding && (
            <Btn label={copy.addAnother} kind="quiet" onPress={() => setAdding(true)} style={{ marginTop: sp(3) }} />
          )}
        </>
      )}
    </Screen>
  );
}
