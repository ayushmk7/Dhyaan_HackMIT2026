// Time and copy helpers. All user-facing time is local, human, and relative when recent.
export const timeOf = (isoTs: string) =>
  new Date(isoTs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * A moment that may not be today. "9:12 AM" is a lie about a time 24 hours out,
 * and the camera switch can put one exactly there, so a stamp that lands on
 * another day carries that day's name.
 */
export const whenOf = (isoTs: string) => {
  const d = new Date(isoTs);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? timeOf(isoTs)
    : `${d.toLocaleDateString(undefined, { weekday: 'long' })} ${timeOf(isoTs)}`;
};

export const dayOf = (isoTs: string) => {
  const d = new Date(isoTs);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - that.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
};

export const ago = (isoTs: string) => {
  const s = Math.max(0, (Date.now() - new Date(isoTs).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
};

export const mins = (s: number) => `${Math.round(s / 60)} min`;

export const zoneLabel = (zone: string | null | undefined) =>
  (zone ?? 'unknown').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// Room names never reach a family surface (D-001, §5.2). The server scrubs the
// activity feed (rag.scrub_rooms), but GET /events/{id} returns the raw record,
// so a family screen that renders `embedding_text` must run the same scrub
// itself. Same pattern and replacement as the server's, so both agree.
const ROOM_WORDS = /(?:\b(?:in|into|from|to|at|inside)\s+(?:the\s+)?)?\b(kitchen|bedroom|bathroom|living[ _]room|hallway|hall|dining[ _]room)\b/gi;
export const scrubRooms = (text: string): string => text.replace(ROOM_WORDS, 'at home');

// embedding_text is written for retrieval ("On Saturday at 12:42 PM, …"); the UI
// already shows the time, so strip the preamble for display and re-capitalize.
// A few sentences arrive written by a machine for a machine: a simulated event
// says so in parentheses, and the walk simulator names her by her record id
// ("res_eleanor completed a walk"). Neither belongs in front of a person, so
// the id becomes "She" and the parenthetical goes.
export const displaySentence = (text: string): string => {
  const stripped = text
    .replace(/^On [A-Za-z]+( \d{1,2} [A-Za-z]+)? (morning|evening|afternoon)?(at [\d:]+\s?[AP]M)?,?\s*/i, '')
    .replace(/\s*\((simulated|test)\)/gi, '')
    .replace(/\bres_[a-z0-9_]+\b/gi, 'she')
    .trim();
  const sentence = stripped.charAt(0).toUpperCase() + stripped.slice(1);
  // Neighbouring rows end in a full stop; a machine line that lost its
  // parenthetical should not be the one row that doesn't.
  return sentence && !/[.!?…]$/.test(sentence) ? `${sentence}.` : sentence;
};

// activity_observed carries WHAT she was doing in payload.activity; the row
// title should say "Had a drink", not the taxonomy's internal label.
const ACTIVITY_TITLES: Record<string, string> = {
  drinking: 'Had a drink',
  eating: 'Was eating',
  reading: 'Was reading',
  watching_tv: 'Watching TV',
  using_phone: 'On her phone',
  sitting: 'Sitting a while',
  standing: 'Up and about',
  walking: 'Moving around',
  exercising: 'Exercising',
  lying_down: 'Lying down',
};

// activity_classified is the band's on-device classifier changing its mind
// (payload.label in walking | sitting | standing | lying); the row title says
// what she is doing now, never the taxonomy word or the transition.
const CLASSIFIED_TITLES: Record<string, string> = {
  walking: 'Up and walking',
  sitting: 'Sitting down',
  standing: 'On her feet',
  lying: 'Lying down',
};

export const eventTitle = (type: string, payload?: Record<string, unknown>): string => {
  if (type === 'activity_observed') {
    const a = String(payload?.activity ?? '');
    return ACTIVITY_TITLES[a] ?? 'Seen active';
  }
  if (type === 'activity_classified') {
    const l = String(payload?.label ?? '');
    return CLASSIFIED_TITLES[l] ?? 'Activity changed';
  }
  return ({
    meal_observed: 'Ate a meal',
    meal_skipped: 'Meal not observed',
    walk_completed: 'Took a walk',
    bed_exit: 'Got up',
    night_activity: 'Up at night',
    zone_entered: 'Changed rooms',
    fall_suspected: 'Possible fall',
    fall_cancelled: 'Fall alert cancelled',
    prolonged_inactivity: 'Unusually still',
    baseline_deviation: 'Different from her routine',
  } as Record<string, string>)[type] ?? zoneLabel(type);
};

/**
 * The resident's own number — how the family rings HER.
 *
 * `Resident.phone_e164` is the answer whenever the roster has been loaded; it
 * comes straight off her document (backend/app/routers/residents.py). The
 * contacts fallback exists because `Contact` is the escalation ladder — who
 * Dhyaan rings ON her behalf — and some installs list her there too, under a
 * "self" relationship or simply under her own name.
 *
 * Returns null rather than a placeholder. Every call site says "Dhyaan doesn't
 * have a number for her" instead of dialling something that belongs to nobody;
 * these buttons used to be a hardcoded +1 617 555 0100.
 */
export function residentNumber(
  resident: { phone_e164?: string | null } | null | undefined,
  contacts: { name: string; phone_e164: string; relationship: string }[] | undefined,
  name: string,
): string | null {
  const own = resident?.phone_e164?.trim();
  if (own) return own;
  const full = name.trim().toLowerCase();
  const first = full.split(/\s+/)[0];
  const self = (contacts ?? []).find((c) => {
    const rel = (c.relationship ?? '').toLowerCase();
    if (rel === 'self' || rel === 'resident' || rel === 'herself' || rel === 'himself') return true;
    const n = c.name.trim().toLowerCase();
    return !!first && (n === full || n.split(/\s+/)[0] === first);
  });
  return self?.phone_e164?.trim() || null;
}
