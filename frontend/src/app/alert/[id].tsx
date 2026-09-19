// THE LIVE ALERT — the app's one bold surface (§10.1 screen 8, DESIGN.md rule 1).
// Full-bleed rust, the live ladder, what the call is hearing, and three buttons.
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, Vibration, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn, LadderTimeline, Txt } from '@/components';
import { api } from '@/lib/api';
import { timeOf } from '@/lib/format';
import { useAlert, useResident } from '@/lib/hooks';
import { useLive } from '@/store/live';
import { useSession } from '@/store/session';
import { font, palette, radius, sp, type } from '@/theme/tokens';

const WHITE = '#FFFFFF';
const WHITE_SOFT = 'rgba(255,255,255,0.8)';

const kindWord: Record<string, string> = {
  fall: 'Possible fall',
  bathroom: 'Long bathroom stay',
  sos: 'Help button pressed',
  inactivity: 'Unusually still',
  baseline_deviation: 'Change in routine',
};

function BigWhiteBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 56, borderRadius: radius.card,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: pressed ? '#F1E4DC' : WHITE,
      })}
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
      style={({ pressed }) => ({
        minHeight: 50, borderRadius: radius.card,
        alignItems: 'center', justifyContent: 'center',
        borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)',
        backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent',
      })}
    >
      <Text style={{ color: WHITE, fontSize: 16, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export default function AlertTakeover() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { data: alert, isLoading, refetch } = useAlert(id ?? '');
  const live = useLive();
  const { role, residentName } = useSession();
  const { data: resident } = useResident(alert?.resident_id ?? '');
  const [closedNote, setClosedNote] = useState<string | null>(null);

  const isActive = live.activeAlert?.id === id;
  const ladder = isActive ? live.ladder : alert?.ladder ?? [];
  const transcript = isActive ? live.transcript : alert?.calls.flatMap((c) => c.transcript) ?? [];
  const closed = !!alert?.closed_at || !!closedNote || (!isActive && !isLoading && !alert);

  const name =
    alert?.resident_id === 'res_eleanor'
      ? residentName
      : resident?.display_name ?? 'the resident';

  useEffect(() => {
    if (!closed && alert) {
      Vibration.vibrate([0, 400, 300, 400], true);
      return () => Vibration.cancel();
    }
    Vibration.cancel();
    return undefined;
  }, [closed, !!alert]);

  const act = async (fn: () => Promise<void>, note: string) => {
    await fn();
    Vibration.cancel();
    setClosedNote(note);
    refetch();
  };

  if (!alert && !isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.paper, padding: sp(6), justifyContent: 'center' }}>
        <Txt kind="title">That alert has already been handled.</Txt>
        <Btn label="Back to home" onPress={() => router.replace('/')} style={{ marginTop: sp(5) }} />
      </View>
    );
  }

  // Calm close-out state.
  if (closed && alert) {
    const who = alert.acked_by ?? 'Someone';
    const sentence =
      closedNote ??
      (alert.resolution === 'false_positive'
        ? 'Marked as a false alarm. Nothing else will happen.'
        : `${who} is on it. The ladder has stopped.`);
    return (
      <View style={{ flex: 1, backgroundColor: palette.paper, padding: sp(6), justifyContent: 'center' }}>
        <Txt kind="display" tone="ok">{sentence}</Txt>
        <Txt kind="body" tone="muted" style={{ marginTop: sp(3) }}>
          Everything Kestrel heard and did is saved on {name}’s timeline.
        </Txt>
        <Btn label="Back to home" onPress={() => router.replace('/')} style={{ marginTop: sp(7) }} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.rust }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + sp(5),
          paddingHorizontal: sp(5),
          paddingBottom: sp(4),
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[type.caption, { color: WHITE_SOFT }]}>
          {kindWord[alert?.kind ?? 'fall']} · {alert ? timeOf(alert.opened_at) : ''}
        </Text>
        <Text style={[type.display, { color: WHITE, marginTop: sp(2) }]}>
          {alert?.kind === 'bathroom'
            ? `${name} has been in the bathroom a long time.`
            : `${name} may have fallen.`}
        </Text>

        <View style={{ marginTop: sp(7) }}>
          <LadderTimeline steps={ladder} night />
        </View>

        {transcript.length > 0 && (
          <View style={{ marginTop: sp(4) }}>
            <Text style={[type.title, { color: WHITE, marginBottom: sp(3) }]}>
              What the call is hearing
            </Text>
            {transcript.map((line, i) => (
              <Text
                key={i}
                style={
                  line.speaker === 'agent'
                    ? { fontFamily: font.displayItalic, fontSize: 16, lineHeight: 24, color: WHITE_SOFT, marginBottom: sp(2) }
                    : { ...type.body, color: WHITE, fontWeight: '700', marginBottom: sp(2) }
                }
              >
                {line.speaker === 'agent' ? 'Kestrel: ' : `${name}: `}{line.text}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={{
        paddingHorizontal: sp(5),
        paddingBottom: Math.max(insets.bottom, sp(4)),
        paddingTop: sp(3),
        gap: sp(2.5),
      }}>
        {role === 'staff' ? (
          <>
            <BigWhiteBtn label="Assign to me" onPress={() => act(() => api.ack(id!, 'Marcus'), 'Assigned to you. The ladder has stopped.')} />
            <OutlineBtn label="Resolved — checked on her" onPress={() => act(() => api.resolve(id!, 'ok'), 'Resolved. Noted on her record.')} />
            <OutlineBtn label="False alarm" onPress={() => act(() => api.resolve(id!, 'false_positive'), 'Marked as a false alarm. Nothing else will happen.')} />
          </>
        ) : (
          <>
            <BigWhiteBtn label="I’ve got her" onPress={() => act(() => api.ack(id!, 'Priya'), 'You’ve got her. The ladder has stopped.')} />
            <OutlineBtn label={`Call ${name}`} onPress={() => Linking.openURL('tel:+16175550100')} />
            <OutlineBtn label="Call 911" onPress={() => Linking.openURL('tel:911')} />
            <Text style={[type.caption, { color: WHITE_SOFT, textAlign: 'center' }]}>
              Opens your phone dialer — Kestrel never calls 911 itself.
            </Text>
          </>
        )}
      </View>
    </View>
  );
}
