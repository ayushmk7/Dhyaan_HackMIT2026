// Shapes from TECHNICAL_PRD §3 and §10.5 — only the fields the app consumes.
import type { ResidentState } from '@/theme/tokens';

export type LocationMethod = 'wifi' | 'ble' | 'fused' | 'camera';

export interface ResidentLocation {
  zone: string;
  // ponytail: the real GET /residents and GET /residents/{id}/location never
  // send a display label, only the raw zone slug — http.ts derives one
  // (title-cased zone) so floor.tsx / resident/[id].tsx keep working.
  // Upgrade: have the backend send a human label.
  label: string;
  since: string;
  confidence: number | null;
  method: LocationMethod | null; // real backend has sent this as null so far
}

export interface Resident {
  id: string;
  display_name: string;
  room: string | null;
  state: ResidentState; // real backend only ever sends 'ok' | 'alerting' today
  last_seen: string | null;
  band_battery_pct: number | null;
  location: ResidentLocation | null;
  // The real GET /residents returns a single `open_alert` object (or null),
  // not a count — httpApi derives open_alerts as 0/1 from it below.
  open_alerts: number;
  // ponytail: no baseline-readiness field exists on the real backend at all.
  // Left optional; httpApi never sets it (undefined, not a fabricated true).
  // Upgrade: add one once baseline.py exposes rollup status per resident.
  baseline_ready?: boolean;
  attention_reason?: string; // one-line triage reason for staff list — mock-only, real backend never sends it
}

export type EventSource = 'band' | 'camera' | 'voice' | 'manual' | 'derived';
export type ReviewState = 'unreviewed' | 'confirmed' | 'false_positive' | 'expected';

export interface KEvent {
  id: string;
  resident_id: string;
  source: EventSource;
  source_id?: string | null;
  type: string;
  ts: string;
  ts_end?: string | null;
  confidence: number;
  zone?: string | null;
  payload: Record<string, unknown>;
  embedding_text: string;
  review_state: ReviewState;
  deviation?: boolean; // render amber ring in timeline — mock-only, not sent by the real backend
  // Real backend extras (backend/app/routers/residents.py `_ser`) — present on
  // every real event but nothing in the app reads them yet. `embedding` (a
  // 768-float vector) is deliberately left untyped here; don't add it just to
  // round-trip it.
  ts_epoch?: number;
  schema_version?: number;
  derived_from?: string[];
  supersedes?: string | null;
  created_at?: string;
}

export type AlertKind = 'fall' | 'baseline_deviation' | 'inactivity' | 'sos' | 'bathroom';
export type AlertSeverity = 'info' | 'warn' | 'urgent' | 'critical';

export interface LadderStep {
  step: string; // 'suspected' | 'calling_resident' | ...
  at: string;
  detail: string;
  outcome?: string;
}

export interface TranscriptLine {
  speaker: 'agent' | 'resident' | 'contact';
  text: string;
}

export interface CallRow {
  role: 'resident' | 'contact_1' | 'contact_2' | 'staff';
  classification: string | null;
  transcript: TranscriptLine[];
  duration_s: number | null;
}

export interface Alert {
  id: string;
  resident_id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  state: string; // real: FSM states like 'LOCAL_CANCEL'/'ACKNOWLEDGED'/'MANUALLY_RESOLVED'; mock: ladder-step names
  opened_at: string;
  // Real backend has no `closed_at` column. httpApi derives it (null unless
  // `state` is one of the FSM's terminal states) so alert/[id].tsx's
  // `!!alert.closed_at` check still works. See http.ts `withDerivedAlertFields`.
  closed_at: string | null;
  resolution: string | null;
  // Real backend never records/returns who acked — it only takes `by` as
  // input on POST .../ack and doesn't persist it on the alert document.
  // httpApi sets this to null for real alerts (same value mock uses for "not
  // acked yet"); screens already fall back to 'Someone' either way.
  acked_by: string | null;
  // ponytail: the real backend has no escalation-ladder array at all (no
  // §4.2 state machine replay over REST) — httpApi always sends `[]` for a
  // real alert, which is honest ("no known ladder steps"), not fabricated.
  // Kept required (matching the mock) so alert/[id].tsx's
  // `alert?.ladder ?? []` and dhyaan.ts's `[...alert.ladder]` both keep
  // working unchanged. Upgrade: have GET /alerts/{id} include real ladder
  // history once alerts.py records one.
  ladder: LadderStep[];
  // ponytail: real GET /alerts/{id} reconstructs `calls` from raw voice-source
  // Events (`{to, role, alert_id, call_sid}` in payload today — no
  // transcript, no duration, no classification; see backend/app/voice.py's
  // stub). httpApi projects those into this same CallRow shape with
  // transcript: [] and duration_s/classification: null rather than widening
  // this type to a union — the screen keeps compiling and just renders call
  // rows with an empty transcript for real alerts until voice.py's payload
  // contract grows a real one.
  calls: CallRow[];
  // Real-only extras (backend/app/routers/residents.py):
  trigger_event_id?: string;
  trigger_event?: KEvent | null; // only on GET /alerts/{id}
  resident_call_attempts?: number;
  resident_name?: string; // only on list/detail, joined from the resident doc
  room?: string | null; // only on list/detail
  updated_at?: string;
  resolved_at?: string;
}

