// Everything the websocket owns (§10.3). In mock mode "connect" subscribes to
// the in-memory backend; in http mode it opens the real socket.
import { create } from 'zustand';
import { USE_MOCKS, WS_URL } from '@/lib/config';
import { dhyaan } from '@/lib/mock/dhyaan';
import type { Alert, LadderStep, ResidentLocation, TranscriptLine, WsEnvelope } from '@/lib/types';
import type { ResidentState } from '@/theme/tokens';

type DwellWarning = { zone: string; dwell_s: number; escalating: boolean };

type LiveState = {
  status: 'connecting' | 'open' | 'closed';
  states: Record<string, ResidentState>;
  locations: Record<string, ResidentLocation>;
  dwellWarnings: Record<string, DwellWarning>;
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
  dwellWarnings: {},
  activeAlert: null,
  ladder: [],
  transcript: [],

  connect() {
    if (unsubscribe) return;
    set({ status: 'connecting' });
    if (USE_MOCKS) {
      unsubscribe = dhyaan.subscribe((m) => get().applyEvent(m));
      set({ status: 'open' });
      return;
    }
    const ws = new WebSocket(WS_URL);
    // §10.5: server→client only; the client pings every 25 s to keep the tunnel warm.
    let ping: ReturnType<typeof setInterval> | null = null;
    ws.onopen = () => {
      set({ status: 'open' });
      ping = setInterval(() => ws.send(JSON.stringify({ t: 'ping' })), 25_000);
    };
    ws.onclose = () => {
      if (ping) clearInterval(ping);
      set({ status: 'closed' });
      unsubscribe = null;
    };
    ws.onmessage = (e) => get().applyEvent(JSON.parse(String(e.data)));
    unsubscribe = () => {
      if (ping) clearInterval(ping);
      ws.close();
    };
  },

  applyEvent(m) {
    switch (m.t) {
      case 'alert.opened':
        set({ activeAlert: m.alert, ladder: [...(m.alert.ladder ?? [])], transcript: [] });
        break;
      // Real backend (backend/app/routers/live.py) only ever sends this one —
      // the whole current alert doc, on open/ack/resolve alike — never the
      // mock's separate opened/ladder/voice/closed messages. Treat it as
      // "this is the current truth" so a live alert on a real backend still
      // opens the takeover and still closes it.
      case 'alert.update':
        set((s) => ({
          activeAlert: m.alert.closed_at
            ? (s.activeAlert?.id === m.alert.id ? null : s.activeAlert)
            : m.alert,
          ladder: m.alert.closed_at ? s.ladder : [...(m.alert.ladder ?? [])],
        }));
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
      case 'location.dwell':
        set((s) => ({
          dwellWarnings: {
            ...s.dwellWarnings,
            [m.resident_id]: { zone: m.zone, dwell_s: m.dwell_s, escalating: m.escalating },
          },
        }));
        break;
      case 'resident.state':
        set((s) => ({ states: { ...s.states, [m.resident_id]: m.state } }));
        break;
      case 'event.new':
        break; // timeline refetches on foreground; mock demo doesn't need live insert
      case 'ping':
        break; // real backend's 25s keepalive — nothing to apply
    }
  },

  clearAlert() { set({ activeAlert: null, ladder: [], transcript: [] }); },
}));
