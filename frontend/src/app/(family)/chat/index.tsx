// Ask. Three sources, always labelled: what you told us, what the camera saw,
// what her pattern is (§6.5). Every answer carries its citations as chips that
// name their kind, because a family must always be able to tell observed from
// assumed.
//
// A refusal is not an error. It renders as a quiet raised hand and a plain
// sentence — no red, no warning icon, no retry — because the questions Dhyaan
// won't answer, it won't answer for anyone, and being told so calmly is the
// product working, not failing.
import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View,
} from 'react-native';
import {
  Card, Chip, CitationChip, Entrance, FLOATING_BAR_CLEARANCE, FloatingBar, KindTag, Row, Rule, Txt,
} from '@/components';
import { Icon } from '@/components/icon';
import { api } from '@/lib/api';
import type { ChatMessage } from '@/lib/types';
import { useSession } from '@/store/session';
import { palette, sp, type } from '@/theme/tokens';

const SUGGESTIONS = [
  'Has she eaten today?',
  'What does she usually have for breakfast?',
  'Where does she spend her afternoons?',
  'How were her nights this week?',
];

/** One line naming why an answer was withheld, above the answer itself. */
const REFUSAL_LABEL: Record<string, string> = {
  surveillance: 'Dhyaan doesn’t answer this, for anyone',
  medical: 'Outside what Dhyaan can answer',
  no_data: 'Dhyaan hasn’t been told or shown this',
};

export default function Ask() {
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
      setSendError(e instanceof Error ? e.message : 'Couldn’t reach Dhyaan. Try again.');
    } finally {
      setThinking(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: palette.paper }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={scrollRef}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingTop: sp(2),
          paddingHorizontal: sp(4),
          paddingBottom: FLOATING_BAR_CLEARANCE + sp(4),
        }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {messages.length === 0 && (
          <>
            {/* The screen's one uncompromising surface, and it is the law of
                the screen: every answer names where it came from. */}
            <Entrance index={0}>
              <Card lift="float" style={{ backgroundColor: palette.ink }}>
                <Txt kind="title" tone="paper">
                  Every answer says where it came from.
                </Txt>
                <Rule color={palette.paper} style={{ marginTop: sp(3.5), opacity: 0.3 }} />
                <Row gap={2} style={{ marginTop: sp(3.5), flexWrap: 'wrap' }}>
                  <KindTag kind="observed" />
                  <KindTag kind="told" />
                  <KindTag kind="pattern" />
                </Row>
              </Card>
            </Entrance>

            <Entrance index={1}>
              <View style={{ marginTop: sp(6), gap: sp(2) }}>
                {SUGGESTIONS.map((s) => (
                  <Chip key={s} label={s} onPress={() => send(s)} />
                ))}
                <Chip
                  label="Plan from group chat"
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
                backgroundColor: palette.ink,
                borderRadius: 20, paddingHorizontal: sp(3.5), paddingVertical: sp(2.5),
              }}>
                <Txt kind="body" tone="paper">{m.text}</Txt>
              </View>
            ) : (
              <Card key={m.id} style={{ alignSelf: 'stretch' }}>
                {m.refused && (
                  <Row gap={1.5} style={{ marginBottom: sp(2.5) }}>
                    <Icon name="hand.raised" size={14} color={palette.slate} />
                    <Txt kind="label" tone="slate">
                      {REFUSAL_LABEL[m.refusal_kind ?? ''] ?? 'Dhyaan doesn’t answer this'}
                    </Txt>
                  </Row>
                )}
                <Txt kind="body" style={{ opacity: m.refused ? 0.75 : 1 }}>{m.text}</Txt>
                {!!m.citations?.length && (
                  <View style={{ marginTop: sp(3.5), gap: sp(2) }}>
                    <Rule weight="hair" color={palette.line} />
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
            <Card style={{ alignSelf: 'stretch' }}>
              <Row gap={2}>
                <ActivityIndicator size="small" color={palette.inkMuted} />
                <Txt kind="caption" tone="muted" accessibilityLiveRegion="polite">
                  Reading her day…
                </Txt>
              </Row>
            </Card>
          )}

          {sendError && !thinking && (
            <Row gap={2} style={{ justifyContent: 'space-between' }}>
              <Txt kind="caption" tone="alert" style={{ flex: 1 }}>{sendError}</Txt>
              <Pressable accessibilityRole="button" onPress={() => send(lastQuestion)}>
                <Txt kind="label" tone="slate">Try again</Txt>
              </Pressable>
            </Row>
          )}
        </View>
      </ScrollView>

      {/* The composer floats and the conversation travels under it. */}
      <FloatingBar>
        <Row gap={2}>
          <TextInput
            accessibilityLabel={`Ask about ${residentName}`}
            value={draft}
            onChangeText={setDraft}
            placeholder={`Ask anything about ${residentName}’s week`}
            placeholderTextColor={palette.inkMuted}
            style={{
              flex: 1, minHeight: 40, maxHeight: 110,
              paddingHorizontal: sp(3), paddingVertical: sp(2),
              ...type.body, color: palette.ink,
            }}
            multiline
            onSubmitEditing={() => send(draft)}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ask"
            accessibilityState={{ disabled: !draft.trim() || thinking }}
            onPress={() => send(draft)}
            style={({ pressed }) => ({
              width: 38, height: 38, borderRadius: 19,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: pressed ? palette.slateDeep : palette.slate,
              opacity: draft.trim() && !thinking ? 1 : 0.4,
            })}
          >
            <Icon name="arrow.up" size={17} color="#FFFFFF" weight="bold" />
          </Pressable>
        </Row>
      </FloatingBar>
    </KeyboardAvoidingView>
  );
}
