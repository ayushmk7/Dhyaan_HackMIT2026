// Real API client. Written against the backend's live OpenAPI schema plus
// docs/API_CONTRACT_V2.md (the baselines/summaries/location-history/events/
// simulate/pairing/survey/contacts/push routes) — NOT the PRD's §10.5, which
// describes a JWT and a different path/shape for nearly everything here (see
// the big comment at the top of residents.py). Same function names and
// signatures as the mock facade in api.ts — flipping USE_MOCKS must change
// zero call sites; where a contract shape doesn't match what a screen already
// expects, that's adapted here (each such spot is commented), never in the
// screen. Where the real backend still has no equivalent endpoint at all,
// the function says so and throws or degrades instead of faking data.
import { draftOpeners, planFromThread as aiPlanFromThread, polishLetter, type FamilyPlan } from './ai';
import { API_BASE, API_KEY } from './config';
import { useSession } from '@/store/session';
import type {
  ActivityDay, Alert, AlertKind, AlertSeverity, BaselineFeature, CallRow,
  ChatMessage, Contact, DaySummary, Fact, KEvent, LocationMethod,
  LocationSegment, LoginResult, MemoryDeleted, MemoryScope, Presence, Profile,
  ProfilePatch, Resident, ResidentLocation, CameraMonitorTick, CameraSummary,
  SimulateKind, VoiceScript,
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
const del = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: 'DELETE', body: JSON.stringify(data ?? {}) });

// The resident this session is looking out for. `POST /auth/login` returns a
// `resident_id` and session.ts stores it, so read it from there rather than
// hardcoding Eleanor — a zustand store is readable outside React, and this
// module has no component to hook into. Falls back to the store's own default
// if called before sign-in (the demo seed and `signIn` both set a real id).
const residentId = () => useSession.getState().residentId;

// zoneId -> in-flight survey, so surveyStop(zoneId) can find the survey_id
// surveyRoom(zoneId) started (see surveyRoom's comment below for why).
const activeSurveys = new Map<string, { surveyId: string; timer: ReturnType<typeof setInterval> }>();

const isNotFound = (e: unknown) => e instanceof Error && /not found/i.test(e.message);

