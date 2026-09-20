// What the family tells Dhyaan about her. These answers are not settings —
// each one becomes a `profile_facts` row (§4.2) that the chatbot retrieves and
// cites as "You told us", so the text you type here is the text she reads back.
// That is why every chip writes a whole sentence rather than a token: the fact
// has to stand on its own in an answer weeks from now.
//
// One question per card, skippable. An unanswered question is simply no fact —
// Dhyaan says it wasn't told, rather than guessing.
//
// The questions, hints, placeholders and chip sentences are
// `onboard.about.questions` in `lib/copy/staff.ts`; the keys are §4.2's.
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Btn, Card, Chip, DataLabel, Entrance, Field, Row, Rule, Screen, Txt } from '@/components';
import { onboard } from '@/lib/copy/staff';
import { sp } from '@/theme/tokens';
import { useSession } from '@/store/session';

const copy = onboard.about;
const QUESTIONS = copy.questions;

export default function About() {
  const { residentName, factDrafts, setFact, grants } = useSession();
  const [idx, setIdx] = useState(0);
  const q = QUESTIONS[idx];
  const [text, setText] = useState(() => factDrafts.find((f) => f.key === q.key)?.text ?? '');

  const go = (delta: number, answer = text) => {
    setFact(q.key, answer.trim());
    const next = idx + delta;
    if (next < 0) { router.back(); return; }
    if (next >= QUESTIONS.length) {
      // Band first (falls grant), then camera, then the call list.
      router.push(
        grants.falls ? '/onboard/pair'
          : grants.camera ? '/onboard/camera'
            : '/onboard/contacts',
      );
      return;
    }
    // Read back through the store, not the render-time copy: setFact above has
    // already landed there, and `factDrafts` in this closure has not.
    const saved = useSession.getState().factDrafts;
    setIdx(next);
    setText(saved.find((f) => f.key === QUESTIONS[next].key)?.text ?? '');
  };

  const answered = factDrafts.filter((f) => f.text.length > 0).length;

  return (
    <Screen
      native
      wash
      floatingBar={
        <Btn
          label={idx === QUESTIONS.length - 1 ? copy.saveAll : copy.next}
          onPress={() => go(1)}
        />
      }
    >
      {/* Machine counters, in the machine face — the only caps on this screen. */}
      <Entrance index={0}>
        <Row style={{ justifyContent: 'space-between' }}>
          <DataLabel value={`${idx + 1}/${QUESTIONS.length}`}>{copy.questionCounter}</DataLabel>
          <DataLabel value={String(answered)}>{copy.answered}</DataLabel>
        </Row>
        <Rule style={{ marginTop: sp(2) }} />
      </Entrance>

      <Entrance index={1}>
        <Txt kind="display" style={{ marginTop: sp(5) }} accessibilityRole="header">
          {q.prompt}
        </Txt>
        {!!q.hint && (
          <Txt kind="caption" tone="muted" style={{ marginTop: sp(3) }}>{q.hint}</Txt>
        )}
      </Entrance>

      <Entrance index={2}>
        <Card style={{ marginTop: sp(5) }}>
          <Txt kind="label" tone="muted">{copy.tapOne}</Txt>
          <Row gap={2} style={{ flexWrap: 'wrap', marginTop: sp(3) }}>
            {q.chips(residentName).map((c) => (
              <Chip key={c.label} label={c.label} selected={text === c.text} onPress={() => setText(c.text)} />
            ))}
          </Row>
          <Field
            label={copy.fieldLabel}
            value={text}
            onChangeText={setText}
            placeholder={q.placeholder}
            multiline
            maxLength={q.maxLength ?? 300}
            hint={q.maxLength ? copy.charCount(text.length, q.maxLength) : copy.storedAsSentence}
            style={{ marginTop: sp(4) }}
          />
        </Card>
      </Entrance>

      <Entrance index={3} style={{ marginTop: sp(5) }}>
        <Row gap={2}>
          <Btn kind="quiet" label={copy.back} onPress={() => go(-1)} style={{ flex: 1 }} />
          <Btn
            kind="ghost"
            label={copy.skip}
            onPress={() => { setText(''); go(1, ''); }}
            style={{ flex: 1 }}
          />
        </Row>
      </Entrance>
    </Screen>
  );
}
