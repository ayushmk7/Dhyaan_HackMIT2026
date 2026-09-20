// Welcome: a face, one line, one button. Real apps don't open with paragraphs.
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn, Txt } from '@/components';
import { Icon } from '@/components/icon';
import { useSession } from '@/store/session';
import { palette, sp } from '@/theme/tokens';

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const { setRole, finishOnboarding } = useSession();

  const familyDemo = () => {
    setRole('family');
    finishOnboarding();
    router.replace('/(family)/home');
  };
  const staffDemo = () => {
    setRole('staff');
    router.replace('/(staff)/triage');
  };

  return (
    <View style={{
      flex: 1, backgroundColor: palette.paper,
      paddingTop: insets.top, paddingBottom: insets.bottom + sp(4),
      paddingHorizontal: sp(6),
    }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <LinearGradient
          colors={['#35B27A', '#1E7A5A']}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={{
            width: 132, height: 132, borderRadius: 66,
            alignItems: 'center', justifyContent: 'center',
            shadowColor: '#1E7A5A', shadowOpacity: 0.35, shadowRadius: 24,
            shadowOffset: { width: 0, height: 10 },
          }}
        >
          <Icon name="figure.2.arms.open" size={64} color="#FFFFFF" weight="semibold" />
        </LinearGradient>

        <Text style={{
          fontSize: 40, fontWeight: '800', letterSpacing: -1,
          color: palette.ink, marginTop: sp(7),
        }}>
          Dhyaan
        </Text>
        <Txt kind="body" style={{ textAlign: 'center', marginTop: sp(3), maxWidth: 300 }}>
          Looks after your mother, so calls can be just calls.
        </Txt>
      </View>

      <Btn label="Get Started" onPress={() => router.push('/onboard/consent')} />
      <Pressable
        accessibilityRole="button"
        onPress={familyDemo}
        onLongPress={staffDemo}
        style={{ paddingVertical: sp(4), alignItems: 'center' }}
      >
        <Txt kind="label" tone="slate">Explore the demo</Txt>
      </Pressable>
      <Txt kind="caption" tone="muted" style={{ textAlign: 'center' }}>{/* voice-ok */}
        Dhyaan is not a medical device and never dials 911.
      </Txt>
    </View>
  );
}
