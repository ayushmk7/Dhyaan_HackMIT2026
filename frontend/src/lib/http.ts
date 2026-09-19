// Real API client. Written against the backend's live OpenAPI schema plus
// backend/API_CONTRACT_V2.md (the baselines/summaries/location-history/events/
// simulate/pairing/survey/contacts/push routes) — NOT the PRD's §10.5, which
// describes a JWT and a different path/shape for nearly everything here (see
// the big comment at the top of residents.py). Same function names and
// signatures as the mock facade in api.ts — flipping USE_MOCKS must change
// zero call sites; where a contract shape doesn't match what a screen already
// expects, that's adapted here (each such spot is commented), never in the
// screen. Where the real backend still has no equivalent endpoint at all,
// the function says so and throws or degrades instead of faking data.
import { API_BASE, API_KEY } from './config';
import type {
  Alert, AlertKind, AlertSeverity, BaselineFeature, CallRow, ChatMessage,
  Contact, DaySummary, KEvent, LocationMethod, LocationSegment, Resident,
  ResidentLocation,
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
const put = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(data ?? {}) });

// ponytail: every real endpoint added below is scoped to Eleanor —
// backend/scripts/seed.py only seeds her, and every other real function in
// this file already hardcodes the same id (getContacts, chat, getEvent's old
// scan). Not read from session state: session.ts has no resident id field,
// only a display name. Upgrade: thread a real resident id through once
// there's more than one onboarded resident.
const RESIDENT_ID = 'res_eleanor';

