// Mock camera lane (VLM_PLAN §6.1 shapes) — presence, activity, profile, facts,
// memory deletion and the guarded chat, all in memory so the whole app is
// demoable with EXPO_PUBLIC_USE_MOCKS=true and no backend at all.
//
// It deliberately STARTS EMPTY: "nothing yet today" is the state the demo opens
// in, so it is the state worth being able to see. A scripted day then advances
// on a wall clock from the first read (sit → eat → settle → leave), and
// `simulate()` jumps straight to a beat for the on-stage fallback.
//
// ponytail: one module-level singleton, no persistence, no zones anywhere in
// the shapes it produces. Ceiling: reloading Metro resets the scripted day.
// Upgrade: none needed — the real backend replaces this wholesale.
import type {
  ActivityDay, ActivityItem, ChatCitation, ChatMessage, Fact, MemoryDeleted,
  MemoryScope, Presence, Profile, ProfilePatch, SourceKind,
} from '../types';

const iso = (t: number) => new Date(t).toISOString();
const clock = (t: number) =>
  new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

let factSeq = 0;
const newFact = (key: string, text: string, author: string): Fact => ({
  id: `fact_${(++factSeq).toString(36).padStart(4, '0')}`,
  key,
  text,
  source: 'family_onboarding',
  author,
  active: true,
  supersedes: null,
  superseded_by: null,
  created_at: iso(Date.now()),
});

// Eleanor's seeded facts — what `Skip setup (dev)` writes instead of making
// the presenter type nine answers at the expo table. Mirrors §4.2's examples
// so the chat's contrast answers have something to contrast against.
export const SEEDED_FACTS: { key: string; text: string }[] = [
  { key: 'wake', text: 'Eleanor is usually up around 6:30.' },
  { key: 'breakfast', text: 'Toast and tea, about 8.' },
  { key: 'lunch', text: 'Lunch is usually soup around 12:30.' },
  { key: 'dinner', text: 'Dinner around 6, usually something she cooked earlier.' },
  { key: 'walk', text: 'She walks to the shops around 10 most mornings.' },
  { key: 'mobility', text: 'Uses a cane outdoors, steady indoors.' },
  { key: 'afternoon', text: 'In the armchair by the window, reading.' },
  { key: 'visitors', text: 'Her neighbour Cheryl comes on Tuesdays.' },
  { key: 'appearance', text: 'Short grey hair, glasses, usually a blue cardigan.' },
  { key: 'private', text: 'Never note bathroom trips.' },
];

const emptyProfile = (): Profile => ({
  name: 'Eleanor',
  appearance: null,
  consent: {
    falls: true, camera: false, memory: false,
    signed_by: null, relationship: null, signed_at: null,
  },
  camera: null,
  usual_spots: [],
  facts: [],
});

type Beat = {
  at_s: number;
  presence: Omit<Presence, 'camera'>;
  item?: Omit<ActivityItem, 'id' | 'ts' | 'ts_end'>;
};

// The scripted day, timed from the first presence read. Sentences are the
// family-facing ones: activity plus "her usual spot", never a room (§1).
const SCRIPT: Beat[] = [
  {
    at_s: 0,
    presence: {
      status: 'out_of_view', activity: null, spot_is_usual: false,
      since: null, last_observation_at: null, sentence: '',
    },
  },
  {
    at_s: 25,
    presence: {
      status: 'in_view', activity: 'eating', spot_is_usual: true,
      since: null, last_observation_at: null,
      sentence: 'Eleanor is having something to eat at the table.',
    },
    item: {
      type: 'meal_observed', kind: 'observed', confidence: 0.82,
      sentence: 'Eleanor ate at the table.',
    },
  },
  {
    at_s: 95,
    presence: {
      status: 'in_view', activity: 'reading', spot_is_usual: true,
      since: null, last_observation_at: null,
      sentence: 'Eleanor has been settled in her usual spot — reading, by the look of it.',
    },
    item: {
      type: 'activity_observed', kind: 'observed', confidence: 0.74,
      sentence: 'Eleanor was settled in her usual spot, reading.',
    },
  },
  {
    at_s: 170,
    presence: {
      status: 'out_of_view', activity: 'absent', spot_is_usual: false,
      since: null, last_observation_at: null,
      sentence: 'Eleanor has been out of view since {since}.',
    },
    item: {
      type: 'room_exit', kind: 'observed', confidence: 0.9,
      sentence: 'Eleanor went out of view — around her usual walk time.',
    },
  },
];

