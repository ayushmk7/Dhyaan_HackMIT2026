// Turn the family group chat into a plan (Meta challenge: "synthesize a group
// discussion into plans everyone would enjoy"). Paste the thread; Claude extracts
// the consensus, commitments, and open questions, plus a reply ready to send back.
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Share, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn, Card, Hairline, Row, Txt } from '@/components';
import { Icon } from '@/components/icon';
import { api } from '@/lib/api';
import type { FamilyPlan } from '@/lib/ai';
import { EXAMPLE_THREAD } from '@/lib/example-thread';
import { palette, radius, sp, type } from '@/theme/tokens';

export default function Plan() {
  const insets = useSafeAreaInsets();
  const [thread, setThread] = useState('');
  const [plan, setPlan] = useState<FamilyPlan | null>(null);
  const [busy, setBusy] = useState(false);

  const make = async () => {
    if (!thread.trim() || busy) return;
    setBusy(true);
    setPlan(await api.planFromThread(thread));
    setBusy(false);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: palette.paper }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingTop: sp(3),
          paddingHorizontal: sp(4),
          paddingBottom: insets.bottom + sp(8),
        }}
        showsVerticalScrollIndicator={false}
      >
        <TextInput
          multiline
          value={thread}
          onChangeText={setThread}
          placeholder="Paste the family group chat"
          placeholderTextColor={palette.inkMuted}
          style={{
            minHeight: 140, maxHeight: 240,
            padding: sp(3),
            backgroundColor: palette.raised,
            borderWidth: 1, borderColor: palette.line, borderRadius: radius.card,
            ...type.body, color: palette.ink, textAlignVertical: 'top',
          }}
        />
        <View style={{ gap: sp(2), marginTop: sp(3) }}>
          <Btn label="Make a plan" onPress={make} busy={busy} disabled={!thread.trim()} />
          {!thread && (
            <Btn label="Try an example" kind="quiet" onPress={() => setThread(EXAMPLE_THREAD)} />
          )}
        </View>

        {plan && (
          <View style={{ marginTop: sp(6) }}>
            <Txt kind="title">{plan.headline}</Txt>
            {plan.when && (
              <Row gap={1.5} style={{ marginTop: sp(2) }}>
                <Icon name="calendar" size={14} color={palette.inkMuted} />
                <Txt kind="body" tone="muted">{plan.when}</Txt>
              </Row>
            )}

            {plan.tasks.length > 0 && (
              <View style={{ marginTop: sp(4) }}>
                {plan.tasks.map((t, i) => (
                  <View key={`${t.who}-${i}`}>
                    {i > 0 && <Hairline />}
                    <Row style={{ paddingVertical: sp(2.5) }} gap={2}>
                      <Txt kind="label" style={{ width: 64 }}>{t.who}</Txt>
                      <Txt kind="body" style={{ flex: 1 }}>{t.what}</Txt>
                    </Row>
                  </View>
                ))}
              </View>
            )}

            {plan.open_questions.length > 0 && (
              <Card style={{ marginTop: sp(4), backgroundColor: palette.ochreWash, borderColor: palette.ochreWash }}>
                <Txt kind="label" tone="warn">Nobody answered yet</Txt>
                {plan.open_questions.map((q) => (
                  <Txt key={q} kind="body" style={{ marginTop: sp(1.5) }}>{q}</Txt>
                ))}
              </Card>
            )}

            {!!plan.reply_text && (
              <View style={{ marginTop: sp(4), gap: sp(2) }}>
                <Card>
                  <Txt kind="caption" tone="muted">Reply, ready to send</Txt>
                  <Txt kind="body" style={{ marginTop: sp(1.5) }}>{plan.reply_text}</Txt>
                </Card>
                <Btn
                  label="Send to the thread"
                  onPress={() => Share.share({ message: plan.reply_text })}
                />
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
