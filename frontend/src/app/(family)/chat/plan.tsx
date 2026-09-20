// Turn the family group chat into a plan (Meta challenge: "synthesize a group
// discussion into plans everyone would enjoy"). Paste the thread; Claude extracts
// the consensus, commitments, and open questions, plus a reply ready to send back.
//
// `api.planFromThread` can reject (no key, no network, a 500) — without a catch
// the button span forever, so every path out of `make()` clears `busy` and says
// something true.
import React, { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, Share, View } from 'react-native';
import {
  Btn, Card, Field, Hairline, Marquee, Row, Rule, Screen, Stagger, Txt,
} from '@/components';
import { Icon } from '@/components/icon';
import { api } from '@/lib/api';
import type { FamilyPlan } from '@/lib/ai';
import { EXAMPLE_THREAD } from '@/lib/example-thread';
import { palette, sp } from '@/theme/tokens';

export default function Plan() {
  const [thread, setThread] = useState('');
  const [plan, setPlan] = useState<FamilyPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const make = useCallback(async () => {
    if (!thread.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      setPlan(await api.planFromThread(thread));
    } catch {
      // Without this the spinner ran until the screen was closed.
      setPlan(null);
      setError('Dhyaan couldn’t read that thread just now. Nothing was sent anywhere — try again in a moment.');
    } finally {
      setBusy(false);
    }
  }, [busy, thread]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen native>
        <Stagger gap={5}>
          <View>
            <Field
              label="The family thread"
              value={thread}
              onChangeText={setThread}
              placeholder="Paste the family group chat"
              multiline
              hint="It is read once to write the plan below. Dhyaan doesn’t keep it."
            />
          </View>

          <View style={{ gap: sp(2) }}>
            <Btn label="Make a plan" onPress={make} busy={busy} disabled={!thread.trim()} />
            {!thread && (
              <Btn label="Try an example" kind="quiet" onPress={() => setThread(EXAMPLE_THREAD)} />
            )}
            {!!error && <Txt kind="caption" tone="alert">{error}</Txt>}
          </View>

          {plan ? (
            <View>
              {/* The screen's one uncompromising surface: the decision, in
                  paper on ink, with the machine's reading of "when" beneath it. */}
              <Card lift="float" style={{ backgroundColor: palette.ink }}>
                <Txt kind="title" tone="paper">{plan.headline}</Txt>
                {!!plan.when && (
                  <>
                    <Rule color={palette.paper} style={{ marginTop: sp(3), opacity: 0.35 }} />
                    <Row gap={1.5} style={{ marginTop: sp(2.5) }}>
                      <Icon name="calendar" size={13} color={palette.paper} />
                      <Txt kind="stamp" tone="paper">{plan.when}</Txt>
                    </Row>
                  </>
                )}
              </Card>

              {plan.tasks.length > 0 && (
                <>
                  <Marquee title="Who’s doing what" meta={`${plan.tasks.length}`} />
                  {plan.tasks.map((t, i) => (
                    <View key={`${t.who}-${i}`}>
                      {i > 0 && <Hairline />}
                      <Row style={{ paddingVertical: sp(3), alignItems: 'flex-start' }} gap={3}>
                        <Txt kind="label" style={{ width: 72 }}>{t.who}</Txt>
                        <Txt kind="body" style={{ flex: 1 }}>{t.what}</Txt>
                      </Row>
                    </View>
                  ))}
                </>
              )}

              {plan.open_questions.length > 0 && (
                <>
                  <Marquee title="Nobody answered yet" meta={`${plan.open_questions.length}`} />
                  <Card style={{ backgroundColor: palette.ochreWash }}>
                    {plan.open_questions.map((q, i) => (
                      <Txt key={q} kind="body" style={{ marginTop: i === 0 ? 0 : sp(2) }}>{q}</Txt>
                    ))}
                  </Card>
                </>
              )}

              {!!plan.reply_text && (
                <>
                  <Marquee title="A reply, ready to send" />
                  <Card>
                    <Txt kind="body">{plan.reply_text}</Txt>
                  </Card>
                  <View style={{ marginTop: sp(3), gap: sp(2) }}>
                    {/* It opens the share sheet. It does not post anywhere, and
                        the label used to promise that it did. */}
                    <Btn
                      label="Copy it out to your thread"
                      onPress={() => Share.share({ message: plan.reply_text })}
                    />
                    <Txt kind="caption" tone="muted">
                      This opens your share sheet. Dhyaan doesn’t post to your group chat itself.
                    </Txt>
                  </View>
                </>
              )}
            </View>
          ) : null}
        </Stagger>
      </Screen>
    </KeyboardAvoidingView>
  );
}
