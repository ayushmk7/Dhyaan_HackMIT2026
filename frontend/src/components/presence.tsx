// Camera-lane components. Four of them, and between them they carry the one
// rule that matters most: a family must always be able to tell what Dhyaan
// SAW from what the family TOLD it from what it has INFERRED (§6.5). That is
// `KindTag`, and every citation and timeline row goes through it.
//
// Nothing in this file can render a room name: none of these components
// takes a zone, and the presence sentence arrives room-free from the server
// (§5.2 / D-001). That is structural, not a styling choice.
import React, { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, TextStyle, View, ViewStyle } from 'react-native';
import { Icon } from '@/components/icon';
import { Row, Txt } from '@/components/ui';
import { useReducedMotion } from '@/components/entrance';
import { displaySentence } from '@/lib/format';
import type { ChatCitation, Fact, SourceKind } from '@/lib/types';
import { useTheme } from '@/theme/theme';
import { cardShadow, radius, sp, type } from '@/theme/tokens';
import { useSurfaceColors } from './text';

// ---- KindTag -----------------------------------------------------------------

// Three sources, three FORMS. Observed is the accent on a pointed fill: the
// camera is Dhyaan pointing. Told is ink on the quiet wash: your own words,
// plain. Pattern is an outline with no fill: an inference, held lightly. The
// word does the real work; the form only reinforces it.
const KIND: Record<SourceKind, { word: string; symbol: string; form: 'accent' | 'plain' | 'outline' }> = {
  observed: { word: 'Dhyaan saw', symbol: 'eye', form: 'accent' },
  told: { word: 'You told us', symbol: 'text.quote', form: 'plain' },
  pattern: { word: 'From her pattern', symbol: 'chart.bar', form: 'outline' },
};

const asKind = (k: string): SourceKind =>
  k === 'told' || k === 'pattern' ? k : 'observed';

export function KindTag({ kind, detail }: { kind: string; detail?: string }) {
  const k = KIND[asKind(kind)];
  const c = useSurfaceColors();
  const fg = k.form === 'accent' ? c.accent : k.form === 'plain' ? c.ink : c.muted;
  const plate: ViewStyle =
    k.form === 'accent' ? { backgroundColor: c.accentWash }
    : k.form === 'plain' ? { backgroundColor: c.wash }
    : { borderWidth: 1, borderColor: c.line, paddingVertical: sp(1) - 1, paddingHorizontal: sp(2) - 1 };
  return (
    <View
      style={[styles.tag, plate]}
      // The word carries the meaning; the form only reinforces it, so this
      // still reads correctly without colour vision.
      accessibilityLabel={detail ? `${k.word}, ${detail}` : k.word}
    >
      <Icon name={k.symbol} size={11} color={fg} />
      <Txt kind="label" style={{ color: fg }}>{k.word}</Txt>
      {!!detail && <Txt kind="caption" style={{ color: fg, opacity: 0.8 }}>· {detail}</Txt>}
    </View>
  );
}

// ---- CitationChip ------------------------------------------------------------

/** Splits "You told us · breakfast" into the tag word and its detail. */
const detailOf = (label: string) => {
  const i = label.indexOf('·');
  return i === -1 ? undefined : label.slice(i + 1).trim();
};

export function CitationChip({ citation, onPress }: {
  citation: ChatCitation; onPress?: () => void;
}) {
  const t = useTheme();
  const tappable = !!onPress && citation.event_ids.length > 0;
  const body = (
    <View
      style={[
        styles.citation,
        { backgroundColor: t.raised },
        t.isDark ? { borderWidth: 1, borderColor: t.line } : cardShadow,
      ]}
    >
      <KindTag kind={citation.kind} detail={detailOf(citation.label)} />
      {!!citation.text && (
        <Txt kind="caption" tone="muted" numberOfLines={2} style={{ marginTop: sp(1.5) }}>
          {/* Evidence arrives written for retrieval ("On Sunday 20 September
              at 7:32 AM, …"); the tag already carries the time, so the
              preamble goes and the sentence reads like a person's. */}
          {displaySentence(citation.text)}
        </Txt>
      )}
    </View>
  );
  if (!tappable) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${citation.label}`}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {body}
    </Pressable>
  );
}

// ---- PresenceHero -------------------------------------------------------------

/**
 * The one sentence per screen, at 40px, fading in whenever presence changes.
 * `sentence` is empty when nothing has been noticed yet. That is the state
 * the demo opens in, so `emptySentence` is a required prop, not an
 * afterthought.
 *
 * ponytail: the "cross-fade" is a fade-IN on a remount keyed by the sentence,
 * not a true cross-fade of old against new. On a 180ms swap nobody can tell,
 * and it needs no animated state machine. Ceiling: the outgoing sentence
 * disappears rather than dissolving.
 */
function HeroLine({ text }: { text: string }) {
  const reduced = useReducedMotion();
  const c = useSurfaceColors();
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1, duration: 420, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [progress]);

  return (
    <Animated.Text
      // The hero is the screen's heading, and it announces itself when the
      // sentence changes under the camera.
      accessibilityRole="header"
      accessibilityLiveRegion="polite"
      style={[type.hero as TextStyle, { color: c.ink, opacity: reduced ? 1 : progress }]}
    >
      {text}
    </Animated.Text>
  );
}

export function PresenceHero({ sentence, emptySentence, sub, style }: {
  sentence: string; emptySentence: string; sub?: string; style?: ViewStyle;
}) {
  const shown = sentence.trim() || emptySentence;
  return (
    <View style={style}>
      {/* Keyed on the sentence: a new sentence is a new element, so it fades
          in rather than swapping under the reader. */}
      <HeroLine key={shown} text={shown} />
      {!!sub && <Txt kind="caption" tone="muted" style={{ marginTop: sp(3) }}>{sub}</Txt>}
    </View>
  );
}

// ---- FactRow -------------------------------------------------------------------

/** One thing the family told Dhyaan. Tapping it supersedes, never overwrites. */
export function FactRow({ fact, onPress }: { fact: Fact; onPress?: () => void }) {
  const c = useSurfaceColors();
  const label = fact.key.replace(/_/g, ' ');
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={`${label}: ${fact.text}${onPress ? '. Tap to change.' : ''}`}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.fact, { opacity: pressed ? 0.6 : 1 }]}
    >
      <View style={{ flex: 1 }}>
        <Txt kind="label" tone="muted" style={{ textTransform: 'capitalize' }}>{label}</Txt>
        <Txt kind="body" style={{ marginTop: 2 }}>{fact.text}</Txt>
      </View>
      {!!onPress && (
        <Row gap={1}>
          <Icon name="pencil" size={13} color={c.muted} />
        </Row>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(1),
    paddingHorizontal: sp(2),
    paddingVertical: sp(1),
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  // A citation is a small raised plate, not a wireframe box. Cards in this app
  // are separated by elevation in light mode and by a hairline edge in dark,
  // where a shadow on black is invisible.
  citation: {
    borderRadius: radius.tile,
    padding: sp(2.5),
  },
  fact: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: sp(3),
    paddingVertical: sp(2.5),
  },
});
