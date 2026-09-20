// API facade (TODO D1.1): screens import ONLY this. USE_MOCKS picks the in-memory
// backend or the real client (http.ts) — flipping it changes zero call sites.
import { draftOpeners, planFromThread, polishLetter, type FamilyPlan } from './ai';
import { USE_MOCKS } from './config';
import { httpApi } from './http';
import { mockCamera } from './mock/camera';
import { dhyaan } from './mock/dhyaan';
import type {
  ActivityDay, Alert, ChatMessage, Fact, MemoryDeleted, MemoryScope,
  Presence, Profile, ProfilePatch, SimulateKind, VoiceScript,
} from './types';

// ponytail: simulated latency keeps loading states honest in the demo.
const wait = (ms = 220) => new Promise((r) => setTimeout(r, ms));

const mockApi = {
  async listResidents() { await wait(); return dhyaan.listResidents(); },
  async getResident(id: string) { await wait(); return dhyaan.getResident(id) ?? null; },
  async getEvents(residentId: string) { await wait(300); return dhyaan.getEvents(residentId); },
  // Camera-lane items live in the camera mock, not the seeded world, so the
  // event-detail screen can still open one instead of saying it is gone.
  async getEvent(id: string) {
    await wait(120);
    const seeded = dhyaan.getEvent(id);
    if (seeded) return seeded;
    const item = mockCamera.getItem(id);
    if (!item) return null;
    return {
      id: item.id,
      resident_id: 'res_eleanor',
      source: 'camera' as const,
      type: item.type,
      ts: item.ts,
      ts_end: item.ts_end,
      confidence: item.confidence,
      zone: null, // camera events reach a family screen without one, always
      payload: {},
      embedding_text: item.sentence,
      review_state: 'unreviewed' as const,
    };
  },
  async getSummaries(residentId: string, _days = 14) { await wait(); return dhyaan.getSummaries(residentId); },
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
  // Chat runs through the camera-lane mock: it is the only one that knows the
  // three citation kinds and the §5.5 refusals.
  // The in-memory world holds exactly one resident, so a question about anyone
  // else has no answer here. Refusing is the honest reply — answering about the
  // wrong person is the one failure mode a care app cannot have.
  async chat(question: string, forResident?: string): Promise<ChatMessage> {
    await wait(1100);
    if (forResident && forResident !== 'res_eleanor') {
      return {
        id: `msg_${Date.now().toString(36)}`,
        role: 'dhyaan',
        text: 'Dhyaan can only answer about the person this account looks after.',
        citations: [],
        refused: true,
        refusal_kind: 'no_data',
      };
    }
    return mockCamera.chat(question);
  },
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
      `Asha’s week, from Dhyaan:\n\n${dhyaan.getSummaries('res_eleanor').map((s) => s.narrative).join(' ')}\n\nSent from the Dhyaan family app`
    );
  },
  async simulate(
    kind: SimulateKind = 'fall', residentId?: string, _script?: VoiceScript,
  ): Promise<Alert | null> {
    await wait(150);
    // The in-memory backend only models the fall ladder; a bathroom dwell or a
    // walk opens nothing there, same as they may open nothing for real.
    if (kind !== 'fall') return null;
    return dhyaan.simulate(kind, residentId);
  },

  async addNote(_residentId: string, text: string, role: 'staff' | 'family' = 'family') {
    await wait(200);
    dhyaan.addNote(text, role);
  },

  async getLocation(residentId: string) {
    await wait(120);
    return dhyaan.getResident(residentId)?.location ?? null;
  },

  // No nightly job in the mock — the seeded world already has its summaries.
  async rollup(_residentId?: string, _date?: string) { await wait(300); },

  async listCameras() { await wait(120); return mockCamera.listCameras(); },
  async getCameraMonitor(cameraId: string) { await wait(60); return mockCamera.getMonitor(cameraId); },
  async pauseCamera(_cameraId: string, hours = 2) { await wait(200); mockCamera.pauseCamera(hours); },
  async resumeCamera(_cameraId: string) { await wait(200); mockCamera.resumeCamera(); },

  // Onboarding — mock accepts anything plausible.
  async pairBand(code: string) {
    await wait(900);
    if (code.length !== 6) throw new Error('That code doesn’t look right. It’s 6 digits.');
    return { band_id: 'band_a3f2' };
  },
  async surveyRoom(_zoneId: string) {
    await wait(400);
    return { survey_id: `srv_${Date.now().toString(36)}`, expect_s: 30 };
  },
  async surveyStop(_surveyId: string) {
    await wait(300);
    return { n_scans: 10, warning: null as string | null };
  },
  async saveContacts(_contacts: unknown) { await wait(400); },

  // ---- camera lane (VLM_PLAN §6.1) ------------------------------------------

  async getPresence(_residentId: string): Promise<Presence> {
    await wait(120);
    return mockCamera.getPresence();
  },
  async getActivity(_residentId: string, date: string): Promise<ActivityDay> {
    await wait(180);
    return mockCamera.getActivity(date);
  },
  async getProfile(_residentId: string): Promise<Profile> {
    await wait(150);
    return mockCamera.getProfile();
  },
  async putProfile(_residentId: string, patch: ProfilePatch): Promise<Profile> {
    await wait(250);
    return mockCamera.putProfile(patch);
  },
  async addFacts(_residentId: string, rows: { key: string; text: string }[], author: string): Promise<Fact[]> {
    await wait(300);
    return mockCamera.addFacts(rows, author);
  },
  async updateFact(_residentId: string, factId: string, text: string, author: string): Promise<Fact> {
    await wait(200);
    return mockCamera.updateFact(factId, text, author);
  },
  async deleteFact(_residentId: string, factId: string): Promise<void> {
    await wait(150);
    mockCamera.deactivateFact(factId);
  },
  async deleteMemory(_residentId: string, scope: MemoryScope, confirm: string): Promise<MemoryDeleted> {
    await wait(400);
    // Same typo protection the API applies at the trust boundary (§4.5) —
    // this is irreversible, so the name has to be typed correctly here too.
    if (confirm.trim().toLowerCase() !== mockCamera.getProfile().name.toLowerCase()) {
      throw new Error('That name doesn’t match. Nothing was deleted.');
    }
    return mockCamera.deleteMemory(scope);
  },
  async simulateCamera(kind: 'meal' | 'visitor' | 'out_of_view'): Promise<void> {
    await wait(150);
    mockCamera.simulate(kind);
  },
};

// `Skip setup (dev)` seeds Asha locally and writes nothing to the server.
// Mock-only by design: against a live backend the seeded resident is whatever
// `make seed` put there, so there is nothing for the app to fabricate.
export const seedDemoResident = (author?: string) => {
  if (USE_MOCKS) mockCamera.seedEleanor(author);
};

export const api: typeof mockApi = USE_MOCKS ? mockApi : httpApi;
