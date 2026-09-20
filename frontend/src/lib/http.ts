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
import { family } from './copy/family';
import { scrubRooms } from './format';
import { useSession } from '@/store/session';
import type {
  ActivityDay, Alert, AlertKind, AlertSeverity, BaselineFeature, CallRow,
  ChatMessage, Contact, DaySummary, Fact, KEvent, LadderStep, LocationMethod,
  TranscriptLine,
  LocationSegment, MemoryDeleted, MemoryScope, Presence, Profile,
  ProfilePatch, Resident, ResidentLocation, CameraMonitorTick, CameraSummary,
  SimulateKind, VoiceScript,
} from './types';

// ---------------------------------------------------------------------------
// transport
// ---------------------------------------------------------------------------

/**
 * Every request times out. React Native's `fetch` has no default deadline, so a
 * host that accepts nothing (the usual cause: a phone pointed at `localhost`,
 * which is the phone, not the Mac) leaves the promise pending forever. React
 * Query then sits in `isPending` and the screen shows its loading state for
 * good — "Checking on Eleanor…" with no way out and nothing in the logs.
 *
 * Ten seconds, and the failure names the address it could not reach, because
 * "Couldn't reach Dhyaan" without the URL tells nobody which of the four
 * plausible causes it was.
 */
const TIMEOUT_MS = 10_000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: abort.signal,
      headers: {
        'Content-Type': 'application/json',
        // The deployed backend generation may still check this shared key; the
        // no-auth HEAD backend ignores it. Unconditional, so either answers.
        Authorization: `Bearer ${API_KEY}`,
        ...init?.headers,
      },
    });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'AbortError';
    throw new Error(
      timedOut
        ? `Dhyaan didn't answer at ${API_BASE}. Is the backend running, and can this device reach that address?`
        : `Couldn't reach Dhyaan at ${API_BASE}. ${e instanceof Error ? e.message : ''}`.trim(),
    );
  } finally {
    clearTimeout(timer);
  }
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

// The resident this session is looking out for. session.ts holds it (the
// seed's one resident, or whatever the demo session set), so read it from
// there rather than hardcoding Eleanor — a zustand store is readable outside
// React, and this module has no component to hook into.
const residentId = () => useSession.getState().residentId;

// Her day, not UTC's. Mirrors `localDayKey` in hooks.ts; kept here so the
// transport layer doesn't import the hooks module for a date format.
const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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

// The API now sends `closed_at` itself (residents.py `_closed_at`), so this
// set is only the fallback for a payload that predates it — the websocket and
// REST both go through the server's one shaper now. Kept rather than deleted
// because an alert that fails to read as closed leaves the full-screen
// takeover stuck on the phone, and that is the wrong thing to be brave about.
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
  calls?: RawCall[]; // `calls` docs, or voice events — see toCallRow
  closed_at?: string | null; // server-computed; see toAlert
  cancel_window_s?: number;
  ladder?: LadderStep[]; // replayed from events by residents.py `_ladder_step`
}

// A call row, from either of the two shapes `alert_response` can send.
//
// `db().calls` is the real one now (app/voice.py's stub and the Twilio adapter
// both write it): top-level `role`, `simulated`, and a `transcript` of
// `{role, content}` turns. The old shape — reconstructed from voice-source
// events when an alert predates that collection — carries the same facts under
// `payload`. This used to read only `payload.role` and hardcode
// `transcript: []`, so every real call rendered as role "staff" with no words,
// and the takeover's "What the call is hearing" panel never appeared even
// though the backend had the transcript sitting there.
const CALL_ROLES = ['resident', 'contact', 'contact_final', 'contact_1', 'contact_2', 'staff'] as const;
const SPEAKERS = ['agent', 'resident', 'contact', 'system'] as const;

interface RawCall {
  role?: string;
  classification?: string | null;
  duration_s?: number | null;
  transcript?: { role?: string; speaker?: string; content?: string; text?: string }[];
  payload?: { role?: string; classification?: string; duration_s?: number };
}

function toCallRow(e: RawCall): CallRow {
  const p = e.payload ?? {};
  const role = e.role ?? p.role;
  const speaker = (r: string | undefined): TranscriptLine['speaker'] =>
    (SPEAKERS as readonly string[]).includes(r ?? '')
      ? (r as TranscriptLine['speaker'])
      // The bridge speaks OpenAI's vocabulary; voice.py speaks ours.
      : r === 'assistant' ? 'agent' : r === 'user' ? 'resident' : 'system';
  return {
    role: (CALL_ROLES as readonly string[]).includes(role ?? '')
      ? (role as CallRow['role'])
      : 'staff',
    classification: e.classification ?? p.classification ?? null,
    transcript: (e.transcript ?? [])
      .map((t) => ({ speaker: speaker(t.role ?? t.speaker), text: t.content ?? t.text ?? '' }))
      .filter((t) => !!t.text),
    duration_s: e.duration_s ?? p.duration_s ?? null,
  };
}

