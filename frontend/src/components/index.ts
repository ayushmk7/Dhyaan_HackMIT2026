export * from './ui';
export * from './viz';
export * from './presence';
export * from './glass';
export * from './brutal';
export * from './entrance';
export * from './wash';
// Previously reached by path (`@/components/icon` etc.); those paths still work.
export * from './icon';
export * from './avatar';
export * from './alert-extras';
// The scheme hooks live in @/theme/theme; re-exported so a screen that already
// imports from '@/components' can pick up `useTheme` without a second import.
export { ThemeProvider, useScheme, useTheme, themes } from '@/theme/theme';
export type { Scheme, Theme } from '@/theme/theme';
