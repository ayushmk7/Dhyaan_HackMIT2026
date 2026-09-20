import React from 'react';
import { Stack, TabStack } from '@/lib/nav';

export default function FloorStack() {
  return (
    <TabStack>
      <Stack.Screen name="index" options={{ title: 'Floor 2' }} />
    </TabStack>
  );
}
