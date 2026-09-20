// Entry: route by session (§7). No user at all → sign in. Signed in but not set
// up → onboarding. Otherwise the family app. Staff is unchanged and reachable
// only from Settings once you are already in.
import { Redirect } from 'expo-router';
import { useSession } from '@/store/session';

export default function Index() {
  const { user, role, onboarded } = useSession();
  if (role === 'staff') return <Redirect href="/(staff)/triage" />;
  if (!user) return <Redirect href="/login" />;
  if (!onboarded) return <Redirect href="/onboard/welcome" />;
  return <Redirect href="/(family)/home" />;
}
