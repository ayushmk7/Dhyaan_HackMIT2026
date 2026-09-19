// Seeded demo world: Eleanor at home (B2C) + a facility floor (B2B).
// Everything is generated relative to "now" so the demo always looks live.
import type {
  BaselineFeature, Contact, DaySummary, KEvent, LocationSegment, Resident,
} from '../types';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let seq = 0;
export const eid = () => `evt_${(++seq).toString(36).padStart(6, '0')}`;

export const iso = (t: number) => new Date(t).toISOString();
export const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const at = (dayStart: number, h: number, m = 0) => dayStart + h * HOUR + m * MIN;
const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const weekday = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { weekday: 'long' });
const clock = (t: number) =>
  new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function ev(p: {
  resident_id: string; source: KEvent['source']; type: string; t: number;
  tEnd?: number; zone?: string; text: string; confidence?: number;
  payload?: Record<string, unknown>; deviation?: boolean;
}): KEvent {
  return {
    id: eid(),
    resident_id: p.resident_id,
    source: p.source,
    type: p.type,
    ts: iso(p.t),
    ts_end: p.tEnd ? iso(p.tEnd) : null,
    confidence: p.confidence ?? 0.9,
    zone: p.zone ?? null,
    payload: p.payload ?? {},
    embedding_text: p.text,
    review_state: 'unreviewed',
    deviation: p.deviation,
  };
}

// ---- Eleanor: 7 days of routine, with a real deviation story ----------------
// Days -6..-1 are full days; day 0 is today up to "now".
// Story: dinners missing since day -2, fewer walks — feeds tiles, chat, timeline.

