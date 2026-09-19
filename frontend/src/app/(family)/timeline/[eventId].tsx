// Event detail: the evidence sentence, plainly. Never an image (§12.4).
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { Btn, Card, Hairline, Row, Screen, Txt } from '@/components';
import { api } from '@/lib/api';
import { dayOf, eventTitle, timeOf, zoneLabel } from '@/lib/format';
import { useEvent } from '@/lib/hooks';
import type { KEvent } from '@/lib/types';
import { sp } from '@/theme/tokens';

function sensorSentence(e: KEvent): string {
  switch (e.source) {
    case 'camera': return e.zone ? `Seen by the ${zoneLabel(e.zone).toLowerCase()} camera` : 'Seen by a camera';
    case 'band': return 'Reported by her band';
    case 'voice': return 'From a phone call';
    case 'derived': return 'Worked out from the pattern of her day';
    default: return 'Noted by a person';
  }
}

const confidenceWords = (c: number) =>
  c >= 0.95 ? 'Sure' : c >= 0.8 ? 'Fairly sure' : 'Not certain';

export default function EventDetail() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { data: event, isLoading } = useEvent(eventId ?? '');
  const [verdict, setVerdict] = useState<'expected' | 'false_positive' | null>(null);
  const [busy, setBusy] = useState(false);

  if (!event) {
    return (
      <Screen>
        <Txt kind="body" tone="muted">
          {isLoading ? 'Looking that up…' : 'That observation isn’t here any more.'}
        </Txt>
        <Btn label="Back" kind="quiet" onPress={() => router.back()} style={{ marginTop: sp(5) }} />
      </Screen>
    );
  }

  const give = async (v: 'expected' | 'false_positive') => {
    setBusy(true);
    await api.feedback(event.id, v);
    setVerdict(v);
    setBusy(false);
  };

  return (
    <Screen>
      <Txt kind="caption" tone="muted">{eventTitle(event.type)}</Txt>
      <Txt kind="title" style={{ marginTop: sp(2) }}>{event.embedding_text}</Txt>

      <Card style={{ marginTop: sp(6) }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt kind="label">When</Txt>
          <Txt kind="body">{dayOf(event.ts)} · {timeOf(event.ts)}</Txt>
        </Row>
        <Hairline style={{ marginVertical: sp(3) }} />
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt kind="label">How Dhyaan knows</Txt>
          <Txt kind="body" style={{ flexShrink: 1, textAlign: 'right' }}>{sensorSentence(event)}</Txt>
        </Row>
        <Hairline style={{ marginVertical: sp(3) }} />
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt kind="label">How certain</Txt>
          <Txt kind="body">{confidenceWords(event.confidence)}</Txt>
        </Row>
      </Card>

      {verdict ? (
        <Txt kind="body" tone="ok" style={{ marginTop: sp(6) }}>
          Got it — Dhyaan will weigh this differently next time.
        </Txt>
      ) : (
        <View style={{ marginTop: sp(6), gap: sp(2) }}>
          <Txt kind="caption" tone="muted">
            Does this look right? Your answer teaches her baseline.
          </Txt>
          <Btn label="This was expected" kind="quiet" busy={busy} onPress={() => give('expected')} />
          <Btn label="This didn’t happen" kind="quiet" busy={busy} onPress={() => give('false_positive')} />
        </View>
      )}
    </Screen>
  );
}
