// Real API client. Written against the backend's live OpenAPI schema and
// backend/app/routers/{residents,chat,live}.py — NOT the PRD's §10.5, which
// describes a JWT and a different path/shape for nearly everything here (see
// the big comment at the top of residents.py). Same function names and
// signatures as the mock facade in api.ts — flipping USE_MOCKS must change
// zero call sites; where the real backend has no equivalent endpoint at all,
// each function says so and throws or degrades instead of faking data.
import { API_BASE, API_KEY } from './config';
import type {
  Alert, AlertKind, AlertSeverity, BaselineFeature, CallRow, ChatMessage,
  Contact, DaySummary, KEvent, LocationMethod, LocationSegment, Resident,
  ResidentLocation, TileState,
} from './types';

// ---------------------------------------------------------------------------
// transport
// ---------------------------------------------------------------------------

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`, // static shared key — see config.ts
      ...init?.headers,
    },
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    // Real backend is plain FastAPI: {"detail": "message"} or, on a 422,
    // {"detail": [{"msg": "...", ...}, ...]}. The PRD's §10.5 {error:{message}}
    // envelope doesn't exist anywhere server-side — handled too in case that
    // ever changes, so this parse stays correct either way.
    const detail = body?.detail;
    const message =
      (typeof detail === 'string' && detail) ||
      (Array.isArray(detail) && detail.map((d) => d?.msg).filter(Boolean).join('; ')) ||
      body?.error?.message ||
      `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(data ?? {}) });

const isNotFound = (e: unknown) => e instanceof Error && /not found/i.test(e.message);

// ---------------------------------------------------------------------------
// shared shaping helpers (real wire shapes -> app types)
// ---------------------------------------------------------------------------

