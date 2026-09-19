// Entry: route by session. No role yet → onboarding welcome (which also offers
// the two demo entries). Family → tabs. Staff → triage.
import { Redirect } from 'expo-router';
import { useSession } from '@/store/session';

export default function Index() {
  const { role, onboarded } = useSession();
  if (role === 'staff') return <Redirect href="/(staff)" />;
  if (role === 'family' && onboarded) return <Redirect href="/(family)" />;
  return <Redirect href="/onboard/welcome" />;
}