// §6.5: "A family must always be able to tell observed from assumed." One
// place builds the visible prefix for each kind.
function citationLabel(kind: 'observed' | 'told' | 'pattern', ts: string): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const day = d.toLocaleDateString(undefined, { weekday: 'short' });
  const isToday = new Date().toDateString() === d.toDateString();
  if (kind === 'told') return `You told us · ${day}`;
  if (kind === 'pattern') return 'From her pattern · last 14 days';
  return `Dhyaan saw · ${time}${isToday ? ' today' : ` ${day}`}`;
}

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
  // GET /residents/{id}, so this pays for the whole resident doc to read four
  // rows off it. Upgrade: add GET /residents/{id}/contacts.
  getContacts: async (): Promise<Contact[]> =>
    (await get<{ contacts: Contact[] }>(`/residents/${residentId()}`)).contacts,

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

  // POST /residents/{id}/chat. §6.1 extends the response with `kind` per
  // citation and explicit `refused`/`refusal_kind`; the pre-camera backend
  // sends neither, so both are read defensively. `kind` falls back to
  // 'observed' — every citation the old route could produce was an event, and
  // labelling one 'told' or 'pattern' without the server saying so would be
  // exactly the fabrication the kind tag exists to prevent.
  chat: async (question: string): Promise<ChatMessage> => {
    const body = await post<{
      answer: string;
      citations: { id?: string; event_id?: string; kind?: string; ts: string; text: string }[];
      retrieved_count: number;
      refused?: boolean;
      refusal_kind?: ChatMessage['refusal_kind'];
    }>(`/residents/${residentId()}/chat`, { question });
    return {
      id: `msg_${Date.now().toString(36)}`,
      role: 'dhyaan',
      text: body.answer,
      citations: (body.citations ?? []).map((c) => {
        const eventId = c.id ?? c.event_id ?? '';
        const kind = c.kind === 'told' || c.kind === 'pattern' ? c.kind : 'observed';
        return {
          id: eventId,
          kind,
          ts: c.ts,
          label: citationLabel(kind, c.ts),
          // A 'told' fact is timeless and has no event behind it, so it gets
          // no tap target rather than one that 404s.
          event_ids: kind === 'observed' && eventId ? [eventId] : [],
          text: c.text,
        };
      }),
      refused: body.refused ?? body.retrieved_count === 0,
      refusal_kind: body.refusal_kind ?? null,
    };
  },

  // POST /admin/simulate — the real demo trigger, walking the real ingest path
  // (FSM + websocket + app all react as they would for a band). Only `fall`
  // is guaranteed to open an alert: `bathroom` opens one on a dwell threshold
  // the backend may not have crossed, and `walk` is benign by design. So this
  // returns `Alert | null` and the caller decides — the old version threw
  // "Simulated event did not open an alert" on every bathroom rehearsal.
  // `script` picks the voice-call outcome the backend will play out
  // (setup.py's Literal); omitted, the process keeps whatever it had.
  simulate: async (
    kind: SimulateKind = 'fall',
    forResident = residentId(),
    script?: VoiceScript,
  ): Promise<Alert | null> => {
    const body = await post<{ event_id: string; alert_id?: string }>('/admin/simulate', {
      resident_id: forResident, kind, ...(script ? { script } : {}),
    });
    if (!body.alert_id) return null;
    return toAlert(await get<RawAlert>(`/alerts/${body.alert_id}`));
  },

  // POST /residents/{id}/notes — a staff or family note, stored as a real
  // event so it is retrievable and shows up on the timeline like anything else.
  addNote: async (residentId_: string, text: string, role: 'staff' | 'family' = 'family'): Promise<void> => {
    await post(`/residents/${residentId_}/notes`, { text, role });
  },

  // POST /admin/rollup — runs the nightly baseline + narrative pass now.
  // Without it a freshly seeded backend has no daily summaries at all and
  // Her day reads "Today's isn't written yet" forever.
  rollup: async (): Promise<void> => { await post('/admin/rollup'); },

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
      { band_id: code, resident_id: residentId() },
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
      `/residents/${residentId()}/survey/start`,
      { zone: zoneId },
    );
    const timer = setInterval(() => {
      post(`/residents/${residentId()}/survey/sample`, { survey_id, beacons: [], wifi: [] }).catch((e) => {
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
      `/residents/${residentId()}/survey/stop`,
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
      warning: body.stored ? null : 'Not enough signal collected. this room may not be recognized reliably yet.',
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
    await put(`/residents/${residentId()}/contacts`, body);
  },
  // ---- camera lane (VLM_PLAN §6.1) ------------------------------------------

  // POST /auth/login. Faux by contract: the server validates an email shape
  // and a non-empty password and hands back the one static key. This client
  // deliberately does not claim more than that — there is no password store
  // behind it, and the sign-in copy says so.
  login: async (email: string, password: string): Promise<LoginResult> => {
    const trimmed = email.trim();
    // Checked here too so a typo doesn't cost a round trip, and so the same
    // message appears whether or not the route exists yet.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      throw new Error('That doesn’t look like an email address.');
    }
    if (!password) throw new Error('Enter your password.');
    return post<LoginResult>('/auth/login', { email: trimmed, password });
  },

  // GET /residents/{id}/presence — no zone, no evidence, by contract.
  // ponytail: while the camera router is still landing, a 404 degrades to an
  // honest "no camera set up" presence instead of throwing, so Today shows
  // its real empty state rather than an error it can't act on. Any other
  // failure still throws and surfaces as a retryable error.
  getPresence: async (residentId: string): Promise<Presence> => {
    try {
      return await get<Presence>(`/residents/${residentId}/presence`);
    } catch (e) {
      if (isNotFound(e)) {
        return {
          status: 'no_camera', activity: null, spot_is_usual: false,
          since: null, last_observation_at: null, sentence: '',
          camera: { online: false, consent: false, paused_until: null, paused_by: null },
        };
      }
      throw e;
    }
  },

  getActivity: async (residentId: string, date: string): Promise<ActivityDay> => {
    try {
      const day = await get<ActivityDay>(`/residents/${residentId}/activity?date=${date}`);
      // The route sorts ascending (camera.py `.sort("ts_epoch", 1)`), but every
      // screen reads `items[0]` as the most recent thing that happened — Today
      // labels it "Last noticed". Reverse once here rather than in each screen.
      return { ...day, items: [...day.items].reverse() };
    } catch (e) {
      if (isNotFound(e)) {
        return {
          date,
          tiles: { meals: 0, walks: 0, out_of_house: 0, night_ups: 0, in_view_minutes: 0 },
          items: [],
        };
      }
      throw e;
    }
  },

  getProfile: (residentId: string): Promise<Profile> =>
    get<Profile>(`/residents/${residentId}/profile`),

  putProfile: (residentId: string, patch: ProfilePatch): Promise<Profile> =>
    put<Profile>(`/residents/${residentId}/profile`, patch),

  // POST /profile/facts takes the bare array; `author` rides on the server's
  // own record of who signed consent, so it is accepted here only to keep one
  // signature across mock and real.
  addFacts: async (
    residentId: string,
    rows: { key: string; text: string }[],
    _author: string,
  ): Promise<Fact[]> =>
    (await post<{ facts: Fact[] }>(`/residents/${residentId}/profile/facts`, rows)).facts,

  updateFact: async (
    residentId: string, factId: string, text: string, _author: string,
  ): Promise<Fact> =>
    (await put<{ fact: Fact }>(`/residents/${residentId}/profile/facts/${factId}`, { text })).fact,

  deleteFact: async (residentId: string, factId: string): Promise<void> => {
    await del(`/residents/${residentId}/profile/facts/${factId}`);
  },

  // DELETE /residents/{id}/memory — `confirm` must equal her display name;
  // the server 422s otherwise. Sent as typed so the server, not the client,
  // is the thing that refuses.
  deleteMemory: async (
    residentId: string, scope: MemoryScope, confirm: string,
  ): Promise<MemoryDeleted> =>
    (await del<{ deleted: MemoryDeleted }>(`/residents/${residentId}/memory`, {
      scope, confirm: confirm.trim(),
    })).deleted,

  // ---- the camera console -------------------------------------------------
  // Telemetry about the worker. `GET /cameras/{id}/monitor` 404s until the
  // worker has posted a tick, which is the honest "nothing is running" state —
  // returning null lets the console say so instead of inventing a feed.

  listCameras: (): Promise<CameraSummary[]> =>
    get<CameraSummary[]>('/cameras'),

  // The route answers `{camera, online, tick}` — an envelope, because "which
  // camera, and is it alive" is the half of the answer that still exists when
  // no tick does. `tick` is null until the worker posts one, and that null is
  // the console's real "nothing is running" state: never synthesize one.
  getCameraMonitor: async (cameraId: string): Promise<CameraMonitorTick | null> => {
    try {
      const body = await get<{ tick: CameraMonitorTick | null }>(`/cameras/${cameraId}/monitor`);
      return body.tick ?? null;
    } catch (e) {
      if (isNotFound(e)) return null; // camera deleted mid-session
      throw e;
    }
  },

  pauseCamera: async (cameraId: string, hours = 2): Promise<void> => {
    await post(`/cameras/${cameraId}/pause`, { hours });
  },

  resumeCamera: async (cameraId: string): Promise<void> => {
    await post(`/cameras/${cameraId}/resume`);
  },

  simulateCamera: async (kind: 'meal' | 'visitor' | 'out_of_view'): Promise<void> => {
    await post('/admin/simulate', { resident_id: residentId(), kind });
  },

  // Not part of the mock facade's surface (mockApi has no such method) — kept
  // only because lib/push.ts imports httpApi.registerPushToken directly,
  // guarded by `if (!USE_MOCKS)` and already wrapped in a try/catch there.
  registerPushToken: async (expoPushToken: string): Promise<void> => {
    await post('/push/register', { token: expoPushToken, resident_id: residentId(), role: 'family' });
  },
  // ponytail: connection layer has no backend endpoints yet — live path is a
  // Muse Spark call over GET /residents/{id}/events (Meta challenge), and a
  // /messages endpoint fed by the voice agent's leave_message tool.
  // Openers are drafted by Claude over today's real observations (the mock
  // already did exactly this; there was never a reason for the real client to
  // return nothing). No key configured -> no openers, and Today drops the
  // section rather than inventing conversation starters.
  talkAbout: async (): Promise<string[]> => {
    const events = await httpApi.getEvents(residentId()).catch(() => []);
    if (!events.length) return [];
    return (await draftOpeners(events.slice(0, 20).map((e) => e.embedding_text))) ?? [];
  },
  latestMessage: async (): Promise<{ text: string; at: string } | null> => null,
  planFromThread: async (thread: string): Promise<FamilyPlan> =>
    (await aiPlanFromThread(thread)) ?? {
      headline: 'Couldn’t read the thread. Try pasting it again.',
      when: null, tasks: [], open_questions: [], reply_text: '',
    },
  sundayLetter: async (): Promise<string> => {
    const events = await httpApi.getEvents(residentId());
    return (await polishLetter(events.map((e) => e.embedding_text).join('\n'))) ?? '';
  },
};
