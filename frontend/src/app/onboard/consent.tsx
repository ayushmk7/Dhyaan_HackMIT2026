// Consent, permission-sheet grammar: mark, four-word title, one line, Yes/No.
// The full §5.4 text (the product's legal defence, VERBATIM) lives behind a
// collapsed "How it works" per grant — complete, but never a wall.
//
// The grant copy itself is `onboard.consent.grants` in `lib/copy/staff.ts`,
// where it is marked verbatim from the spec. Nothing in a grant's `title`,
// `line` or `detail` may be reworded. Only the surface around it is design.
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
import { onboard } from '@/lib/copy/staff';
import { sp, radius, useTheme } from '@/theme';
import { useSession, type Grants } from '@/store/session';

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
          minHeight: 48,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.card,
          backgroundColor: on ? t.ink : pressed ? t.line : t.slateWash,
        })}
      >
        <Txt kind="label" tone={on ? 'paper' : 'muted'}>{word}</Txt>
      </Pressable>
    );
  };
  return <Row gap={2} style={{ marginTop: sp(3) }}>{[opt(true, copy.yes), opt(false, copy.no)]}</Row>;
}

function GrantCard({ g, value, onChange }: {
  g: (typeof GRANTS)[number]; value: boolean | null; onChange: (v: boolean) => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ marginTop: sp(3) }}>
      <Row gap={3}>
        {/* Ink, not a hue: chrome carries no colour, and none of the three
            grants is more or less alarming than another. */}
        <IconBadge name={g.icon} color={t.ink} size={34} />
        <View style={{ flex: 1 }}>
          <Txt kind="label">{g.title}</Txt>
          <Txt kind="caption" style={{ marginTop: 1 }}>{g.line}</Txt>
        </View>
      </Row>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={copy.howItWorksA11y(g.title)}
        onPress={() => setOpen((v) => !v)}
        style={{ marginTop: sp(1), alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}
      >
        <Row gap={1}>
          <Icon name={open ? 'chevron.down' : 'chevron.right'} size={11} color={t.ink} />
          <Txt kind="tag">{copy.howItWorks}</Txt>
        </Row>
      </Pressable>
      {open && (
        <View style={{ marginTop: sp(2.5) }}>
          <Rule weight="hair" color={t.line} />
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
      native
      wash
      floatingBar={<Btn label={copy.agree} disabled={!ready} onPress={agree} />}
    >
      <Stagger>
        <View>
          <Marquee first title={copy.title} />
          <Txt kind="body">
            {copy.intro}
          </Txt>
        </View>

        <Field
          label={copy.herName}
          value={resident}
          onChangeText={setResident}
          placeholder={copy.herNamePlaceholder}
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
          <Txt kind="label" style={{ marginTop: sp(3) }}>{copy.whoIsAgreeing}</Txt>
          <Field
            label={copy.yourName}
            value={signer}
            onChangeText={setSigner}
            placeholder={copy.yourNamePlaceholder}
            style={{ marginTop: sp(3) }}
          />
          <Field
            label={copy.relationship}
            value={relationship}
            onChangeText={setRelationship}
            placeholder={copy.relationshipPlaceholder}
            style={{ marginTop: sp(3) }}
          />
        </View>
      </Stagger>

      {!ready && (
        <Entrance index={5}>
          <Txt kind="caption" tone="muted" style={{ marginTop: sp(4) }}>{/* voice-ok */}
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
