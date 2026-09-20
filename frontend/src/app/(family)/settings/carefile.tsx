// Her care file — the paper folder, turned into action (Dropbox: files → action).
// Paste or photograph a care document; medications, appointments, and the
// emergency card come out the other side and show up where they matter.
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn, Card, Hairline, Row, Rule, SectionTitle, Txt } from '@/components';
import { EXAMPLE_DISCHARGE } from '@/lib/example-docs';
import { ago } from '@/lib/format';
import { useCareFile } from '@/store/carefile';
import { palette, radius, sp, type } from '@/theme/tokens';

export default function CareFileScreen() {
  const insets = useSafeAreaInsets();
  const file = useCareFile();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pasteFocused, setPasteFocused] = useState(false);

  // dhyaan://carefile?demo=1 — loads the example document (demo + headless testing,
  // same precedent as /simulate).
  const { demo } = useLocalSearchParams<{ demo?: string }>();
  useEffect(() => {
    if (demo && !file.sources.length && !file.busy) {
      file.addDocument({ text: EXAMPLE_DISCHARGE }).then((r) => {
        if ('added' in r) setNote({ kind: 'ok', text: `Added: ${r.added}.` });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  const finish = (result: { added: string } | { error: string }) => {
    if ('added' in result) {
      setNote({ kind: 'ok', text: `Added: ${result.added}.` });
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
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: palette.paper }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingTop: sp(2),
          paddingHorizontal: sp(4),
          paddingBottom: insets.bottom + sp(8),
        }}
        showsVerticalScrollIndicator={false}
      >
        {(empty || adding) && (
          <View style={{ marginTop: sp(2) }}>
            {empty && (
              <Txt kind="body" style={{ marginBottom: sp(3) }}>
                Paste or photograph a care document.
              </Txt>
            )}
            {/* Same grammar as <Field>: a plate with an exposed rule beneath
                it, never a box outline. Field itself can't host a 220pt paste
                area, so the shape is borrowed rather than rebuilt. */}
            <TextInput
              multiline
              value={draft}
              onChangeText={setDraft}
              placeholder="Paste a document here"
              placeholderTextColor={palette.inkMuted}
              onFocus={() => setPasteFocused(true)}
              onBlur={() => setPasteFocused(false)}
              style={{
                minHeight: 120, maxHeight: 220, padding: sp(3),
                backgroundColor: palette.raised,
                borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card,
                ...type.body, color: palette.ink, textAlignVertical: 'top',
              }}
            />
            <Rule
              weight={pasteFocused ? 'ink' : 'hair'}
              color={pasteFocused ? palette.ink : palette.line}
            />
            <View style={{ gap: sp(2), marginTop: sp(3) }}>
              <Btn label="Read it" onPress={addText} busy={file.busy} disabled={!draft.trim()} />
              <Btn label="Add a photo" kind="quiet" onPress={addPhoto} busy={file.busy} />
              {!draft && (
                <Btn
                  label="Try an example"
                  kind="quiet"
                  onPress={() => setDraft(EXAMPLE_DISCHARGE)}
                />
              )}
            </View>
          </View>
        )}
        {note && (
          <Txt kind="body" tone={note.kind === 'ok' ? 'ok' : 'alert'} style={{ marginTop: sp(3) }}>
            {note.text}
          </Txt>
        )}

        {file.medications.length > 0 && (
          <>
            <SectionTitle>Medications</SectionTitle>
            <Card>
              {file.medications.map((m, i) => (
                <View key={m.name}>
                  {i > 0 && <Hairline style={{ marginVertical: sp(2) }} />}
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Txt kind="label">{m.name}{m.dose ? ` · ${m.dose}` : ''}</Txt>
                    <Txt kind="caption" tone="muted">{m.timing ?? ''}</Txt>
                  </Row>
                </View>
              ))}
            </Card>
          </>
        )}

        {file.appointments.length > 0 && (
          <>
            <SectionTitle>Coming up</SectionTitle>
            {file.appointments.map((a) => (
              <Card key={`${a.title}${a.when}`} style={{ marginBottom: sp(2) }}>
                <Txt kind="label">{a.title}</Txt>
                <Txt kind="body" style={{ marginTop: 2 }}>{a.when}</Txt>
                {!!a.where && <Txt kind="caption" tone="muted" style={{ marginTop: 2 }}>{a.where}</Txt>}
                {!!a.note && <Txt kind="caption" tone="muted" style={{ marginTop: 2 }}>{a.note}</Txt>}
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    Linking.openURL(
                      `sms:+16175550178&body=${encodeURIComponent(
                        `Mom has ${a.title} on ${a.when}. Can you drive her?`,
                      )}`,
                    )
                  }
                  style={{ marginTop: sp(2.5) }}
                >
                  <Txt kind="label" tone="slate">Text Dev about driving her</Txt>
                </Pressable>
              </Card>
            ))}
          </>
        )}

        {(file.emergency.allergies.length > 0 || file.emergency.conditions.length > 0 || file.emergency.doctor) && (
          <>
            <SectionTitle>In an emergency</SectionTitle>
            <Card style={{ backgroundColor: palette.ochreWash }}>
              {file.emergency.allergies.length > 0 && (
                <Txt kind="body">Allergic to {file.emergency.allergies.join(', ')}</Txt>
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
            </Card>
          </>
        )}

        {file.sources.length > 0 && (
          <>
            <SectionTitle>Documents read</SectionTitle>
            {file.sources.map((s) => (
              <Row key={s.id} style={{ paddingVertical: sp(1.5), justifyContent: 'space-between' }}>
                <Txt kind="caption" tone="muted" style={{ flex: 1, paddingRight: sp(2) }}>{/* voice-ok */}
                  {s.kind === 'photo' ? 'Photo' : 'Pasted'} · {s.summary}
                </Txt>
                <Txt kind="caption" tone="muted">{ago(s.added_at)}</Txt>
              </Row>
            ))}
            {!adding && (
              <Btn label="Add another document" kind="quiet" onPress={() => setAdding(true)} style={{ marginTop: sp(3) }} />
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
