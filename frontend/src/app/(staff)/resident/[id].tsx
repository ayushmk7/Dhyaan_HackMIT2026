// Resident detail: who they are, how today compares to their own baseline,
// today's observations, and a scoped ask box (§10.1 S3).
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { TextInput, View } from 'react-native';
import {
  Btn, Card, Chip, EventRow, Hairline, Row, Screen, SectionTitle, Sparkline, StateChip, Txt,
} from '@/components';
import { api } from '@/lib/api';
import { ago, dayOf, timeOf } from '@/lib/format';
import { useBaselines, useResident, useTimeline } from '@/lib/hooks';
import type { ChatMessage } from '@/lib/types';
import { useLive } from '@/store/live';
import { palette, radius, sp, type } from '@/theme/tokens';

export default function ResidentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: resident } = useResident(id);
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

  if (!resident) {
    return (
      <Screen>
        <Txt kind="body" tone="muted">Loading…</Txt>
      </Screen>
    );
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
    try {
      setAnswer(await api.chat(q));
    } finally {
      setAsking(false);
    }
  };

  return (
    <Screen>
      <Txt kind="display">{resident.display_name}</Txt>
      <Row gap={2} style={{ marginTop: sp(2), flexWrap: 'wrap' }}>
        <StateChip state={state} />
        {resident.room && <Txt kind="caption" tone="muted">Room {resident.room}</Txt>}
      </Row>
      <Txt kind="body" tone="muted" style={{ marginTop: sp(2) }}>
        {location
          ? `In the ${location.label.toLowerCase()} since ${timeOf(location.since)}`
          : `No location signal — last seen ${ago(resident.last_seen)}`}
      </Txt>

      {alertHere && (
        <Btn
          label="Open the live alert"
          kind="danger"
          onPress={() => router.push(`/alert/${activeAlert.id}`)}
          style={{ marginTop: sp(4) }}
        />
      )}

      {resident.attention_reason && (
        <Card style={{ backgroundColor: palette.ochreWash, borderColor: palette.ochre, marginTop: sp(4) }}>
          <Txt kind="body">{resident.attention_reason}</Txt>
        </Card>
      )}

      <SectionTitle>Their routine, 14 days</SectionTitle>
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
                usually {b.mu} {b.unit}
              </Txt>
            </Row>
          );
        })}
      </View>

      <SectionTitle>Today</SectionTitle>
      {today.length === 0 && notes.length === 0 && (
        <Txt kind="body" tone="muted">No observations yet today — cameras and band are quiet.</Txt>
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
      {answer && (
        <Card style={{ marginTop: sp(3) }}>
          <Txt kind="body" style={{ fontFamily: 'Fraunces_400Regular' }}>{answer.text}</Txt>
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