// zoneId -> in-flight survey, so surveyStop(zoneId) can find the survey_id
// surveyRoom(zoneId) started (see surveyRoom's comment below for why).
const activeSurveys = new Map<string, { surveyId: string; timer: ReturnType<typeof setInterval> }>();

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

  // GET /events/{event_id} — contract-exact, or null on 404.
  getEvent: async (id: string): Promise<KEvent | null> => {
    const raw = await get<KEvent>(`/events/${id}`).catch((e) => {
      if (isNotFound(e)) return null;
      throw e;
    });
    return raw;
  },

  // GET /residents/{id}/summaries?days=7 — contract-exact shape, just
  // renamed date->date_local on the way in (see types.ts DaySummary).
  getSummaries: async (residentId: string): Promise<DaySummary[]> => {
    const raw = await get<{ date: string; narrative: string; deviations: DaySummary['deviations'] }[]>(
      `/residents/${residentId}/summaries?days=7`,
    );
    return raw.map((s) => ({ date_local: s.date, narrative: s.narrative, deviations: s.deviations }));
  },

  // GET /residents/{id}/location/history?date= — contract sends
  // from/to/seconds; renamed to start/end/s for RoomTimeBar (see types.ts).
  getLocationHistory: async (residentId: string, date: string): Promise<LocationSegment[]> => {
    const raw = await get<{ zone: string; from: string; to: string; seconds: number }[]>(
      `/residents/${residentId}/location/history?date=${date}`,
    );
    return raw.map((s) => ({ zone: s.zone, start: s.from, end: s.to, s: s.seconds }));
  },

  // GET /residents/{id}/baselines — contract-exact fields, plus a derived
  // label/series pair for the sparkline UI (see types.ts BaselineFeature).
  getBaselines: async (residentId: string): Promise<BaselineFeature[]> => {
    const raw = await get<Omit<BaselineFeature, 'label' | 'series'>[]>(`/residents/${residentId}/baselines`);
    return raw.map((b) => ({
      ...b,
      label: locationLabel(b.feature), // reuses the same title-case helper zones use — it's just string formatting
      series: b.last_value == null ? [] : [b.last_value],
    }));
  },

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

  // POST /admin/simulate — the real demo trigger, walking the real ingest
  // path (FSM + websocket + app all react as they would for a band). Not
  // every kind is guaranteed an alert_id (e.g. a plain "walk"); this
  // signature only ever passes fall/bathroom, which the contract's own note
  // says must produce one, so a missing alert_id surfaces as a real error
  // rather than a fabricated Alert card.
  simulate: async (kind: 'fall' | 'bathroom' = 'fall', residentId = RESIDENT_ID): Promise<Alert> => {
    const body = await post<{ event_id: string; alert_id?: string }>('/admin/simulate', {
      resident_id: residentId,
      kind,
    });
    if (!body.alert_id) {
      throw new Error('Simulated event did not open an alert.');
    }
    return toAlert(await get<RawAlert>(`/alerts/${body.alert_id}`));
  },

  // POST /bands/pair — contract body is {band_id, resident_id}, but
  // onboard/pair.tsx only ever collects a 6-digit code shown on the band, no
  // separate band_id field. Treated as the same value (the band's own code
  // *is* its id for pairing purposes here). Contract's `band: {...}` is left
  // unspecified in the doc, so band_id/rssi are read defensively off it
  // with sane fallbacks instead of assuming a shape. Upgrade: nail down
  // `band`'s real fields with the backend and stop guessing.
  pairBand: async (code: string): Promise<{ band_id: string; rssi: number }> => {
    const body = await post<{ ok: boolean; band?: { band_id?: string; id?: string; rssi?: number } }>(
      '/bands/pair',
      { band_id: code, resident_id: RESIDENT_ID },
    );
    return { band_id: body.band?.band_id ?? body.band?.id ?? code, rssi: body.band?.rssi ?? -60 };
  },

  // ponytail: this phone has no BLE radio access, so `surveyRoom` can only
  // ever send wifi readings during the sampling loop below — real per-beacon
  // RSSI (uuid/major/minor) comes from the band's own uplink, not a staff
  // phone. And Expo's managed workflow has no built-in "list nearby wifi APs
  // with RSSI" API either, so even the wifi reading is sent empty rather
  // than faked. Ceiling: a survey run from this app teaches the fingerprint
  // store nothing real yet. Upgrade: wire in a native wifi-scan module (e.g.
  // react-native-wifi-reborn) and fill `wifi` with real {bssid, rssi} pairs.
  //
  // survey/start -> survey/sample (repeated) -> survey/stop is a three-call
  // flow; onboard/survey.tsx only calls surveyRoom(zoneId) then, later,
  // surveyStop(zoneId) — it never drives the sampling loop itself, and it
  // re-passes the *zone id*, not the survey_id /start hands back. So the
  // sampling loop and the zoneId->survey_id mapping both live here.
  surveyRoom: async (zoneId: string): Promise<{ survey_id: string; expect_s: number }> => {
    const { survey_id } = await post<{ survey_id: string; zone: string }>(
      `/residents/${RESIDENT_ID}/survey/start`,
      { zone: zoneId },
    );
    const timer = setInterval(() => {
      post(`/residents/${RESIDENT_ID}/survey/sample`, { survey_id, beacons: [], wifi: [] }).catch((e) => {
        console.warn('survey sample failed', e);
      });
    }, 2000);
    activeSurveys.set(zoneId, { surveyId: survey_id, timer });
    return { survey_id, expect_s: 30 };
  },
  surveyStop: async (
    zoneId: string,
  ): Promise<{ n_scans: number; n_anchors: number; separability_db: number; warning: string | null }> => {
    const active = activeSurveys.get(zoneId);
    activeSurveys.delete(zoneId);
    if (active) clearInterval(active.timer);
    const surveyId = active?.surveyId ?? zoneId; // fallback: caller already held a real survey_id
    const body = await post<{ zone: string; samples: number; stored: boolean }>(
      `/residents/${RESIDENT_ID}/survey/stop`,
      { survey_id: surveyId },
    );
    return {
      n_scans: body.samples,
      // ponytail: the real stop response has no per-anchor breakdown (no BLE
      // beacons from a phone to count) — approximated from sample count so
      // the "N anchors" readout still moves with real activity instead of
      // being a fabricated number. Ceiling: not a real anchor count. Upgrade:
      // have the backend return one, or drop the anchor UI for phone surveys.
      n_anchors: Math.min(6, body.samples),
      separability_db: 0, // not computed over REST — honest zero, not a fabricated confidence score
      warning: body.stored ? null : 'Not enough signal collected — this room may not be recognized reliably yet.',
    };
  },

  // PUT /residents/{id}/contacts — replaces the whole ladder. Contacts.tsx's
  // draft objects carry `phone` (free-typed, may have spaces), not the
  // contract's `phone_e164` — best-effort normalized here rather than
  // rejected, since there's no client-side validation UI to send the user
  // back to.
  saveContacts: async (contacts: unknown): Promise<void> => {
    const drafts = contacts as { name: string; phone: string; relationship: string; ladder_order: number }[];
    const body = drafts.map((c) => ({
      name: c.name,
      phone_e164: c.phone.replace(/[^\d+]/g, ''),
      relationship: c.relationship,
      ladder_order: c.ladder_order,
    }));
    await put(`/residents/${RESIDENT_ID}/contacts`, body);
  },
  // Not part of the mock facade's surface (mockApi has no such method) — kept
  // only because lib/push.ts imports httpApi.registerPushToken directly,
  // guarded by `if (!USE_MOCKS)` and already wrapped in a try/catch there.
  registerPushToken: async (expoPushToken: string): Promise<void> => {
    await post('/push/register', { token: expoPushToken, resident_id: RESIDENT_ID, role: 'family' });
  },
};