// ponytail: neither GET /residents nor GET /residents/{id}/location send a
// display label, only the raw zone slug — derive one client-side so
// floor.tsx / resident/[id].tsx (which read `location.label`) keep working.
// Upgrade: have the backend send a human label.
function locationLabel(zone: string): string {
  return zone.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

interface RawLocation {
  zone: string | null;
  since: string | null;
  confidence: number | null;
  method: string | null;
}

function toLocation(raw: RawLocation | null | undefined): ResidentLocation | null {
  if (!raw || !raw.zone) return null;
  return {
    zone: raw.zone,
    label: locationLabel(raw.zone),
    since: raw.since ?? '',
    confidence: raw.confidence,
    method: raw.method as LocationMethod | null,
  };
}

// ponytail: the wire format has no `closed: bool` — this mirrors
// backend/app/routers/residents.py's `_terminal_states()` by hand (its
// fallback set + the router's own MANUALLY_RESOLVED addition). Keep in sync;
// upgrade by having the API return `closed`/`closed_at` directly.
const TERMINAL_ALERT_STATES = new Set([
  'RESOLVED_OK', 'CANCELLED', 'ACKNOWLEDGED', 'EXHAUSTED', 'MANUALLY_RESOLVED',
]);

interface RawAlert {
  id: string;
  resident_id: string;
  trigger_event_id?: string;
  kind: string;
  severity: string;
  state: string;
  resolution: string | null;
  resident_call_attempts?: number;
  opened_at: string;
  updated_at?: string;
  resolved_at?: string;
  resident_name?: string;
  room?: string | null;
  trigger_event?: KEvent | null;
  calls?: KEvent[]; // raw voice-source events — see toCallRow
}

// ponytail: real voice.py only ever emits `{to, role, alert_id, call_sid}` —
// no transcript, duration, or classification. Project the real fields we do
// have into CallRow's shape and leave the rest empty/null (honest: "no
// transcript exists yet", not a fabricated conversation).
function toCallRow(e: KEvent): CallRow {
  const payload = e.payload as { role?: string; classification?: string; duration_s?: number };
  const role = payload.role;
  const knownRole = role === 'resident' || role === 'contact_1' || role === 'contact_2' || role === 'staff';
  return {
    role: knownRole ? (role as CallRow['role']) : 'staff',
    classification: payload.classification ?? null,
    transcript: [],
    duration_s: payload.duration_s ?? null,
  };
}

function toAlert(raw: RawAlert): Alert {
  return {
    ...raw,
    kind: raw.kind as AlertKind,
    severity: raw.severity as AlertSeverity,
    closed_at: TERMINAL_ALERT_STATES.has(raw.state) ? raw.resolved_at ?? raw.updated_at ?? null : null,
    acked_by: null, // real backend never persists/returns who acked — see types.ts
    ladder: [], // real backend has no ladder history over REST — see types.ts
    calls: (raw.calls ?? []).map(toCallRow),
  };
}

interface RawResidentListItem {
  id: string;
  display_name: string;
  room: string | null;
  state: string;
  battery_pct: number | null;
  last_seen: string | null;
  location: RawLocation | null;
  open_alert: RawAlert | null;
}

function toResident(raw: RawResidentListItem): Resident {
  return {
    id: raw.id,
    display_name: raw.display_name,
    room: raw.room,
    state: raw.state as Resident['state'],
    last_seen: raw.last_seen,
    band_battery_pct: raw.battery_pct, // real field is `battery_pct`; renamed for existing call sites
    location: toLocation(raw.location),
    open_alerts: raw.open_alert ? 1 : 0,
    // baseline_ready intentionally left unset — see types.ts, no such field exists.
  };
}

interface RawDayRollup {
  date: string;
  meal_count: number;
  walk_count: number;
  night_bed_exits: number;
  room_time_s: Record<string, number>;
}

function tile(ok: boolean, detail: string): TileState {
  return { state: ok ? 'ok' : 'warn', detail };
}

// ponytail: GET /day gives raw counts only — no narrative, no deviations
// (those exist, but only behind POST /admin/rollup, which also re-runs the
// LLM narrative and rewrites baseline.py's rollup state; too slow and too
// mutating to call once per day for a 6-day-back scan). Build a plain-facts
// summary from the real counts instead of an LLM narrative, and report zero
// deviations honestly rather than inventing any. Upgrade: cache
// admin/rollup's real narrative+deviations server-side and serve them here
// read-only.
function toDaySummary(day: RawDayRollup): DaySummary {
  const topZone = Object.entries(day.room_time_s).sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    date_local: day.date,
    narrative: `${day.meal_count} meal(s) observed, ${day.walk_count} walk(s) completed, ${day.night_bed_exits} night bed exit(s).`,
    tiles: {
      ate: tile(day.meal_count >= 2, `${day.meal_count} meal(s) observed`),
      walked: tile(day.walk_count >= 1, `${day.walk_count} walk(s) completed`),
      night: tile(day.night_bed_exits === 0, `${day.night_bed_exits} night bed exit(s)`),
      location: topZone
        ? { state: 'ok', detail: `Mostly in the ${locationLabel(topZone).toLowerCase()}` }
        : { state: 'unknown', detail: 'No location data yet' },
    },
    deviations: [],
  };
}

// ---------------------------------------------------------------------------
// client
// ---------------------------------------------------------------------------

