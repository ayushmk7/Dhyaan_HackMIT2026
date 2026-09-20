// SF Symbols everywhere an icon appears (Apple HIG). Text dot fallback keeps
// non-iOS platforms from crashing — this demo ships iOS-only.
import { SymbolView, SymbolWeight } from 'expo-symbols';
import React from 'react';
import { ColorValue, Text, View } from 'react-native';

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
      <Icon name={name} size={symbolSize ?? Math.round(size * 0.55)} color="#FFFFFF" weight="semibold" />
    </View>
  );
}

// One place decides the badge color an event type gets (import palette lazily to
// avoid a cycle with tokens consumers).
export const eventColor = (type: string): string => {
  if (type.startsWith('meal')) return '#B57E1E'; // ochre
  if (type.startsWith('walk')) return '#5E7C45'; // moss
  if (type === 'bed_exit') return '#B57E1E';
  if (type.includes('night')) return '#44607D'; // slate
  if (type.includes('fall') || type === 'button_pressed') return '#C0431F'; // rust
  if (type.startsWith('call') || type.includes('voice') || type.includes('escalation')) return '#44607D';
  return '#A9A192';
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
