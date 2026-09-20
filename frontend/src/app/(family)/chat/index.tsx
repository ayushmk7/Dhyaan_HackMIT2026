// Ask about Eleanor — RAG chat with tappable citations (§10.1 screen 11).
import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, Chip, Row, Txt } from '@/components';
import { Icon } from '@/components/icon';
import { api } from '@/lib/api';
import type { ChatMessage } from '@/lib/types';
import { useSession } from '@/store/session';
import { palette, radius, sp, type } from '@/theme/tokens';

const SUGGESTIONS = [
  'Has she been eating?',
  'How did she sleep?',
  'When was she last outside?',
  'Is she walking enough?',
];

export default function Chat() {
  const insets = useSafeAreaInsets();
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
          paddingBottom: sp(4),
        }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        showsVerticalScrollIndicator={false}
      >
        {messages.length === 0 && (
          <View style={{ marginTop: sp(2), gap: sp(2) }}>
            {SUGGESTIONS.map((s) => (
              <Chip key={s} label={s} onPress={() => send(s)} />
            ))}
            <Chip
              label="Plan from group chat"
              onPress={() => router.push('/(family)/chat/plan')}
            />
          </View>
        )}

        <View style={{ marginTop: sp(4), gap: sp(3) }}>
          {messages.map((m) =>
            m.role === 'user' ? (
              <View key={m.id} style={{
                alignSelf: 'flex-end', maxWidth: '85%',
                backgroundColor: palette.slateWash,
                borderRadius: radius.card, padding: sp(3),
              }}>
                <Txt kind="body">{m.text}</Txt>
              </View>
            ) : (
              // A refusal reads as "outside scope", not a warning — no red/amber,
              // just a quiet label so it's distinct without feeling alarming.
              <Card key={m.id} style={{ alignSelf: 'stretch' }}>
                {m.refused && (
                  <Row gap={1.5} style={{ marginBottom: sp(2) }}>
                    <Icon name="questionmark.circle" size={14} color={palette.slate} />
                    <Txt kind="caption" tone="slate" style={{ fontWeight: '600' }}>
                      Outside what Dhyaan has observed
                    </Txt>
                  </Row>
                )}
                <Text
                  style={{
                    fontSize: 17, lineHeight: 24,
                    color: palette.ink, opacity: m.refused ? 0.75 : 1,
                  }}
                >
                  {m.text}
                </Text>
                {!!m.citations?.length && (
                  <Row style={{ flexWrap: 'wrap', marginTop: sp(3) }} gap={2}>
                    {m.citations.map((c) => (
                      <Chip
                        key={c.id}
                        label={c.label}
                        onPress={() =>
                          c.event_ids[0] &&
                          router.push({
                            pathname: '/(family)/timeline/[eventId]',
                            params: { eventId: c.event_ids[0] },
                          })
                        }
                      />
                    ))}
                  </Row>
                )}
              </Card>
            ),
          )}
          {thinking && (
            <Row gap={2}>
              <ActivityIndicator size="small" color={palette.inkMuted} />
              <Txt kind="caption" tone="muted">Dhyaan is reading her week…</Txt>
            </Row>
          )}
          {sendError && !thinking && (
            <Row gap={2} style={{ justifyContent: 'space-between' }}>
              <Txt kind="caption" tone="alert" style={{ flex: 1 }}>{sendError}</Txt>
              <Pressable accessibilityRole="button" onPress={() => send(lastQuestion)}>
                <Txt kind="label" tone="slate">Retry</Txt>
              </Pressable>
            </Row>
          )}
        </View>
      </ScrollView>

      <View style={{
        flexDirection: 'row', gap: sp(2), alignItems: 'center',
        paddingHorizontal: sp(5), paddingTop: sp(2),
        paddingBottom: Math.max(insets.bottom, sp(2)),
        borderTopWidth: 1, borderTopColor: palette.line, backgroundColor: palette.paper,
      }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={`Ask anything about ${residentName}’s week`}
          placeholderTextColor={palette.inkMuted}
          style={{
            flex: 1, minHeight: 44, maxHeight: 100,
            backgroundColor: palette.raised, borderWidth: 1, borderColor: palette.line,
            borderRadius: radius.card, paddingHorizontal: sp(3), paddingVertical: sp(2.5),
            ...type.body, color: palette.ink,
          }}
          multiline
          onSubmitEditing={() => send(draft)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
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
      </View>
    </KeyboardAvoidingView>
  );
}
