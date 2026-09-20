// Root: fonts, query client, websocket, notification handler, and the rule that
// an opening alert takes over the screen no matter where you are (§10.2).
import {
  Fraunces_300Light, Fraunces_400Regular, Fraunces_400Regular_Italic, Fraunces_600SemiBold,
  Fraunces_700Bold, Fraunces_900Black, useFonts,
} from '@expo-google-fonts/fraunces';
import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import { router, Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { api } from '@/lib/api';
import { useHydrateResident } from '@/lib/hooks';
import { queryClient } from '@/lib/queryClient';
import { useLive } from '@/store/live';
import { ThemeProvider, themes } from '@/theme';

SplashScreen.preventAutoHideAsync();

// Push handling is a no-op in Expo Go; guarded so the demo never crashes on it.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Notifications = require('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async (n: { request: { content: { data?: Record<string, unknown> } } }) => ({
      shouldShowBanner: n.request.content.data?.kind !== 'ladder',
      shouldShowList: true,
      shouldPlaySound: n.request.content.data?.severity === 'critical',
      shouldSetBadge: true,
    }),
  });
} catch { /* not available in this runtime */ }

function AlertWatcher() {
  const activeAlert = useLive((s) => s.activeAlert);
  const pathname = usePathname();
  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    if (activeAlert && shownFor.current !== activeAlert.id && !pathname.startsWith('/alert/')) {
      shownFor.current = activeAlert.id;
      router.push(`/alert/${activeAlert.id}`);
    }
    if (!activeAlert) shownFor.current = null;
  }, [activeAlert, pathname]);
  return null;
}

// Login returns her resident id but not her name, so the session opens on a
// placeholder. This asks the profile once the id is known and writes the real
// name back (widening only). It uses useQuery, so it must sit under the
// QueryClientProvider, which is why it is a component beside AlertWatcher and
// not a call in RootLayout.
function SessionHydrator() {
  useHydrateResident();
  return null;
}

// The app is light-only. `app.json`'s `userInterfaceStyle: "light"` tells iOS,
// and this forces it everywhere else — Android and web still report the system
// scheme through `useColorScheme()` regardless of that setting, which is how a
// navy Slab and a near-black ground reached the home screen on a phone set to
// dark. The dark palette is still built and still passes its contrast checks;
// re-enabling it is this wrapper plus one word in app.json.
function LightOnly({ children }: { children: React.ReactNode }) {
  return <ThemeProvider scheme="light">{children}</ThemeProvider>;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    // 300 Light carries all body copy, 900 Black the one hero sentence per
    // screen — the weight extremes are the type system (§7).
    Fraunces_300Light, Fraunces_400Regular, Fraunces_400Regular_Italic, Fraunces_600SemiBold,
    Fraunces_700Bold, Fraunces_900Black,
  });
  const connect = useLive((s) => s.connect);
  // Read directly rather than through `useTheme()`: RootLayout renders the
  // provider, so a hook here would resolve ABOVE it and report the system
  // scheme, which is exactly the bug being fixed.
  const t = themes.light;

  useEffect(() => { connect(); }, [connect]);

  // ponytail: the real backend only ever broadcasts `alert.update` on
  // ack/resolve (backend/app/routers/residents.py) — a brand-new alert firing
  // (e.g. a fall) is never pushed over the socket at all today. Without this
  // poll, a live alert would only ever surface by background/foreground
  // cycling the app. Upgrade: have the backend broadcast on alert creation too.
  const checkForOpenAlert = () => {
    api.listOpenAlerts().then((open) => {
      const live = useLive.getState();
      if (open[0] && live.activeAlert?.id !== open[0].id) {
        live.applyEvent({ t: 'alert.opened', alert: open[0], resident_id: open[0].resident_id });
      }
    }).catch(() => { /* next poll or the next foreground tries again */ });
  };

  // §10.3: on foreground, assume we missed everything — refetch + resync alerts.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active');
      if (state === 'active') {
        connect();
        checkForOpenAlert();
      }
    });
    return () => sub.remove();
  }, [connect]);

  useEffect(() => {
    const t = setInterval(checkForOpenAlert, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { if (fontsLoaded) SplashScreen.hideAsync(); }, [fontsLoaded]);
  if (!fontsLoaded) return null;

  return (
    <LightOnly>
    <QueryClientProvider client={queryClient}>
      {/* Dark glyphs, because the ground is always paper now. */}
      <StatusBar style="dark" />
      <AlertWatcher />
      <SessionHydrator />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.paper },
        }}
      >
        <Stack.Screen
          name="alert/[id]"
          options={{ presentation: 'fullScreenModal', gestureEnabled: false, animation: 'fade' }}
        />
      </Stack>
    </QueryClientProvider>
    </LightOnly>
  );
}
