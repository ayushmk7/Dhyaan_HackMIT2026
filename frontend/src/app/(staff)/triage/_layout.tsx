import React from 'react';
import { shell } from '@/lib/copy/staff';
import { Stack, TabStack } from '@/lib/nav';

export default function TriageStack() {
  return (
    <TabStack>
      <Stack.Screen name="index" options={{ title: shell.stacks.triage }} />
      <Stack.Screen name="resident/[id]" options={{ title: shell.stacks.resident, headerLargeTitle: false }} />
    </TabStack>
  );
}