class MockCamera {
  private startedAt: number | null = null;
  private beatIdx = 0;
  private beatAt = Date.now();
  private items: ActivityItem[] = [];
  private profile: Profile = emptyProfile();
  private itemSeq = 0;
  private cameraOnlineAt: number | null = null;
  // Set by a memory deletion: the scripted day does not quietly restart itself
  // thirty seconds after someone has just watched everything be deleted.
  private stopped = false;

  // ---- the scripted clock ---------------------------------------------------

  private advance() {
    if (this.stopped) return;
    if (this.startedAt == null) {
      this.startedAt = Date.now();
      this.cameraOnlineAt = Date.now();
    }
    const elapsed = (Date.now() - this.startedAt) / 1000;
    let next = this.beatIdx;
    for (let i = this.beatIdx + 1; i < SCRIPT.length; i += 1) {
      if (elapsed >= SCRIPT[i].at_s) next = i;
    }
    if (next !== this.beatIdx) this.enter(next);
  }

  private enter(idx: number) {
    this.beatIdx = idx;
    this.beatAt = Date.now();
    const beat = SCRIPT[idx];
    if (beat.item) {
      this.itemSeq += 1;
      this.items.unshift({
        ...beat.item,
        id: `evt_cam_${this.itemSeq.toString(36)}`,
        ts: iso(Date.now()),
        ts_end: null,
      });
    }
  }

  // ---- reads ----------------------------------------------------------------

  getPresence(): Presence {
    const consent = this.profile.consent.camera;
    const camera = { online: consent, consent, paused_until: null, paused_by: null };
    // Consent off is the whole answer: nothing is observed, so there is no
    // sentence to give and the app says the camera is off (§5.6).
    if (!consent) {
      return {
        status: this.profile.camera ? 'camera_off' : 'no_camera',
        activity: null, spot_is_usual: false, since: null,
        last_observation_at: null, sentence: '', camera,
      };
    }
    this.advance();
    const beat = SCRIPT[this.beatIdx];
    return {
      ...beat.presence,
      sentence: beat.presence.sentence.replace('{since}', clock(this.beatAt)),
      since: this.beatIdx === 0 ? null : iso(this.beatAt),
      last_observation_at: this.beatIdx === 0 ? null : iso(this.beatAt),
      camera,
    };
  }

  /** The line under the hero when nothing has happened yet. */
  cameraOnlineSince(): string | null {
    return this.cameraOnlineAt == null ? null : iso(this.cameraOnlineAt);
  }

  getActivity(date: string): ActivityDay {
    this.advance();
    const meals = this.items.filter((i) => i.type === 'meal_observed').length;
    const walks = this.items.filter((i) => i.type.startsWith('walk')).length;
    const outs = this.items.filter((i) => i.type === 'room_exit').length;
    const nights = this.items.filter((i) => i.type === 'night_activity').length;
    const inView = this.items.filter((i) => i.type !== 'room_exit').length * 12;
    return {
      date,
      tiles: {
        meals, walks, out_of_house: outs, night_ups: nights, in_view_minutes: inView,
      },
      items: [...this.items],
    };
  }

  /** One activity item by id, for the mock event-detail lookup. */
  getItem(id: string): ActivityItem | undefined {
    return this.items.find((i) => i.id === id);
  }

