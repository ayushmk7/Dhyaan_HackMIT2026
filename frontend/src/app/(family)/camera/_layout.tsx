// The console's own native stack, so it gets the same UINavigationBar large
// title every other tab has. One screen: there is nothing to drill into,
// because there is nothing behind a tick but the tick.
import React from 'react';
import { family } from '@/lib/copy/family';
import { Stack, TabStack } from '@/lib/nav';

export default function CameraStack() {
  return (
    <TabStack>
      <Stack.Screen name="index" options={{ title: family.titles.camera }} />
    </TabStack>
  );
}
