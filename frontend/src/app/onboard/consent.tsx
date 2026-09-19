// Consent. Three separate grants, her name, and who is signing. The copy below
// is VLM_PLAN §5.4 verbatim — it is the product's defence, so it is not
// paraphrased, shortened or softened to fit a layout.
//
// ponytail: this screen records the answers in the session and does not PUT
// on its own. The whole profile — consent, appearance, facts, camera — is
// written once at the end of onboarding (`done.tsx`), so there is exactly one
// place that can fail and exactly one retry to build. Ceiling: quitting
// mid-onboarding loses the answers. Upgrade: PUT each step as it is answered.
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Btn, Card, Field, Hairline, Row, Screen, Txt } from '@/components';
import { sp, palette, radius } from '@/theme/tokens';
import { useSession, type Grants } from '@/store/session';

type GrantKey = keyof Grants;

const GRANTS: { key: GrantKey; title: string; body: string[] }[] = [
  {
    key: 'falls',
    title: 'A band on her wrist, watching for a fall.',
    body: [
      'Her band notices movement, stillness, and a fall. If it thinks she has fallen, it gives her thirty seconds to cancel, then Dhyaan calls her. If she does not answer, it calls the people on her list, in order.',
      'It does not record audio or video. It does not call 911.',
    ],
  },
  {
    key: 'camera',
    title: 'A camera in one room, and a description instead of a video.',
    body: [
      'One camera in the room she spends her day in — never a bedroom or bathroom. It notices whether she is up, whether she has eaten, whether she is settled or moving about, and whether someone is visiting. It turns that into a sentence, on the computer in her home, and throws the picture away. No video is stored. No video is ever shown to family, and there is no way to turn that on. It cannot hear anything. If someone else is alone in the room, Dhyaan may mistake them for her. She can pause it for two hours from the computer, and pausing never affects fall detection.',
    ],
  },
  {
    key: 'memory',
    title: 'Notes about her, kept at home, deleted when you say.',
    body: [
      'To make sense of what it sees, Dhyaan keeps what you tell us about her routine, a few words describing her, and where she usually sits at different times of day. None of this leaves her home, none of it is a face or a photograph, and Forget her profile in Settings removes all of it at once.',
    ],
  },
];

function YesNo({ value, onChange, label }: {
  value: boolean | null; onChange: (v: boolean) => void; label: string;
}) {
  const opt = (v: boolean, word: string) => {
    const on = value === v;
    return (
      <Pressable
        key={word}
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`${word} to ${label}`}
        onPress={() => onChange(v)}
        style={({ pressed }) => ({
          flex: 1,
          minHeight: 48,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.card,
          borderWidth: on ? 2 : 1,
          borderColor: on ? palette.slate : palette.line,
          backgroundColor: on ? palette.slateWash : pressed ? palette.line : 'transparent',
        })}
      >
        <Txt kind="label" tone={on ? 'slate' : 'muted'}>{word}</Txt>
      </Pressable>
    );
  };
  return <Row gap={2} style={{ marginTop: sp(3) }}>{[opt(true, 'Yes'), opt(false, 'No')]}</Row>;
}

export default function Consent() {
  const session = useSession();
  const [resident, setResident] = useState(session.residentName);
  const [signer, setSigner] = useState(session.consentGivenBy || session.user?.name || '');
  const [relationship, setRelationship] = useState(session.consentRelationship);
  const [grants, setGrants] = useState<Grants>(session.grants);

  const answeredAll = GRANTS.every((g) => grants[g.key] !== null);
  const anyYes = Object.values(grants).some((v) => v === true);
  const ready =
    resident.trim().length > 0 && signer.trim().length > 0
    && relationship.trim().length > 0 && answeredAll && anyYes;

  return (
    <Screen>
      <Txt kind="display" accessibilityRole="header">Dhyaan looks out for one person.</Txt>
      <Txt kind="body" tone="muted" style={{ marginTop: sp(3) }}>
        She — or the person legally able to decide with her — agrees to each part
        separately. You can say yes to one and no to another, and change any of them
        later. Nothing here can be switched back on by family without her.
      </Txt>

      <Field
        label="Who is Dhyaan looking out for?"
        value={resident}
        onChangeText={setResident}
        placeholder="Her name"
        style={{ marginTop: sp(6) }}
      />

      {GRANTS.map((g) => (
        <Card key={g.key} style={{ marginTop: sp(4) }}>
          <Txt kind="title">{g.title}</Txt>
          {g.body.map((para) => (
            <Txt key={para.slice(0, 24)} kind="body" tone="muted" style={{ marginTop: sp(2) }}>
              {para}
            </Txt>
          ))}
          <YesNo
            label={g.title}
            value={grants[g.key]}
            onChange={(v) => setGrants((s) => ({ ...s, [g.key]: v }))}
          />
        </Card>
      ))}

      <Hairline style={{ marginVertical: sp(6) }} />

      <Txt kind="label">Your full name, and how you are related to her</Txt>
      <Field
        label="Your full name"
        value={signer}
        onChangeText={setSigner}
        placeholder="Type your full name"
        style={{ marginTop: sp(3) }}
      />
      <Field
        label="How you are related to her"
        value={relationship}
        onChangeText={setRelationship}
        placeholder="Daughter, son, carer…"
        style={{ marginTop: sp(3) }}
      />

      {!ready && (
        <Txt kind="caption" tone="muted" style={{ marginTop: sp(4) }}>
          {!answeredAll
            ? 'Answer each of the three above — yes or no.'
            : !anyYes
              ? 'Dhyaan can’t watch over her with all three declined. Say yes to at least one.'
              : 'Fill in her name, your name, and how you are related to her.'}
        </Txt>
      )}

      <View style={{ marginTop: sp(4) }}>
        <Btn
          label="Agree and continue"
          disabled={!ready}
          onPress={() => {
            session.setConsent({
              residentName: resident.trim(),
              signedBy: signer.trim(),
              relationship: relationship.trim(),
              grants,
            });
            // No camera grant means no camera to place, and no memory grant
            // means nothing to remember — skip straight past both.
            router.push(grants.memory ? '/onboard/about' : '/onboard/contacts');
          }}
        />
      </View>
    </Screen>
  );
}
