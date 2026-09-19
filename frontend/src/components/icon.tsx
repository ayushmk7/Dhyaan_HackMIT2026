// SF Symbols everywhere an icon appears (Apple HIG). Text dot fallback keeps
// non-iOS platforms from crashing — this demo ships iOS-only.
import { SymbolView, SymbolWeight } from 'expo-symbols';
import React from 'react';
import { ColorValue, Text } from 'react-native';

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
