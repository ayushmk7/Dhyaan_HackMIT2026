// Turn the family group chat into a plan (Meta challenge: "synthesize a group
// discussion into plans everyone would enjoy"). Paste the thread; Claude extracts
// the consensus, commitments, and open questions, plus a reply ready to send back.
//
// Two screens in one file, and only one shows at a time. Before: one sentence
// and the paste box. After: the plan, and the paste box is gone, because the
// resulting plan is the screen. Start over brings the box back.
//
// `api.planFromThread` can reject (no key, no network, a 500) — without a catch
// the button spun forever, so every path out of `make()` clears `busy` and says
// something true.
//
// Every sentence this screen says lives in lib/copy/family.ts under `plan`.
import React, { useCallback, useState } from 'react';
import { Share, View } from 'react-native';
import {
  Btn, DataLabel, Entrance, ErrorState, Field, Row, RowGroup, Screen, Txt,
} from '@/components';
import { api } from '@/lib/api';
import { hasAI, type FamilyPlan } from '@/lib/ai';
import { family } from '@/lib/copy/family';
import { EXAMPLE_THREAD } from '@/lib/example-thread';
import { radius, sp, useTheme } from '@/theme';

const copy = family.plan;

export default function Plan() {
  const t = useTheme();
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
      // as the decision was a failure dressed as a result.
      const empty = !p.when && !p.tasks.length && !p.open_questions.length && !p.reply_text;
      if (empty) {
        setPlan(null);
        setError(hasAI ? copy.unreadable : copy.needsAI);
        return;
      }
      setPlan(p);
    } catch {
      // Without this the spinner ran until the screen was closed.
      setPlan(null);
      setError(copy.unreadable);
    } finally {
      setBusy(false);
    }
  }, [busy, thread]);

  if (!plan) {
    return (
      <Screen native keyboard>
        {/* Before: the one big sentence, then the box it is about. */}
        <Entrance index={0} distance={26}>
          <Txt kind="display">{copy.hero}</Txt>
        </Entrance>
        <Entrance index={1} style={{ marginTop: sp(7) }}>
          <Field
            label={copy.threadLabel}
            value={thread}
            onChangeText={setThread}
            placeholder={copy.threadPlaceholder}
            multiline
            minHeight={140}
            hint={copy.threadHint}
          />
        </Entrance>
        <Entrance index={2} style={{ marginTop: sp(5), gap: sp(2) }}>
          <Btn label={copy.make} onPress={make} busy={busy} disabled={!thread.trim()} />
          {!thread && (
            <Btn label={copy.tryExample} kind="quiet" onPress={() => setThread(EXAMPLE_THREAD)} />
          )}
          {!!error && <ErrorState inline message={error} />}
        </Entrance>
      </Screen>
    );
  }

  return (
    <Screen native>
      {/* After. The decision is the one plate on the screen: big type on the
          light blue ground, with the machine's reading of "when" under it. */}
      <Entrance index={0} distance={26}>
        <View style={{ backgroundColor: t.accentWash, borderRadius: radius.glass, padding: sp(4.5) }}>
          <Txt kind="display">{plan.headline}</Txt>
          {!!plan.when && (
            <DataLabel value={plan.when} style={{ marginTop: sp(4) }}>{copy.when}</DataLabel>
          )}
        </View>
      </Entrance>

      {/* Who is doing what, one line each, and the questions nobody answered
          as one more row at the end. No headings: a name beside a task says
          what it is. */}
      {(plan.tasks.length > 0 || plan.open_questions.length > 0) && (
        <Entrance index={1} style={{ marginTop: sp(4) }}>
          <RowGroup>
            {plan.tasks.map((task, i) => (
              <Row key={`${task.who}-${i}`} style={{ paddingVertical: sp(3), alignItems: 'flex-start' }} gap={3}>
                <Txt kind="label" style={{ width: 72 }}>{task.who}</Txt>
                <Txt kind="body" style={{ flex: 1 }}>{task.what}</Txt>
              </Row>
            ))}
            {plan.open_questions.length > 0 && (
              <View style={{ paddingVertical: sp(3), gap: sp(2) }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Txt kind="tag" tone="muted">{copy.nobodyAnswered}</Txt>
                  <Txt kind="stamp" tone="muted">{String(plan.open_questions.length)}</Txt>
                </Row>
                {plan.open_questions.map((q) => (
                  <Txt key={q} kind="body">{q}</Txt>
                ))}
              </View>
            )}
          </RowGroup>
        </Entrance>
      )}

      {/* The reply, on the paper, and the one button that does something
          with it. It opens the share sheet; it does not post anywhere. */}
      {!!plan.reply_text && (
        <Entrance index={2} style={{ marginTop: sp(7) }}>
          <Txt kind="tag" tone="muted">{copy.replyReady}</Txt>
          <Txt kind="body" style={{ marginTop: sp(2) }}>{plan.reply_text}</Txt>
          <Btn
            label={copy.copyOut}
            onPress={() => Share.share({ message: plan.reply_text })}
            style={{ marginTop: sp(4) }}
          />
          <Txt kind="caption" tone="muted" style={{ marginTop: sp(2) }}>{copy.shareNote}</Txt>
        </Entrance>
      )}

      <Entrance index={3} style={{ marginTop: sp(8) }}>
        <Btn label={copy.startOver} kind="quiet" onPress={() => { setPlan(null); setError(null); }} />
      </Entrance>
    </Screen>
  );
}