export function toAlert(raw: RawAlert): Alert {
  return {
    ...raw,
    kind: raw.kind as AlertKind,
    severity: raw.severity as AlertSeverity,
    // Prefer the server's own answer; derive only if it didn't send one.
    closed_at: raw.closed_at !== undefined
      ? raw.closed_at
      : TERMINAL_ALERT_STATES.has(raw.state) ? raw.resolved_at ?? raw.updated_at ?? null : null,
    acked_by: null, // real backend never persists/returns who acked — see types.ts
    // The ladder is replayed from the transition events the FSM already
    // writes (PRD §4.3), so the takeover's phase machine runs against a live
    // backend now. Empty array, not undefined: every call site spreads it.
    ladder: raw.ladder ?? [],
    calls: (raw.calls ?? []).map(toCallRow),
  };
}

interface RawResidentListItem {
  id: string;
  display_name: string;
  phone_e164: string | null;
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
    phone_e164: raw.phone_e164 ?? null,
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

  // GET /residents/{id}/summaries — contract-exact shape, just
  // renamed date->date_local on the way in (see types.ts DaySummary).
  // 14 days, not 7: the timeline pages backwards a day at a time, and the
  // baseline learner's own window is 14. The route now keys one story per day
  // and sorts by the day it describes, so a wider window is just more days
  // rather than an arbitrary slice.
  getSummaries: async (residentId: string, days = 14): Promise<DaySummary[]> => {
    const raw = await get<{ date: string; narrative: string; deviations: DaySummary['deviations'] }[]>(
      `/residents/${residentId}/summaries?days=${days}`,
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
      // Title-cased feature name, minus a trailing unit suffix: the unit
      // already renders beside the value, so "longest_inactivity_s" must read
      // "Longest Inactivity", not "Longest Inactivity S at 16320 s".
      label: locationLabel(b.feature.replace(/_s$/, '')),
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
  // features on downweighted/suppress_until, they're not real.
  //
  // The route is named for an alert but accepts either id: residents.py falls
  // back to `trigger_event_id`, then to the bare event, because the family
  // gives feedback from the TIMELINE where the thing on screen is an event.
  // So passing an event id here is correct, not a latent 404.
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
  chat: async (question: string, forResident = residentId()): Promise<ChatMessage> => {
    const body = await post<{
      answer: string;
      citations: { id?: string; event_id?: string; kind?: string; ts: string; text: string }[];
      retrieved_count: number;
      refused?: boolean;
      refusal_kind?: ChatMessage['refusal_kind'];
    }>(`/residents/${forResident}/chat`, { question });
    // Two display scrubs, both second locks on §6.1 (the deployed backend can
    // still send these):
    //  · the extractive answer inlines its retrieval ids ("[evt_01M2…]"),
    //    which no person should read — stripped, sentences left intact.
    //  · the retriever can cite the alert FSM's own transition rows ("Alert
    //    alt_…: CALLING_RESIDENT -> CLASSIFYING"), a log line rather than a
    //    sentence — that citation is dropped, never rewritten.
    const scrubIds = (text: string) =>
      text.replace(/\s*\[(?:evt|fact|alt|cam|obs)_[A-Za-z0-9]+\]/g, '').replace(/[ \t]{2,}/g, ' ').trim();
    const isMachineLine = (text: string) => /^alert\s+alt_/i.test(text) || text.includes('->');
    return {
      id: `msg_${Date.now().toString(36)}`,
      role: 'dhyaan',
      text: scrubIds(body.answer),
      citations: (body.citations ?? []).filter((c) => !isMachineLine(c.text)).map((c) => {
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
          // Raw records name rooms; only the family chat renders this text,
          // so it carries the same scrub the server runs on the activity feed.
          text: scrubRooms(c.text),
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
  // `author` is required by NoteBody (residents.py) and has no default. There
  // is no signed-in person to name (the app has no login), so the note is
  // signed by its lane, with the same words the alert screen uses for who
  // acted: "Staff" or "Family", from the copy module.
  addNote: async (residentId_: string, text: string, role: 'staff' | 'family' = 'family'): Promise<void> => {
    const author = role === 'staff' ? family.alert.actorStaff : family.alert.actorFamily;
    await post(`/residents/${residentId_}/notes`, { text, author, role });
  },

  // GET /residents/{id}/location — one zone for one resident. Staff-only by
  // D-001; no family screen may call it. Cheaper than `getResident`, which
  // fetches the whole roster to read one row.
  getLocation: async (residentId_: string): Promise<ResidentLocation | null> =>
    toLocation(await get<RawLocation>(`/residents/${residentId_}/location`)),

  // POST /admin/rollup — runs the nightly baseline + narrative pass now.
  // Without it a freshly seeded backend has no daily summaries at all and
  // Her day reads "Today's isn't written yet" forever.
  //
  // `resident_id` and `date` are both REQUIRED by RollupRequest — posting an
  // empty body 422s, which is what the "Write today's story now" button did
  // until this was smoke-tested against the live API. `date` is the resident's
  // local day, not UTC's, same as every other day-keyed route here.
  rollup: async (residentId_ = residentId(), date = localDay()): Promise<void> => {
    await post('/admin/rollup', { resident_id: residentId_, date });
  },

  // POST /bands/pair — contract body is {band_id, resident_id}, but
  // onboard/pair.tsx only ever collects a 6-digit code shown on the band, no
  // separate band_id field. Treated as the same value (the band's own code
  // *is* its id for pairing purposes here).
  //
  // No `rssi`. The old version returned `body.band?.rssi ?? -60` — a fabricated
  // signal strength for a band the hub has not heard from yet, which is the
  // whole reason pairing cannot confirm a band is really there. The screen now
  // says that instead of showing a number.
  pairBand: async (code: string): Promise<{ band_id: string }> => {
    const body = await post<{ ok: boolean; band?: { band_id?: string; id?: string } }>(
      '/bands/pair',
      { band_id: code, resident_id: residentId() },
    );
    return { band_id: body.band?.band_id ?? body.band?.id ?? code };
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
  ): Promise<{ n_scans: number; warning: string | null }> => {
    const active = activeSurveys.get(zoneId);
    activeSurveys.delete(zoneId);
    if (active) clearInterval(active.timer);
    const surveyId = active?.surveyId ?? zoneId; // fallback: caller already held a real survey_id
    const body = await post<{ zone: string; samples: number; stored: boolean }>(
      `/residents/${residentId()}/survey/stop`,
      { survey_id: surveyId },
    );
    // Only what the server actually measured. This used to also return
    // `n_anchors` (approximated from the sample count) and `separability_db: 0`
    // — a phone with no radio access cannot count anchors or compute a
    // separation, so those were two numbers dressed as measurements. Deleted
    // rather than zeroed: a field that exists invites a screen to render it.
    return {
      n_scans: body.samples,
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
  // Both of these send text to Claude, so both must send the FAMILY view.
  //
  // They used to read `GET /residents/{id}/timeline`, which is the staff feed:
  // raw `embedding_text` with zones attached ("Eleanor moved into the
  // bathroom", "Band band_a3f2 reported fall_suspected"). That is whereabouts
  // and machine log text, it is exactly what D-001 says never reaches a family
  // surface, and it was being posted off-device and then rendered back onto
  // Today and into her weekly letter. `/activity` is the same day already run
  // through the server's family filter (`_family_item` strips zone, evidence,
  // posture and movement), so it is the only correct source here.
  talkAbout: async (): Promise<string[]> => {
    const day = await httpApi.getActivity(residentId(), localDay()).catch(() => null);
    const lines = (day?.items ?? []).map((i) => i.sentence).filter(Boolean);
    if (!lines.length) return [];
    return (await draftOpeners(lines.slice(0, 20))) ?? [];
  },
  // The voice agent's leave_message tool lands as a family_note event with the
  // spoken text in payload.message (backend/app/voice_adapter.py). Newest wins.
  latestMessage: async (): Promise<{ text: string; at: string } | null> => {
    const events = await httpApi.getEvents(residentId()).catch(() => []);
    const note = events.find(
      (e) => e.type === 'family_note' && typeof e.payload?.message === 'string',
    );
    return note ? { text: note.payload.message as string, at: note.ts } : null;
  },
  planFromThread: async (thread: string): Promise<FamilyPlan> =>
    (await aiPlanFromThread(thread)) ?? {
      headline: 'Couldn’t read the thread. Try pasting it again.',
      when: null, tasks: [], open_questions: [], reply_text: '',
    },
  // The week, in her family's view. Seven days of family-filtered activity
  // plus the daily narratives — never the staff timeline (see talkAbout).
  sundayLetter: async (): Promise<string> => {
    const id = residentId();
    const days = [...Array(7)].map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return localDay(d);
    });
    const [summaries, activity] = await Promise.all([
      httpApi.getSummaries(id).catch(() => []),
      Promise.all(days.map((d) => httpApi.getActivity(id, d).catch(() => null))),
    ]);
    const draft = [
      ...summaries.map((s) => s.narrative),
      ...activity.flatMap((day) => (day?.items ?? []).map((i) => i.sentence)),
    ].filter(Boolean).join('\n');
    if (!draft) return '';
    return (await polishLetter(draft)) ?? '';
  },
};
