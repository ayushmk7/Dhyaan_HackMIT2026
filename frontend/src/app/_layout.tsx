// Root: fonts, query client, websocket, notification handler, and the rule that
// an opening alert takes over the screen no matter where you are (§10.2).
import {
  Fraunces_400Regular, Fraunces_400Regular_Italic, Fraunces_600SemiBold, Fraunces_700Bold,
  useFonts,
} from '@expo-google-fonts/fraunces';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router, Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { api } from '@/lib/api';
import { useLive } from '@/store/live';
import { palette } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1 } },
});

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

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Fraunces_400Regular, Fraunces_400Regular_Italic, Fraunces_600SemiBold, Fraunces_700Bold,
  });
  const connect = useLive((s) => s.connect);

  useEffect(() => { connect(); }, [connect]);

  // §10.3: on foreground, assume we missed everything — refetch + resync alerts.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active');
      if (state === 'active') {
        connect();
        api.listOpenAlerts().then((open) => {
          const live = useLive.getState();
          if (open[0] && !live.activeAlert) {
            live.applyEvent({ t: 'alert.opened', alert: open[0], resident_id: open[0].resident_id });
          }
        });
      }
    });
    return () => sub.remove();
  }, [connect]);

  useEffect(() => { if (fontsLoaded) SplashScreen.hideAsync(); }, [fontsLoaded]);
  if (!fontsLoaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <AlertWatcher />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.paper },
        }}
      >
        <Stack.Screen
          name="alert/[id]"
          options={{ presentation: 'fullScreenModal', gestureEnabled: false, animation: 'fade' }}
        />
      </Stack>
    </QueryClientProvider>
  );
}
