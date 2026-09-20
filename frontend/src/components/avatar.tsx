// The app's "face". Human apps anchor on people (photos, characters); with no
// photo to ship, a bold gradient monogram is the contacts-app answer. Three
// monograms on the blue ramp (deep, mid, graphite), white initial on all.
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { useTheme } from '@/theme/theme';
import { avatarGradient } from '@/theme/tokens';
import { Txt } from './text';

export type AvatarTone = keyof typeof avatarGradient;

const TONES = Object.keys(avatarGradient) as AvatarTone[];

/** The tone for the i-th person in a list, so a roster cycles through all three. */
export const avatarTone = (i: number): AvatarTone => TONES[i % TONES.length];

export function Avatar({
  name, size = 44, tone = 'green',
}: { name: string; size?: number; tone?: AvatarTone }) {
  const t = useTheme();
  return (
    <LinearGradient
      colors={t.avatarGradient[tone]}
      start={{ x: 0.2, y: 0 }}
      end={{ x: 0.8, y: 1 }}
      style={{
        width: size, height: size, borderRadius: size / 2,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Txt style={{ color: t.white, fontSize: size * 0.42, lineHeight: size * 0.5, fontWeight: '700' }}>
        {name.trim().charAt(0).toUpperCase()}
      </Txt>
    </LinearGradient>
  );
}