export type TileTone = 'ok' | 'warn' | 'unknown';
export interface TileState { state: TileTone; detail: string }

export interface DaySummary {
  // Contract field is `date` — http.ts renames to `date_local` on the way in
  // because timeline/index.tsx keys its day sections off `date_local`.
  date_local: string;
  narrative: string;
  // Contract shape is exactly `{feature, severity, text}` — matched as-is.
  deviations: { feature: string; severity: string; text: string }[];
  // ponytail: the real /summaries endpoint has no per-tile rollup (ate/
  // walked/night/location) — that was a mock-only convenience. Optional and
  // left unset by httpApi; only the mock still populates it, and no screen
  // currently reads `.tiles` (grepped clean across src/app, src/components).
  // Upgrade: drop entirely once the mock stops needing it, or have the
  // backend expose real day tiles.
  tiles?: { ate: TileState; walked: TileState; night: TileState; location: TileState };
}

export interface LocationSegment {
  // Contract sends `{zone, from, to, seconds, method, confidence}` — renamed
  // to start/end/s here because components/viz.tsx's RoomTimeBar (not owned
  // by this facade) already reads `.start`/`.end`/`.s`. method/confidence are
  // real fields nothing reads yet, so they're left off rather than invented
  // further; add them back if a screen ever needs them.
  zone: string;
  start: string;
  end: string;
  s: number;
}

export interface Contact {
  id: string;
  name: string;
  phone_e164: string;
  relationship: string;
  ladder_order: number;
}

export interface ChatCitation {
  id: string;
  /** §6.5: 'observed' | 'told' | 'pattern'. Widened to string because the
   *  pre-camera backend sends the literal 'event' for every citation. */
  kind: string;
  ts: string;
  label: string;
  event_ids: string[];
  /** The cited sentence itself, when the backend sends one (§6.1 `text`). */
  text?: string;
}

export type RefusalKind = 'surveillance' | 'medical' | 'no_data' | null;

export interface ChatMessage {
  id: string;
  role: 'user' | 'dhyaan';
  text: string;
  citations?: ChatCitation[];
  refused?: boolean;
  refusal_kind?: RefusalKind;
}

export interface BaselineFeature {
  // Real fields, contract-exact:
  feature: string;
  mu: number;
  mad: number;
  lam: number;
  n_obs: number;
  cold_start: boolean;
  last_value: number | null;
  updated_at: string;
  unit: string;
  direction: string;
  // ponytail: not on the wire — httpApi derives `label` by title-casing
  // `feature` (same trick as http.ts's locationLabel). `series` has no
  // history endpoint behind it at all, so httpApi fills it with just
  // `[last_value]` (or `[]` if null) rather than fabricating 14 fake points;
  // resident/[id].tsx's sparkline degrades to one bar but its deviation
  // check (`abs(last - mu) > 2*mad`) still runs on a real value. Upgrade:
  // add a real per-feature history endpoint and drop this shim.
  label: string;
  series: number[];
}

// Mock-only variants (dhyaan.ts / store/live.ts) kept below — the real
// `WS /v1/live` (backend/app/routers/live.py) only ever sends the last three:
// `event.new` (identical shape to the mock's), `alert.update` (the whole
// current alert doc, on ack/resolve — there's no separate ladder/voice/closed
// message; the real backend has no ladder or voice-transcript broadcast at
// all), and `ping` (a 25s keepalive, ignored by store/live.ts today since it
// has no case for it). Upgrade: if the ladder/voice/dwell UI needs to be live
// against the real backend, those events have to start existing server-side
// first — this is a listing of what already exists, not a wishlist.
export type WsEnvelope =
  | { t: 'alert.opened'; alert: Alert; resident_id: string }
  | { t: 'alert.ladder'; alert_id: string; step: LadderStep }
  | { t: 'alert.voice'; alert_id: string; speaker: TranscriptLine['speaker']; text: string }
  | { t: 'alert.closed'; alert_id: string; resolution: string; acked_by: string | null }
  | { t: 'location.changed'; resident_id: string; location: ResidentLocation }
  | { t: 'location.dwell'; resident_id: string; zone: string; dwell_s: number; expected_p95_s: number; escalating: boolean }
  | { t: 'event.new'; event: KEvent }
  | { t: 'resident.state'; resident_id: string; state: ResidentState; reason?: string }
  | { t: 'alert.update'; alert: Alert; resident_id: string | null } // real: live.py broadcast_alert
  | { t: 'presence.update'; resident_id: string; presence: Presence } // VLM_PLAN §6.1
  | { t: 'camera.monitor'; tick: CameraMonitorTick } // the console's live feed
  | { t: 'ping' }; // real: live.py's 25s keepalive

