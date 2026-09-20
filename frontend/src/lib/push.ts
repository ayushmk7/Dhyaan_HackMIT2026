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

/**
 * Fire the §10.4 FALL payload at this phone, end to end, with no backend.
 *
 * A diagnostic, reached only from the hidden debug panel. It used to hardcode
 * "Possible fall: Asha" and `resident_id: 'res_eleanor'`, which meant a test
 * notification named the seed's resident on any install. The caller passes who
 * it is actually for, and the body says plainly that it is a test, because a
 * notification that reads exactly like a real fall alert is one a person can
 * act on by mistake.
 */
export async function sendTestPush(
  token: string,
  resident: { id: string; name: string },
): Promise<void> {
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: token,
      title: `Test alert: ${resident.name}`,
      body: 'This is a test of the fall notification. Nothing has happened.',
      sound: 'dhyaan-urgent.wav',
      priority: 'high',
      interruptionLevel: 'timeSensitive',
      categoryId: 'dhyaan_alert',
      channelId: 'alerts',
      badge: 1,
      data: {
        v: 1, kind: 'alert', alert_id: 'alr_demo', resident_id: resident.id,
        severity: 'critical', deeplink: 'dhyaan://alert/alr_demo', test: true,
      },
    }),
  });
}
