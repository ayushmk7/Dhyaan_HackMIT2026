// Ask. Three sources, always labelled: what you told us, what the camera saw,
// what her pattern is (§6.5). Every answer carries its citations as chips that
// name their kind, because a family must always be able to tell observed from
// assumed.
//
// A refusal is not an error. It renders as a quiet raised hand and a plain
// sentence — no red, no warning icon, no retry — because the questions Dhyaan
// won't answer, it won't answer for anyone, and being told so calmly is the
// product working, not failing.
//
// Every sentence this screen says lives in lib/copy/family.ts under `chat`.
import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import {
  Card, Chip, CitationChip, Entrance, ErrorState, IconBtn, KindTag, LoadingState, Refusal, Row, Rule,
  Screen, Slab, Txt,
} from '@/components';
import { api } from '@/lib/api';
import { family } from '@/lib/copy/family';
import type { ChatMessage, RefusalKind } from '@/lib/types';
import { useSession } from '@/store/session';
import { radius, sp, type, useTheme } from '@/theme';

const copy = family.chat;

/** One line naming why an answer was withheld, above the answer itself. */
const refusalLabel = (kind: RefusalKind | undefined): string =>
  kind === 'surveillance' || kind === 'medical' || kind === 'no_data'
    ? copy.refusal[kind]
    : copy.refusal.other;

export default function Ask() {
  const t = useTheme();
  const { residentName } = useSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || thinking) return;
    setDraft('');
    setSendError(null);
    setLastQuestion(q);
    setMessages((m) => [...m, { id: `u_${Date.now()}`, role: 'user', text: q }]);
    setThinking(true);
    try {
      const answer = await api.chat(q);
      setMessages((m) => [...m, answer]);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : copy.sendError);
    } finally {
      setThinking(false);
    }
  };

  // The composer floats and the conversation travels under it. The input is
  // hand-rolled on purpose: Field's white plate is wrong inside glass.
  const composer = (
    <Row gap={2}>
      <TextInput
        accessibilityLabel={copy.askAbout(residentName)}
        value={draft}
        onChangeText={setDraft}
        placeholder={copy.placeholder(residentName)}
        placeholderTextColor={t.inkMuted}
        style={{
          flex: 1, minHeight: 40, maxHeight: 110,
          paddingHorizontal: sp(3), paddingVertical: sp(2),
          ...type.body, color: t.ink,
        }}
        multiline
        onSubmitEditing={() => send(draft)}
      />
      <IconBtn
        name="arrow.up"
        label={copy.ask}
        kind="primary"
        size={38}
        disabled={!draft.trim() || thinking}
        onPress={() => send(draft)}
      />
    </Row>
  );

  return (
    <Screen
      native
      wash
      keyboard
      scrollRef={scrollRef}
      scrollProps={{
        keyboardShouldPersistTaps: 'handled',
        onContentSizeChange: () => scrollRef.current?.scrollToEnd({ animated: true }),
      }}
      floatingBar={composer}
    >
      {messages.length === 0 && (
        <>
          {/* The screen's one uncompromising surface, and it is the law of
              the screen: every answer names where it came from. */}
          <Entrance index={0}>
            <Slab>
              <Txt kind="title">{copy.everyAnswer}</Txt>
              <Rule weight="hair" style={{ marginTop: sp(3.5) }} />
              <Row gap={2} style={{ marginTop: sp(3.5), flexWrap: 'wrap' }}>
                <KindTag kind="observed" />
                <KindTag kind="told" />
                <KindTag kind="pattern" />
              </Row>
            </Slab>
          </Entrance>

          <Entrance index={1}>
            <View style={{ marginTop: sp(6), gap: sp(2) }}>
              {copy.suggestions.map((s) => (
                <Chip key={s} label={s} onPress={() => send(s)} />
              ))}
              <Chip
                label={copy.planFromChat}
                onPress={() => router.push('/(family)/chat/plan')}
              />
            </View>
          </Entrance>
        </>
      )}

      <View style={{ marginTop: sp(5), gap: sp(3) }}>
        {messages.map((m) =>
          m.role === 'user' ? (
            <View key={m.id} style={{
              alignSelf: 'flex-end', maxWidth: '85%',
              backgroundColor: t.ink,
              borderRadius: radius.bubble, paddingHorizontal: sp(3.5), paddingVertical: sp(2.5),
            }}>
              <Txt kind="body" tone="paper">{m.text}</Txt>
            </View>
          ) : (
            <Card key={m.id} style={{ alignSelf: 'stretch' }}>
              {m.refused ? (
                <Refusal label={refusalLabel(m.refusal_kind)}>
                  {m.text}
                </Refusal>
              ) : (
                <Txt kind="body">{m.text}</Txt>
              )}
              {!!m.citations?.length && (
                <View style={{ marginTop: sp(3.5), gap: sp(2) }}>
                  <Rule weight="hair" color={t.line} />
                  {m.citations.map((c) => (
                    <CitationChip
                      key={`${c.kind}_${c.id}`}
                      citation={c}
                      onPress={
                        c.event_ids[0]
                          ? () => router.push({
                            pathname: '/(family)/timeline/[eventId]',
                            params: { eventId: c.event_ids[0] },
                          })
                          : undefined
                      }
                    />
                  ))}
                </View>
              )}
            </Card>
          ),
        )}

        {thinking && (
          <Card>
            <LoadingState label={copy.thinking} />
          </Card>
        )}

        {sendError && !thinking && (
          <ErrorState inline message={sendError} onRetry={() => send(lastQuestion)} />
        )}
      </View>
    </Screen>
  );
}
