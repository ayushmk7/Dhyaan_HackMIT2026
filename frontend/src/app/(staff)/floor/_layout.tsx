// The title used to be "Floor 2": a floor number nothing in the session or on
// the wire knows about. Until the server says which floor this is, the header
// says only what is true.
import React from 'react';
import { shell } from '@/lib/copy/staff';
import { Stack, TabStack } from '@/lib/nav';

export default function FloorStack() {
  return (
    <TabStack>
      <Stack.Screen name="index" options={{ title: shell.stacks.floor }} />
    </TabStack>
  );
}
