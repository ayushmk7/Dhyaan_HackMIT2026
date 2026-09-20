// In-memory Dhyaan backend. Implements the §10.5 contract shapes the app uses,
// plus a real-time fall-ladder simulation driven by timers (§4.2 timings, compressed
// ~6x so a demo fits in a minute).
import type {
  Alert, ChatCitation, ChatMessage, DaySummary, KEvent, LadderStep,
  LocationSegment, Resident, WsEnvelope,
} from '../types';
import {
  dayKey, eid, eleanorBaselines, eleanorContacts, eleanorResident,
  facilityResidents, generateEleanor, iso,
} from './data';

type Listener = (m: WsEnvelope) => void;

const SPEED = 6; // ladder timings divided by this
const secs = (s: number) => (s * 1000) / SPEED;

class MockDhyaan {
  private now = Date.now();
  private world = generateEleanor(this.now);
  private residents: Resident[] = [eleanorResident(this.now), ...facilityResidents];
  private alerts: Alert[] = [];
  private listeners = new Set<Listener>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private chatLog: ChatMessage[] = [];

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  private emit(m: WsEnvelope) {
    this.listeners.forEach((fn) => fn(m));
  }

  // ---- reads ----------------------------------------------------------------
  listResidents(): Resident[] { return [...this.residents]; }
  getResident(id: string): Resident | undefined { return this.residents.find((r) => r.id === id); }

  getEvents(residentId: string, limit = 200): KEvent[] {
    return this.world.events.filter((e) => e.resident_id === residentId).slice(0, limit);
  }
  getEvent(id: string): KEvent | undefined { return this.world.events.find((e) => e.id === id); }

  /** A note someone typed, stored as a real event — same as the server does. */
  addNote(text: string, role: 'staff' | 'family'): KEvent {
    const e: KEvent = {
      id: `evt_note_${Date.now().toString(36)}`,
      resident_id: 'res_eleanor',
      source: 'manual',
      type: role === 'staff' ? 'staff_note' : 'family_note',
      ts: new Date().toISOString(),
      ts_end: null,
      confidence: 1,
      zone: null,
      payload: { text, role },
      embedding_text: text,
      review_state: 'unreviewed',
    };
    this.world.events.unshift(e);
    this.emit({ t: 'event.new', event: e });
    return e;
  }

  getSummaries(residentId: string): DaySummary[] {
    if (residentId !== 'res_eleanor') return [];
    return [...this.world.summaries].reverse();
  }

  getLocationHistory(residentId: string, date: string): LocationSegment[] {
    if (residentId !== 'res_eleanor') return [];
    return this.world.locationDays[date] ?? [];
  }

  getBaselines(residentId: string) {
    return residentId === 'res_eleanor' || residentId.startsWith('res_') ? eleanorBaselines : [];
  }
  getContacts() { return [...eleanorContacts]; }

  listOpenAlerts(): Alert[] { return this.alerts.filter((a) => !a.closed_at); }
  getAlert(id: string): Alert | undefined { return this.alerts.find((a) => a.id === id); }

  // ---- alert lifecycle --------------------------------------------------------
  ack(alertId: string, by: string) {
    const a = this.getAlert(alertId);
    if (!a || a.closed_at) return;
    this.clearTimers();
    a.state = 'acknowledged';
    a.acked_by = by;
    a.closed_at = iso(Date.now());
    a.resolution = 'ok';
    this.pushLadder(a, { step: 'acknowledged', at: iso(Date.now()), detail: `${by} is on it. Ladder stopped` });
    this.setResidentState(a.resident_id, 'ok');
    // She gets the last word — the scary call ends as a human moment.
    this.message = { text: 'Tell Priya not to fuss. I’m alright, just clumsy.', at: iso(Date.now()) };
    this.emit({ t: 'alert.closed', alert_id: a.id, resolution: 'ok', acked_by: by });
  }

  resolve(alertId: string, resolution: string) {
    const a = this.getAlert(alertId);
    if (!a || a.closed_at) return;
    this.clearTimers();
    a.state = 'resolved';
    a.resolution = resolution;
    a.closed_at = iso(Date.now());
    this.setResidentState(a.resident_id, 'ok');
    this.emit({ t: 'alert.closed', alert_id: a.id, resolution, acked_by: a.acked_by });
  }

  feedback(_eventId: string, verdict: 'expected' | 'false_positive', _reason?: string) {
    return {
      downweighted: ['walk_count', 'meal_count'],
      suppress_until: dayKey(Date.now() + 7 * 86_400_000),
      verdict,
    };
  }

