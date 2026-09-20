// Ask. Three sources, always labelled: what you told us, what the camera saw,
// what her pattern is (§6.5). Every answer carries its citations as chips that
// name their kind, because a family must always be able to tell observed from
// assumed.
//
// The conversation is the screen. Her answers sit straight on the paper; your
// questions are the one plate, a light blue bubble on the right. Nothing else
// is boxed. Before the first question, one big sentence and the openers.
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
  Btn, CitationChip, Entrance, ErrorState, IconBtn, LoadingState, Refusal, Row, Rule, Screen, Txt,
} from '@/components';
import { api } from '@/lib/api';
import { family } from '@/lib/copy/family';
import { scrubRooms } from '@/lib/format';
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
    } catch {
      // Never the transport's own words: a person at 3am needs to know the
      // question went unanswered and that asking again is safe.
      setSendError(copy.sendError);
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
          flex: 1, minHeight: 44, maxHeight: 110,
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
        size={44}
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
          {/* Before the first question: the one big sentence, the law under
              it in a caption, then the openers. No plate, no legend. */}
          <Entrance index={0} distance={26}>
            <Txt kind="display">{copy.hero(residentName)}</Txt>
            <Txt kind="caption" tone="muted" style={{ marginTop: sp(3) }}>{copy.everyAnswer}</Txt>
          </Entrance>

          <Entrance index={1}>
            {/* Openers are 44pt tonal buttons, not 30pt chips: at this hour
                a question should be hard to miss and easy to hit. */}
            <View style={{ marginTop: sp(7), gap: sp(2), alignItems: 'flex-start' }}>
              {copy.suggestions.map((s) => (
                <Btn key={s} kind="quiet" size="small" label={s} onPress={() => send(s)} />
              ))}
              <Btn
                kind="quiet"
                size="small"
                label={copy.planFromChat}
                style={{ marginTop: sp(2) }}
                onPress={() => router.push('/(family)/chat/plan')}
              />
            </View>
          </Entrance>
        </>
      )}

      {/* The conversation. A question is the one plate; an answer is prose
          on the paper with its sources under a hairline. */}
      <View style={{ gap: sp(5) }}>
        {messages.map((m) =>
          m.role === 'user' ? (
            <View key={m.id} style={{
              alignSelf: 'flex-end', maxWidth: '85%',
              backgroundColor: t.accentWash,
              borderRadius: radius.bubble, paddingHorizontal: sp(3.5), paddingVertical: sp(2.5),
            }}>
              <Txt kind="body">{m.text}</Txt>
            </View>
          ) : (
            <View key={m.id} style={{ alignSelf: 'stretch', paddingRight: sp(4) }}>
              {m.refused ? (
                <Refusal label={refusalLabel(m.refusal_kind)}>
                  {m.text}
                </Refusal>
              ) : (
                // Family surface: the answer is stitched from raw records, so
                // it gets the same room scrub the activity feed gets (D-001).
                <Txt kind="body">{scrubRooms(m.text)}</Txt>
              )}
              {!!m.citations?.length && (
                <View style={{ marginTop: sp(3), gap: sp(2) }}>
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
            </View>
          ),
        )}

        {thinking && <LoadingState label={copy.thinking} />}

        {sendError && !thinking && (
          <ErrorState
            inline
            message={sendError}
            retryLabel={copy.tryAgain}
            onRetry={() => send(lastQuestion)}
          />
        )}
      </View>
    </Screen>
  );
}
