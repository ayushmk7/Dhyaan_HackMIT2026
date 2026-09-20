import React from 'react';
import { Stack, TabStack } from '@/lib/nav';

export default function TimelineStack() {
  return (
    <TabStack>
      <Stack.Screen name="index" options={{ title: 'Her day' }} />
      <Stack.Screen name="[eventId]" options={{ title: 'Details', headerLargeTitle: false }} />
    </TabStack>
  );
}
