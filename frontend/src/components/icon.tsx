// SF Symbols everywhere an icon appears (Apple HIG). Text dot fallback keeps
// non-iOS platforms from crashing — this demo ships iOS-only.
import { SymbolView, SymbolWeight } from 'expo-symbols';
import React from 'react';
import { ColorValue, Text, View } from 'react-native';
import { hue, onDark, palette } from '@/theme/tokens';

export function Icon({
  name, size = 18, color, weight = 'regular',
}: { name: string; size?: number; color: ColorValue; weight?: SymbolWeight }) {
  return (
    <SymbolView
       
      name={name as any}
      size={size}
      tintColor={color}
      weight={weight}
      fallback={<Text style={{ fontSize: size, color }}>•</Text>}
    />
  );
}

// Apple-Settings-style tinted badge: white symbol on a colored roundrect.
// This is what makes rows and tiles read as a native app instead of text.
export function IconBadge({
  name, color, size = 30, symbolSize,
}: { name: string; color: string; size?: number; symbolSize?: number }) {
  return (
    <View
      style={{
        width: size, height: size, borderRadius: Math.round(size * 0.3),
        backgroundColor: color, alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Icon name={name} size={symbolSize ?? Math.round(size * 0.55)} color={onDark.ink} weight="semibold" />
    </View>
  );
}

// One place decides the badge color an event type gets: the Health taxonomy
// hue for its category. (Kept for callers; `EventRow` derives the same thing.)
export const eventColor = (type: string): string => {
  if (type.startsWith('meal')) return hue.nutrition;
  if (type.startsWith('walk') || type === 'bed_exit') return hue.activity;
  if (type.includes('night')) return hue.sleep;
  if (type.includes('fall') || type === 'button_pressed') return hue.heart;
  if (type.startsWith('call') || type.includes('voice') || type.includes('escalation')) return hue.social;
  return palette.inkMuted;
};

// One place decides which symbol an event type gets.
export const eventSymbol = (type: string): string => {
  if (type.startsWith('meal')) return 'fork.knife';
  if (type.startsWith('walk')) return 'figure.walk';
  if (type === 'bed_exit') return 'sunrise';
  if (type.includes('night')) return 'moon.zzz';
  if (type.includes('fall') || type === 'button_pressed') return 'exclamationmark.triangle';
  if (type.startsWith('call') || type.includes('voice') || type.includes('escalation')) return 'phone';
  if (type.startsWith('zone') || type.includes('home')) return 'door.left.hand.open';
  return 'circle.fill';
};
