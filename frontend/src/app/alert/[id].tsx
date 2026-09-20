// THE LIVE ALERT — phase-driven takeover (§10.1 screen 8, abhinavtodo D6.1).
//
// The phase is derived from `alert.state` — the FSM state from
// backend/app/alerts.py, the one field that is always present and always real.
// It used to be read off the LAST LADDER STEP, and `lib/http.ts` hands every
// real alert `ladder: []`, so against the real backend this screen pinned
// itself at 'suspected' forever: no ringing pulse, no "she didn't answer", no
// ladder, no final escalation. The ladder is now used for the one thing it is
// good for — filling in the step-by-step history when a backend sends one —
// and the screen reads correctly either way.
//
// Everything white sits on vermilion, and vermilion means alarm and nothing
// else in this app. The hard cream rules and the mono state readout are the
// counterweight: under the noise, this is a machine you can audit.
import * as Haptics from 'expo-haptics';
import { useAudioPlayer } from 'expo-audio';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, Vibration, View } from 'react-native';
import {
  Btn, DataLabel, Entrance, ErrorState, LadderTimeline, Marquee, Rule, Screen, Slab, Stagger, Txt,
} from '@/components';
import { CancelCountdownRing, ElapsedStat, RingingPulse } from '@/components/alert-extras';
import { api } from '@/lib/api';
import { residentNumber, timeOf } from '@/lib/format';
import { useAlert, useContacts, useResident } from '@/lib/hooks';
import { emergencyLine, useCareFile } from '@/store/carefile';
import { useLive } from '@/store/live';
import { useSession } from '@/store/session';
import { sp } from '@/theme/tokens';

const kindWord: Record<string, string> = {
  fall: 'Possible fall',
  bathroom: 'Long bathroom stay',
  sos: 'Help button pressed',
  inactivity: 'Unusually still',
  baseline_deviation: 'Change in routine',
};

type Phase = 'suspected' | 'ringing_resident' | 'no_answer' | 'contacts' | 'final' | 'closed';

/**
 * backend/app/alerts.py's STATES, lowercased. The mock writes the same words
 * in lower case and the real FSM writes them in upper, so one table normalized
 * to lower case serves both. Terminal states never reach here — `closed` is
 * decided before this is consulted.
 */
const PHASE_BY_STATE: Record<string, Phase> = {
  idle: 'suspected',
  suspected: 'suspected',
  local_cancel: 'suspected',
  calling_resident: 'ringing_resident',
  classifying: 'ringing_resident',
  retry_resident: 'no_answer',
  voicemail: 'no_answer',
  scheduled_callback: 'no_answer',
  fell_but_fine: 'no_answer',
  calling_contact_1: 'contacts',
  calling_contact_2: 'contacts',
  escalated_final: 'final',
  exhausted: 'final',
};

/**
 * How it ended, from the one field that says so. The FSM closes an alert five
 * different ways and only one of them means a person picked up: CANCELLED is
 * her button, RESOLVED_OK is her voice, ACKNOWLEDGED is a family member,
 * EXHAUSTED is nobody at all. One sentence for each, because "this alert has
 * been answered" over an EXHAUSTED alert is the wrong thing to be soothing
 * about. Lower-cased so the mock's step names and the real FSM's states match.
 */
function closedSentence(
  state: string, resolution: string | null, who: string | undefined, name: string,
): string {
  switch (state) {
    case 'cancelled':
      return resolution === 'false_positive' && !who
        ? `${name} cancelled it from her band. Nobody was called.`
        : `Cancelled${who ? ` by ${who}` : ''}. Nobody was called.`;
    case 'resolved_ok':
    case 'resolved':
      return `${name} answered and said she is all right. Nobody else was called.`;
    case 'exhausted':
      return `Nobody answered. Dhyaan has run out of people to call.`;
    case 'acknowledged':
      return who ? `${who} is on it. The ladder has stopped.` : 'Someone has got her. The ladder has stopped.';
    case 'manually_resolved':
      switch (resolution) {
        case 'ok': return 'Resolved. Someone checked on her.';
        case 'fell_ok': return `${name} fell but is all right.`;
        case 'ems': return 'Paramedics were called. The ladder has stopped.';
        case 'false_positive': return 'Marked as a false alarm. Nothing else will happen.';
        default: return 'Closed. The ladder has stopped.';
      }
    default:
      return resolution === 'false_positive'
        ? 'Marked as a false alarm. Nothing else will happen.'
        : 'This alert has been closed. The ladder has stopped.';
  }
}

/** A person acted, so the seconds-until-a-human-was-told line is true. */
const humanActed = (state: string) => state === 'acknowledged' || state === 'manually_resolved';

