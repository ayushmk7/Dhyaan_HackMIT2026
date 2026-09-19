import { Stack } from 'expo-router';
import { palette } from '@/theme/tokens';

export default function OnboardLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: palette.paper },
      }}
    />
  );
}
