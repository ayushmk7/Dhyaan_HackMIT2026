// Resident detail: who they are, where they have been today, how today
// compares to their own baseline, today's observations, and a note the floor
// can actually leave behind.
//
// The identity block is the focal point: the name at the hero size, the
// where-line under it, telemetry on a heavy rule. It is drawn on paper unless
// this resident is alerting, in which case the same block is the inverted
// plate. Inversion is alarm and nothing else, so a resident who is fine is
// never shown on a black slab.
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
//   · "Ask about X" called `api.chat` with no resident, and the facade was
//     hardcoded to the SESSION's resident in both clients: asking about
//     Harold returned Eleanor's day, the most dangerous bug on this screen.
//     `api.chat` now takes a resident id, so the box is offered for everyone
//     and scoped to the resident on screen. The mock holds one resident and
//     answers any other id with a real refusal, which renders in the quiet
//     refusal shape rather than as an error.
//   · `GET /residents/{id}/location/history` was a real endpoint with a real
//     client function, a real hook and a real component, and nothing imported
//     any of them. Staff screens are the one place whereabouts are permitted
//     (DECISIONS.md D-001, TECHNICAL_PRD §12.4), so the room-time bar lives
//     here.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import {
  Btn, Card, Chip, DataLabel, EmptyState, ErrorState, EventRow, Field, LoadingState, Marquee,
  Refusal, RoomTimeBar, Row, RowGroup, Rule, Screen, Slab, Sparkline, Stagger, StateChip, Txt,
} from '@/components';
import { api } from '@/lib/api';
import { readout, resident as copy } from '@/lib/copy/staff';
import { ago, dayOf, timeOf } from '@/lib/format';
import { localDayKey, useBaselines, useLocationHistory, useResident, useTimeline } from '@/lib/hooks';
import type { BaselineFeature, ChatMessage } from '@/lib/types';
import { useLive } from '@/store/live';
import { sp, useTheme } from '@/theme';

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
  const t = useTheme();
  const pts = b.series.filter((v) => typeof v === 'number' && Number.isFinite(v));
  const last = lastReading(b);
  const deviating = isDeviating(b);
  return (
    <View style={{ paddingVertical: sp(3) }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt kind="label" tone={deviating ? 'warn' : 'ink'} numberOfLines={1} style={{ flex: 1 }}>
          {b.label}
        </Txt>
        <DataLabel value={`${fmt(b.mu)} ${b.unit}`}>{copy.routine.usual}</DataLabel>
      </Row>

      <View style={{ marginTop: sp(2) }}>
        {pts.length >= 2 ? (
          // Deviating = "worth a look" = the accent, which is the one thing
          // blue means. A line that means nothing is a quiet grey.
          <Sparkline series={pts} tone={deviating ? t.accent : t.inkMuted} />
        ) : last == null ? (
          // No history endpoint and no last value: say so rather than drawing
          // a chart of nothing.
          <Txt kind="caption" tone="muted">{copy.routine.noReading}</Txt>
        ) : (
          <Row gap={2} style={{ alignItems: 'baseline' }}>
            <Txt kind="data" tone={deviating ? 'warn' : 'ink'}>{fmt(last)}</Txt>
            <Txt kind="caption" tone="muted">{copy.routine.oneReading(b.unit)}</Txt>
              {/* voice-ok: an empty state, which DESIGN.md exempts. */}
          </Row>
        )}
      </View>

      <Row gap={3} style={{ marginTop: sp(2), flexWrap: 'wrap' }}>
        <DataLabel value={String(b.n_obs)}>{copy.routine.obs}</DataLabel>
        {b.cold_start && <DataLabel value={readout.coldBaseline}>{copy.routine.baseline}</DataLabel>}
        {!!b.updated_at && <DataLabel value={timeOf(b.updated_at)}>{copy.routine.updated}</DataLabel>}
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
  // ponytail: no `useLocation` hook in lib/hooks.ts, so the facade is called
  // directly here, the same pattern triage's open-alerts poll already uses.
  // GET /residents/{id}/location is one document; `useResident` pays for the
  // whole roster, so this is the cheap read for the one thing that moves.
  // 15 s is `usePresence`'s interval: the belt under the websocket push.
  const { data: currentZone } = useQuery({
    queryKey: ['location', id],
    queryFn: () => api.getLocation(id),
    enabled: !!id,
    refetchInterval: 15_000,
  });
  const liveStates = useLive((s) => s.states);
  const liveLocations = useLive((s) => s.locations);
  const activeAlert = useLive((s) => s.activeAlert);

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
      return <Screen native wash><ErrorState message={copy.loadError} onRetry={refetch} /></Screen>;
    }
    if (isLoading) {
      return <Screen native wash><LoadingState label={copy.loading} /></Screen>;
    }
    return <Screen native wash><EmptyState>{copy.notFound}</EmptyState></Screen>;
  }

  const state = liveStates[resident.id] ?? resident.state;
  // Socket first, then the dedicated zone read; the roster's copy only covers
  // the frame before that read lands.
  const location = liveLocations[resident.id] ?? currentZone ?? resident.location;
  const firstName = resident.display_name.split(' ')[0];
  const today = (events ?? []).filter((e) => dayOf(e.ts) === 'Today');
  const alertHere = state === 'alerting' && activeAlert?.resident_id === resident.id;
  const deviations = (baselines ?? []).filter(isDeviating);

  const whereLine = location
    ? location.since
      ? copy.where.inZoneSince(location.label, timeOf(location.since))
      : location.label
    : resident.last_seen
      ? copy.where.noZoneLastHeard(ago(resident.last_seen))
      : copy.where.noSignalYet;

  const ask = async () => {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setAskError(null);
    try {
      // Scoped to the resident on screen, never the session's.
      setAnswer(await api.chat(q, resident.id));
    } catch (e) {
      setAskError(e instanceof Error ? e.message : copy.ask.error);
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
      setNoteError(e instanceof Error ? e.message : copy.note.saveError);
    } finally {
      setSavingNote(false);
    }
  };

  // The identity block reads its colours from whatever it is placed on: the
  // paper, or the inverted plate when this resident is alerting.
  const identity = (
    <>
      <Txt kind="hero" numberOfLines={1} adjustsFontSizeToFit accessibilityRole="header">
        {resident.display_name}
      </Txt>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: sp(2.5) }} gap={3}>
        <Txt kind="body" tone="muted" style={{ flex: 1 }} numberOfLines={2}>{whereLine}</Txt>
        <StateChip state={state} />
      </Row>
      <Rule weight={state === 'alerting' ? 'hair' : 'heavy'} style={{ marginTop: sp(3.5) }} />
      <Row gap={3} style={{ marginTop: sp(2.5), flexWrap: 'wrap' }}>
        <DataLabel value={resident.room ?? readout.none}>{copy.slab.room}</DataLabel>
        <DataLabel value={resident.last_seen ? timeOf(resident.last_seen) : readout.noTime}>
          {copy.slab.seen}
        </DataLabel>
        {resident.band_battery_pct != null && (
          <DataLabel value={`${resident.band_battery_pct}%`}>{copy.slab.band}</DataLabel>
        )}
      </Row>
    </>
  );

  return (
    <Screen
      native
      wash
      // The screen's single commitment, floating: content scrolls under it.
      // Screen owns the clearance, and the bar rides the safe-area inset the
      // floating tab bar raises (TabBarInsets), so it clears the tab bar.
      floatingBar={alertHere && activeAlert ? (
        <Btn
          label={copy.openAlert}
          kind="danger"
          onPress={() => router.push(`/alert/${activeAlert.id}`)}
        />
      ) : undefined}
    >
      <Stagger>
        {state === 'alerting' ? <Slab>{identity}</Slab> : <View>{identity}</View>}

        {deviations.length > 0 ? (
          // "Worth a look" is a state, not a card background: the plate stays
          // plain and the meaning rides on the chip.
          <Card style={{ marginTop: sp(5) }}>
            <StateChip state="attention" />
            <Txt kind="body" style={{ marginTop: sp(2.5) }}>
              {copy.deviation.summary(
                firstName,
                deviations.map((b) => ({
                  label: b.label, value: fmt(lastReading(b)!), unit: b.unit, usual: fmt(b.mu),
                })),
              )}
            </Txt>
          </Card>
        ) : null}

        <View>
          {/* Room-level history is staff-only by decision, not by omission. */}
          <Marquee title={copy.whereToday.title} meta={copy.whereToday.meta((segments ?? []).length)} />
          <Card>
            <RoomTimeBar segments={segments ?? []} />
            <Txt kind="caption" tone="muted" style={{ marginTop: sp(3) }}>{/* voice-ok: a reading, not prose */}
              {location
                ? copy.whereToday.nowIn(location.label, location.since ? timeOf(location.since) : null)
                : copy.whereToday.noZone}
            </Txt>
          </Card>
        </View>

        <View>
          <Marquee title={copy.routine.title} meta={copy.routine.meta((baselines ?? []).length)} />
          <RowGroup>
            {(baselines ?? []).map((b) => <BaselineRow key={b.feature} b={b} />)}
            {(baselines ?? []).length === 0 && (
              <EmptyState>{copy.routine.empty(firstName)}</EmptyState>
            )}
          </RowGroup>
        </View>

        <View>
          <Marquee title={copy.today.title} meta={copy.today.meta(today.length)} />
          <RowGroup>
            {today.length === 0 && !pendingNote && (
              <EmptyState>{copy.today.empty}</EmptyState>
            )}
            {!!pendingNote && (
              <View style={{ paddingVertical: sp(2.5) }}>
                <DataLabel value={timeOf(pendingNote.at)}>{copy.today.savingNote}</DataLabel>
                <Txt kind="body" style={{ marginTop: 2 }}>{pendingNote.text}</Txt>
              </View>
            )}
            {today.map((e) => <EventRow key={e.id} event={e} />)}
          </RowGroup>

          {noteOpen ? (
            <View style={{ marginTop: sp(3), gap: sp(2.5) }}>
              <Field
                label={copy.note.label}
                value={noteText}
                onChangeText={setNoteText}
                placeholder={copy.note.placeholder(firstName)}
                multiline
                maxLength={400}
                onSubmitEditing={saveNote}
              />
              <Row gap={2}>
                <Btn label={copy.note.save} busy={savingNote} onPress={saveNote} style={{ flex: 1 }} />
                <Btn
                  label={copy.note.cancel}
                  kind="ghost"
                  onPress={() => { setNoteOpen(false); setNoteError(null); }}
                  style={{ flex: 1 }}
                />
              </Row>
            </View>
          ) : (
            <Btn
              label={copy.note.add}
              kind="quiet"
              onPress={() => setNoteOpen(true)}
              style={{ marginTop: sp(3) }}
            />
          )}
          {!!noteError && <ErrorState inline message={noteError} style={{ marginTop: sp(2) }} />}
        </View>

        <View>
          <Marquee title={copy.ask.title(firstName)} />
          <Row gap={2} style={{ alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Field
                label={copy.ask.label}
                value={question}
                onChangeText={setQuestion}
                placeholder={copy.ask.placeholder(firstName)}
                onSubmitEditing={ask}
              />
            </View>
            <Btn label={copy.ask.button} size="small" busy={asking} onPress={ask} />
          </Row>
          {!!askError && <ErrorState inline message={askError} style={{ marginTop: sp(2) }} />}
          {!!answer && (answer.refused ? (
            // A refusal is not an error. Saying so calmly is the product working.
            <Refusal style={{ marginTop: sp(3.5) }}>{answer.text}</Refusal>
          ) : (
            <Card style={{ marginTop: sp(3) }}>
              <Txt kind="body">{answer.text}</Txt>
              {!!answer.citations?.length && (
                <Row gap={2} style={{ marginTop: sp(3), flexWrap: 'wrap' }}>
                  {answer.citations.map((c) => <Chip key={c.id} label={c.label} />)}
                </Row>
              )}
            </Card>
          ))}
        </View>
      </Stagger>
    </Screen>
  );
}