export function generateEleanor(now: number) {
  const events: KEvent[] = [];
  const summaries: DaySummary[] = [];
  const locationDays: Record<string, LocationSegment[]> = {};
  const R = 'res_eleanor';

  for (let d = -6; d <= 0; d++) {
    const ds = startOfDay(now) + d * DAY;
    const today = d === 0;
    const wobble = (n: number) => n + (((d * 7 + 3) % 5) - 2); // deterministic ±2 min-ish
    const dinnerSkipped = d >= -2 && d !== 0;
    const fewWalks = d >= -2;

    const wakeT = at(ds, 6, wobble(40));
    const push = (e: KEvent | null) => { if (e && e.ts <= iso(now)) events.push(e); };

    push(ev({
      resident_id: R, source: 'camera', type: 'bed_exit', t: wakeT, zone: 'bedroom',
      text: `On ${weekday(wakeT)} at ${clock(wakeT)}, Eleanor got up for the day.`,
    }));
    const bfast = at(ds, 8, wobble(5));
    push(ev({
      resident_id: R, source: 'camera', type: 'meal_observed', t: bfast, tEnd: bfast + 18 * MIN,
      zone: 'kitchen', confidence: 0.86, payload: { meal: 'breakfast' },
      text: `On ${weekday(bfast)} at ${clock(bfast)}, Eleanor ate breakfast in the kitchen for about 18 minutes.`,
    }));
    const walk1 = at(ds, 10, wobble(15));
    push(ev({
      resident_id: R, source: 'band', type: 'walk_completed', t: walk1, tEnd: walk1 + 22 * MIN,
      zone: 'outside', payload: { duration_s: 1320 },
      text: `On ${weekday(walk1)} at ${clock(walk1)}, Eleanor went out for her morning walk, about 22 minutes.`,
    }));
    const lunch = at(ds, 12, wobble(41));
    push(ev({
      resident_id: R, source: 'camera', type: 'meal_observed', t: lunch, tEnd: lunch + 22 * MIN,
      zone: 'kitchen', confidence: 0.82, payload: { meal: 'lunch' },
      text: `On ${weekday(lunch)} at ${clock(lunch)}, Eleanor ate lunch in the kitchen for about 22 minutes. Her plate went from full to mostly empty.`,
    }));
    if (!fewWalks) {
      const walk2 = at(ds, 15, wobble(30));
      push(ev({
        resident_id: R, source: 'band', type: 'walk_completed', t: walk2, tEnd: walk2 + 15 * MIN,
        zone: 'outside', payload: { duration_s: 900 },
        text: `On ${weekday(walk2)} at ${clock(walk2)}, Eleanor took an afternoon walk of about 15 minutes.`,
      }));
    }
    if (!today) {
      if (dinnerSkipped) {
        const t = at(ds, 19, 30);
        push(ev({
          resident_id: R, source: 'camera', type: 'meal_skipped', t, zone: 'kitchen',
          confidence: 0.7, deviation: true, payload: { meal: 'dinner' },
          text: `On ${weekday(t)} evening, no dinner was observed. Eleanor was last seen in the living room at ${clock(at(ds, 19, 5))}.`,
        }));
      } else {
        const dinner = at(ds, 18, wobble(20));
        push(ev({
          resident_id: R, source: 'camera', type: 'meal_observed', t: dinner, tEnd: dinner + 25 * MIN,
          zone: 'kitchen', confidence: 0.84, payload: { meal: 'dinner' },
          text: `On ${weekday(dinner)} at ${clock(dinner)}, Eleanor ate dinner in the kitchen for about 25 minutes.`,
        }));
      }
      if (d === -3) {
        const t = at(ds + DAY, 3, 12); // technically next-day 3am; keep inside this day block
        push(ev({
          resident_id: R, source: 'band', type: 'night_activity', t: t - DAY + 0, zone: 'hallway',
          deviation: true, payload: { hour_local: 3 },
          text: `On ${weekday(t - DAY)} at 3:12 AM, Eleanor was up and moving around the hallway for about 9 minutes.`,
        }));
      }
      const bed = at(ds, 21, wobble(45));
      push(ev({
        resident_id: R, source: 'band', type: 'zone_entered', t: bed, zone: 'bedroom',
        text: `On ${weekday(bed)} at ${clock(bed)}, Eleanor settled in the bedroom for the night.`,
      }));
    }

    // Location history for the room-time bar.
    const segs: LocationSegment[] = [];
    const seg = (zone: string, a: number, b: number) => {
      const end = today ? Math.min(b, now) : b;
      if (end > a) segs.push({ zone, start: iso(a), end: iso(end), s: (end - a) / 1000 });
    };
    seg('bedroom', ds, wakeT);
    seg('bathroom', wakeT, wakeT + 20 * MIN);
    seg('kitchen', wakeT + 20 * MIN, bfast + 30 * MIN);
    seg('living_room', bfast + 30 * MIN, walk1);
    seg('outside', walk1, walk1 + 25 * MIN);
    seg('living_room', walk1 + 25 * MIN, lunch);
    seg('kitchen', lunch, lunch + 40 * MIN);
    seg('living_room', lunch + 40 * MIN, at(ds, 18, 15));
    seg('kitchen', at(ds, 18, 15), at(ds, 19, 10));
    seg('living_room', at(ds, 19, 10), at(ds, 21, 45));
    seg('bedroom', at(ds, 21, 45), ds + DAY);
    locationDays[dayKey(ds)] = segs;

    if (!today) {
      const meals = dinnerSkipped ? 2 : 3;
      const walks = fewWalks ? 1 : 2;
      summaries.push({
        date_local: dayKey(ds),
        narrative:
          `Eleanor was up at ${clock(wakeT)} and ate ${meals === 3 ? 'all three meals' : 'breakfast and lunch'}.` +
          ` She ${walks === 2 ? 'walked twice' : 'walked once'}${dinnerSkipped ? '. No dinner was observed — that is the ' +
          (d === -1 ? 'second' : 'first') + ' evening in a row' : ''}.` +
          (d === -3 ? ' She was briefly up at 3 AM, which is unusual for her.' : ''),
        tiles: {
          ate: dinnerSkipped
            ? { state: 'warn', detail: '2 of 3 meals' }
            : { state: 'ok', detail: '3 meals' },
          walked: fewWalks
            ? { state: 'warn', detail: '1 walk — she usually takes 2' }
            : { state: 'ok', detail: '2 walks' },
          night: d === -3
            ? { state: 'warn', detail: 'Up at 3:12 AM' }
            : { state: 'ok', detail: 'Slept through' },
          location: { state: 'ok', detail: 'Home all day' },
        },
        deviations: dinnerSkipped
          ? [{ feature: 'meal_count', text: 'Dinner not observed — usually eats at about 6:20 PM' }]
          : [],
      });
    }
  }

  events.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return { events, summaries, locationDays };
}

// ---- Facility floor (B2B) ---------------------------------------------------

