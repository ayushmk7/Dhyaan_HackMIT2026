import React from 'react';
import { Stack, TabStack } from '@/lib/nav';

export default function SettingsStack() {
  return (
    <TabStack>
      <Stack.Screen name="index" options={{ title: 'Settings' }} />
      <Stack.Screen name="carefile" options={{ title: 'Care File', headerLargeTitle: false }} />
    </TabStack>
  );
}
