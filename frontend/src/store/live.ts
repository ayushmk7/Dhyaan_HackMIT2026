// Everything the websocket owns (§10.3). In mock mode "connect" subscribes to
// the in-memory backend; in http mode it opens the real socket.
import { create } from 'zustand';
import { MODE, BASE_URL } from '@/lib/api';
import { dhyaan } from '@/lib/mock/dhyaan';
import type { Alert, LadderStep, ResidentLocation, TranscriptLine, WsEnvelope } from '@/lib/types';
import type { ResidentState } from '@/theme/tokens';

type LiveState = {
  status: 'connecting' | 'open' | 'closed';
  states: Record<string, ResidentState>;
  locations: Record<string, ResidentLocation>;
  activeAlert: Alert | null;
  ladder: LadderStep[];
  transcript: TranscriptLine[];
  connect(): void;
  applyEvent(m: WsEnvelope): void;
  clearAlert(): void;
};

let unsubscribe: (() => void) | null = null;

export const useLive = create<LiveState>((set, get) => ({
  status: 'closed',
  states: {},
  locations: {},
  activeAlert: null,
  ladder: [],
  transcript: [],

  connect() {
    if (unsubscribe) return;
    set({ status: 'connecting' });
    if (MODE === 'mock') {
      unsubscribe = dhyaan.subscribe((m) => get().applyEvent(m));
      set({ status: 'open' });
      return;
    }
    const ws = new WebSocket(`${BASE_URL.replace('https', 'wss')}/ws`);
    ws.onopen = () => set({ status: 'open' });
    ws.onclose = () => { set({ status: 'closed' }); unsubscribe = null; };
    ws.onmessage = (e) => get().applyEvent(JSON.parse(String(e.data)));
    unsubscribe = () => ws.close();
  },

  applyEvent(m) {
    switch (m.t) {
      case 'alert.opened':
        set({ activeAlert: m.alert, ladder: [...m.alert.ladder], transcript: [] });
        break;
      case 'alert.ladder':
        set((s) => ({ ladder: [...s.ladder, m.step] }));
        break;
      case 'alert.voice':
        set((s) => ({ transcript: [...s.transcript, { speaker: m.speaker, text: m.text }] }));
        break;
      case 'alert.closed':
        set((s) => ({
          activeAlert: s.activeAlert && s.activeAlert.id === m.alert_id ? null : s.activeAlert,
        }));
        break;
      case 'location.changed':
        set((s) => ({ locations: { ...s.locations, [m.resident_id]: m.location } }));
        break;
      case 'resident.state':
        set((s) => ({ states: { ...s.states, [m.resident_id]: m.state } }));
        break;
      case 'event.new':
        break; // timeline refetches on foreground; mock demo doesn't need live insert
    }
  },

  clearAlert() { set({ activeAlert: null, ladder: [], transcript: [] }); },
}));