export const facilityResidents: Resident[] = [
  {
    id: 'res_harold', display_name: 'Harold Weiss', room: '214', state: 'attention',
    last_seen: iso(Date.now() - 4 * MIN), band_battery_pct: 58,
    location: { zone: 'bedroom', label: 'Room 214', since: iso(Date.now() - 50 * MIN), confidence: 0.91, method: 'ble' },
    open_alerts: 0, baseline_ready: true,
    attention_reason: 'Up at 3 AM two nights running — new for him',
  },
  {
    id: 'res_marguerite', display_name: 'Marguerite Cole', room: '203', state: 'attention',
    last_seen: iso(Date.now() - 2 * MIN), band_battery_pct: 71,
    location: { zone: 'dining_room', label: 'Dining room', since: iso(Date.now() - 12 * MIN), confidence: 0.84, method: 'fused' },
    open_alerts: 0, baseline_ready: true,
    attention_reason: 'Ate 1 of 3 meals yesterday',
  },
  {
    id: 'res_dorothy', display_name: 'Dorothy Nakamura', room: '207', state: 'ok',
    last_seen: iso(Date.now() - 1 * MIN), band_battery_pct: 88,
    location: { zone: 'living_room', label: 'Common room', since: iso(Date.now() - 34 * MIN), confidence: 0.9, method: 'camera' },
    open_alerts: 0, baseline_ready: true,
  },
  {
    id: 'res_ernest', display_name: 'Ernest Boyd', room: '210', state: 'ok',
    last_seen: iso(Date.now() - 6 * MIN), band_battery_pct: 64,
    location: { zone: 'hallway', label: 'Floor 2 hallway', since: iso(Date.now() - 3 * MIN), confidence: 0.77, method: 'ble' },
    open_alerts: 0, baseline_ready: true,
  },
  {
    id: 'res_alma', display_name: 'Alma Reyes', room: '201', state: 'learning',
    last_seen: iso(Date.now() - 8 * MIN), band_battery_pct: 92,
    location: { zone: 'bedroom', label: 'Room 201', since: iso(Date.now() - 65 * MIN), confidence: 0.88, method: 'ble' },
    open_alerts: 0, baseline_ready: false,
    attention_reason: 'Moved in 3 days ago — baseline still learning',
  },
  {
    id: 'res_walter', display_name: 'Walter Osei', room: '212', state: 'ok',
    last_seen: iso(Date.now() - 30_000), band_battery_pct: 47,
    location: { zone: 'dining_room', label: 'Dining room', since: iso(Date.now() - 22 * MIN), confidence: 0.9, method: 'camera' },
    open_alerts: 0, baseline_ready: true,
  },
  {
    id: 'res_june', display_name: 'June Pelletier', room: '206', state: 'offline',
    last_seen: iso(Date.now() - 4 * HOUR), band_battery_pct: null,
    location: null, open_alerts: 0, baseline_ready: true,
    attention_reason: 'Band unreachable for 4 hours',
  },
];

export const eleanorResident = (now: number): Resident => ({
  id: 'res_eleanor', display_name: 'Eleanor', room: null, state: 'ok',
  last_seen: iso(now - 40_000), band_battery_pct: 64,
  location: { zone: 'kitchen', label: 'Kitchen', since: iso(now - 12 * MIN), confidence: 0.88, method: 'ble' },
  open_alerts: 0, baseline_ready: true,
});

export const eleanorContacts: Contact[] = [
  { id: 'con_priya', name: 'Priya Sharma', phone_e164: '+16175550142', relationship: 'Daughter', ladder_order: 1 },
  { id: 'con_dev', name: 'Dev Sharma', phone_e164: '+16175550178', relationship: 'Son', ladder_order: 2 },
];

export const eleanorBaselines: BaselineFeature[] = [
  { feature: 'wake_time_min', label: 'Wake time', mu: 6.7, mad: 0.4, n_obs: 21, unit: 'AM', series: [6.6, 6.8, 6.5, 6.7, 6.9, 6.6, 6.7, 6.8, 6.5, 6.6, 6.7, 6.9, 6.7, 6.6] },
  { feature: 'meal_count', label: 'Meals per day', mu: 3, mad: 0.3, n_obs: 21, unit: 'meals', series: [3, 3, 3, 3, 2, 3, 3, 3, 3, 3, 3, 2, 2, 2] },
  { feature: 'walk_count', label: 'Walks per day', mu: 2, mad: 0.4, n_obs: 21, unit: 'walks', series: [2, 2, 3, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1] },
  { feature: 'night_exits', label: 'Nights with activity', mu: 0.2, mad: 0.2, n_obs: 21, unit: 'times up', series: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0] },
];

export const homeZones = [
  { id: 'bedroom', label: 'Bedroom' },
  { id: 'bathroom', label: 'Bathroom' },
  { id: 'kitchen', label: 'Kitchen' },
  { id: 'living_room', label: 'Living room' },
  { id: 'hallway', label: 'Hallway' },
] as const;
