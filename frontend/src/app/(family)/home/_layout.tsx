import React from 'react';
import { family } from '@/lib/copy/family';
import { Stack, TabStack } from '@/lib/nav';

export default function HomeStack() {
  return (
    <TabStack>
      <Stack.Screen name="index" options={{ title: family.titles.home }} />
    </TabStack>
  );
}
