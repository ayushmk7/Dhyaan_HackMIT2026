// Minimal client for `WS /v1/live` (backend/app/routers/live.py): connects
// with the token query param baked into WS_URL (see config.ts), reconnects
// with capped exponential backoff, and hands parsed messages to subscribers.
//
// store/live.ts owns the single instance. Nothing else should construct one:
// two clients means two sockets and every message applied twice.
import { WS_URL } from './config';
import type { WsEnvelope } from './types';

type Listener = (msg: WsEnvelope) => void;

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 15_000;

// backend/app/routers/live.py sends a keepalive every 25 s, so a socket that
// has said nothing for this long is not quiet, it is gone. A half-open socket
// (wifi dropped, NAT forgot the flow, phone slept) never fires onclose at all,
// and the status this class reports is the only thing standing between the
// family and a screen that looks live over a connection that has not carried a
// byte in minutes.
// ponytail: a server that stays up but stops pinging gets reconnected every
// 45 s. Harmless, and cheaper than a client ping the server must parse.
const SILENCE_MS = 45_000; // two missed keepalives, with room for one slow LAN

export class LiveClient {
  private ws: WebSocket | null = null;
  private readonly listeners = new Set<Listener>();
  private attempt = 0;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;

  // `residentId` mirrors the query param live.py accepts to scope the feed;
  // omit it to get every resident's events, same as store/live.ts does today.
  // `onStatus` is how the socket's state leaves this class at all: the store
  // writes it straight through, and a screen says so.
  constructor(
    private readonly residentId?: string,
    private readonly onStatus?: (open: boolean) => void,
  ) {}

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  private url(): string {
    // WS_URL carries no query string of its own (config.ts: no token, no
    // params), so the first param is a `?`. This was an `&`, which would have
    // handed live.py a param named `&resident_id` the day anything passed one.
    return this.residentId ? `${WS_URL}?resident_id=${encodeURIComponent(this.residentId)}` : WS_URL;
  }

  /** Any frame is proof of life; the deadline moves out. */
  private heard(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => this.ws?.close(), SILENCE_MS);
  }

  private scheduleReconnect(): void {
    if (this.closedByUser) return;
    const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** this.attempt);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private open(): void {
    // Must not crash the app when the backend is absent: any construction or
    // handshake failure falls through to the same backoff-and-retry path
    // instead of throwing out of connect().
    try {
      const ws = new WebSocket(this.url());
      this.ws = ws;
      ws.onopen = () => { this.attempt = 0; this.heard(); this.onStatus?.(true); };
      ws.onmessage = (e) => {
        this.heard();
        let msg: WsEnvelope;
        try {
          msg = JSON.parse(String(e.data));
        } catch {
          return; // malformed frame — drop it, never throw from onmessage
        }
        this.listeners.forEach((fn) => fn(msg));
      };
      ws.onerror = () => { /* onclose always follows; reconnect happens there */ };
      ws.onclose = () => {
        this.ws = null;
        if (this.silenceTimer) clearTimeout(this.silenceTimer);
        this.onStatus?.(false);
        this.scheduleReconnect();
      };
    } catch {
      this.onStatus?.(false);
      this.scheduleReconnect();
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
    this.ws?.close();
    this.ws = null;
  }
}