/**
 * The window she can cancel from the band. It belongs to two FSM states. The
 * server owns the real number (`CANCEL_WINDOW_S` in backend/app/config.py,
 * env-overridable) and sends it on the alert; 30 is only the fallback for an
 * alert that predates the field.
 */
const CANCEL_WINDOW_S = 30;
const inCancelWindow = (state: string) => state === 'suspected' || state === 'local_cancel';

/** The line for a phase the FSM expresses several different ways. */
const noAnswerLine = (state: string, name: string): string => {
  switch (state) {
    case 'retry_resident':
      return `${name} didn’t pick up. Dhyaan is trying her once more.`;
    case 'voicemail':
      return `${name} didn’t pick up. Dhyaan left her a message and is calling her family next.`;
    case 'fell_but_fine':
      return `${name} says she fell but is all right. Dhyaan is telling her family anyway.`;
    case 'scheduled_callback':
      return `${name} asked Dhyaan to call back. Her family is being told too.`;
    default:
      return `${name} didn’t answer. Calling her family next.`;
  }
};


// Outside the component so the compiler's immutability rule doesn't apply;
// wrapped so a sound failure never kills the takeover.
type RingtonePlayer = { loop: boolean; play(): void; pause(): void };
const startRingtone = (p: RingtonePlayer) => { try { p.loop = true; p.play(); } catch { /* noop */ } };
const stopRingtone = (p: RingtonePlayer) => { try { p.pause(); } catch { /* noop */ } };

