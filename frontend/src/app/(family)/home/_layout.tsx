import React from 'react';
import { Stack, TabStack } from '@/lib/nav';

export default function HomeStack() {
  return (
    <TabStack>
      <Stack.Screen name="index" options={{ title: 'Dhyaan' }} />
    </TabStack>
  );
}
