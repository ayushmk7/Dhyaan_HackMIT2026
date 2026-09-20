import React from 'react';
import { family } from '@/lib/copy/family';
import { Stack, TabStack } from '@/lib/nav';

export default function SettingsStack() {
  return (
    <TabStack>
      <Stack.Screen name="index" options={{ title: family.titles.settings }} />
      <Stack.Screen name="carefile" options={{ title: family.titles.carefile, headerLargeTitle: false }} />
    </TabStack>
  );
}
