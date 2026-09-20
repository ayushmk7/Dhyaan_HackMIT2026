// API facade (TODO D1.1): screens import ONLY this. USE_MOCKS picks the in-memory
// backend or the real client (http.ts) — flipping it changes zero call sites.
import { draftOpeners, planFromThread, polishLetter, type FamilyPlan } from './ai';
import { USE_MOCKS } from './config';
import { httpApi } from './http';
import { dhyaan } from './mock/dhyaan';
import type { Alert, ChatMessage } from './types';

// ponytail: simulated latency keeps loading states honest in the demo.
const wait = (ms = 220) => new Promise((r) => setTimeout(r, ms));

const mockApi = {
  async listResidents() { await wait(); return dhyaan.listResidents(); },
  async getResident(id: string) { await wait(); return dhyaan.getResident(id) ?? null; },
  async getEvents(residentId: string) { await wait(300); return dhyaan.getEvents(residentId); },
  async getEvent(id: string) { await wait(120); return dhyaan.getEvent(id) ?? null; },
  async getSummaries(residentId: string) { await wait(); return dhyaan.getSummaries(residentId); },
  async getLocationHistory(residentId: string, date: string) {
    await wait(150);
    return dhyaan.getLocationHistory(residentId, date);
  },
  async getBaselines(residentId: string) { await wait(); return dhyaan.getBaselines(residentId); },
  async getContacts() { await wait(); return dhyaan.getContacts(); },
  async listOpenAlerts() { await wait(100); return dhyaan.listOpenAlerts(); },
  async getAlert(id: string) { await wait(100); return dhyaan.getAlert(id) ?? null; },

  async ack(alertId: string, by: string) { dhyaan.ack(alertId, by); },
  async resolve(alertId: string, resolution: string) { dhyaan.resolve(alertId, resolution); },
  async feedback(eventId: string, verdict: 'expected' | 'false_positive', reason?: string) {
    await wait();
    return dhyaan.feedback(eventId, verdict, reason);
  },
  async chat(question: string): Promise<ChatMessage> { await wait(1100); return dhyaan.chat(question); },
  async talkAbout(): Promise<string[]> {
    // Live Claude over today's real observations when a key exists; mock heuristics otherwise.
    const live = await draftOpeners(dhyaan.getEvents('res_eleanor', 20).map((e) => e.embedding_text));
    if (live) return live;
    await wait(400);
    return dhyaan.talkAbout();
  },
  async latestMessage(): Promise<{ text: string; at: string } | null> { await wait(); return dhyaan.latestMessage(); },
  async planFromThread(thread: string): Promise<FamilyPlan> {
    return (await planFromThread(thread)) ?? dhyaan.planFromThread(thread);
  },
  async sundayLetter(): Promise<string> {
    const draft = dhyaan.sundayLetterDraft();
    return (
      (await polishLetter(draft)) ??
      `Eleanor’s week, from Dhyaan:\n\n${dhyaan.getSummaries('res_eleanor').map((s) => s.narrative).join(' ')}\n\nSent from the Dhyaan family app`
    );
  },
  async simulate(kind: 'fall' | 'bathroom' = 'fall', residentId?: string): Promise<Alert> {
    await wait(150);
    return dhyaan.simulate(kind, residentId);
  },

  // Onboarding — mock accepts anything plausible.
  async pairBand(code: string) {
    await wait(900);
    if (code.length !== 6) throw new Error('That code doesn’t look right. It’s 6 digits.');
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

export const api: typeof mockApi = USE_MOCKS ? mockApi : httpApi;
