// Ask. Three sources, always labelled: what you told us, what the camera saw,
// what her pattern is (§6.5). Every answer carries its citations as chips that
// name their kind, because a family must always be able to tell observed from
// assumed.
//
// The shape is a chat assistant's: one scrolling column of turns, generously
// spaced, with the composer pinned at the bottom. Her answers are prose
// straight on the paper, no bubble, no card. Your questions are the one
// container, a light blue plate on the right. Turns are separated by air, not
// by rules. Before the first question, a quiet line and the openers as chips.
//
// A refusal is not an error. It renders as a quiet raised hand and a plain
// sentence in the answer's own place — no red, no warning icon, no retry —
// because the questions Dhyaan won't answer, it won't answer for anyone, and
// being told so calmly is the product working, not failing.
//
// Every sentence this screen says lives in lib/copy/family.ts under `chat`.
import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
import {
  Chip, CitationChip, Entrance, ErrorState, IconBtn, Refusal, Row, Screen, Txt,
} from '@/components';
import { api } from '@/lib/api';
import { family } from '@/lib/copy/family';
import { scrubRooms } from '@/lib/format';
import type { ChatMessage, RefusalKind } from '@/lib/types';
import { useSession } from '@/store/session';
import { radius, scale, sp, type, useTheme } from '@/theme';

const copy = family.chat;

// Prose measure. An answer can run to a paragraph or three; body type at
// 1.35x line height is right for a row and tight for a page of reading, so
// the answer alone takes 1.5x. Same size, more air.
const PROSE_LINE = Math.round(scale.body * 1.5);

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

  const canSend = !!draft.trim() && !thinking;

  // The composer floats and the conversation travels under it. The input is
  // hand-rolled on purpose: Field's white plate is wrong inside glass. It
  // grows to about five lines, and the send button rides its bottom edge.
  const composer = (
    <Row gap={2} style={{ alignItems: 'flex-end' }}>
      <TextInput
        accessibilityLabel={copy.askAbout(residentName)}
        value={draft}
        onChangeText={setDraft}
        placeholder={copy.placeholder(residentName)}
        placeholderTextColor={t.inkMuted}
        style={{
          flex: 1, minHeight: 44, maxHeight: 132,
          paddingHorizontal: sp(3), paddingVertical: sp(2.5),
          ...type.body, color: t.ink,
        }}
        multiline
        editable={!thinking}
      />
      <IconBtn
        name="arrow.up"
        label={copy.ask}
        kind="primary"
        size={44}
        disabled={!canSend}
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
        // Follow the conversation, but never the empty state: scrolling the
        // openers to the end shoves the hero under the header on first open.
        onContentSizeChange: () => {
          if (messages.length) scrollRef.current?.scrollToEnd({ animated: true });
        },
      }}
      floatingBar={composer}
    >
      {messages.length === 0 && (
        <View style={{ paddingTop: sp(10) }}>
          {/* Before the first question: one quiet line, the law under it, and
              the openers as chips. Tapping one is the first turn. */}
          <Entrance index={0} distance={26}>
            <Txt kind="title">{copy.hero(residentName)}</Txt>
            <Txt kind="caption" tone="muted" style={{ marginTop: sp(2) }}>{copy.everyAnswer}</Txt>
          </Entrance>

          <Entrance index={1}>
            <View style={{ marginTop: sp(6), flexDirection: 'row', flexWrap: 'wrap', gap: sp(2) }}>
              {copy.suggestions.map((s) => (
                <Chip key={s} label={s} onPress={() => send(s)} />
              ))}
            </View>
          </Entrance>
        </View>
      )}

      {/* The conversation. One column of turns with real whitespace between
          them. A question is the one plate; an answer is prose on the paper
          with its sources, as chips, directly under it. */}
      <View style={{ gap: sp(8), paddingTop: messages.length ? sp(2) : 0 }}>
        {messages.map((m) =>
          m.role === 'user' ? (
            <View key={m.id} style={{
              alignSelf: 'flex-end', maxWidth: '82%',
              backgroundColor: t.accentWash,
              borderRadius: radius.bubble, paddingHorizontal: sp(4), paddingVertical: sp(2.5),
            }}>
              <Txt kind="body">{m.text}</Txt>
            </View>
          ) : (
            <View key={m.id} style={{ alignSelf: 'stretch', paddingRight: sp(2) }}>
              {m.refused ? (
                <Refusal label={refusalLabel(m.refusal_kind)}>
                  {m.text}
                </Refusal>
              ) : (
                // Family surface: the answer is stitched from raw records, so
                // it gets the same room scrub the activity feed gets (D-001).
                <Txt kind="body" style={{ lineHeight: PROSE_LINE }}>{scrubRooms(m.text)}</Txt>
              )}
              {!!m.citations?.length && (
                <View style={{ marginTop: sp(4), gap: sp(2) }}>
                  <Txt kind="tag" tone="muted">{copy.sources}</Txt>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp(2) }}>
                    {/* Two `told` or `pattern` citations in one answer both
                        carry `id: ''`, so kind+id is not unique. Position is. */}
                    {m.citations.map((c, ci) => (
                      <CitationChip
                        key={`${c.kind}_${c.id}_${ci}`}
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
                </View>
              )}
            </View>
          ),
        )}

        {/* While Dhyaan reads her day, the pending mark sits exactly where the
            answer will land: left-aligned, small, muted, no card. */}
        {thinking && (
          <View
            accessibilityLiveRegion="polite"
            style={{ flexDirection: 'row', alignItems: 'center', gap: sp(2), alignSelf: 'flex-start', minHeight: 44 }}
          >
            <ActivityIndicator size="small" color={t.inkMuted} />
            <Txt kind="caption" tone="muted">{copy.thinking}</Txt>
          </View>
        )}

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
