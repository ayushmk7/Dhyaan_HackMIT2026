// Consent, permission-sheet grammar: mark, four-word title, one line, Yes/No.
// The full §5.4 text (the product's legal defence, VERBATIM) lives behind a
// collapsed "How it works" per grant — complete, but never a wall.
//
// Nothing in `line` or `detail` may be reworded: that copy is the spec's, to
// the letter. Only the surface around it is design.
//
// ponytail: answers are held in the session; the whole profile is PUT once in
// done.tsx. Quitting mid-onboarding loses the draft.
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  Btn, Card, Entrance, Field, Marquee, Row, Rule, Screen, Stagger, Txt,
} from '@/components';
import { Icon, IconBadge } from '@/components/icon';
import { sp, palette, radius } from '@/theme/tokens';
import { useSession, type Grants } from '@/store/session';

type GrantKey = keyof Grants;

const GRANTS: {
  key: GrantKey; icon: string; title: string; line: string; detail: string[];
}[] = [
  {
    key: 'falls',
    icon: 'figure.fall',
    title: 'Fall detection',
    line: 'Detects falls and calls her, then her contacts.',
    detail: [
      'Her band notices movement, stillness, and a fall. If it thinks she has fallen, it gives her thirty seconds to cancel, then Dhyaan calls her. If she does not answer, it calls the people on her list, in order.',
      'It does not record audio or video. It does not call 911.',
    ],
  },
  {
    key: 'camera',
    icon: 'eye',
    title: 'One room camera',
    line: 'Describes her day in text. No video is saved.',
    detail: [
      'One camera in the room she spends her day in. It is never put in a bedroom or bathroom. It notices whether she is up, whether she has eaten, whether she is settled or moving about, and whether someone is visiting. It turns that into a sentence, on the computer in her home, and throws the picture away. No video is stored. No video is ever shown to family, and there is no way to turn that on. It cannot hear anything. If someone else is alone in the room, Dhyaan may mistake them for her. She can pause it for two hours from the computer, and pausing never affects fall detection.',
    ],
  },
  {
    key: 'memory',
    icon: 'lock',
    title: 'Remembers her routine',
    line: 'Saves her routine on the computer at her house.',
    detail: [
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
          backgroundColor: on ? palette.ink : pressed ? palette.line : palette.slateWash,
        })}
      >
        <Txt kind="label" tone={on ? 'paper' : 'muted'}>{word}</Txt>
      </Pressable>
    );
  };
  return <Row gap={2} style={{ marginTop: sp(3) }}>{[opt(true, 'Yes'), opt(false, 'No')]}</Row>;
}

function GrantCard({ g, value, onChange }: {
  g: (typeof GRANTS)[number]; value: boolean | null; onChange: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ marginTop: sp(3) }}>
      <Row gap={3}>
        {/* Ink, not a hue: chrome carries no colour, and none of the three
            grants is more or less alarming than another. */}
        <IconBadge name={g.icon} color={palette.ink} size={34} />
        <View style={{ flex: 1 }}>
          <Txt kind="label">{g.title}</Txt>
          <Txt kind="caption" style={{ marginTop: 1 }}>{g.line}</Txt>
        </View>
      </Row>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen((v) => !v)}
        style={{ marginTop: sp(2.5), alignSelf: 'flex-start' }}
      >
        <Row gap={1}>
          <Icon name={open ? 'chevron.down' : 'chevron.right'} size={11} color={palette.ink} />
          <Txt kind="caption" style={{ fontWeight: '600' }}>How it works</Txt>
        </Row>
      </Pressable>
      {open && (
        <View style={{ marginTop: sp(2.5) }}>
          <Rule weight="hair" color={palette.line} />
          {g.detail.map((para) => (
            <Txt key={para.slice(0, 24)} kind="caption" style={{ marginTop: sp(2.5) }}>
              {para}
            </Txt>
          ))}
        </View>
      )}
      <YesNo label={g.title} value={value} onChange={onChange} />
    </Card>
  );
}

/** Next step, respecting the grants: no falls grant means no band to pair. */
export function nextAfterConsent(grants: Grants): string {
  if (grants.memory) return '/onboard/about';
  if (grants.falls) return '/onboard/pair';
  if (grants.camera) return '/onboard/camera';
  return '/onboard/contacts';
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

  const agree = () => {
    session.setConsent({
      residentName: resident.trim(),
      signedBy: signer.trim(),
      relationship: relationship.trim(),
      grants,
    });
    router.push(nextAfterConsent(grants) as never);
  };

  return (
    <Screen
      wash
      floatingBar={<Btn label="Agree and continue" disabled={!ready} onPress={agree} />}
    >
      <Stagger>
        <View>
          <Marquee first title="Permissions" />
          <Txt kind="body">
            She can change these anytime in Settings.
          </Txt>
        </View>

        <Field
          label="Her name"
          value={resident}
          onChangeText={setResident}
          placeholder="Her name"
          style={{ marginTop: sp(5) }}
        />

        <View style={{ marginTop: sp(2) }}>
          {GRANTS.map((g) => (
            <GrantCard
              key={g.key}
              g={g}
              value={grants[g.key]}
              onChange={(v) => setGrants((s) => ({ ...s, [g.key]: v }))}
            />
          ))}
        </View>

        <View style={{ marginTop: sp(6) }}>
          <Rule weight="heavy" />
          <Txt kind="label" style={{ marginTop: sp(3) }}>Who is agreeing</Txt>
          <Field
            label="Your name"
            value={signer}
            onChangeText={setSigner}
            placeholder="Full name"
            style={{ marginTop: sp(3) }}
          />
          <Field
            label="Relationship"
            value={relationship}
            onChangeText={setRelationship}
            placeholder="Daughter, son, carer"
            style={{ marginTop: sp(3) }}
          />
        </View>
      </Stagger>

      {!ready && (
        <Entrance index={5}>
          <Txt kind="caption" tone="muted" style={{ marginTop: sp(4) }}>{/* voice-ok */}
            {!answeredAll
              ? 'Answer all three.'
              : !anyYes
                ? 'Say yes to at least one.'
                : 'Add her name, your name, and your relationship.'}
          </Txt>
        </Entrance>
      )}
    </Screen>
  );
}
