// Ask about Eleanor — RAG chat with tappable citations (§10.1 screen 11).
import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, Chip, Row, Txt } from '@/components';
import { api } from '@/lib/api';
import type { ChatMessage } from '@/lib/types';
import { useSession } from '@/store/session';
import { font, palette, radius, sp, type } from '@/theme/tokens';

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
  const scrollRef = useRef<ScrollView>(null);

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || thinking) return;
    setDraft('');
    setMessages((m) => [...m, { id: `u_${Date.now()}`, role: 'user', text: q }]);
    setThinking(true);
    const answer = await api.chat(q);
    setMessages((m) => [...m, answer]);
    setThinking(false);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: palette.paper }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{
          paddingTop: insets.top + sp(4),
          paddingHorizontal: sp(5),
          paddingBottom: sp(4),
        }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        showsVerticalScrollIndicator={false}
      >
        <Txt kind="display">Ask about {residentName}</Txt>
        <Txt kind="caption" tone="muted" style={{ marginTop: sp(1) }}>
          Answers come only from what Dhyaan observed, with the evidence attached.
        </Txt>

        {messages.length === 0 && (
          <View style={{ marginTop: sp(6), gap: sp(2) }}>
            {SUGGESTIONS.map((s) => (
              <Chip key={s} label={s} onPress={() => send(s)} />
            ))}
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
              // TODO D8.1: a refusal must read differently from an answer.
              <Card
                key={m.id}
                style={{
                  alignSelf: 'stretch',
                  ...(m.refused ? { borderLeftWidth: 4, borderLeftColor: palette.ochre } : {}),
                }}
              >
                <Text
                  style={{
                    fontFamily: font.serif, fontSize: 17, lineHeight: 25,
                    color: m.refused ? palette.inkMuted : palette.ink,
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
            <Txt kind="caption" tone="muted">Dhyaan is reading her week…</Txt>
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
            height: 44, paddingHorizontal: sp(4), borderRadius: radius.card,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: pressed ? palette.slateDeep : palette.slate,
            opacity: draft.trim() && !thinking ? 1 : 0.4,
          })}
        >
          <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>Ask</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
