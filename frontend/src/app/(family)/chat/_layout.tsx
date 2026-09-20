import React from 'react';
import { Stack, TabStack } from '@/lib/nav';

export default function ChatStack() {
  return (
    <TabStack>
      <Stack.Screen name="index" options={{ title: 'Ask Dhyaan' }} />
      <Stack.Screen name="plan" options={{ title: 'Family Plan', headerLargeTitle: false }} />
    </TabStack>
  );
}
