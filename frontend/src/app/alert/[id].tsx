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
// The takeover is the `alarm` tone, resolved by the theme; this file names no
// colour of its own. What makes it unmistakable is not the ground but the
// shape: her name at the top step of the scale, one heavy accent rule under
// it, and one action pinned at the bottom. The mono state readout is the
// counterweight: under the noise, this is a machine you can audit.
//
// Every sentence this screen says lives in lib/copy/family.ts under `alert`,
// including the two state-to-sentence tables (how it closed, why she didn't
// answer), which are copy with a switch in front of them.
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
import { family } from '@/lib/copy/family';
import { residentNumber, timeOf } from '@/lib/format';
import { useAlert, useContacts, useResident } from '@/lib/hooks';
import { emergencyLine, useCareFile } from '@/store/carefile';
import { useLive } from '@/store/live';
import { useSession } from '@/store/session';
import { sp, useTheme } from '@/theme';

const copy = family.alert;

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

// The emergency number is a value the button dials, not a sentence.
const EMERGENCY_NUMBER = '911';

const firstName = (full: string) => full.split(' ')[0];

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
  const { role, residentId, residentName, user } = useSession();
  const careFile = useCareFile();
  const emsLine = emergencyLine(careFile);
  const t = useTheme();
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

  // Her name comes from the session when the alert is about the resident this
  // phone is signed in for, and from the roster otherwise (a staff phone sees
  // every resident's alerts). It used to compare against a demo id.
  const name =
    alert?.resident_id === residentId
      ? residentName
      : resident?.display_name ? firstName(resident.display_name) : copy.unknownResident;
  const contact1 = contacts?.[0] ? firstName(contacts[0].name) : copy.unknownFamily;
  const contact2 = contacts?.[1] ? firstName(contacts[1].name) : undefined;
  const herPhone = residentNumber(resident, contacts, name);
  // Who is actually tapping the button. `acked_by` used to be hard-coded to a
  // demo name on each branch.
  const actor = user?.name?.trim() || (role === 'staff' ? copy.actorStaff : copy.actorFamily);

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
      setActionError(copy.actionError);
      refetch();
    }
  };

  const callHer = () => herPhone && Linking.openURL(`tel:${herPhone}`);
  const call911 = () => Linking.openURL(`tel:${EMERGENCY_NUMBER}`);
  const goHome = () => router.replace('/');

  // A flaky LAN hop, not "nobody needs help any more" — never conflate the two.
  if (isError && !alert) {
    return (
      <Screen scroll={false} style={{ justifyContent: 'center' }}>
        <ErrorState message={copy.loadError} onRetry={refetch} />
        <Btn label={copy.backHome} kind="quiet" onPress={goHome} style={{ marginTop: sp(3) }} />
      </Screen>
    );
  }

  if (!alert && !isLoading) {
    return (
      <Screen scroll={false} style={{ justifyContent: 'center' }}>
        <Txt kind="title">{copy.alreadyHandled}</Txt>
        <Btn label={copy.backHome} onPress={goHome} style={{ marginTop: sp(5) }} />
      </Screen>
    );
  }

  // Calm close-out — plus the applause line, when a person earned it.
  if (closed && alert) {
    // `acked_by` is null for every real alert (the backend takes `by` on the
    // ack and never stores it). Say what is true instead of naming "Someone".
    const who = alert.acked_by?.trim();
    const sentence = closedNote ?? copy.closed(state, alert.resolution, who, name);
    // Nobody picked up. That is not an OK, and it is not over for the family:
    // the two ways to reach her stay on the screen.
    const exhausted = !closedNote && state === 'exhausted';
    return (
      <Screen scroll={false} style={{ justifyContent: 'center' }}>
        <Stagger gap={4}>
          <Txt kind="display" tone={exhausted ? 'ink' : 'ok'}>{sentence}</Txt>
          <View>
            <Txt kind="body" tone="muted">{copy.savedToTimeline(name)}</Txt>
            {!closedNote && state === 'acknowledged' && !who && (
              <Txt kind="caption" tone="muted" style={{ marginTop: sp(2) }}>
                {copy.noRecordOfWho}
              </Txt>
            )}
          </View>
          {exhausted && (
            <View style={{ gap: sp(2.5) }}>
              {herPhone ? (
                <Btn label={copy.call(name)} onPress={callHer} />
              ) : (
                <Txt kind="caption" tone="muted">{copy.noNumber(name)}</Txt>
              )}
              <Btn label={copy.call911} onPress={call911} />
              <Txt kind="caption" tone="muted" style={{ textAlign: 'center' }}>
                {copy.dialerNote}
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
          <Btn label={copy.backHome} kind={exhausted ? 'quiet' : 'primary'} onPress={goHome} />
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
        <Txt kind="body" style={styles.betweenLine}>{copy.workingOut}</Txt>
      );
    }
    if (phase === 'ringing_resident') return <RingingPulse label={copy.calling(name)} />;
    if (phase === 'no_answer') {
      return <Txt kind="body" style={styles.betweenLine}>{copy.noAnswer(state, name)}</Txt>;
    }
    if (phase === 'contacts') {
      return (
        <RingingPulse
          label={
            state === 'calling_contact_2' && contact2
              ? copy.callingBoth(contact1, contact2)
              : contact2
                ? copy.callingThenNext(contact1, contact2)
                : copy.callingOne(contact1)
          }
        />
      );
    }
    return (
      <Txt kind="body" style={styles.betweenLine}>{copy.nobodyYet}</Txt>
    );
  })();

  // The one commitment. Content travels under it.
  const bar = (
    <>
      {!!actionError && <ErrorState inline message={actionError} style={{ marginBottom: sp(2) }} />}
      {role === 'staff' ? (
        <Btn
          kind="inverse"
          label={copy.assignToMe}
          onPress={() => act(() => api.ack(id!, actor), copy.assigned)}
        />
      ) : (
        <Btn
          kind="inverse"
          label={copy.gotHer}
          onPress={() => act(() => api.ack(id!, actor), copy.youHaveGotHer)}
        />
      )}
    </>
  );

  return (
    <Screen tone="alarm" wash floatingBar={bar} style={{ paddingHorizontal: sp(5) }}>
      {/* Beat 0 — the sentence, and nothing above it. Ten seconds to read
          that someone has fallen: the top step of the scale, then the one
          heavy rule in the accent, then the machine's own header under it.
          Uppercase mono is correct there and nowhere else on this screen. */}
      <Entrance index={0}>
        <Txt kind="hero" style={{ marginTop: sp(2) }}>
          {copy.headline(alert?.kind ?? 'fall', name)}
        </Txt>
        <Rule weight="heavy" color={t.accent} style={{ marginTop: sp(4) }} />
        <DataLabel value={alert ? timeOf(alert.opened_at) : ''} style={{ marginTop: sp(2.5) }}>
          {copy.kind[alert?.kind ?? 'fall'] ?? copy.kind.fall}
        </DataLabel>
      </Entrance>

      <Entrance index={1}>{middle}</Entrance>

      <Entrance index={2}>
        <Marquee title={copy.whatDone} />
        {ladder.length > 0 ? (
          <LadderTimeline steps={ladder} />
        ) : (
          // No ladder history over REST (lib/http.ts sends []). Show the
          // machine's real position instead of an empty timeline. On the
          // ground, not on a plate: the one plate on this screen is the
          // paramedics' card, which is the thing that matters.
          <View style={{ gap: sp(2.5) }}>
            <DataLabel value={alert?.state ?? '—'}>{copy.state}</DataLabel>
            <DataLabel value={alert ? timeOf(alert.opened_at) : '—'}>{copy.opened}</DataLabel>
            <Txt kind="caption" tone="muted" style={{ marginTop: sp(1) }}>
              {copy.noHistory}
            </Txt>
          </View>
        )}
      </Entrance>

      {transcript.length > 0 && (
        <Entrance index={3}>
          <Marquee title={copy.hearing} />
          {transcript.map((line, i) => (
            <Txt
              key={i}
              kind="body"
              style={
                line.speaker === 'agent'
                  ? { fontStyle: 'italic', opacity: 0.8, marginBottom: sp(2) }
                  : { fontWeight: '700', marginBottom: sp(2) }
              }
            >
              {line.speaker === 'agent' ? copy.speakerDhyaan : copy.speakerHer(name)}{line.text}
            </Txt>
          ))}
        </Entrance>
      )}

      {/* Beat 4 — everything that is not the one commitment. The floating bar
          below holds that, and only that. */}
      <Entrance index={4}>
        <Marquee title={copy.ratherYourself} />
        <View style={{ gap: sp(2.5) }}>
          {role === 'staff' ? (
            <>
              <Btn
                kind="outline"
                label={copy.resolvedChecked}
                onPress={() => act(() => api.resolve(id!, 'ok'), copy.resolvedNote)}
              />
              <Btn
                kind="outline"
                label={copy.falseAlarm}
                onPress={() => act(() => api.resolve(id!, 'false_positive'), copy.falseAlarmNote)}
              />
            </>
          ) : (
            <>
              {herPhone ? (
                <Btn kind="outline" label={copy.call(name)} onPress={callHer} />
              ) : (
                <Txt kind="caption" tone="muted">{copy.noNumberCalling(name)}</Txt>
              )}
              <Btn kind="outline" label={copy.call911} onPress={call911} />
              <Txt kind="caption" tone="muted" style={{ textAlign: 'center' }}>
                {phase === 'final' ? copy.dialerNoteFinal : copy.dialerNote}
              </Txt>
            </>
          )}
        </View>
      </Entrance>

      {emsLine && (
        <Entrance index={5}>
          <Marquee title={copy.paramedics} />
          <Slab tone="alarm">
            <DataLabel>{copy.fromCareFile}</DataLabel>
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
