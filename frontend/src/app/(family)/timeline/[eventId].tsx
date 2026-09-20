// Event detail: the evidence sentence, plainly. Never an image (§12.4).
import { useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { Btn, Card, ErrorState, Hairline, Row, Screen, Txt } from '@/components';
import { api } from '@/lib/api';
import { dayOf, displaySentence, eventTitle, timeOf } from '@/lib/format';
import { useEvent } from '@/lib/hooks';
import type { KEvent } from '@/lib/types';
import { sp } from '@/theme/tokens';

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

const confidenceWords = (c: number) =>
  c >= 0.95 ? 'Sure' : c >= 0.8 ? 'Fairly sure' : 'Not certain';

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
      <Txt kind="caption" tone="muted">{eventTitle(event.type)}</Txt>
      <Txt kind="title" style={{ marginTop: sp(2) }}>{displaySentence(event.embedding_text)}</Txt>

      <Card style={{ marginTop: sp(5) }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt kind="label">When</Txt>
          <Txt kind="body">{dayOf(event.ts)} · {timeOf(event.ts)}</Txt>
        </Row>
        <Hairline style={{ marginVertical: sp(3) }} />
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt kind="label">Source</Txt>
          <Txt kind="body" style={{ flexShrink: 1, textAlign: 'right' }}>{sensorSentence(event)}</Txt>
        </Row>
        <Hairline style={{ marginVertical: sp(3) }} />
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt kind="label">Certainty</Txt>
          <Txt kind="body">{confidenceWords(event.confidence)}</Txt>
        </Row>
      </Card>

      {verdict ? (
        <Txt kind="body" tone="ok" style={{ marginTop: sp(6) }}>
          Got it. Dhyaan will weigh this differently next time.
        </Txt>
      ) : (
        <View style={{ marginTop: sp(6), gap: sp(2) }}>
          <Btn label="This was expected" kind="quiet" busy={busy} onPress={() => give('expected')} />
          <Btn label="This didn’t happen" kind="quiet" busy={busy} onPress={() => give('false_positive')} />
          {feedbackError && <Txt kind="caption" tone="alert">{feedbackError}</Txt>}
        </View>
      )}
    </Screen>
  );
}
