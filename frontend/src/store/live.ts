// Everything the websocket owns (§10.3). In mock mode "connect" subscribes to
// the in-memory backend; in http mode it opens the real socket.
import { create } from 'zustand';
import { USE_MOCKS } from '@/lib/config';
import { LiveClient } from '@/lib/live';
import { dhyaan } from '@/lib/mock/dhyaan';
import { queryClient } from '@/lib/queryClient';
import type {
  Alert, CameraMonitorTick, LadderStep, Presence, ResidentLocation, TranscriptLine, WsEnvelope,
} from '@/lib/types';
import type { ResidentState } from '@/theme/tokens';

type DwellWarning = { zone: string; dwell_s: number; escalating: boolean };

type LiveState = {
  status: 'connecting' | 'open' | 'closed';
  states: Record<string, ResidentState>;
  locations: Record<string, ResidentLocation>;
  // VLM_PLAN §6.1: pushed after every observation and heartbeat state change.
  // Today reads this first and falls back to the 15 s GET /presence refetch.
  presence: Record<string, Presence>;
  dwellWarnings: Record<string, DwellWarning>;
  /** camera_id -> the last tick. The console reads this; nothing else does. */
  monitor: Record<string, CameraMonitorTick>;
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
  presence: {},
  dwellWarnings: {},
  monitor: {},
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
    // LiveClient owns the socket: it reconnects with capped exponential
    // backoff and never throws out of onmessage. The raw `new WebSocket` this
    // replaced gave up permanently the first time the Mac's API restarted,
    // which on a demo LAN is every code reload.
    const client = new LiveClient();
    const off = client.subscribe((m) => {
      if (get().status !== 'open') set({ status: 'open' });
      get().applyEvent(m);
    });
    client.connect();
    unsubscribe = () => { off(); client.close(); set({ status: 'closed' }); };
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
      case 'camera.monitor':
        set((st) => ({ monitor: { ...st.monitor, [m.tick.camera_id]: m.tick } }));
        break;
      case 'presence.update':
        set((s) => ({ presence: { ...s.presence, [m.resident_id]: m.presence } }));
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
        // The server pushes every write. Invalidate the two caches an event can
        // change so Her day and Today update while you are looking at them,
        // instead of only on the next foreground. Invalidate, not insert: the
        // server applies the family filter (§6.1), and a client-side insert
        // would be the app deciding what the family may see.
        queryClient.invalidateQueries({ queryKey: ['events', m.event.resident_id] });
        queryClient.invalidateQueries({ queryKey: ['activity', m.event.resident_id] });
        break;
      case 'ping':
        break; // real backend's 25s keepalive — nothing to apply
    }
  },

  clearAlert() { set({ activeAlert: null, ladder: [], transcript: [] }); },
}));
