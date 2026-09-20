// Push helpers (TODO D10). Everything is guarded: in Expo Go or the simulator
// these fail soft with a reason string instead of crashing the demo.
import { USE_MOCKS } from './config';
import { httpApi } from './http';

export async function registerForPush(): Promise<{ token: string | null; reason?: string }> {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const Notifications = require('expo-notifications');
    const Device = require('expo-device');
    const Constants = require('expo-constants').default;
    /* eslint-enable @typescript-eslint/no-require-imports */
    if (!Device.isDevice) {
      return { token: null, reason: 'Push needs a real phone.' };
    }
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      return { token: null, reason: 'Notifications are off for Dhyaan in iOS Settings.' };
    }
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId;
    if (!projectId || String(projectId).startsWith('REPLACE')) {
      return { token: null, reason: 'Run npx eas init once so the app has a project id.' };
    }
    const token: string = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    if (!USE_MOCKS) await httpApi.registerPushToken(token);
    return { token };
  } catch (e) {
    console.warn('push registration failed', e);
    return { token: null, reason: 'Push needs the dev build, not Expo Go.' };
  }
}

// TODO D10.3: fire the §10.4 FALL payload at this phone, end to end, no backend.
export async function sendTestPush(token: string): Promise<void> {
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: token,
      title: 'Possible fall: Eleanor',
      body: 'Her band detected a fall at 3:42 PM. We’re calling her now.',
      sound: 'dhyaan-urgent.wav',
      priority: 'high',
      interruptionLevel: 'timeSensitive',
      categoryId: 'dhyaan_alert',
      channelId: 'alerts',
      badge: 1,
      data: {
        v: 1, kind: 'alert', alert_id: 'alr_demo', resident_id: 'res_eleanor',
        severity: 'critical', deeplink: 'dhyaan://alert/alr_demo',
      },
    }),
  });
}
