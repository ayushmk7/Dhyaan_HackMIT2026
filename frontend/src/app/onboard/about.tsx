// What the family tells Dhyaan about her. These answers are not settings:
// each one becomes a `profile_facts` row (§4.2) that the chatbot retrieves and
// cites as "You told us", so the text you type here is the text she reads back.
// That is why every chip writes a whole sentence rather than a token: the fact
// has to stand on its own in an answer weeks from now.
//
// One question per screen, skippable. An unanswered question is simply no
// fact. Dhyaan says it wasn't told, rather than guessing.
//
// The question owns the screen. The step and the question counter are one
// small machine line above it; the chips and the field sit straight on the
// paper under it, with no card, because a box around the answer made the
// answer look like a form.
//
// The questions, hints, placeholders and chip sentences are
// `onboard.about.questions` in `lib/copy/staff.ts`; the keys are §4.2's.
import { router } from 'expo-router';
import React, { useState } from 'react';

import { Btn, DataLabel, Entrance, Field, Row, Screen, Txt } from '@/components';
import { onboard } from '@/lib/copy/staff';
import { sp } from '@/theme/tokens';
import { useSession } from '@/store/session';
import { ChoiceChip, stepOf } from './_layout';

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
      <Entrance index={0}>
        {/* The machine line: which step this is, and which question. */}
        <Row gap={4}>
          <DataLabel value={stepOf('about', grants)}>{onboard.step.label}</DataLabel>
          <DataLabel value={`${idx + 1}/${QUESTIONS.length}`}>{copy.questionCounter}</DataLabel>
        </Row>
        <Txt kind="display" style={{ marginTop: sp(3) }} accessibilityRole="header">
          {q.prompt}
        </Txt>
        <Txt kind="body" tone="muted" style={{ marginTop: sp(3) }}>
          {q.hint ?? copy.purpose}
        </Txt>
      </Entrance>

      <Entrance index={1}>
        <Row gap={2} style={{ flexWrap: 'wrap', marginTop: sp(6) }}>
          {q.chips(residentName).map((c) => (
            <ChoiceChip key={c.label} label={c.label} selected={text === c.text} onPress={() => setText(c.text)} />
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
      </Entrance>

      <Entrance index={2} style={{ marginTop: sp(5) }}>
        {/* Two real buttons. As text links they were the smallest things on
            the screen and the ones a hurried thumb missed. */}
        <Row gap={3}>
          <Btn kind="quiet" size="small" label={copy.back} onPress={() => go(-1)} style={{ flex: 1 }} />
          <Btn kind="quiet" size="small" label={copy.skip} onPress={() => { setText(''); go(1, ''); }} style={{ flex: 1 }} />
        </Row>
      </Entrance>
    </Screen>
  );
}
