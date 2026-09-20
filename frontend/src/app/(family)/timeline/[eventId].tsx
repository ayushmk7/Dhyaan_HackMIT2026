// Event detail: the evidence sentence, plainly. Never an image (§12.4).
//
// The sentence is the hero; everything underneath it is the machine's own
// record of how it got there, set in the machine's voice. That split is the
// whole screen: a human sentence you can read out loud, and a readout you can
// audit it against.
//
// Every sentence this screen says lives in lib/copy/family.ts under `event`.
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import {
  Btn, DataLabel, EmptyState, ErrorState, KindTag, LoadingState, Marquee, Rule, Screen, Slab, Stagger,
  Txt,
} from '@/components';
import { api } from '@/lib/api';
import { family } from '@/lib/copy/family';
import { dayOf, displaySentence, eventTitle, scrubRooms, timeOf } from '@/lib/format';
import { useEvent } from '@/lib/hooks';
import type { KEvent, SourceKind } from '@/lib/types';
import { sp } from '@/theme/tokens';

const copy = family.event;

function sensorSentence(e: KEvent): string {
  switch (e.source) {
    // Deliberately never `e.zone`, even though a raw event carries one: this
    // is a family screen, and a room name must not reach one (§5.2, D-001).
    // GET /activity already strips it; this is the second lock.
    case 'camera': return copy.source.camera;
    case 'band': return copy.source.band;
    case 'voice': return copy.source.voice;
    case 'derived': return copy.source.derived;
    default: return copy.source.other;
  }
}

/**
 * The sentence a person reads. The band's fall record is a log line ("Band
 * band_a3f2 reported fall_suspected"); every other record already arrives as
 * a sentence. Nothing is added that the record does not say.
 */
const familySentence = (e: KEvent): string => {
  if (e.type === 'fall_suspected') return family.shared.fallSuspected;
  if (e.type === 'fall_confirmed') return family.shared.fallConfirmed;
  // The raw record names rooms; this is a family screen, so the same scrub the
  // server runs on the activity feed runs here too (the second lock, for real).
  return scrubRooms(displaySentence(e.embedding_text));
};

/** §6.5's three kinds, read off the one field that decides them. */
const kindOf = (e: KEvent): SourceKind =>
  e.source === 'derived' ? 'pattern' : e.source === 'manual' ? 'told' : 'observed';

export default function EventDetail() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { data: event, isLoading, isError, refetch } = useEvent(eventId ?? '');
  const [verdict, setVerdict] = useState<'expected' | 'false_positive' | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [lastVerdict, setLastVerdict] = useState<'expected' | 'false_positive' | null>(null);

  if (!event) {
    return (
      <Screen native>
        {isError ? (
          <ErrorState message={copy.loadError} onRetry={refetch} />
        ) : isLoading ? (
          <LoadingState label={copy.loading} />
        ) : (
          <EmptyState action={<Btn kind="quiet" label={copy.backToDay} onPress={() => router.back()} />}>
            {copy.gone}
          </EmptyState>
        )}
      </Screen>
    );
  }

  const give = async (v: 'expected' | 'false_positive') => {
    setBusy(true);
    setFeedbackError(null);
    setLastVerdict(v);
    try {
      await api.feedback(event.id, v);
      setVerdict(v);
    } catch {
      setFeedbackError(copy.feedbackError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen native>
      <Stagger gap={6}>
        <View>
          <KindTag kind={kindOf(event)} detail={timeOf(event.ts)} />
          {/* The sentence is the screen. Hero size, so the record below is
              plainly the small print. */}
          <Txt kind="hero" style={{ marginTop: sp(3) }}>{familySentence(event)}</Txt>
        </View>

        {/* The screen's one uncompromising surface: paper on ink, every figure
            tabular, nothing softened. This is the record, not the reassurance. */}
        <Slab style={{ gap: sp(3) }}>
          <DataLabel value={`${dayOf(event.ts)} · ${timeOf(event.ts)}`}>{copy.recorded}</DataLabel>
          <Rule weight="hair" />
          <DataLabel value={event.source.toUpperCase()}>{copy.sourceLabel}</DataLabel>
          <Rule weight="hair" />
          <DataLabel value={event.confidence.toFixed(2)}>{copy.confidence}</DataLabel>
        </Slab>

        <View>
          <Txt kind="body">
            {copy.filedAs(sensorSentence(event), eventTitle(event.type))}
          </Txt>
          <Txt kind="body" tone="muted" style={{ marginTop: sp(2) }}>
            {copy.certainty(event.confidence)}
          </Txt>
        </View>

        <View>
          <Marquee title={copy.didItGetThisRight} first />
          {verdict ? (
            // True as written: the route records the verdict against this
            // observation. Nothing reads it back for you, so don't promise
            // that it will — the old copy said Dhyaan would "weigh this
            // differently next time", and nothing does.
            <Txt kind="body" tone="ok">{copy.feedbackSaved}</Txt>
          ) : (
            <View style={{ gap: sp(2) }}>
              <Btn label={copy.wasExpected} kind="quiet" busy={busy} onPress={() => give('expected')} />
              <Btn label={copy.didNotHappen} kind="quiet" busy={busy} onPress={() => give('false_positive')} />
              {feedbackError && (
                <ErrorState
                  inline
                  message={feedbackError}
                  retryLabel={copy.tryAgain}
                  onRetry={() => lastVerdict && give(lastVerdict)}
                />
              )}
            </View>
          )}
        </View>
      </Stagger>
    </Screen>
  );
}
