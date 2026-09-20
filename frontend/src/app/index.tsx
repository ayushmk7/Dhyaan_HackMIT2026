// Entry: route by session (§7). No user at all → sign in. Signed in but not set
// up → onboarding. Otherwise the family app. Staff is unchanged and reachable
// only from Settings once you are already in.
import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { useSession } from '@/store/session';

// Local dev convenience: EXPO_PUBLIC_DEV_AUTOLOGIN=true boots straight into the
// family app as the demo user, so a running camera can be watched without
// tapping through login and onboarding every reload. Never set in a build that
// leaves this machine - it is an auth bypass, not a feature.
const AUTOLOGIN = process.env.EXPO_PUBLIC_DEV_AUTOLOGIN === 'true';

export default function Index() {
  const { user, role, onboarded } = useSession();
  const seedDemoSession = useSession((s) => s.seedDemoSession);

  useEffect(() => {
    if (AUTOLOGIN && !user) seedDemoSession([]);
  }, [user, seedDemoSession]);

  if (AUTOLOGIN && !user) return null;   // one frame, while the effect runs
  if (role === 'staff') return <Redirect href="/(staff)/triage" />;
  if (!user) return <Redirect href="/login" />;
  if (!onboarded) return <Redirect href="/onboard/welcome" />;
  return <Redirect href="/(family)/home" />;
}
