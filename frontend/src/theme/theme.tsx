// The resolved theme. `useTheme()` hands a component the palette for the
// scheme it is being drawn in, with the same keys `palette` has, plus the
// semantics that hang off it (state styles, zone ramp, wash ramps, glass).
//
// Scheme comes from `useColorScheme()` (react-native, per the Expo v57 docs:
// https://docs.expo.dev/develop/user-interface/color-themes/). It only ever
// reports 'dark' when app.json's `userInterfaceStyle` is "automatic" or
// "dark"; with "light" (the default) the app is pinned light and this hook
// resolves to the light theme forever.
//
// `<ThemeProvider>` is optional. Without it, `useTheme()` follows the system.
// With `scheme` set, it forces one, for a screen that must always be dark or
// a preview that must always be light.
import React from 'react';
import { useColorScheme } from 'react-native';
import { buildSemantics, darkPalette, palette, Palette, Semantics } from './tokens';

export type Scheme = 'light' | 'dark';

export type Theme = Palette & Semantics & {
  scheme: Scheme;
  /** True in the dark scheme. Not "is this surface dark": see `isDarkSurface`. */
  isDark: boolean;
};

const build = (p: Palette, scheme: Scheme): Theme => ({
  ...p, ...buildSemantics(p, scheme), scheme, isDark: scheme === 'dark',
});

/** Both resolved themes, for the rare non-hook site that knows its scheme. */
export const themes: Record<Scheme, Theme> = {
  light: build(palette, 'light'),
  dark: build(darkPalette, 'dark'),
};

const SchemeCtx = React.createContext<Scheme | null>(null);

const fromSystem = (s: ReturnType<typeof useColorScheme>): Scheme => (s === 'dark' ? 'dark' : 'light');

/**
 * Optional. Wrap the app (or one subtree) to force a scheme; leave `scheme`
 * unset to follow the system, which is also what happens with no provider.
 */
export function ThemeProvider({ scheme, children }: { scheme?: Scheme; children: React.ReactNode }) {
  const system = useColorScheme();
  return <SchemeCtx.Provider value={scheme ?? fromSystem(system)}>{children}</SchemeCtx.Provider>;
}

/** The scheme this subtree is drawn in. */
export function useScheme(): Scheme {
  const forced = React.useContext(SchemeCtx);
  const system = useColorScheme();
  return forced ?? fromSystem(system);
}

/** The resolved palette and semantics for the current scheme. */
export function useTheme(): Theme {
  return themes[useScheme()];
}