// ---------------------------------------------------------------------------
// Camera / presence lane — VLM_PLAN §6.1, typed verbatim from the frozen
// contract table. Nothing below carries a zone, a frame, or evidence text:
// those fields do not exist on any family-facing response by design (§5.2,
// D-001). If a room name can reach a family screen it is a bug, so there is
// deliberately no field here to put one in.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The camera console (the in-app CCTV). Telemetry about the WORKER, not about
// her: this is the only surface in the app that speaks in machine terms, and
// it still carries no pixels. `boxes` are normalized 0..1 rectangles, which is
// geometry, not an image — there is deliberately no field here that could hold
// a frame, because the worker is the only process that ever holds one (§5.3).
// ---------------------------------------------------------------------------

/** What the pipeline is doing right now — the cascade of VLM_PLAN §3.3. */
export type GateState = 'idle' | 'motion' | 'person' | 'thinking';

/** Normalized [x0, y0, x1, y1], each 0..1 of the frame. */
export type NormBox = [number, number, number, number];

export interface CameraMonitorTick {
  camera_id: string;
  ts: string;
  fps: number;
  person_count: number;
  boxes: NormBox[];
  gate: GateState;
  model: string;
  latency_ms: number | null;
  batch_frames: number;
  activity: CameraActivity | null;
  /** The worker's own evidence line. Machine-facing; never rendered to family. */
  sentence: string;
  confidence: number | null;
  simulated: boolean;
}

export interface CameraSummary {
  id: string;
  resident_id: string;
  state: string;
  consent: boolean;
  paused_until: string | null;
  last_heartbeat_at: string | null;
  online: boolean;
}

export type PresenceStatus =
  | 'in_view' | 'out_of_view' | 'paused' | 'camera_off' | 'no_camera';

/** Activity enum from §3.5 plus the worker's post-rule `absent`. */
export type CameraActivity =
  | 'eating' | 'drinking' | 'sitting' | 'reading' | 'watching_tv' | 'using_phone'
  | 'standing' | 'walking' | 'exercising' | 'lying_down' | 'on_floor'
  | 'entering' | 'leaving' | 'with_visitor' | 'unclear' | 'absent';

export interface Presence {
  status: PresenceStatus;
  activity: CameraActivity | null;
  /** True when she is in the spot she is usually found at this hour. Never a room. */
  spot_is_usual: boolean;
  since: string | null;
  last_observation_at: string | null;
  /** The one sentence the family is shown. Written server-side, room-free. */
  sentence: string;
  camera: {
    online: boolean;
    consent: boolean;
    paused_until: string | null;
    paused_by: string | null;
  };
}

/** `kind` labels every citable/telling thing in the app — §6.5. */
export type SourceKind = 'observed' | 'told' | 'pattern';

export interface ActivityItem {
  id: string;
  ts: string;
  ts_end: string | null;
  type: string;
  sentence: string;
  kind: SourceKind;
  confidence: number;
}

export interface ActivityDay {
  date: string;
  tiles: {
    meals: number;
    walks: number;
    out_of_house: number;
    night_ups: number;
    in_view_minutes: number;
  };
  items: ActivityItem[];
}

export interface Fact {
  id: string;
  key: string;
  text: string;
  source: string;
  author: string;
  active: boolean;
  supersedes: string | null;
  superseded_by: string | null;
  created_at: string;
}

/** §5.1: bedroom and bathroom are not options, here or on the wire. */
export type CameraZone = 'kitchen' | 'living_room' | 'dining_room' | 'hallway';
export type CameraState = 'watching' | 'paused' | 'offline' | 'no_consent';

export interface Profile {
  name: string;
  appearance: string | null;
  consent: {
    falls: boolean;
    camera: boolean;
    memory: boolean;
    signed_by: string | null;
    relationship: string | null;
    signed_at: string | null;
  };
  camera: {
    camera_id: string;
    zone: CameraZone;
    zone_hint: string;
    state: CameraState;
    paused_until: string | null;
  } | null;
  /** Learned "usual spot" phrases, already stripped of room names. */
  usual_spots: string[];
  facts: Fact[];
}

export interface ProfilePatch {
  name?: string;
  appearance?: string;
  consent?: Partial<Profile['consent']>;
  camera?: { zone: CameraZone; zone_hint: string };
}

export type MemoryScope = 'profile' | 'camera' | 'all';

export interface MemoryDeleted {
  profile_facts: number;
  observations: number;
  camera_events: number;
  usual_spots: boolean;
}

export interface AuthUser {
  name: string;
  email: string;
}

export interface LoginResult {
  ok: boolean;
  token: string;
  user: AuthUser;
  resident_id: string;
}
