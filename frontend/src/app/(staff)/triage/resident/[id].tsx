// Resident detail: who they are, how today compares to their own baseline,
// today's observations, and a scoped ask box (§10.1 S3).
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { TextInput, View } from 'react-native';
import {
  Btn, Card, Chip, ErrorState, EventRow, Hairline, LoadingState, Row, Screen, SectionTitle,
  Sparkline, StateChip, Txt,
} from '@/components';
import { Avatar } from '@/components/avatar';
import { api } from '@/lib/api';
import { ago, dayOf, timeOf } from '@/lib/format';
import { useBaselines, useResident, useTimeline } from '@/lib/hooks';
import type { ChatMessage } from '@/lib/types';
import { useLive } from '@/store/live';
import { palette, radius, sp, type } from '@/theme/tokens';

export default function ResidentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: resident, isLoading, isError, refetch } = useResident(id);
  const { data: baselines } = useBaselines(id);
  const { data: events } = useTimeline(id);
  const liveStates = useLive((s) => s.states);
  const liveLocations = useLive((s) => s.locations);
  const activeAlert = useLive((s) => s.activeAlert);

  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<ChatMessage | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [notes, setNotes] = useState<{ text: string; at: string }[]>([]);
  const [askError, setAskError] = useState<string | null>(null);

  if (!resident) {
    if (isError) {
      return <Screen native><ErrorState message="Couldn’t load this resident." onRetry={refetch} /></Screen>;
    }
    if (isLoading) {
      return <Screen native><LoadingState label="Loading…" /></Screen>;
    }
    return <Screen native><Txt kind="body" tone="muted">Resident not found.</Txt></Screen>;
  }

  const state = liveStates[resident.id] ?? resident.state;
  const location = liveLocations[resident.id] ?? resident.location;
  const firstName = resident.display_name.split(' ')[0];
  const today = (events ?? []).filter((e) => dayOf(e.ts) === 'Today');
  const alertHere = state === 'alerting' && activeAlert?.resident_id === resident.id;

  const ask = async () => {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setAskError(null);
    try {
      setAnswer(await api.chat(q));
    } catch (e) {
      setAskError(e instanceof Error ? e.message : 'Couldn’t reach Dhyaan. Try again.');
    } finally {
      setAsking(false);
    }
  };

  return (
    <Screen native>
      <Card style={{ paddingVertical: sp(3.5) }}>
        <Row gap={3}>
          <Avatar
            name={resident.display_name}
            size={48}
            tone={state === 'attention' || state === 'alerting' ? 'amber' : 'blue'}
          />
          <View style={{ flex: 1 }}>
            <Txt kind="heading">{resident.display_name}</Txt>
            <Txt kind="label" style={{ marginTop: 2 }}>
              {location
                ? `${location.label} · since ${timeOf(location.since)}`
                : `No signal · ${resident.last_seen ? ago(resident.last_seen) : 'never seen'}`}
            </Txt>
            {resident.room && (
              <Txt kind="caption" tone="muted" style={{ marginTop: 1 }}>Room {resident.room}</Txt>
            )}
          </View>
          <StateChip state={state} />
        </Row>
      </Card>

      {alertHere && (
        <Btn
          label="Open the live alert"
          kind="danger"
          onPress={() => router.push(`/alert/${activeAlert.id}`)}
          style={{ marginTop: sp(4) }}
        />
      )}

      {resident.attention_reason && (
        <Card style={{ backgroundColor: palette.ochreWash, marginTop: sp(3) }}>
          <Txt kind="body">{resident.attention_reason}</Txt>
        </Card>
      )}

      <SectionTitle>Routine</SectionTitle>
      <View style={{ gap: sp(4) }}>
        {(baselines ?? []).map((b) => {
          const last = b.series[b.series.length - 1];
          const deviating = b.mad > 0 && Math.abs(last - b.mu) > 2 * b.mad;
          return (
            <Row key={b.feature} gap={3}>
              <Txt kind="label" tone={deviating ? 'warn' : 'ink'} style={{ width: 118 }}>
                {b.label}
              </Txt>
              <View style={{ flex: 1 }}>
                <Sparkline series={b.series} tone={deviating ? palette.ochre : palette.slate} />
              </View>
              <Txt kind="caption" tone="muted" style={{ width: 88, textAlign: 'right' }}>
                avg {b.mu} {b.unit}
              </Txt>
            </Row>
          );
        })}
      </View>

      <SectionTitle>Today</SectionTitle>
      {today.length === 0 && notes.length === 0 && (
        <Txt kind="body" tone="muted">Nothing yet today.</Txt>
      )}
      {notes.map((n, i) => (
        <View key={i} style={{ paddingVertical: sp(2) }}>
          <Txt kind="caption" tone="muted">Note · {timeOf(n.at)}</Txt>
          <Txt kind="body" style={{ marginTop: 2 }}>{n.text}</Txt>
        </View>
      ))}
      {today.map((e, i) => (
        <View key={e.id}>
          {(i > 0 || notes.length > 0) && <Hairline />}
          <EventRow event={e} />
        </View>
      ))}

      {noteOpen ? (
        <Row gap={2} style={{ marginTop: sp(3) }}>
          <TextInput
            value={noteText}
            onChangeText={setNoteText}
            placeholder={`One line about ${firstName}`}
            placeholderTextColor={palette.inkMuted}
            style={{
              flex: 1, ...type.body, color: palette.ink,
              borderWidth: 1, borderColor: palette.line, borderRadius: radius.tile,
              paddingHorizontal: sp(3), paddingVertical: sp(2.5), backgroundColor: palette.raised,
            }}
            autoFocus
            onSubmitEditing={() => {
              if (noteText.trim()) {
                setNotes((ns) => [{ text: noteText.trim(), at: new Date().toISOString() }, ...ns]);
              }
              setNoteText('');
              setNoteOpen(false);
            }}
            returnKeyType="done"
          />
        </Row>
      ) : (
        <Btn label="Add a note" kind="quiet" onPress={() => setNoteOpen(true)} style={{ marginTop: sp(3) }} />
      )}

      <SectionTitle>Ask about {firstName}</SectionTitle>
      <Row gap={2}>
        <TextInput
          value={question}
          onChangeText={setQuestion}
          placeholder={`Has ${firstName} been eating?`}
          placeholderTextColor={palette.inkMuted}
          style={{
            flex: 1, ...type.body, color: palette.ink,
            borderWidth: 1, borderColor: palette.line, borderRadius: radius.tile,
            paddingHorizontal: sp(3), paddingVertical: sp(2.5), backgroundColor: palette.raised,
          }}
          onSubmitEditing={ask}
          returnKeyType="send"
        />
        <Btn label="Ask" onPress={ask} busy={asking} style={{ minHeight: 44, paddingHorizontal: sp(4) }} />
      </Row>
      {askError && (
        <Txt kind="caption" tone="alert" style={{ marginTop: sp(2) }}>{askError}</Txt>
      )}
      {answer && (
        <Card style={{ marginTop: sp(3) }}>
          <Txt kind="body">{answer.text}</Txt>
          {!!answer.citations?.length && (
            <Row gap={2} style={{ marginTop: sp(3), flexWrap: 'wrap' }}>
              {answer.citations.map((c) => <Chip key={c.id} label={c.label} />)}
            </Row>
          )}
        </Card>
      )}
    </Screen>
  );
}
