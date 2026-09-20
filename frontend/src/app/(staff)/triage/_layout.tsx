import React from 'react';
import { Stack, TabStack } from '@/lib/nav';

export default function TriageStack() {
  return (
    <TabStack>
      <Stack.Screen name="index" options={{ title: 'Tonight' }} />
      <Stack.Screen name="resident/[id]" options={{ title: 'Resident', headerLargeTitle: false }} />
    </TabStack>
  );
}