  // ---- the demo trigger -------------------------------------------------------
  simulate(kind: 'fall' | 'bathroom' = 'fall', residentId = 'res_eleanor'): Alert {
    const open = this.listOpenAlerts()[0];
    if (open) return open;
    const now = Date.now();
    const alert: Alert = {
      id: `alr_${now.toString(36)}`,
      resident_id: residentId,
      kind: kind === 'fall' ? 'fall' : 'bathroom',
      severity: kind === 'fall' ? 'critical' : 'warn',
      state: 'suspected',
      opened_at: iso(now),
      closed_at: null,
      resolution: null,
      acked_by: null,
      ladder: [],
      calls: [],
    };
    this.alerts.unshift(alert);
    this.setResidentState(residentId, 'alerting');
    this.emit({ t: 'alert.opened', alert: { ...alert }, resident_id: residentId });

    const name = this.getResident(residentId)?.display_name ?? 'the resident';
    this.pushLadder(alert, {
      step: 'suspected', at: iso(now),
      detail: kind === 'fall'
        ? `${name}'s band detected a possible fall: 3.4 g impact, then stillness`
        : `${name} has been in the bathroom 40 minutes. Her usual is 6`,
    });

    // Compressed §4.2 ladder.
    this.after(secs(8), () => this.pushLadder(alert, {
      step: 'cancel_window', at: iso(Date.now()),
      detail: 'Waiting 30 seconds so she can cancel from the band',
    }));
    this.after(secs(30), () => {
      alert.state = 'calling_resident';
      this.pushLadder(alert, { step: 'calling_resident', at: iso(Date.now()), detail: `Calling ${name} now` });
      alert.calls.push({ role: 'resident', classification: null, transcript: [], duration_s: null });
    });
    this.after(secs(38), () => this.voice(alert, 'agent',
      `Hi ${name}, this is Dhyaan calling because your band thought you might have fallen. Are you okay?`));
    this.after(secs(48), () => this.voice(alert, 'agent', `${name}, can you hear me? Are you okay?`));
    this.after(secs(60), () => {
      alert.calls[0].classification = 'no_answer';
      alert.calls[0].duration_s = 27;
      this.pushLadder(alert, { step: 'no_answer', at: iso(Date.now()), detail: 'No answer after 27 seconds', outcome: 'no_answer' });
    });
    this.after(secs(75), () => {
      alert.state = 'calling_contact_1';
      this.pushLadder(alert, { step: 'calling_contact_1', at: iso(Date.now()), detail: 'Calling Priya (daughter)' });
      alert.calls.push({ role: 'contact_1', classification: null, transcript: [], duration_s: null });
    });
    this.after(secs(135), () => {
      alert.state = 'calling_contact_2';
      this.pushLadder(alert, { step: 'calling_contact_2', at: iso(Date.now()), detail: 'No response. Also calling Dev (son)' });
    });
    this.after(secs(195), () => {
      alert.state = 'escalated_final';
      this.pushLadder(alert, {
        step: 'escalated_final', at: iso(Date.now()),
        detail: 'Nobody has responded. Texting all contacts with her address and 911 guidance',
      });
    });
    return alert;
  }


  // ---- connection layer (Meta challenge): observations → things to talk about ---
  // ponytail: live path swaps this for one Muse Spark call over the day's events;
  // the shape (3 short strings) is the contract, the generator is disposable.
  talkAbout(): string[] {
    const evs = this.world.events;
    const out: string[] = [];
    if (evs.find((e) => e.type === 'walk_completed')) {
      out.push('Ask where her morning walk went');
    }
    if (evs.filter((e) => e.type === 'meal_skipped').length >= 2) {
      out.push('Suggest Sunday dinner together');
    }
    if (evs.find((e) => e.type === 'night_activity')) {
      out.push('Ask how she’s sleeping');
    }
    out.push('Afternoons are a good time to call');
    return out.slice(0, 3);
  }

  // Canned plan for when no Claude key is configured — same shape as ai.planFromThread.
  planFromThread(_thread: string) {
    return {
      headline: 'Mom’s birthday lunch, Sunday the 12th at her place.',
      when: 'Sunday Oct 12, noon',
      tasks: [
        { who: 'Priya', what: 'Brings the cake and picks up flowers' },
        { who: 'Dev', what: 'Drives Mom, handles groceries Saturday' },
        { who: 'Nisha', what: 'Cooks the biryani, arrives at 10' },
      ],
      open_questions: [
        'Is Uncle Raj invited? Nobody answered.',
        'Gluten-free or regular cake? Two people asked, no one decided.',
      ],
      reply_text:
        'Locking it in: Sunday the 12th, noon, at Mom’s. Priya: cake + flowers. Dev: driving Mom + groceries. Nisha: biryani. Still open: is Raj coming, and GF or regular cake?',
    };
  }