export default function AlertTakeover() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: alert, isLoading, isError, refetch } = useAlert(id ?? '');
  const { data: contacts } = useContacts();
  const live = useLive();
  const { role, residentName, user } = useSession();
  const careFile = useCareFile();
  const emsLine = emergencyLine(careFile);
  const { data: resident } = useResident(alert?.resident_id ?? '');
  const [closedNote, setClosedNote] = useState<string | null>(null);
  const player = useAudioPlayer(require('../../../assets/audio/dhyaan-urgent.wav'));

  const isActive = live.activeAlert?.id === id;
  const ladder = isActive ? live.ladder : alert?.ladder ?? [];
  // Real GET /alerts/{id} reconstructs `calls` from raw voice Events, not the
  // richer CallRow shape the mock uses — only CallRow carries a transcript.
  const transcript = isActive
    ? live.transcript
    : (alert?.calls ?? []).flatMap((c) => ('transcript' in c ? c.transcript : []));
  const closed = !!alert?.closed_at || !!closedNote || (!isActive && !isLoading && !isError && !alert);

  const state = (alert?.state ?? '').toLowerCase();
  const statePhase: Phase = closed ? 'closed' : PHASE_BY_STATE[state] ?? 'suspected';
  const lastStep = ladder[ladder.length - 1]?.step;
  // The ladder refines exactly one beat the FSM cannot express on its own: the
  // mock holds CALLING_RESIDENT while its ladder has already recorded that
  // nobody picked up. It never decides the phase on its own — an empty ladder
  // changes nothing here.
  const phase: Phase =
    statePhase === 'ringing_resident' && lastStep === 'no_answer' ? 'no_answer' : statePhase;

  const name =
    alert?.resident_id === 'res_eleanor'
      ? residentName
      : resident?.display_name?.split(' ')[0] ?? 'the resident';
  const contact1 = contacts?.[0]?.name.split(' ')[0] ?? 'her family';
  const contact2 = contacts?.[1]?.name.split(' ')[0];
  const herPhone = residentNumber(resident, contacts, name);
  // Who is actually tapping the button. `acked_by` used to be hard-coded to a
  // demo name on each branch.
  const actor = user?.name?.trim() || (role === 'staff' ? 'Staff' : 'Family');

  const hasAlert = !!alert;

  // Urgency channel: vibration + ringtone + one heavy haptic, all stop on close.
  useEffect(() => {
    if (!closed && hasAlert) {
      Vibration.vibrate([0, 400, 300, 400], true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      startRingtone(player);
      return () => {
        Vibration.cancel();
        stopRingtone(player);
      };
    }
    Vibration.cancel();
    stopRingtone(player);
    return undefined;
  }, [closed, hasAlert, player]);

  const [actionError, setActionError] = useState<string | null>(null);
  const act = async (fn: () => Promise<void>, note: string) => {
    setActionError(null);
    try {
      await fn();
      Vibration.cancel();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setClosedNote(note);
      refetch();
    } catch {
      // ponytail: someone else may have already closed this alert — a refetch
      // picks that up (poll below) instead of leaving the button silently dead.
      setActionError('That didn’t go through. Someone else may already be on it.');
      refetch();
    }
  };

  // A flaky LAN hop, not "nobody needs help any more" — never conflate the two.
  if (isError && !alert) {
    return (
      <Screen scroll={false} style={{ justifyContent: 'center' }}>
        <ErrorState message="Couldn’t reach Dhyaan to load this alert." onRetry={refetch} />
        <Btn label="Back to home" kind="quiet" onPress={() => router.replace('/')} style={{ marginTop: sp(3) }} />
      </Screen>
    );
  }

  if (!alert && !isLoading) {
    return (
      <Screen scroll={false} style={{ justifyContent: 'center' }}>
        <Txt kind="title">That alert has already been handled.</Txt>
        <Btn label="Back to home" onPress={() => router.replace('/')} style={{ marginTop: sp(5) }} />
      </Screen>
    );
  }

  // Calm close-out — plus the applause line, when a person earned it.
  if (closed && alert) {
    // `acked_by` is null for every real alert (the backend takes `by` on the
    // ack and never stores it). Say what is true instead of naming "Someone".
    const who = alert.acked_by?.trim();
    const sentence = closedNote ?? closedSentence(state, alert.resolution, who, name);
    // Nobody picked up. That is not an OK, and it is not over for the family:
    // the two ways to reach her stay on the screen.
    const exhausted = !closedNote && state === 'exhausted';
    return (
      <Screen scroll={false} style={{ justifyContent: 'center' }}>
        <Stagger gap={4}>
          <Txt kind="display" tone={exhausted ? 'ink' : 'ok'}>{sentence}</Txt>
          <View>
            <Txt kind="body" tone="muted">Saved to {name}’s timeline.</Txt>
            {!closedNote && state === 'acknowledged' && !who && (
              <Txt kind="caption" tone="muted" style={{ marginTop: sp(2) }}>
                Dhyaan didn’t record who answered it.
              </Txt>
            )}
          </View>
          {exhausted && (
            <View style={{ gap: sp(2.5) }}>
              {herPhone ? (
                <Btn label={`Call ${name}`} onPress={() => Linking.openURL(`tel:${herPhone}`)} />
              ) : (
                <Txt kind="caption" tone="muted">{/* voice-ok */}
                  Dhyaan doesn’t have a number for {name}, so it can’t hand you one to dial.
                </Txt>
              )}
              <Btn label="Call 911" onPress={() => Linking.openURL('tel:911')} />
              <Txt kind="caption" tone="muted" style={{ textAlign: 'center' }}>{/* voice-ok */}
                Opens your dialer. Dhyaan never calls 911 itself.
              </Txt>
            </View>
          )}
          {/* ElapsedStat's sentence is "to a human being told", so it is only
              true when a person acted on a fall. Her own cancel, her own
              voice, and a ladder that ran out are closed without it rather
              than with a sentence that is wrong. */}
          {alert.closed_at && alert.kind === 'fall' && (!!closedNote || humanActed(state)) ? (
            <View>
              <Rule />
              <ElapsedStat openedAt={alert.opened_at} closedAt={alert.closed_at} name={name} />
            </View>
          ) : null}
          <Btn label="Back to home" kind={exhausted ? 'quiet' : 'primary'} onPress={() => router.replace('/')} />
        </Stagger>
      </Screen>
    );
  }

  const middle = (() => {
    if (phase === 'suspected') {
      return inCancelWindow(state) ? (
        // The window runs from when the alert opened — the mock's
        // `cancel_window` ladder step does not exist on the real backend.
        <CancelCountdownRing
          since={alert?.opened_at ?? ''}
          windowS={alert?.cancel_window_s ?? CANCEL_WINDOW_S}
        />
      ) : (
        <Txt kind="body" style={styles.betweenLine}>
          Dhyaan is working out what to do next.
        </Txt>
      );
    }
    if (phase === 'ringing_resident') return <RingingPulse label={`Calling ${name} now…`} />;
    if (phase === 'no_answer') {
      return <Txt kind="body" style={styles.betweenLine}>{noAnswerLine(state, name)}</Txt>;
    }
    if (phase === 'contacts') {
      return (
        <RingingPulse
          label={
            state === 'calling_contact_2' && contact2
              ? `Calling ${contact1} and ${contact2} at the same time`
              : contact2
                ? `Calling ${contact1} · ${contact2} is next if she doesn’t pick up`
                : `Calling ${contact1}`
          }
        />
      );
    }
    return (
      <Txt kind="body" style={styles.betweenLine}>
        Nobody has answered yet. Every contact is being told, with her address.
      </Txt>
    );
  })();

  // The one commitment. Content travels under it.
  const bar = (
    <>
      {!!actionError && <ErrorState inline message={actionError} style={{ marginBottom: sp(2) }} />}
      {role === 'staff' ? (
        <Btn
          kind="inverse"
          label="Assign to me"
          onPress={() => act(() => api.ack(id!, actor), 'Assigned to you. The ladder has stopped.')}
        />
      ) : (
        <Btn
          kind="inverse"
          label="I’ve got her"
          onPress={() => act(() => api.ack(id!, actor), 'You’ve got her. The ladder has stopped.')}
        />
      )}
    </>
  );

  return (
    <Screen tone="alarm" wash floatingBar={bar} style={{ paddingHorizontal: sp(5) }}>
      {/* Beat 0 — the machine's own header. Uppercase mono is correct here
          and nowhere else on this screen: it is telemetry, not a sentence. */}
      <Entrance index={0}>
        <DataLabel value={alert ? timeOf(alert.opened_at) : ''}>
          {kindWord[alert?.kind ?? 'fall']}
        </DataLabel>
        <Rule style={{ marginTop: sp(2) }} />
      </Entrance>

      <Entrance index={1}>
        <Txt kind="display" style={{ marginTop: sp(4) }}>
          {alert?.kind === 'bathroom'
            ? `${name} has been in the bathroom a long time.`
            : `${name} may have fallen.`}
        </Txt>
      </Entrance>

      <Entrance index={2}>{middle}</Entrance>

      <Entrance index={3}>
        <Marquee title="What Dhyaan has done" />
        {ladder.length > 0 ? (
          <LadderTimeline steps={ladder} />
        ) : (
          // No ladder history over REST (lib/http.ts sends []). Show the
          // machine's real position instead of an empty timeline.
          <Slab tone="alarm" style={{ gap: sp(2.5) }}>
            <DataLabel value={alert?.state ?? '—'}>State</DataLabel>
            <DataLabel value={alert ? timeOf(alert.opened_at) : '—'}>Opened</DataLabel>
            <Txt kind="caption" style={{ opacity: 0.85, marginTop: sp(1) }}>
              Dhyaan isn’t sending the step-by-step history for this alert. This is where it has
              got to, and it is updating as it goes.
            </Txt>
          </Slab>
        )}
      </Entrance>

      {transcript.length > 0 && (
        <Entrance index={4}>
          <Marquee title="What the call is hearing" />
          {transcript.map((line, i) => (
            <Txt
              key={i}
              kind="body"
              style={
                line.speaker === 'agent'
                  ? { fontStyle: 'italic', fontSize: 16, lineHeight: 24, opacity: 0.8, marginBottom: sp(2) }
                  : { fontWeight: '700', marginBottom: sp(2) }
              }
            >
              {line.speaker === 'agent' ? 'Dhyaan: ' : `${name}: `}{line.text}
            </Txt>
          ))}
        </Entrance>
      )}

      {/* Beat 5 — everything that is not the one commitment. The floating bar
          below holds that, and only that. */}
      <Entrance index={5}>
        <Marquee title="If you’d rather do it yourself" />
        <View style={{ gap: sp(2.5) }}>
          {role === 'staff' ? (
            <>
              <Btn
                kind="outline"
                label="Resolved, checked on her"
                onPress={() => act(() => api.resolve(id!, 'ok'), 'Resolved. Noted on her record.')}
              />
              <Btn
                kind="outline"
                label="False alarm"
                onPress={() => act(() => api.resolve(id!, 'false_positive'), 'Marked as a false alarm. Nothing else will happen.')}
              />
            </>
          ) : (
            <>
              {herPhone ? (
                <Btn kind="outline" label={`Call ${name}`} onPress={() => Linking.openURL(`tel:${herPhone}`)} />
              ) : (
                <Txt kind="caption" style={{ opacity: 0.8 }}>
                  Dhyaan doesn’t have a number for {name} — it has her contacts, not her own line —
                  so it can’t hand you one to dial. Dhyaan is calling her itself.
                </Txt>
              )}
              <Btn kind="outline" label="Call 911" onPress={() => Linking.openURL('tel:911')} />
              <Txt kind="caption" style={{ opacity: 0.8, textAlign: 'center' }}>
                {phase === 'final'
                  ? 'Dhyaan does not dial 911 for you. If you can’t reach her, this button opens your dialer.'
                  : 'Opens your dialer. Dhyaan never calls 911 itself.'}
              </Txt>
            </>
          )}
        </View>
      </Entrance>

      {emsLine && (
        <Entrance index={6}>
          <Marquee title="For the paramedics" />
          <Slab tone="alarm">
            <DataLabel>From her care file</DataLabel>
            <Txt kind="body" style={{ marginTop: sp(2) }}>{emsLine}</Txt>
          </Slab>
        </Entrance>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  betweenLine: { fontWeight: '600', marginTop: sp(4), textAlign: 'center' },
});
