// Consent, permission-sheet grammar: title, one quiet line, three grants, each
// a question with Yes/No. The full §5.4 text (the product's legal defence,
// VERBATIM) lives behind a collapsed "How it works" per grant: complete, but
// never a wall.
//
// The grant copy itself is `onboard.consent.grants` in `lib/copy/staff.ts`,
// where it is marked verbatim from the spec. Nothing in a grant's `title`,
// `line` or `detail` may be reworded. Only the surface around it is design.
// The "if you say no" line under each answer is design copy (`copy.ifNo`),
// kept separate from the script on purpose.
//
// The three grants are the screen. They are not cards: a card each made three
// equal boxes and nothing owned the page. Now they sit on the paper, separated
// by hairlines, and the chosen answer is the only filled shape in each.
//
// Decluttered: the intro paragraph, the "what a no means" caption under every
// grant (it now sits inside "How it works", after the script, for whoever
// asks), the chevron glyph beside that link, and the "Who is agreeing" group
// label above two fields that already carry their own labels.
//
// ponytail: answers are held in the session; the whole profile is PUT once in
// done.tsx. Quitting mid-onboarding loses the draft.
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  Btn, Entrance, Field, Row, Rule, Screen, Stagger, Txt,
} from '@/components';
import { onboard } from '@/lib/copy/staff';
import { sp, radius, useTheme } from '@/theme';
import { useSession, type Grants } from '@/store/session';
import { StepHeader } from './_layout';

const copy = onboard.consent;
const GRANTS = copy.grants;

function YesNo({ value, onChange, label }: {
  value: boolean | null; onChange: (v: boolean) => void; label: string;
}) {
  const t = useTheme();
  const opt = (v: boolean, word: string) => {
    const on = value === v;
    return (
      <Pressable
        key={word}
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        accessibilityLabel={copy.yesNoA11y(word, label)}
        onPress={() => onChange(v)}
        style={({ pressed }) => ({
          flex: 1,
          minHeight: 52,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.card,
          // The answer is the one filled shape: the accent wash when chosen,
          // a quiet wash when not, so both read as buttons and the chosen one
          // reads as chosen.
          backgroundColor: on ? t.accentWash : pressed ? t.slateWashDeep : t.slateWash,
          borderWidth: 1.5,
          borderColor: on ? t.accent : 'transparent',
        })}
      >
        <Txt kind="button" tone={on ? 'accent' : 'ink'}>{word}</Txt>
      </Pressable>
    );
  };
  return <Row gap={2} style={{ marginTop: sp(3) }}>{[opt(true, copy.yes), opt(false, copy.no)]}</Row>;
}

function Grant({ g, value, onChange }: {
  g: (typeof GRANTS)[number]; value: boolean | null; onChange: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ paddingVertical: sp(6) }}>
      <Txt kind="title">{g.title}</Txt>
      <Txt kind="body" tone="muted" style={{ marginTop: sp(1.5) }}>{g.line}</Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={copy.howItWorksA11y(g.title)}
        onPress={() => setOpen((v) => !v)}
        hitSlop={8}
        style={({ pressed }) => ({
          marginTop: sp(1), alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center',
          opacity: pressed ? 0.55 : 1,
        })}
      >
        <Txt kind="label" tone="accent">{copy.howItWorks}</Txt>
      </Pressable>
      {open && (
        <View style={{ marginTop: sp(1) }}>
          {g.detail.map((para) => (
            <Txt key={para.slice(0, 24)} kind="caption" style={{ marginTop: sp(2) }}>
              {para}
            </Txt>
          ))}
          {/* What a no means: design copy, after the script, never mixed into it. */}
          <Txt kind="caption" tone="muted" style={{ marginTop: sp(2) }}>{/* voice-ok */}
            {copy.ifNo[g.key]}
          </Txt>
        </View>
      )}
      <YesNo label={g.title} value={value} onChange={onChange} />
    </View>
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
  const [signer, setSigner] = useState(session.consentGivenBy || '');
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
      native
      wash
      floatingBar={<Btn label={copy.agree} disabled={!ready} onPress={agree} />}
    >
      <Stagger>
        {/* The step total follows the answers: each no shortens the setup. */}
        <StepHeader step="consent" grants={grants} title={copy.title} />

        <Field
          label={copy.herName}
          value={resident}
          onChangeText={setResident}
          style={{ marginTop: sp(8) }}
        />

        <View style={{ marginTop: sp(8) }}>
          {GRANTS.map((g, i) => (
            <React.Fragment key={g.key}>
              {i > 0 && <Rule weight="hair" />}
              <Grant
                g={g}
                value={grants[g.key]}
                onChange={(v) => setGrants((s) => ({ ...s, [g.key]: v }))}
              />
            </React.Fragment>
          ))}
        </View>

        <View style={{ marginTop: sp(8) }}>
          <Field
            label={copy.yourName}
            value={signer}
            onChangeText={setSigner}
            placeholder={copy.yourNamePlaceholder}
          />
          <Field
            label={copy.relationship}
            value={relationship}
            onChangeText={setRelationship}
            placeholder={copy.relationshipPlaceholder}
            style={{ marginTop: sp(4) }}
          />
        </View>
      </Stagger>

      {!ready && (
        // Why the button below is still grey, in ink, not a whisper.
        <Entrance index={5}>
          <Txt kind="body" accessibilityLiveRegion="polite" style={{ marginTop: sp(8) }}>{/* voice-ok */}
            {!answeredAll
              ? copy.needAnswers
              : !anyYes
                ? copy.needOneYes
                : copy.needNames}
          </Txt>
        </Entrance>
      )}
    </Screen>
  );
}
