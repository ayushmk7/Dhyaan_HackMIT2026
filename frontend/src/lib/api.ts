// API facade. Mock today; swap `MODE` to 'http' and fill BASE_URL when the
// Python backend exists — screens and hooks don't change.
import { kestrel } from './mock/kestrel';
import type { Alert, ChatMessage } from './types';

export const MODE: 'mock' | 'http' = 'mock';
export const BASE_URL = 'https://kestrel.example.com/v1'; // cloudflared tunnel

// ponytail: simulated latency keeps loading states honest in the demo.
const wait = (ms = 220) => new Promise((r) => setTimeout(r, ms));

export const api = {
  async listResidents() { await wait(); return kestrel.listResidents(); },
  async getResident(id: string) { await wait(); return kestrel.getResident(id) ?? null; },
  async getEvents(residentId: string) { await wait(300); return kestrel.getEvents(residentId); },
  async getEvent(id: string) { await wait(120); return kestrel.getEvent(id) ?? null; },
  async getSummaries(residentId: string) { await wait(); return kestrel.getSummaries(residentId); },
  async getLocationHistory(residentId: string, date: string) {
    await wait(150);
    return kestrel.getLocationHistory(residentId, date);
  },
  async getBaselines(residentId: string) { await wait(); return kestrel.getBaselines(residentId); },
  async getContacts() { await wait(); return kestrel.getContacts(); },
  async listOpenAlerts() { await wait(100); return kestrel.listOpenAlerts(); },
  async getAlert(id: string) { await wait(100); return kestrel.getAlert(id) ?? null; },

  async ack(alertId: string, by: string) { kestrel.ack(alertId, by); },
  async resolve(alertId: string, resolution: string) { kestrel.resolve(alertId, resolution); },
  async feedback(eventId: string, verdict: 'expected' | 'false_positive', reason?: string) {
    await wait();
    return kestrel.feedback(eventId, verdict, reason);
  },
  async chat(question: string): Promise<ChatMessage> { await wait(1100); return kestrel.chat(question); },
  async simulate(kind: 'fall' | 'bathroom' = 'fall', residentId?: string): Promise<Alert> {
    await wait(150);
    return kestrel.simulate(kind, residentId);
  },

  // Onboarding — mock accepts anything plausible.
  async pairBand(code: string) {
    await wait(900);
    if (code.length !== 6) throw new Error('That code doesn’t look right — it’s 6 digits.');
    return { band_id: 'band_a3f2', rssi: -54 };
  },
  async surveyRoom(_zoneId: string) {
    await wait(400);
    return { survey_id: `srv_${Date.now().toString(36)}`, expect_s: 30 };
  },
  async surveyStop(_surveyId: string) {
    await wait(300);
    return { n_scans: 10, n_anchors: 6, separability_db: 9.2, warning: null as string | null };
  },
  async saveContacts(_contacts: unknown) { await wait(400); },
};
