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

export class LiveClient {
  private ws: WebSocket | null = null;
  private readonly listeners = new Set<Listener>();
  private attempt = 0;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // `residentId` mirrors the query param live.py accepts to scope the feed;
  // omit it to get every resident's events, same as store/live.ts does today.
  constructor(private readonly residentId?: string) {}

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  private url(): string {
    return this.residentId ? `${WS_URL}&resident_id=${encodeURIComponent(this.residentId)}` : WS_URL;
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
      ws.onopen = () => { this.attempt = 0; };
      ws.onmessage = (e) => {
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
        this.scheduleReconnect();
      };
    } catch {
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
    this.ws?.close();
    this.ws = null;
  }
}
