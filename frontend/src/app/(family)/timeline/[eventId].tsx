// Event detail: the evidence sentence, plainly. Never an image (§12.4).
//
// The sentence is the hero; everything underneath it is the machine's own
// record of how it got there, set in the machine's voice. That split is the
// whole screen: a human sentence you can read out loud, and a readout you can
// audit it against.
import { useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import {
  Btn, Card, DataLabel, ErrorState, KindTag, Marquee, Rule, Screen, Stagger, Txt,
} from '@/components';
import { api } from '@/lib/api';
import { dayOf, displaySentence, eventTitle, timeOf } from '@/lib/format';
import { useEvent } from '@/lib/hooks';
import type { KEvent, SourceKind } from '@/lib/types';
import { palette, sp } from '@/theme/tokens';

function sensorSentence(e: KEvent): string {
  switch (e.source) {
    // Deliberately never `e.zone`, even though a raw event carries one: this
    // is a family screen, and a room name must not reach one (§5.2, D-001).
    // GET /activity already strips it; this is the second lock.
    case 'camera': return 'The camera in her home';
    case 'band': return 'Her band';
    case 'voice': return 'A phone call';
    case 'derived': return 'The pattern of her day';
    default: return 'A person';
  }
}

/** §6.5's three kinds, read off the one field that decides them. */
const kindOf = (e: KEvent): SourceKind =>
  e.source === 'derived' ? 'pattern' : e.source === 'manual' ? 'told' : 'observed';

/** How sure it is, in words a person would use — and what that means for them. */
const certaintyLine = (c: number) =>
  c >= 0.95
    ? 'It is sure enough about this one to say it as a plain sentence.'
    : c >= 0.8
      ? 'It is fairly sure about this one. Tell it below if it got this wrong.'
      : 'It is not certain about this one. Tell it below if it got this wrong.';

export default function EventDetail() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { data: event, isLoading, isError, refetch } = useEvent(eventId ?? '');
  const [verdict, setVerdict] = useState<'expected' | 'false_positive' | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  if (!event) {
    return (
      <Screen native>
        {isError ? (
          <ErrorState message="Couldn’t load that observation." onRetry={refetch} />
        ) : (
          <Txt kind="body" tone="muted">{/* voice-ok */}
            {isLoading ? 'Looking that up…' : 'That observation isn’t here any more.'}
          </Txt>
        )}
      </Screen>
    );
  }

  const give = async (v: 'expected' | 'false_positive') => {
    setBusy(true);
    setFeedbackError(null);
    try {
      await api.feedback(event.id, v);
      setVerdict(v);
    } catch {
      setFeedbackError('Couldn’t save that. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen native>
      <Stagger gap={6}>
        <View>
          <KindTag kind={kindOf(event)} detail={timeOf(event.ts)} />
          <Txt kind="hero" style={{ marginTop: sp(3) }}>{displaySentence(event.embedding_text)}</Txt>
        </View>

        {/* The screen's one uncompromising surface: paper on ink, every figure
            tabular, nothing softened. This is the record, not the reassurance. */}
        <Card lift="float" style={{ backgroundColor: palette.ink, gap: sp(3) }}>
          <DataLabel tone={palette.paper} value={`${dayOf(event.ts)} · ${timeOf(event.ts)}`}>
            Recorded
          </DataLabel>
          <Rule color={palette.paper} style={{ opacity: 0.25 }} />
          <DataLabel tone={palette.paper} value={event.source.toUpperCase()}>Source</DataLabel>
          <Rule color={palette.paper} style={{ opacity: 0.25 }} />
          <DataLabel tone={palette.paper} value={event.confidence.toFixed(2)}>Confidence</DataLabel>
        </Card>

        <View>
          <Txt kind="body">
            {sensorSentence(event)} noticed this, and Dhyaan filed it as “{eventTitle(event.type)}”.
          </Txt>
          <Txt kind="body" tone="muted" style={{ marginTop: sp(2) }}>
            {certaintyLine(event.confidence)}
          </Txt>
        </View>

        <View>
          <Marquee title="Did Dhyaan get this right?" first />
          {verdict ? (
            // True as written: the route records the verdict against this
            // observation. Nothing reads it back for you, so don't promise
            // that it will — the old copy said Dhyaan would "weigh this
            // differently next time", and nothing does.
            <Txt kind="body" tone="ok">Got it. That’s recorded against this observation.</Txt>
          ) : (
            <View style={{ gap: sp(2) }}>
              <Btn label="This was expected" kind="quiet" busy={busy} onPress={() => give('expected')} />
              <Btn label="This didn’t happen" kind="quiet" busy={busy} onPress={() => give('false_positive')} />
              {feedbackError && <Txt kind="caption" tone="alert">{feedbackError}</Txt>}
            </View>
          )}
        </View>
      </Stagger>
    </Screen>
  );
}
