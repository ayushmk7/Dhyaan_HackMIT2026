// Real API client (§10.5). Same names and signatures as the mock facade in
// api.ts — flipping USE_MOCKS must change zero call sites.
import { API_BASE } from './config';
import type {
  Alert, BaselineFeature, ChatMessage, Contact, DaySummary, KEvent,
  LocationSegment, Resident,
} from './types';

let token: string | null = null;
export const setToken = (t: string | null) => { token = t; };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    // §10.5 error envelope, parsed once.
    const message = body?.error?.message ?? `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(data ?? {}) });

export const httpApi = {
  listResidents: () => get<Resident[]>('/residents'),
  getResident: (id: string) => get<Resident | null>(`/residents/${id}`),
  getEvents: async (residentId: string) =>
    (await get<{ events: KEvent[] }>(`/residents/${residentId}/events?limit=200`)).events,
  // ponytail: no GET /events/{id} exists in §10.5 — scan Eleanor's recent events.
  // Ceiling: staff tapping another resident's event; upgrade path: add the endpoint.
  getEvent: async (id: string) => {
    const { events } = await get<{ events: KEvent[] }>('/residents/res_eleanor/events?limit=200');
    return events.find((e) => e.id === id) ?? null;
  },
  getSummaries: async (residentId: string) => {
    // §10.5 serves one summary per date; the app wants the recent week.
    const days: DaySummary[] = [];
    for (let d = 1; d <= 6; d++) {
      const date = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
      const s = await get<DaySummary | null>(`/residents/${residentId}/summary?date=${date}`).catch(() => null);
      if (s) days.push(s);
    }
    return days;
  },
  getLocationHistory: async (residentId: string, date: string) =>
    (await get<{ segments: LocationSegment[] }>(
      `/residents/${residentId}/location/history?date=${date}`,
    )).segments,
  // ponytail: §10.5 has no baselines endpoint — staff sparklines stay mock-only
  // until the backend exposes one.
  getBaselines: async (_residentId: string): Promise<BaselineFeature[]> => [],
  getContacts: () => get<Contact[]>('/residents/res_eleanor/contacts'),
  listOpenAlerts: () => get<Alert[]>('/alerts?state=open'),
  getAlert: (id: string) => get<Alert | null>(`/alerts/${id}`),

  ack: async (alertId: string, by: string) => {
    await post(`/alerts/${alertId}/ack`, { by, channel: 'app' });
  },
  resolve: async (alertId: string, resolution: string) => {
    await post(`/alerts/${alertId}/resolve`, { resolution });
  },
  feedback: (eventId: string, verdict: 'expected' | 'false_positive', reason?: string) =>
    post<{ downweighted: string[]; suppress_until: string; verdict: 'expected' | 'false_positive' }>(
      `/alerts/${eventId}/feedback`, { verdict, reason, scope: 'day' },
    ),
  chat: (question: string) =>
    post<ChatMessage>('/chat', { resident_id: 'res_eleanor', question }),
  simulate: (kind: 'fall' | 'bathroom' = 'fall', residentId?: string) =>
    post<Alert>('/admin/simulate', { kind, resident_id: residentId ?? 'res_eleanor' }),

  pairBand: (code: string) =>
    post<{ band_id: string; rssi: number }>('/bands/pair', {
      pair_code: code, resident_id: 'res_eleanor',
    }),
  surveyRoom: (zoneId: string) =>
    post<{ survey_id: string; expect_s: number }>(
      '/residents/res_eleanor/fingerprint/start', { zone_id: zoneId, label: zoneId },
    ),
  surveyStop: (surveyId: string) =>
    post<{ n_scans: number; n_anchors: number; separability_db: number; warning: string | null }>(
      '/residents/res_eleanor/fingerprint/stop', { survey_id: surveyId },
    ),
  saveContacts: async (contacts: unknown) => {
    await post('/residents/res_eleanor/contacts', { contacts });
  },
  registerPushToken: async (expoPushToken: string) => {
    await post('/devices/push-token', { expo_push_token: expoPushToken, platform: 'ios' });
  },
};