  sundayLetterDraft(): string {
    return this.world.summaries.map((s) => `${s.date_local}: ${s.narrative}`).join('\n');
  }

  private message: { text: string; at: string } | null = {
    text: 'Tell Priya I’m fine. And that I found her grandmother’s recipe box in the attic.',
    at: iso(Date.now() - 3 * 3_600_000),
  };
  latestMessage() { return this.message; }

  // ---- chat: keyword retrieval over real mock events ---------------------------
  chat(question: string): ChatMessage {
    const q = question.toLowerCase();
    const cite = (events: KEvent[], n = 3): ChatCitation[] =>
      events.slice(0, n).map((e) => ({
        id: e.id, kind: 'event', ts: e.ts,
        label: new Date(e.ts).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }),
        event_ids: [e.id],
      }));
    const evs = this.world.events;
    let text: string; let citations: ChatCitation[] = []; let refused = false;

    if (/eat|meal|food|dinner|lunch|breakfast|appetite/.test(q)) {
      const meals = evs.filter((e) => e.type === 'meal_observed');
      const skipped = evs.filter((e) => e.type === 'meal_skipped');
      text = `Asha ate ${meals.length} recorded meals this week, breakfast and lunch every day. ` +
        `But no dinner was observed on ${skipped.length} of the last 3 evenings, which is new for her. ` +
        `Her usual dinner time is about 6:20 PM.`;
      citations = cite([...skipped, ...meals]);
    } else if (/walk|exercise|active|moving/.test(q)) {
      const walks = evs.filter((e) => e.type === 'walk_completed');
      text = `She's walking less this week: one walk a day for the last three days, down from her usual two. ` +
        `Her morning walk is intact. It's the afternoon walk she's dropped.`;
      citations = cite(walks);
    } else if (/sleep|night|up at|3 ?am|wake/.test(q)) {
      const night = evs.filter((e) => e.type === 'night_activity');
      text = night.length
        ? `Mostly normal. She was up once at 3:12 AM on ${citationsLabel(night[0])} for about 9 minutes, ` +
          `which is unusual for her. Otherwise she's slept through and woken near her usual 6:40 AM.`
        : `She's slept through every night this week, waking near her usual 6:40 AM.`;
      citations = cite(night);
    } else if (/outside|out of|left home|garden/.test(q)) {
      const outs = evs.filter((e) => e.zone === 'outside');
      text = `She last went outside ${outs[0] ? citationsLabel(outs[0]) : 'earlier this week'} for her morning walk. ` +
        `She's gone out every morning this week.`;
      citations = cite(outs);
    } else if (/fall|fell|hurt|alert/.test(q)) {
      const open = this.listOpenAlerts()[0];
      text = open
        ? `There is an active alert right now. Open it from the home screen to follow it live.`
        : `No falls this week. Her band has raised no alerts, and I have no observations that suggest one.`;
    } else {
      text = `I can only answer from what Dhyaan observed, and nothing I have answers that. ` +
        `try asking about her meals, walks, sleep, or time outside.`;
      refused = true;
    }

    function citationsLabel(e: KEvent) {
      return new Date(e.ts).toLocaleDateString(undefined, { weekday: 'long' });
    }

    const msg: ChatMessage = { id: `msg_${Date.now().toString(36)}`, role: 'dhyaan', text, citations, refused };
    this.chatLog.push(msg);
    return msg;
  }

  // ---- internals ---------------------------------------------------------------
  private pushLadder(alert: Alert, step: LadderStep) {
    if (alert.closed_at) return;
    alert.ladder.push(step);
    this.emit({ t: 'alert.ladder', alert_id: alert.id, step });
  }
  private voice(alert: Alert, speaker: 'agent' | 'resident', text: string) {
    if (alert.closed_at) return;
    const call = alert.calls[alert.calls.length - 1];
    call?.transcript.push({ speaker, text });
    this.emit({ t: 'alert.voice', alert_id: alert.id, speaker, text });
  }
  private setResidentState(id: string, state: Resident['state']) {
    const r = this.getResident(id);
    if (r) r.state = state;
    this.emit({ t: 'resident.state', resident_id: id, state });
  }
  private after(ms: number, fn: () => void) {
    this.timers.push(setTimeout(fn, ms));
  }
  private clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
}

export const dhyaan = new MockDhyaan();
export { eid };
