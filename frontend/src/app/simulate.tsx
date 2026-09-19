// Demo trigger, deep-linkable: dhyaan://simulate (PRD §10.5 /admin/simulate twin).
// Fires the mock fall ladder; the root AlertWatcher takes over from there.
import { router } from 'expo-router';
import { useEffect } from 'react';
import { api } from '@/lib/api';

export default function Simulate() {
  useEffect(() => {
    api.simulate('fall').then((a) => router.replace(`/alert/${a.id}`));
  }, []);
  return null;
}