  getProfile(): Profile {
    return { ...this.profile, facts: this.profile.facts.filter((f) => f.active) };
  }

  // ---- writes ---------------------------------------------------------------

  putProfile(patch: ProfilePatch): Profile {
    const ALLOWED = ['kitchen', 'living_room', 'dining_room', 'hallway'];
    if (patch.camera && !ALLOWED.includes(patch.camera.zone)) {
      // Mirrors the API's 422 at the trust boundary (§5.1) — bedroom and
      // bathroom are not acceptable here either, even though the picker
      // never offers them.
      throw new Error('That room cannot be watched.');
    }
    if (patch.appearance != null && patch.appearance.length > 200) {
      throw new Error('Keep the description under 200 characters.');
    }
    this.profile = {
      ...this.profile,
      name: patch.name ?? this.profile.name,
      appearance: patch.appearance ?? this.profile.appearance,
      consent: { ...this.profile.consent, ...(patch.consent ?? {}) },
      camera: patch.camera
        ? {
          camera_id: 'cam_mac_01',
          zone: patch.camera.zone,
          zone_hint: patch.camera.zone_hint,
          state: 'watching',
          paused_until: null,
        }
        : this.profile.camera,
    };
    if (patch.consent?.memory === false) this.deleteMemory('profile');
    return this.getProfile();
  }

  addFacts(rows: { key: string; text: string }[], author: string): Fact[] {
    const made = rows
      .filter((r) => r.text.trim().length > 0)
      .map((r) => newFact(r.key, r.text.trim().slice(0, 300), author));
    this.profile.facts = [...this.profile.facts, ...made];
    const appearance = made.find((f) => f.key === 'appearance');
    if (appearance) this.profile.appearance = appearance.text.slice(0, 200);
    return made;
  }

  /** §4.2 supersession: never edited in place, always a new row. */
  updateFact(factId: string, text: string, author: string): Fact {
    const old = this.profile.facts.find((f) => f.id === factId);
    if (!old) throw new Error('That note is no longer there.');
    const replacement = newFact(old.key, text.trim().slice(0, 300), author);
    replacement.source = 'family_edit';
    replacement.supersedes = old.id;
    old.active = false;
    old.superseded_by = replacement.id;
    this.profile.facts = [...this.profile.facts, replacement];
    return replacement;
  }

  deactivateFact(factId: string) {
    const f = this.profile.facts.find((x) => x.id === factId);
    if (f) f.active = false;
  }

  deleteMemory(scope: MemoryScope): MemoryDeleted {
    const factCount = this.profile.facts.filter((f) => f.active).length;
    const obsCount = this.items.length;
    if (scope === 'profile' || scope === 'all') {
      this.profile.facts = [];
      this.profile.appearance = null;
      this.profile.usual_spots = [];
    }
    if (scope === 'camera' || scope === 'all') {
      this.items = [];
      this.startedAt = null;
      this.beatIdx = 0;
      this.beatAt = Date.now();
      this.stopped = true;
    }
    return {
      profile_facts: scope === 'camera' ? 0 : factCount,
      observations: scope === 'profile' ? 0 : obsCount,
      camera_events: scope === 'profile' ? 0 : obsCount,
      usual_spots: scope !== 'camera',
    };
  }

  seedEleanor(author = 'Priya Sharma') {
    this.stopped = false;
    this.profile = emptyProfile();
    this.profile.consent = {
      falls: true, camera: true, memory: true,
      signed_by: author, relationship: 'Daughter', signed_at: iso(Date.now()),
    };
    this.profile.camera = {
      camera_id: 'cam_mac_01',
      zone: 'living_room',
      zone_hint: 'The dining table is on the left, her armchair by the window on the right.',
      state: 'watching',
      paused_until: null,
    };
    this.profile.usual_spots = ['at the table in the mornings', 'in her armchair after lunch'];
    this.addFacts(SEEDED_FACTS, author);
  }

