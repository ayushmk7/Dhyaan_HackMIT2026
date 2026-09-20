// The app's "face". Human apps anchor on people (photos, characters); with no
// photo to ship, a bold gradient monogram is the contacts-app answer.
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Text } from 'react-native';

const GRADIENTS: Record<string, [string, string]> = {
  green: ['#35B27A', '#1E7A5A'],
  amber: ['#F2B24C', '#DD8500'],
  blue: ['#6FA6E8', '#3D6FBF'],
};

export function Avatar({
  name, size = 44, tone = 'green',
}: { name: string; size?: number; tone?: keyof typeof GRADIENTS }) {
  return (
    <LinearGradient
      colors={GRADIENTS[tone]}
      start={{ x: 0.2, y: 0 }}
      end={{ x: 0.8, y: 1 }}
      style={{
        width: size, height: size, borderRadius: size / 2,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Text style={{
        color: '#FFFFFF', fontSize: size * 0.42, fontWeight: '700',
      }}>
        {name.trim().charAt(0).toUpperCase()}
      </Text>
    </LinearGradient>
  );
}
