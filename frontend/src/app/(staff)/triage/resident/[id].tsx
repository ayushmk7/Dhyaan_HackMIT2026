// Resident detail: who they are, where they have been today, how today
// compares to their own baseline, today's observations, and a note the floor
// can actually leave behind.
//
// Fixed here:
//   · "Add a note" wrote to useState and evaporated on unmount. It now POSTs
//     through `api.addNote` (POST /v1/residents/{id}/notes, stored as a real
//     `staff_note` event), renders optimistically while in flight, and says so
//     out loud when the write fails instead of pretending it saved.
//   · The sparklines computed `Math.abs(undefined - mu)` whenever the real
//     backend's one-point series was empty, so the deviation check silently
//     became NaN and never fired. Empty and one-point series are handled
//     explicitly now.
//   · "Ask about X" called `api.chat`, which is hardcoded to the SESSION's
//     resident in both the mock and the real client. Asking about Harold
//     returned Eleanor's day. The box is only offered for the session's own
//     resident; for anyone else the screen says why, quietly.
//   · `GET /residents/{id}/location/history` was a real endpoint with a real
//     client function, a real hook and a real component, and nothing imported
//     any of them. Staff screens are the one place whereabouts are permitted
//     (DECISIONS.md D-001, TECHNICAL_PRD §12.4), so the room-time bar lives
//     here.
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import {
  Btn, Card, Chip, DataLabel, ErrorState, EventRow, FLOATING_BAR_CLEARANCE, FloatingBar, Field,
  Hairline, LoadingState, Marquee, RoomTimeBar, Row, Rule, Screen, Sparkline, Stagger, StateChip,
  Txt,
} from '@/components';
import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { api } from '@/lib/api';
import { ago, dayOf, timeOf } from '@/lib/format';
import { localDayKey, useBaselines, useLocationHistory, useResident, useTimeline } from '@/lib/hooks';
import type { BaselineFeature, ChatMessage } from '@/lib/types';
import { useLive } from '@/store/live';
import { useSession } from '@/store/session';
import { elevation, palette, radius, sp } from '@/theme/tokens';

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** The real deviation test, run only on a value that exists. */
function lastReading(b: BaselineFeature): number | null {
  const pts = b.series.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (pts.length) return pts[pts.length - 1];
  return typeof b.last_value === 'number' && Number.isFinite(b.last_value) ? b.last_value : null;
}

function isDeviating(b: BaselineFeature): boolean {
  const last = lastReading(b);
  return last != null && b.mad > 0 && Math.abs(last - b.mu) > 2 * b.mad;
}

