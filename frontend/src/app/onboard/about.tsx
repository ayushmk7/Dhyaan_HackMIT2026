// What the family tells Dhyaan about her. These answers are not settings —
// each one becomes a `profile_facts` row (§4.2) that the chatbot retrieves and
// cites as "You told us", so the text you type here is the text she reads back.
// That is why every chip writes a whole sentence rather than a token: the fact
// has to stand on its own in an answer weeks from now.
//
// One question per card, skippable. An unanswered question is simply no fact —
// Dhyaan says it wasn't told, rather than guessing.
import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { Btn, Card, Chip, Field, Row, Screen, Txt } from '@/components';
import { sp } from '@/theme/tokens';
import { useSession } from '@/store/session';

type Question = {
  key: string;
  prompt: string;
  hint?: string;
  placeholder: string;
  maxLength?: number;
  /** A short pill that writes a whole sentence — the fact text, not the pill,
   *  is what gets stored and read back. */
  chips: (name: string) => { label: string; text: string }[];
};

// The keys are §4.2's, exactly — the backend slugs facts by them, and `private`
// additionally feeds the chat guard's hard list.
const QUESTIONS: Question[] = [
  {
    key: 'wake',
    prompt: 'When is she usually up?',
    placeholder: 'She is usually up around…',
    chips: (n) => [
      { label: 'Around 5:30', text: `${n} is usually up around 5:30.` },
      { label: 'Around 6:30', text: `${n} is usually up around 6:30.` },
      { label: 'Around 7:30', text: `${n} is usually up around 7:30.` },
      { label: 'After 8', text: `${n} is usually up after 8.` },
    ],
  },
  {
    key: 'breakfast',
    prompt: 'What does breakfast usually look like?',
    placeholder: 'Toast and tea, about 8.',
    chips: () => [
      { label: 'Toast and tea', text: 'Toast and tea, about 8.' },
      { label: 'Porridge', text: 'Porridge, about 7:30.' },
      { label: 'Often skips it', text: 'She often skips breakfast.' },
    ],
  },
  {
    key: 'lunch',
    prompt: 'And lunch?',
    placeholder: 'Lunch is usually soup around 12:30.',
    chips: () => [
      { label: 'Soup, 12:30', text: 'Lunch is usually soup around 12:30.' },
      { label: 'Sandwich, 1', text: 'A sandwich around 1.' },
      { label: 'Her main meal', text: 'Lunch is her main meal.' },
    ],
  },
  {
    key: 'dinner',
    prompt: 'And dinner?',
    placeholder: 'Dinner around 6.',
    chips: () => [
      { label: 'Around 6', text: 'Dinner around 6.' },
      { label: 'Around 7', text: 'Dinner around 7, usually something she cooked earlier.' },
      { label: 'Light', text: 'Dinner is usually light.' },
    ],
  },
  {
    key: 'walk',
    prompt: 'Does she go out most days? When?',
    hint: 'The camera can’t see the front door, so this is how Dhyaan knows what being out of view might mean.',
    placeholder: 'She walks to the shops around 10 most mornings.',
    chips: () => [
      { label: 'Morning walk, 10', text: 'She walks to the shops around 10 most mornings.' },
      { label: 'Afternoon', text: 'She goes out in the afternoon most days.' },
      { label: 'Rarely alone', text: 'She rarely goes out on her own.' },
    ],
  },
  {
    key: 'mobility',
    prompt: 'How does she get around?',
    placeholder: 'Steady indoors.',
    chips: () => [
      { label: 'Steady', text: 'Steady on her feet.' },
      { label: 'Cane outdoors', text: 'Uses a cane outdoors, steady indoors.' },
      { label: 'Walker', text: 'Uses a walker indoors and out.' },
    ],
  },
  {
    key: 'afternoon',
    prompt: 'Where does she usually spend her afternoons?',
    hint: 'Describe the spot, not the room — "her armchair by the window" is what Dhyaan can recognise.',
    placeholder: 'In the armchair by the window, reading.',
    chips: () => [
      { label: 'Her armchair', text: 'In the armchair by the window, reading.' },
      { label: 'At the table', text: 'At the table with the radio on.' },
      { label: 'On the sofa', text: 'On the sofa with the television.' },
    ],
  },
  {
    key: 'visitors',
    prompt: 'Who visits, and when?',
    hint: 'Dhyaan only ever notes that someone visited and for how long — never who.',
    placeholder: 'Her neighbour comes on Tuesdays.',
    chips: () => [
      { label: 'Neighbour, Tuesdays', text: 'Her neighbour comes on Tuesdays.' },
      { label: 'Family, weekends', text: 'Family visit at weekends.' },
      { label: 'Rarely', text: 'She rarely has visitors.' },
    ],
  },
  {
    key: 'appearance',
    prompt: 'How would you describe her to someone meeting her?',
    hint: 'A few words, never a photo. Dhyaan uses this only as a hint when two people are in the room — it is not face recognition, and it is not stored as an image.',
    placeholder: 'Short grey hair, glasses, usually a blue cardigan.',
    maxLength: 200,
    chips: () => [
      { label: 'An example', text: 'Short grey hair, glasses, usually a blue cardigan.' },
    ],
  },
  {
    key: 'private',
    prompt: 'Anything Dhyaan should never note?',
    hint: 'This becomes a rule, not a preference — Dhyaan refuses these questions from anyone, including you.',
    placeholder: 'Never note bathroom trips.',
    chips: () => [
      { label: 'Bathroom trips', text: 'Never note bathroom trips.' },
      { label: 'Her weight', text: 'Never note anything about her weight.' },
      { label: 'Nothing', text: 'Nothing in particular.' },
    ],
  },
];

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
      router.push(grants.camera ? '/onboard/camera' : '/onboard/contacts');
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
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt kind="label" tone="muted">Question {idx + 1} of {QUESTIONS.length}</Txt>
        <Txt kind="label" tone="muted">{answered} answered</Txt>
      </Row>

      <Txt kind="display" style={{ marginTop: sp(4) }} accessibilityRole="header">
        {q.prompt}
      </Txt>
      {!!q.hint && (
        <Txt kind="caption" tone="muted" style={{ marginTop: sp(3) }}>{q.hint}</Txt>
      )}

      <Card style={{ marginTop: sp(5) }}>
        <Txt kind="label" tone="muted">Tap one to start, then change the words to hers</Txt>
        <Row gap={2} style={{ flexWrap: 'wrap', marginTop: sp(3) }}>
          {q.chips(residentName).map((c) => (
            <Chip key={c.label} label={c.label} selected={text === c.text} onPress={() => setText(c.text)} />
          ))}
        </Row>
        <Field
          label="What Dhyaan should remember"
          value={text}
          onChangeText={setText}
          placeholder={q.placeholder}
          multiline
          maxLength={q.maxLength ?? 300}
          hint={
            q.maxLength
              ? `${text.length} of ${q.maxLength} characters`
              : 'This is stored as a sentence and read back to you when it’s used.'
          }
          style={{ marginTop: sp(4) }}
        />
      </Card>

      <View style={{ marginTop: sp(6), gap: sp(2) }}>
        <Btn
          label={idx === QUESTIONS.length - 1 ? 'Save what you told us' : 'Next'}
          onPress={() => go(1)}
        />
        <Row gap={2}>
          <Btn kind="quiet" label="Back" onPress={() => go(-1)} style={{ flex: 1 }} />
          <Btn
            kind="ghost"
            label="Skip this one"
            onPress={() => { setText(''); go(1, ''); }}
            style={{ flex: 1 }}
          />
        </Row>
      </View>

      <Txt kind="caption" tone="muted" style={{ marginTop: sp(4) }}>
        Skip anything you’re unsure about. Dhyaan would rather say it wasn’t told than guess.
      </Txt>
    </Screen>
  );
}
