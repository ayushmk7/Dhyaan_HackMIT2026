import React from 'react';
import { family } from '@/lib/copy/family';
import { Stack, TabStack } from '@/lib/nav';

export default function ChatStack() {
  return (
    <TabStack>
      <Stack.Screen name="index" options={{ title: family.titles.chat }} />
      <Stack.Screen name="plan" options={{ title: family.titles.plan, headerLargeTitle: false }} />
    </TabStack>
  );
}
