// Turn the family group chat into a plan (Meta challenge: "synthesize a group
// discussion into plans everyone would enjoy"). Paste the thread; Claude extracts
// the consensus, commitments, and open questions, plus a reply ready to send back.
//
// `api.planFromThread` can reject (no key, no network, a 500) — without a catch
// the button spun forever, so every path out of `make()` clears `busy` and says
// something true.
import React, { useCallback, useState } from 'react';
import { Share, View } from 'react-native';
import {
  Btn, Card, ErrorState, Field, Marquee, Row, RowGroup, Rule, Screen, Slab, Stagger, Txt,
} from '@/components';
import { Icon } from '@/components/icon';
import { api } from '@/lib/api';
import { hasAI, type FamilyPlan } from '@/lib/ai';
import { EXAMPLE_THREAD } from '@/lib/example-thread';
import { onDark, sp } from '@/theme/tokens';

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
      const p = await api.planFromThread(thread);
      // `api.planFromThread` never rejects on the live client: with no key,
      // or when the call fails, it hands back a plan-shaped object whose
      // headline is an apology and whose every list is empty. Rendering that
      // in the ink slab was a failure dressed as a result.
      const empty = !p.when && !p.tasks.length && !p.open_questions.length && !p.reply_text;
      if (empty) {
        setPlan(null);
        setError(hasAI
          ? 'Dhyaan couldn’t read that thread just now. Nothing was sent anywhere. Try again in a moment.'
          : 'Reading a thread needs Dhyaan’s writing service, which isn’t connected on this phone. Nothing was sent anywhere.');
        return;
      }
      setPlan(p);
    } catch {
      // Without this the spinner ran until the screen was closed.
      setPlan(null);
      setError('Dhyaan couldn’t read that thread just now. Nothing was sent anywhere. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }, [busy, thread]);

  return (
    <Screen native keyboard>
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
          {!!error && <ErrorState inline message={error} />}
        </View>

        {plan ? (
          <View>
            {/* The screen's one uncompromising surface: the decision, in
                paper on ink, with the machine's reading of "when" beneath it. */}
            <Slab>
              <Txt kind="title">{plan.headline}</Txt>
              {!!plan.when && (
                <>
                  <Rule weight="hair" style={{ marginTop: sp(3) }} />
                  <Row gap={1.5} style={{ marginTop: sp(2.5) }}>
                    <Icon name="calendar" size={13} color={onDark.ink} />
                    <Txt kind="stamp">{plan.when}</Txt>
                  </Row>
                </>
              )}
            </Slab>

            {plan.tasks.length > 0 && (
              <>
                <Marquee title="Who’s doing what" meta={`${plan.tasks.length}`} />
                <RowGroup>
                  {plan.tasks.map((t, i) => (
                    <Row key={`${t.who}-${i}`} style={{ paddingVertical: sp(3), alignItems: 'flex-start' }} gap={3}>
                      <Txt kind="label" style={{ width: 72 }}>{t.who}</Txt>
                      <Txt kind="body" style={{ flex: 1 }}>{t.what}</Txt>
                    </Row>
                  ))}
                </RowGroup>
              </>
            )}

            {plan.open_questions.length > 0 && (
              <>
                {/* The heading and its count carry the meaning; the plate stays
                    white. Ochre is a resident state, not a mood for a card. */}
                <Marquee title="Nobody answered yet" meta={`${plan.open_questions.length}`} />
                <Card>
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
                    {/* voice-ok: an empty state, which DESIGN.md exempts. */}
                    This opens your share sheet. Dhyaan doesn’t post to your group chat itself.
                  </Txt>
                </View>
              </>
            )}
          </View>
        ) : null}
      </Stagger>
    </Screen>
  );
}