  /** §6.1 POST /admin/simulate — the on-stage fallback if the webcam sulks. */
  simulate(kind: 'meal' | 'visitor' | 'out_of_view') {
    this.stopped = false;
    if (this.startedAt == null) this.advance();
    if (kind === 'meal') this.enter(1);
    else if (kind === 'out_of_view') this.enter(3);
    else {
      this.itemSeq += 1;
      this.items.unshift({
        id: `evt_cam_${this.itemSeq.toString(36)}`,
        ts: iso(Date.now()),
        ts_end: null,
        type: 'visitor_present',
        kind: 'observed',
        confidence: 0.7,
        sentence: 'Eleanor had a visitor for about 40 minutes.',
      });
    }
  }

  // ---- chat -----------------------------------------------------------------
  // The guard order is §5.5's: medical, then hard surveillance, then soft,
  // then retrieval. The copy is the plan's fixed sentences, verbatim, because
  // a refusal the family reads is the product's defence, not filler.

  chat(question: string): ChatMessage {
    const q = question.toLowerCase();
    const id = `msg_${Date.now().toString(36)}`;
    const facts = this.profile.facts.filter((f) => f.active);
    const factCite = (key: string): ChatCitation | null => {
      const f = facts.find((x) => x.key === key);
      return f
        ? { id: f.id, kind: 'told' as SourceKind, ts: f.created_at, label: `You told us · ${f.key}`, event_ids: [], text: f.text }
        : null;
    };
    const itemCite = (type: string): ChatCitation | null => {
      const it = this.items.find((x) => x.type === type);
      return it
        ? { id: it.id, kind: 'observed' as SourceKind, ts: it.ts, label: `Dhyaan saw · ${clock(new Date(it.ts).getTime())}`, event_ids: [it.id], text: it.sentence }
        : null;
    };
    const patternCite = (label: string, text: string): ChatCitation => ({
      id: `pat_${label}`, kind: 'pattern' as SourceKind, ts: iso(Date.now()),
      label: 'From her pattern · last 14 days', event_ids: [], text,
    });
    const reply = (
      text: string,
      citations: (ChatCitation | null)[] = [],
      refused = false,
      refusal_kind: ChatMessage['refusal_kind'] = null,
    ): ChatMessage => ({
      id, role: 'dhyaan', text,
      citations: citations.filter((c): c is ChatCitation => c != null),
      refused, refusal_kind,
    });

    // 1. Medical.
    if (/diagnos|medicat|medicine|pill|dose|doctor|symptom|dementia|blood pressure/.test(q)) {
      return reply(
        'Dhyaan isn’t a medical device and can’t answer anything medical. Her doctor is the right person to ask.',
        [], true, 'medical',
      );
    }
    // 2. Hard surveillance, by sub-kind (§5.5).
    if (/photo|picture|image|video|footage|camera feed|show me|watch her|look at her|screenshot/.test(q)) {
      return reply(
        'There is no video to show — not to you, not to anyone. I can tell you what she’s been doing.',
        [], true, 'surveillance',
      );
    }
    if (/\bsay\b|said|talk|conversation|discuss|\bhear\b|audio/.test(q)) {
      return reply(
        'Dhyaan never listens, so there is nothing she said that I could tell you. Someone visited on Tuesday for about 40 minutes.',
        [], true, 'surveillance',
      );
    }
    if (/bathroom|toilet|shower|bedroom|undress|naked|pyjama/.test(q)) {
      return reply(
        'Bedrooms and bathrooms are outside what Dhyaan notices, by design.',
        [], true, 'surveillance',
      );
    }
    if (/right now|at the moment|which room|where is she/.test(q)) {
      return reply(
        'I don’t say where she is in the house. I can tell you she’s at home and what she’s been up to.',
        [], true, 'surveillance',
      );
    }
    if (/wearing|looks? like|\bhair\b|weight|thin\b|\bfat\b/.test(q)) {
      return reply(
        'Dhyaan doesn’t keep or describe what she looks like, and there is no video to show — not to you, not to anyone. I can tell you what she’s been doing.',
        [], true, 'surveillance',
      );
    }
    // 3. Soft surveillance: visitors answer, but only count and duration.
    if (/visitor|visit|who came|who was there|guest|company/.test(q)) {
      return reply(
        'Dhyaan only notes that someone visited, and for how long — never who or what was said. Someone visited on Tuesday for about 40 minutes.',
        [itemCite('visitor_present'), factCite('visitors')],
      );
    }
    // 4. The useful half.
    const meal = this.items.find((i) => i.type === 'meal_observed');
    if (/eat|eaten|meal|food|breakfast|lunch|dinner|appetite/.test(q)) {
      if (/usually|normally|typical/.test(q)) {
        const told = factCite('breakfast') ?? factCite('lunch');
        return told
          ? reply(`You told us: ${told.text}`, [told])
          : reply(
            'You haven’t told Dhyaan anything about her meals yet. Add what you know in Settings and I can compare it to what the camera sees.',
            [],
          );
      }
      if (meal) {
        const told = factCite('breakfast');
        return reply(
          told
            ? `Yes — Dhyaan saw her eat at ${clock(new Date(meal.ts).getTime())} today. You told us she usually has toast and tea around 8, so this was later and lighter than usual.`
            : `Yes — Dhyaan saw her eat at ${clock(new Date(meal.ts).getTime())} today.`,
          [told, itemCite('meal_observed')],
        );
      }
      return reply(
        'Dhyaan hasn’t noticed a meal yet today. It only counts one when it sees a plate and a hand going to her mouth, so a quick snack out of view wouldn’t show up.',
        [factCite('breakfast')],
      );
    }
    if (/afternoon|spend|sit|settle|usual spot/.test(q)) {
      const told = factCite('afternoon');
      const seen = itemCite('activity_observed');
      if (!told && !seen) {
        return reply(
          'Nothing yet — Dhyaan hasn’t watched a full afternoon, and you haven’t told it where she usually spends them.',
          [],
        );
      }
      return reply(
        told && seen
          ? `You told us she spends afternoons in her armchair by the window, reading. Dhyaan has seen her settled in that usual spot today too.`
          : told
            ? `You told us: ${told.text}`
            : 'Dhyaan has seen her settled in her usual spot today.',
        [told, seen, patternCite('spots', 'She is most often found in her usual spot in the early afternoon.')],
      );
    }
    if (/sleep|night|slept|woke|wake/.test(q)) {
      return reply(
        'The camera isn’t in her bedroom, so nights come from her band instead. She has slept through every night this week and woken near her usual 6:40.',
        [factCite('wake'), patternCite('nights', 'Nights are steady: no up-at-night stretches in the last 14 days.')],
      );
    }
    if (/walk|out|outside|went out|left/.test(q)) {
      const exit = itemCite('room_exit');
      return reply(
        exit
          ? 'She went out of view around her usual walk time. Dhyaan can’t see the front door, so it won’t claim she went for a walk — only that she is out of view, and that you told us she usually walks about then.'
          : 'Dhyaan hasn’t seen her go out of view yet today. It can only tell you she’s at home or out of view — never where in the house.',
        [exit, factCite('walk')],
      );
    }
    if (/ok|okay|alright|fine|worried/.test(q)) {
      const p = this.getPresence();
      return reply(
        p.sentence
          ? `${p.sentence} No alerts today.`
          : 'Nothing has happened yet today — the camera is on and has noticed nothing, and there are no alerts.',
        [itemCite('meal_observed')],
      );
    }
    return reply(
      'I can answer from three things: what you told us about her, what the camera noticed, and the pattern it has learned. I don’t have anything that answers that yet — try her meals, her afternoons, her nights, or whether anyone visited.',
      [],
      true,
      'no_data',
    );
  }
}

export const mockCamera = new MockCamera();