function BaselineRow({ b }: { b: BaselineFeature }) {
  const pts = b.series.filter((v) => typeof v === 'number' && Number.isFinite(v));
  const last = lastReading(b);
  const deviating = isDeviating(b);
  return (
    <View style={{ paddingVertical: sp(3) }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt kind="label" tone={deviating ? 'warn' : 'ink'} numberOfLines={1} style={{ flex: 1 }}>
          {b.label}
        </Txt>
        <DataLabel value={`${fmt(b.mu)} ${b.unit}`}>Usual</DataLabel>
      </Row>

      <View style={{ marginTop: sp(2) }}>
        {pts.length >= 2 ? (
          <Sparkline series={pts} tone={deviating ? palette.ochre : palette.slate} />
        ) : last == null ? (
          // No history endpoint and no last value: say so rather than drawing
          // a chart of nothing.
          <Txt kind="caption" tone="muted">No reading recorded yet.</Txt>
        ) : (
          <Row gap={2} style={{ alignItems: 'baseline' }}>
            <Txt kind="data" tone={deviating ? 'warn' : 'ink'}>{fmt(last)}</Txt>
            <Txt kind="caption" tone="muted">{b.unit} · one reading, no trend yet</Txt>
          </Row>
        )}
      </View>

      <Row gap={3} style={{ marginTop: sp(2), flexWrap: 'wrap' }}>
        <DataLabel value={String(b.n_obs)}>Obs</DataLabel>
        {b.cold_start && <DataLabel value="COLD">Baseline</DataLabel>}
        {!!b.updated_at && <DataLabel value={timeOf(b.updated_at)}>Updated</DataLabel>}
      </Row>
    </View>
  );
}

export default function ResidentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: resident, isLoading, isError, refetch } = useResident(id);
  const { data: baselines } = useBaselines(id);
  const { data: events } = useTimeline(id);
  const { data: segments } = useLocationHistory(id, localDayKey());
  const liveStates = useLive((s) => s.states);
  const liveLocations = useLive((s) => s.locations);
  const activeAlert = useLive((s) => s.activeAlert);
  const sessionResidentId = useSession((s) => s.residentId);
  const sessionResidentName = useSession((s) => s.residentName);

  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<ChatMessage | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [pendingNote, setPendingNote] = useState<{ text: string; at: string } | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);

  if (!resident) {
    if (isError) {
      return <Screen native wash><ErrorState message="Couldn’t load this resident." onRetry={refetch} /></Screen>;
    }
    if (isLoading) {
      return <Screen native wash><LoadingState label="Loading…" /></Screen>;
    }
    return <Screen native wash><Txt kind="body" tone="muted">Resident not found.</Txt></Screen>;
  }

  const state = liveStates[resident.id] ?? resident.state;
  const location = liveLocations[resident.id] ?? resident.location;
  const firstName = resident.display_name.split(' ')[0];
  const today = (events ?? []).filter((e) => dayOf(e.ts) === 'Today');
  const alertHere = state === 'alerting' && activeAlert?.resident_id === resident.id;
  const deviations = (baselines ?? []).filter(isDeviating);
  // api.chat is hardcoded to the session's resident in BOTH clients, so any
  // other resident's box would answer about the wrong person.
  const canAsk = resident.id === sessionResidentId;

  const whereLine = location
    ? location.since
      ? `${location.label} · since ${timeOf(location.since)}`
      : location.label
    : resident.last_seen
      ? `No zone signal · last heard ${ago(resident.last_seen)}`
      : 'No signal from this band yet';

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

  const saveNote = async () => {
    const text = noteText.trim();
    if (!text || savingNote) return;
    setSavingNote(true);
    setNoteError(null);
    setPendingNote({ text, at: new Date().toISOString() });
    try {
      await api.addNote(resident.id, text, 'staff');
      setNoteText('');
      setNoteOpen(false);
      // The server stored it as a real `staff_note` event, so the timeline is
      // now the source of truth and the optimistic copy goes away.
      await qc.invalidateQueries({ queryKey: ['events', resident.id] });
      setPendingNote(null);
    } catch (e) {
      // The text stays in the field: a note that failed to save must not
      // vanish, and it must not look saved either.
      setPendingNote(null);
      setNoteError(e instanceof Error ? e.message : 'That note didn’t save. Try again.');
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen
        native
        wash
        style={alertHere ? { paddingBottom: FLOATING_BAR_CLEARANCE + sp(6) } : undefined}
      >
        <Stagger>
          {/* The one uncompromising moment: the identity slab, ink on paper. */}
          <View
            style={{
              backgroundColor: palette.ink,
              borderRadius: radius.glass,
              padding: sp(4.5),
              ...elevation.float,
            }}
          >
            <Row gap={3} style={{ alignItems: 'flex-start' }}>
              <Avatar
                name={resident.display_name}
                size={48}
                tone={state === 'attention' || state === 'alerting' ? 'amber' : 'blue'}
              />
              <View style={{ flex: 1 }}>
                <Txt kind="title" tone="white" numberOfLines={1}>{resident.display_name}</Txt>
                <Txt kind="caption" style={{ color: 'rgba(255,255,255,0.75)', marginTop: 2 }}>
                  {whereLine}
                </Txt>
              </View>
              <StateChip state={state} />
            </Row>
            <Rule color="rgba(255,255,255,0.35)" style={{ marginTop: sp(3.5) }} />
            <Row gap={3} style={{ marginTop: sp(2.5), flexWrap: 'wrap' }}>
              <DataLabel tone="rgba(255,255,255,0.6)" value={resident.room ?? 'NONE'}>Room</DataLabel>
              <DataLabel
                tone="rgba(255,255,255,0.6)"
                value={resident.last_seen ? timeOf(resident.last_seen) : '--:--'}
              >
                Seen
              </DataLabel>
              {resident.band_battery_pct != null && (
                <DataLabel tone="rgba(255,255,255,0.6)" value={`${resident.band_battery_pct}%`}>
                  Band
                </DataLabel>
              )}
            </Row>
          </View>

          {deviations.length > 0 ? (
            <Card style={{ backgroundColor: palette.ochreWash }}>
              <Txt kind="body">
                {`Different from ${firstName}’s own routine: `}
                {deviations
                  .map((b) => `${b.label.toLowerCase()} at ${fmt(lastReading(b)!)} ${b.unit} against a usual ${fmt(b.mu)}`)
                  .join('; ')}
                .
              </Txt>
            </Card>
          ) : null}

          <View>
            {/* Room-level history is staff-only by decision, not by omission. */}
            <Marquee title="Where they’ve been today" meta={`${(segments ?? []).length} segments`} />
            <Card>
              <RoomTimeBar segments={segments ?? []} />
              <Txt kind="caption" tone="muted" style={{ marginTop: sp(3) }}>
                {location
                  ? `Now in the ${location.label.toLowerCase()}${location.since ? `, since ${timeOf(location.since)}` : ''}.`
                  : 'No current zone reading.'}
              </Txt>
            </Card>
          </View>

          <View>
            <Marquee title="Routine" meta={`${(baselines ?? []).length} baselines`} />
            <Card style={{ paddingVertical: sp(1) }}>
              {(baselines ?? []).map((b, i) => (
                <View key={b.feature}>
                  {i > 0 && <Hairline />}
                  <BaselineRow b={b} />
                </View>
              ))}
              {(baselines ?? []).length === 0 && (
                <Txt kind="body" tone="muted" style={{ paddingVertical: sp(3) }}>
                  No baseline has been learned for {firstName} yet.
                </Txt>
              )}
            </Card>
          </View>

          <View>
            <Marquee title="Today" meta={`${today.length} entries`} />
            <Card style={{ paddingVertical: sp(1) }}>
              {today.length === 0 && !pendingNote && (
                <Txt kind="body" tone="muted" style={{ paddingVertical: sp(3) }}>
                  Nothing recorded yet today.
                </Txt>
              )}
              {!!pendingNote && (
                <View style={{ paddingVertical: sp(2.5) }}>
                  <DataLabel value={timeOf(pendingNote.at)}>Saving note</DataLabel>
                  <Txt kind="body" style={{ marginTop: 2 }}>{pendingNote.text}</Txt>
                </View>
              )}
              {today.map((e, i) => (
                <View key={e.id}>
                  {(i > 0 || !!pendingNote) && <Hairline />}
                  <EventRow event={e} />
                </View>
              ))}
            </Card>

            {noteOpen ? (
              <View style={{ marginTop: sp(3), gap: sp(2.5) }}>
                <Field
                  label="Note"
                  value={noteText}
                  onChangeText={setNoteText}
                  placeholder={`One line about ${firstName}`}
                  multiline
                  maxLength={400}
                  onSubmitEditing={saveNote}
                />
                <Row gap={2}>
                  <Btn label="Save note" busy={savingNote} onPress={saveNote} style={{ flex: 1 }} />
                  <Btn
                    label="Cancel"
                    kind="ghost"
                    onPress={() => { setNoteOpen(false); setNoteError(null); }}
                    style={{ flex: 1 }}
                  />
                </Row>
              </View>
            ) : (
              <Btn
                label="Add a note"
                kind="quiet"
                onPress={() => setNoteOpen(true)}
                style={{ marginTop: sp(3) }}
              />
            )}
            {!!noteError && (
              <Txt kind="caption" tone="alert" style={{ marginTop: sp(2) }}>{noteError}</Txt>
            )}
          </View>

          {canAsk ? (
            <View>
              <Marquee title={`Ask about ${firstName}`} />
              <Row gap={2} style={{ alignItems: 'flex-end' }}>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Question"
                    value={question}
                    onChangeText={setQuestion}
                    placeholder={`Has ${firstName} been eating?`}
                    onSubmitEditing={ask}
                  />
                </View>
                <Btn label="Ask" busy={asking} onPress={ask} style={{ minHeight: 48, paddingHorizontal: sp(4) }} />
              </Row>
              {!!askError && (
                <Txt kind="caption" tone="alert" style={{ marginTop: sp(2) }}>{askError}</Txt>
              )}
              {!!answer && (
                <Card style={{ marginTop: sp(3) }}>
                  <Txt kind="body">{answer.text}</Txt>
                  {!!answer.citations?.length && (
                    <Row gap={2} style={{ marginTop: sp(3), flexWrap: 'wrap' }}>
                      {answer.citations.map((c) => <Chip key={c.id} label={c.label} />)}
                    </Row>
                  )}
                </Card>
              )}
            </View>
          ) : (
            // A refusal is not an error: it renders quietly, in ink, once.
            <Row gap={2} style={{ marginTop: sp(7), alignItems: 'flex-start' }}>
              <Icon name="hand.raised" size={15} color={palette.inkMuted} />
              <Txt kind="caption" tone="muted" style={{ flex: 1 }}>
                Asking Dhyaan is switched off here. It only answers about {sessionResidentName},
                so a question about {firstName} would come back with the wrong resident’s day.
              </Txt>
            </Row>
          )}
        </Stagger>
      </Screen>

      {alertHere && activeAlert && (
        // The screen's single commitment, floating: content scrolls under it.
        // inset={false} — the tab bar already owns the bottom safe area.
        <FloatingBar inset={false}>
          <Btn
            label="Open the live alert"
            kind="danger"
            onPress={() => router.push(`/alert/${activeAlert.id}`)}
          />
        </FloatingBar>
      )}
    </View>
  );
}
