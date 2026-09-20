// THE LIVE ALERT — phase-driven takeover (§10.1 screen 8, abhinavtodo D6.1).
// Explicit phases: suspected → calling → contacts → final → acknowledged.
// Full-bleed vermilion, layered gradient, choreographed entrance, haptics, ringtone.
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useAudioPlayer } from 'expo-audio';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, Vibration, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn, ErrorState, LadderTimeline, Txt } from '@/components';
import { CancelCountdownRing, ElapsedStat, RingingPulse } from '@/components/alert-extras';
import { Entrance } from '@/components/entrance';
import { api } from '@/lib/api';
import { timeOf } from '@/lib/format';
import { useAlert, useContacts, useResident } from '@/lib/hooks';
import { emergencyLine, useCareFile } from '@/store/carefile';
import { useLive } from '@/store/live';
import { useSession } from '@/store/session';
import { palette, radius, sp, type } from '@/theme/tokens';

const WHITE = '#FFFFFF';
const WHITE_SOFT = 'rgba(255,255,255,0.8)';

const kindWord: Record<string, string> = {
  fall: 'Possible fall',
  bathroom: 'Long bathroom stay',
  sos: 'Help button pressed',
  inactivity: 'Unusually still',
  baseline_deviation: 'Change in routine',
};

type Phase = 'suspected' | 'ringing_resident' | 'no_answer' | 'contacts' | 'final' | 'closed';

// Outside the component so the compiler's immutability rule doesn't apply;
// wrapped so a sound failure never kills the takeover.
type RingtonePlayer = { loop: boolean; play(): void; pause(): void };
const startRingtone = (p: RingtonePlayer) => { try { p.loop = true; p.play(); } catch { /* noop */ } };
const stopRingtone = (p: RingtonePlayer) => { try { p.pause(); } catch { /* noop */ } };

function phaseOf(lastStep: string | undefined, closed: boolean): Phase {
  if (closed) return 'closed';
  switch (lastStep) {
    case 'calling_resident': return 'ringing_resident';
    case 'no_answer': return 'no_answer';
    case 'calling_contact_1':
    case 'calling_contact_2': return 'contacts';
    case 'escalated_final': return 'final';
    default: return 'suspected';
  }
}

function BigWhiteBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.bigBtn, { backgroundColor: pressed ? '#F1E4DC' : WHITE }]}
    >
      <Text style={{ color: palette.rustDeep, fontSize: 18, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function OutlineBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.outlineBtn, pressed && { backgroundColor: 'rgba(255,255,255,0.12)' }]}
    >
      <Text style={{ color: WHITE, fontSize: 16, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export default function AlertTakeover() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { data: alert, isLoading, isError, refetch } = useAlert(id ?? '');
  const { data: contacts } = useContacts();
  const live = useLive();
  const { role, residentName } = useSession();
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

  const lastStep = ladder[ladder.length - 1];
  const phase = phaseOf(lastStep?.step, closed);

  const name =
    alert?.resident_id === 'res_eleanor'
      ? residentName
      : resident?.display_name?.split(' ')[0] ?? 'the resident';
  const contact1 = contacts?.[0]?.name.split(' ')[0] ?? 'her family';
  const contact2 = contacts?.[1]?.name.split(' ')[0];

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
      <View style={[styles.paperFill, { padding: sp(6) }]}>
        <ErrorState message="Couldn’t reach Dhyaan to load this alert." onRetry={refetch} />
        <Btn label="Back to home" kind="quiet" onPress={() => router.replace('/')} style={{ marginTop: sp(3) }} />
      </View>
    );
  }

  if (!alert && !isLoading) {
    return (
      <View style={[styles.paperFill, { padding: sp(6) }]}>
        <Txt kind="title">That alert has already been handled.</Txt>
        <Btn label="Back to home" onPress={() => router.replace('/')} style={{ marginTop: sp(5) }} />
      </View>
    );
  }

  // Calm close-out — plus the applause line.
  if (closed && alert) {
    const who = alert.acked_by ?? 'Someone';
    const sentence =
      closedNote ??
      (alert.resolution === 'false_positive'
        ? 'Marked as a false alarm. Nothing else will happen.'
        : `${who} is on it. The ladder has stopped.`);
    return (
      <View style={[styles.paperFill, { padding: sp(6) }]}>
        <Txt kind="display" tone="ok">{sentence}</Txt>
        <Txt kind="body" tone="muted" style={{ marginTop: sp(3) }}>
          Saved to {name}’s timeline.
        </Txt>
        {!!alert.closed_at && (
          <ElapsedStat openedAt={alert.opened_at} closedAt={alert.closed_at} name={name} />
        )}
        <Btn label="Back to home" onPress={() => router.replace('/')} style={{ marginTop: sp(7) }} />
      </View>
    );
  }

  const gradient: [string, string] =
    phase === 'final' ? [palette.rustDeep, '#4A1608'] : [palette.rust, palette.rustDeep];

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient colors={gradient} style={StyleSheet.absoluteFill} />
      <LinearGradient
        colors={['rgba(255,255,255,0.08)', 'rgba(0,0,0,0.22)']}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + sp(5),
          paddingHorizontal: sp(5),
          paddingBottom: sp(4),
        }}
        showsVerticalScrollIndicator={false}
      >
        <Entrance index={0}>
          <Text style={[type.caption, { color: WHITE_SOFT }]}>
            {kindWord[alert?.kind ?? 'fall']} · {alert ? timeOf(alert.opened_at) : ''}
          </Text>
        </Entrance>
        <Entrance index={1}>
          <Text style={[type.display, { color: WHITE, marginTop: sp(2) }]}>
            {alert?.kind === 'bathroom'
              ? `${name} has been in the bathroom a long time.`
              : `${name} may have fallen.`}
          </Text>
        </Entrance>

        <Entrance index={2}>
          {phase === 'suspected' && (
            <CancelCountdownRing
              since={ladder.find((s) => s.step === 'cancel_window')?.at ?? alert?.opened_at ?? ''}
            />
          )}
          {phase === 'ringing_resident' && <RingingPulse label={`Calling ${name} now…`} />}
          {phase === 'no_answer' && (
            <Text style={[styles.betweenLine]}>
              {name} didn’t answer. Calling her family next.
            </Text>
          )}
          {phase === 'contacts' && (
            <RingingPulse
              label={
                lastStep?.step === 'calling_contact_2' && contact2
                  ? `Calling ${contact1} and ${contact2} at the same time`
                  : contact2
                    ? `Calling ${contact1} · ${contact2} is next if she doesn’t pick up`
                    : `Calling ${contact1}`
              }
            />
          )}
          {phase === 'final' && (
            <Text style={styles.betweenLine}>
              Nobody has answered yet. Every contact is being told, with her address.
            </Text>
          )}
        </Entrance>

        <Entrance index={3} style={{ marginTop: sp(4) }}>
          <LadderTimeline steps={ladder} night />
        </Entrance>

        {transcript.length > 0 && (
          <View style={{ marginTop: sp(2) }}>
            <Text style={[type.title, { color: WHITE, marginBottom: sp(3) }]}>
              What the call is hearing
            </Text>
            {transcript.map((line, i) => (
              <Text
                key={i}
                style={
                  line.speaker === 'agent'
                    ? { fontStyle: 'italic' as const, fontSize: 16, lineHeight: 24, color: WHITE_SOFT, marginBottom: sp(2) }
                    : { ...type.body, color: WHITE, fontWeight: '700', marginBottom: sp(2) }
                }
              >
                {line.speaker === 'agent' ? 'Dhyaan: ' : `${name}: `}{line.text}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>

      <Entrance index={4}>
        <View style={{
          paddingHorizontal: sp(5),
          paddingBottom: Math.max(insets.bottom, sp(4)),
          paddingTop: sp(3),
          gap: sp(2.5),
        }}>
          {emsLine && (
            <View style={{
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)',
              borderRadius: radius.card, padding: sp(3),
            }}>
              <Text style={[type.caption, { color: WHITE_SOFT }]}>For EMS, from her care file</Text>
              <Text style={[type.caption, { color: WHITE, marginTop: 2 }]}>{emsLine}</Text>
            </View>
          )}
          {actionError && (
            <Text style={[type.caption, { color: WHITE, textAlign: 'center', fontWeight: '600' }]}>
              {actionError}
            </Text>
          )}
          {role === 'staff' ? (
            <>
              <BigWhiteBtn label="Assign to me" onPress={() => act(() => api.ack(id!, 'Marcus'), 'Assigned to you. The ladder has stopped.')} />
              <OutlineBtn label="Resolved, checked on her" onPress={() => act(() => api.resolve(id!, 'ok'), 'Resolved. Noted on her record.')} />
              <OutlineBtn label="False alarm" onPress={() => act(() => api.resolve(id!, 'false_positive'), 'Marked as a false alarm. Nothing else will happen.')} />
            </>
          ) : (
            <>
              <BigWhiteBtn label="I’ve got her" onPress={() => act(() => api.ack(id!, 'Priya'), 'You’ve got her. The ladder has stopped.')} />
              <OutlineBtn label={`Call ${name}`} onPress={() => Linking.openURL('tel:+16175550100')} />
              <OutlineBtn label="Call 911" onPress={() => Linking.openURL('tel:911')} />
              <Text style={[type.caption, { color: WHITE_SOFT, textAlign: 'center' }]}>
                {phase === 'final'
                  ? 'Dhyaan does not dial 911 for you. If you can’t reach her, this button opens your dialer.'
                  : 'Opens your dialer. Dhyaan never calls 911 itself.'}
              </Text>
            </>
          )}
        </View>
      </Entrance>
    </View>
  );
}

const styles = StyleSheet.create({
  paperFill: { flex: 1, backgroundColor: palette.paper, justifyContent: 'center' },
  bigBtn: {
    minHeight: 56, borderRadius: radius.card,
    alignItems: 'center', justifyContent: 'center',
  },
  outlineBtn: {
    minHeight: 50, borderRadius: radius.card,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)',
  },
  betweenLine: {
    ...type.body, color: WHITE, fontWeight: '600',
    marginTop: sp(4), textAlign: 'center',
  },
});
