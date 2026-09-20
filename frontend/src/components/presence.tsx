// Camera-lane components. Four of them, and between them they carry the one
// rule that matters most: a family must always be able to tell what Dhyaan
// SAW from what the family TOLD it from what it has INFERRED (§6.5). That is
// `KindTag`, and every citation and timeline row goes through it.
//
// Nothing in this file can render a room name — none of these components
// takes a zone, and the presence sentence arrives room-free from the server
// (§5.2 / D-001). That is structural, not a styling choice.
import React, { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, TextStyle, View, ViewStyle } from 'react-native';
import { Icon } from '@/components/icon';
import { Row, Txt } from '@/components/ui';
import { useReducedMotion } from '@/components/entrance';
import type { ChatCitation, Fact, SourceKind } from '@/lib/types';
import { cardShadow, palette, radius, sp, type } from '@/theme/tokens';

// ---- KindTag -----------------------------------------------------------------

const KIND: Record<SourceKind, { word: string; fg: string; wash: string; symbol: string }> = {
  // Amber is the camera's colour — "observed just now". It is not a status and
  // never means alert; rust still owns that alone.
  observed: { word: 'Dhyaan saw', fg: palette.amber, wash: palette.amberWash, symbol: 'eye' },
  told: { word: 'You told us', fg: palette.slate, wash: palette.slateWash, symbol: 'text.quote' },
  pattern: { word: 'From her pattern', fg: palette.moss, wash: palette.mossWash, symbol: 'chart.bar' },
};

const asKind = (k: string): SourceKind =>
  k === 'told' || k === 'pattern' ? k : 'observed';

export function KindTag({ kind, detail }: { kind: string; detail?: string }) {
  const k = KIND[asKind(kind)];
  return (
    <View
      style={[styles.tag, { backgroundColor: k.wash }]}
      // The word carries the meaning; the colour only reinforces it, so this
      // still reads correctly without colour vision.
      accessibilityLabel={detail ? `${k.word}, ${detail}` : k.word}
    >
      <Icon name={k.symbol} size={11} color={k.fg} />
      <Txt kind="label" style={{ color: k.fg }}>{k.word}</Txt>
      {!!detail && <Txt kind="caption" style={{ color: k.fg, opacity: 0.8 }}>· {detail}</Txt>}
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
  const tappable = !!onPress && citation.event_ids.length > 0;
  const body = (
    <View style={styles.citation}>
      <KindTag kind={citation.kind} detail={detailOf(citation.label)} />
      {!!citation.text && (
        <Txt kind="caption" tone="muted" numberOfLines={2} style={{ marginTop: sp(1.5) }}>
          {citation.text}
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
 * `sentence` is empty when nothing has been noticed yet — that is the state
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
      style={[type.hero as TextStyle, { color: palette.ink, opacity: reduced ? 1 : progress }]}
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
          <Icon name="pencil" size={13} color={palette.inkMuted} />
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
  // are separated by elevation; a border around one is the look the whole
  // design system exists to avoid.
  citation: {
    backgroundColor: palette.raised,
    borderRadius: radius.tile,
    padding: sp(2.5),
    ...cardShadow,
  },
  fact: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: sp(3),
    paddingVertical: sp(2.5),
  },
});
