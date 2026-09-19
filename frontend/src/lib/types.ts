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
  date_local: string;
  narrative: string;
  tiles: { ate: TileState; walked: TileState; night: TileState; location: TileState };
  deviations: { feature: string; text: string }[];
}

export interface LocationSegment {
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
  kind: string;
  ts: string;
  label: string;
  event_ids: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'dhyaan';
  text: string;
  citations?: ChatCitation[];
  refused?: boolean;
}

export interface BaselineFeature {
  feature: string;
  label: string;
  mu: number;
  mad: number;
  n_obs: number;
  unit: string;
  series: number[]; // last 14 days for sparkline
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
  | { t: 'ping' }; // real: live.py's 25s keepalive
