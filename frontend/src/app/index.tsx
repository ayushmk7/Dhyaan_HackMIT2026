// Entry: route by session (§7). There is no sign-in and no auth anywhere
// (see backend/app/main.py). Not set up yet → onboarding. Otherwise the family
// app. Staff is reachable only from Settings once you are already in.
import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { useSession } from '@/store/session';

// Local dev convenience: EXPO_PUBLIC_DEV_SKIP_ONBOARDING=true boots straight
// into the family app with Eleanor already set up, so a running camera can be
// watched without tapping through onboarding every reload.
const SKIP_ONBOARDING = process.env.EXPO_PUBLIC_DEV_SKIP_ONBOARDING === 'true';

export default function Index() {
  const { role, onboarded } = useSession();
  const seedDemoSession = useSession((s) => s.seedDemoSession);

  useEffect(() => {
    if (SKIP_ONBOARDING && !onboarded) seedDemoSession([]);
  }, [onboarded, seedDemoSession]);

  if (SKIP_ONBOARDING && !onboarded) return null;   // one frame, while the effect runs
  if (role === 'staff') return <Redirect href="/(staff)/triage" />;
  if (!onboarded) return <Redirect href="/onboard/welcome" />;
  return <Redirect href="/(family)/home" />;
}
