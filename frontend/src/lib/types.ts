// Shapes from TECHNICAL_PRD §3 and §10.5 — only the fields the app consumes.
import type { ResidentState } from '@/theme/tokens';

export type LocationMethod = 'wifi' | 'ble' | 'fused' | 'camera';

export interface ResidentLocation {
  zone: string;
  label: string;
  since: string;
  confidence: number;
  method: LocationMethod;
}

export interface Resident {
  id: string;
  display_name: string;
  room: string | null;
  state: ResidentState;
  last_seen: string;
  band_battery_pct: number | null;
  location: ResidentLocation | null;
  open_alerts: number;
  baseline_ready: boolean;
  attention_reason?: string; // one-line triage reason for staff list
}

export type EventSource = 'band' | 'camera' | 'voice' | 'manual' | 'derived';
export type ReviewState = 'unreviewed' | 'confirmed' | 'false_positive' | 'expected';

export interface KEvent {
  id: string;
  resident_id: string;
  source: EventSource;
  source_id?: string;
  type: string;
  ts: string;
  ts_end?: string | null;
  confidence: number;
  zone?: string | null;
  payload: Record<string, unknown>;
  embedding_text: string;
  review_state: ReviewState;
  deviation?: boolean; // render amber ring in timeline
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
  state: string;
  opened_at: string;
  closed_at: string | null;
  resolution: string | null;
  acked_by: string | null;
  ladder: LadderStep[];
  calls: CallRow[];
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

export type WsEnvelope =
  | { t: 'alert.opened'; alert: Alert; resident_id: string }
  | { t: 'alert.ladder'; alert_id: string; step: LadderStep }
  | { t: 'alert.voice'; alert_id: string; speaker: TranscriptLine['speaker']; text: string }
  | { t: 'alert.closed'; alert_id: string; resolution: string; acked_by: string | null }
  | { t: 'location.changed'; resident_id: string; location: ResidentLocation }
  | { t: 'location.dwell'; resident_id: string; zone: string; dwell_s: number; expected_p95_s: number; escalating: boolean }
  | { t: 'event.new'; event: KEvent }
  | { t: 'resident.state'; resident_id: string; state: ResidentState; reason?: string };
