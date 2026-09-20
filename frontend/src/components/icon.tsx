// SF Symbols everywhere an icon appears (Apple HIG). Text dot fallback keeps
// non-iOS platforms from crashing. This demo ships iOS-only.
import { SymbolView, SymbolWeight } from 'expo-symbols';
import React from 'react';
import { ColorValue, Text, View } from 'react-native';
import { useTheme } from '@/theme/theme';
import { hue as lightHue, Hue } from '@/theme/tokens';

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

// Apple-Settings-style badge: a symbol on a roundrect. Filled (default) puts
// the symbol in the scheme's `onAccent`/white on a `color` plate; `outline`
// draws a ring in `color` with the symbol in `color`, which is how "nothing
// to point at" is drawn now that OK has no colour. This is what makes rows
// and tiles read as a native app instead of text.
export function IconBadge({
  name, color, size = 30, symbolSize, outline = false,
}: { name: string; color: string; size?: number; symbolSize?: number; outline?: boolean }) {
  const t = useTheme();
  // A plate in the accent takes the accent's text colour (near-black in dark
  // mode); any other plate takes white, which every other plate is dark enough for.
  const glyph = outline ? color : color === t.accent ? t.onAccent : t.white;
  return (
    <View
      style={{
        width: size, height: size, borderRadius: Math.round(size * 0.3),
        alignItems: 'center', justifyContent: 'center',
        ...(outline ? { borderWidth: 1.5, borderColor: color } : { backgroundColor: color }),
      }}
    >
      <Icon name={name} size={symbolSize ?? Math.round(size * 0.55)} color={glyph} weight="semibold" />
    </View>
  );
}

// One place decides the tint an event type gets. Pass `t.hue` from `useTheme()`
// for the scheme's values; the default is the light set. (Kept for callers;
// `EventRow` derives the same thing.)
export const eventColor = (type: string, hue: Hue = lightHue): string => {
  if (type.startsWith('meal')) return hue.nutrition;
  if (type.startsWith('walk') || type === 'bed_exit') return hue.activity;
  if (type.includes('night')) return hue.sleep;
  if (type.includes('fall') || type === 'button_pressed') return hue.heart;
  if (type.startsWith('call') || type.includes('voice') || type.includes('escalation')) return hue.social;
  return hue.location;
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
