import React from 'react';
import { family } from '@/lib/copy/family';
import { Stack, TabStack } from '@/lib/nav';

export default function TimelineStack() {
  return (
    <TabStack>
      <Stack.Screen name="index" options={{ title: family.titles.timeline }} />
      <Stack.Screen name="[eventId]" options={{ title: family.titles.event, headerLargeTitle: false }} />
    </TabStack>
  );
}
