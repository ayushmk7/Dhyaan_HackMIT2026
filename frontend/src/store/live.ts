// Everything the websocket owns (§10.3). In mock mode "connect" subscribes to
// the in-memory backend; in http mode it opens the real socket.
import { create } from 'zustand';
import { USE_MOCKS } from '@/lib/config';
import { toAlert } from '@/lib/http';
import { LiveClient } from '@/lib/live';
import { dhyaan } from '@/lib/mock/dhyaan';
import { queryClient } from '@/lib/queryClient';
import type {
  Alert, CameraMonitorTick, LadderStep, Presence, ResidentLocation, TranscriptLine, WsEnvelope,
} from '@/lib/types';
import type { ResidentState } from '@/theme/tokens';

type LiveState = {
  status: 'connecting' | 'open' | 'closed';
  states: Record<string, ResidentState>;
  locations: Record<string, ResidentLocation>;
  // VLM_PLAN §6.1: pushed after every observation and heartbeat state change.
  // Today reads this first and falls back to the 15 s GET /presence refetch.
  presence: Record<string, Presence>;
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

// REST alerts go through `toAlert`; socket alerts used to skip it entirely and
// land in the store as the raw Mongo document. That is how the takeover got
// stuck open: `closed_at` and `calls` are shaped by that function, and the
// reducer below decides whether to dismiss on `closed_at`. The mock emits
// already-shaped alerts, so it passes them straight through.
const shapeAlert = (a: Alert): Alert => (USE_MOCKS ? a : toAlert(a as never));

// Mirrors MONITOR_STALE_S in backend/app/routers/camera.py. Keep in sync.
const MONITOR_STALE_MS = 15_000;
const staleTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Drop a camera's tick once it stops being live. Each new tick pushes the
 *  deadline out, so a healthy worker never trips it. */
function expireTick(cameraId: string, set: (fn: (s: LiveState) => Partial<LiveState>) => void) {
  clearTimeout(staleTimers.get(cameraId));
  staleTimers.set(cameraId, setTimeout(() => {
    staleTimers.delete(cameraId);
    set((st) => {
      const { [cameraId]: _gone, ...rest } = st.monitor;
      return { monitor: rest };
    });
  }, MONITOR_STALE_MS));
}

export const useLive = create<LiveState>((set, get) => ({
  status: 'closed',
  states: {},
  locations: {},
  presence: {},
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
      case 'alert.opened': {
        const a = shapeAlert(m.alert);
        set({ activeAlert: a, ladder: [...(a.ladder ?? [])], transcript: [] });
        break;
      }
      // Real backend (backend/app/routers/live.py) only ever sends this one —
      // the whole current alert doc, on open/ack/resolve alike — never the
      // mock's separate opened/ladder/voice/closed messages. Treat it as
      // "this is the current truth" so a live alert on a real backend still
      // opens the takeover and still closes it.
      case 'alert.update': {
        const a = shapeAlert(m.alert);
        set((s) => ({
          activeAlert: a.closed_at ? (s.activeAlert?.id === a.id ? null : s.activeAlert) : a,
          ladder: a.closed_at ? s.ladder : [...(a.ladder ?? [])],
        }));
        break;
      }
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
      case 'camera.monitor': {
        // The server spreads the tick into the envelope rather than nesting it
        // (`{"t": "camera.monitor", **tick}`), so strip the discriminator back
        // off to store a clean tick.
        const { t: _t, ...tick } = m;
        set((st) => ({ monitor: { ...st.monitor, [tick.camera_id]: tick } }));
        // A tick is live telemetry, not a record: when the worker dies the
        // pushes simply stop, and without this the console would keep showing
        // that last confident "12 fps" forever. The hub drops ticks older than
        // MONITOR_STALE_S (15 s) on the read path; this is the same rule on the
        // push path, so both agree on when there is nothing to show.
        expireTick(tick.camera_id, set);
        break;
      }
      case 'presence.update':
        set((s) => ({ presence: { ...s.presence, [m.resident_id]: m.presence } }));
        break;
      case 'location.changed':
        set((s) => ({ locations: { ...s.locations, [m.resident_id]: m.location } }));
        break;
      case 'location.dwell':
        // Nothing emits this on either backend, and nothing read the store slot
        // it used to fill. Kept as an explicit no-op rather than deleted from
        // the union: the PRD still specifies the message, and a silent
        // `default` would swallow a real one if it ever starts arriving.
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