export const httpApi = {
  listResidents: async (): Promise<Resident[]> =>
    (await get<RawResidentListItem[]>('/residents')).map(toResident),

  getResident: async (id: string): Promise<Resident | null> => {
    // ponytail: GET /residents/{id} only returns identity/consent/contacts —
    // the state/location/battery fields resident-detail screens read
    // (resident.state, resident.location, resident.band_battery_pct) live
    // only in the bulk GET /residents projection. Reuse listResidents and
    // filter instead of merging two different response shapes. Ceiling: an
    // O(n) scan and a full-roster fetch per single-resident lookup — fine at
    // demo headcount. Upgrade: have GET /residents/{id} include the same
    // status fields the list endpoint already computes.
    const rows = await httpApi.listResidents();
    return rows.find((r) => r.id === id) ?? null;
  },

  getEvents: (residentId: string) =>
    get<KEvent[]>(`/residents/${residentId}/timeline?limit=200`),

  // ponytail: no GET /events/{id} exists — scan Eleanor's recent timeline
  // (the only resident backend/scripts/seed.py seeds). Ceiling: misses
  // events past the 200-row page and can't resolve another resident's event
  // id at all. Upgrade: add GET /v1/events/{id} server-side.
  getEvent: async (id: string) => {
    const events = await get<KEvent[]>('/residents/res_eleanor/timeline?limit=200');
    return events.find((e) => e.id === id) ?? null;
  },

  getSummaries: async (residentId: string): Promise<DaySummary[]> => {
    const days: DaySummary[] = [];
    for (let d = 1; d <= 6; d++) {
      const date = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
      const day = await get<RawDayRollup | null>(`/residents/${residentId}/day?date=${date}`).catch(() => null);
      if (day) days.push(toDaySummary(day));
    }
    return days;
  },

  // ponytail: no location-history endpoint — GET /day folds a whole day's
  // room time into totals with no timestamps, and GET /location only knows
  // the current zone. Reconstruct segments client-side from the timeline's
  // zone-bearing events, the same single-forward-pass trick day_rollup takes
  // server-side for room_time_s. Ceiling: capped at the timeline's 200-row
  // max, and a sensor gap gets attributed to whichever zone was last seen.
  // Upgrade: add GET /residents/{id}/location/history?date=.
  getLocationHistory: async (residentId: string, date: string): Promise<LocationSegment[]> => {
    const sinceEpoch = Math.floor(new Date(`${date}T00:00:00`).getTime() / 1000);
    const nextDayEpoch = sinceEpoch + 86_400;
    const events = await get<KEvent[]>(`/residents/${residentId}/timeline?since=${sinceEpoch}&limit=200`);
    const zoned = events
      .filter((e): e is KEvent & { zone: string } => !!e.zone)
      .sort((a, b) => (a.ts_epoch ?? 0) - (b.ts_epoch ?? 0));
    return zoned.map((e, i) => {
      const startEpoch = e.ts_epoch ?? Math.floor(new Date(e.ts).getTime() / 1000);
      const next = zoned[i + 1];
      const endEpoch = next ? next.ts_epoch ?? startEpoch : nextDayEpoch;
      return {
        zone: e.zone,
        start: e.ts,
        end: next?.ts ?? new Date(nextDayEpoch * 1000).toISOString(),
        s: Math.max(0, endEpoch - startEpoch),
      };
    });
  },

  // ponytail: no baselines/sparkline endpoint — baseline.py writes aggregate
  // rollup docs consumed by rag.daily_narrative, nothing per-feature is
  // exposed over HTTP. Staff sparklines stay empty against the real backend.
  // Upgrade: add GET /residents/{id}/baselines.
  getBaselines: async (_residentId: string): Promise<BaselineFeature[]> => [],

  // ponytail: no standalone contacts endpoint — contacts are embedded in
  // GET /residents/{id}. Hardcoded to res_eleanor, matching the mock facade's
  // own single-resident assumption. Upgrade: add GET /residents/{id}/contacts.
  getContacts: async (): Promise<Contact[]> =>
    (await get<{ contacts: Contact[] }>('/residents/res_eleanor')).contacts,

  listOpenAlerts: async (): Promise<Alert[]> =>
    (await get<RawAlert[]>('/alerts?state=open')).map(toAlert),

  getAlert: async (id: string): Promise<Alert | null> => {
    const raw = await get<RawAlert>(`/alerts/${id}`).catch((e) => {
      if (isNotFound(e)) return null;
      throw e;
    });
    return raw ? toAlert(raw) : null;
  },

  ack: async (alertId: string, by: string): Promise<void> => {
    await post(`/alerts/${alertId}/ack`, { by, channel: 'app' });
  },

  resolve: async (alertId: string, resolution: string): Promise<void> => {
    // Server validates `resolution` against a strict enum (ok/fell_ok/ems/
    // false_positive/timeout) and 422s otherwise — that's the trust-boundary
    // check; the error message survives via request()'s parsing above.
    await post(`/alerts/${alertId}/resolve`, { resolution });
  },

  // ponytail: real feedback is POST /alerts/{alert_id}/feedback → {ok,
  // feedback_event_id} — nothing like the mock's {downweighted,
  // suppress_until, verdict}. The one call site
  // (app/(family)/timeline/[eventId].tsx) ignores the return value, so this
  // shapes a compatible stand-in instead of the real body; don't build new
  // features on downweighted/suppress_until, they're not real. Also: that
  // call site passes an EVENT id, but the real route is keyed by ALERT id
  // (it looks up the alert's single trigger_event_id internally) — this
  // 404s unless the id given also happens to be an open alert's id. Upgrade:
  // add a real per-event feedback route, or thread the owning alert id
  // through from the timeline screen.
  feedback: async (
    eventId: string,
    verdict: 'expected' | 'false_positive',
    reason?: string,
  ): Promise<{ downweighted: string[]; suppress_until: string; verdict: 'expected' | 'false_positive' }> => {
    await post(`/alerts/${eventId}/feedback`, { verdict, reason, scope: 'day' });
    return { downweighted: [], suppress_until: '', verdict };
  },

  chat: async (question: string): Promise<ChatMessage> => {
    const body = await post<{
      answer: string;
      citations: { event_id: string; ts: string; text: string }[];
      retrieved_count: number;
    }>('/residents/res_eleanor/chat', { question });
    return {
      id: `msg_${Date.now().toString(36)}`,
      role: 'dhyaan',
      text: body.answer,
      citations: body.citations.map((c) => ({
        id: c.event_id,
        kind: 'event',
        ts: c.ts,
        label: new Date(c.ts).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }),
        event_ids: [c.event_id],
      })),
      refused: body.retrieved_count === 0,
    };
  },

  // ponytail: no POST /admin/simulate, and the only real trigger path
  // (POST /v1/ingest/band, fall_suspected payload) needs the band's own
  // shared secret (X-Band-Key) — a second static key this client doesn't
  // carry, and not worth adding just for a staff demo button. Throwing
  // rather than fabricating a fake Alert: a fake "fall" card is actively
  // misleading in a fall-detection app. Upgrade: add a demo-only
  // POST /admin/simulate authed with the app's own API key.
  simulate: async (_kind: 'fall' | 'bathroom' = 'fall', _residentId?: string): Promise<Alert> => {
    throw new Error('Simulating an alert needs the real band hardware — not available in this build.');
  },

  // ponytail: none of the four below exist on the real backend — band
  // pairing and RF fingerprinting are backend/app/routers/ingest.py's job,
  // driven by the physical band/AP, not a staff phone tapping through
  // onboarding, and there's no contacts-write or push-token route either.
  // Throwing rather than faking success so onboarding visibly stops instead
  // of pretending a band paired that didn't. Upgrade: add
  // POST /bands/pair, /residents/{id}/fingerprint/start|stop,
  // POST /residents/{id}/contacts, and POST /devices/push-token.
  pairBand: async (_code: string): Promise<{ band_id: string; rssi: number }> => {
    throw new Error('Band pairing needs a real endpoint — not available in this build.');
  },
  surveyRoom: async (_zoneId: string): Promise<{ survey_id: string; expect_s: number }> => {
    throw new Error('Room survey needs a real endpoint — not available in this build.');
  },
  surveyStop: async (
    _surveyId: string,
  ): Promise<{ n_scans: number; n_anchors: number; separability_db: number; warning: string | null }> => {
    throw new Error('Room survey needs a real endpoint — not available in this build.');
  },
  saveContacts: async (_contacts: unknown): Promise<void> => {
    throw new Error('Saving contacts needs a real endpoint — not available in this build.');
  },
  // Not part of the mock facade's surface (mockApi has no such method) — kept
  // only because lib/push.ts imports httpApi.registerPushToken directly,
  // guarded by `if (!USE_MOCKS)` and already wrapped in a try/catch there.
  registerPushToken: async (_expoPushToken: string): Promise<void> => {
    throw new Error('Push token registration needs a real endpoint — not available in this build.');
  },
};
