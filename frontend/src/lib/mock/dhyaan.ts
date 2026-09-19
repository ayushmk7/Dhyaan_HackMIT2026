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

  getSummaries(residentId: string): DaySummary[] {
    if (residentId !== 'res_eleanor') return [];
    return [...this.world.summaries].reverse();
  }

  getLocationHistory(residentId: string, date: string): LocationSegment[] {
    if (residentId !== 'res_eleanor') return [];
    return this.world.locationDays[date] ?? [];
  }
  get locationDayKeys(): string[] { return Object.keys(this.world.locationDays); }

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
    this.pushLadder(a, { step: 'acknowledged', at: iso(Date.now()), detail: `${by} is on it — ladder stopped` });
    this.setResidentState(a.resident_id, 'ok');
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
        ? `${name}'s band detected a possible fall — peak 3.4 g, then stillness`
        : `${name} has been in the bathroom 40 minutes — her usual is about 6`,
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
      this.pushLadder(alert, { step: 'calling_contact_2', at: iso(Date.now()), detail: 'No response — also calling Dev (son)' });
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

  demoDeviationPush() {
    const e = this.world.events.find((x) => x.type === 'meal_skipped');
    if (e) this.emit({ t: 'event.new', event: e });
  }

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
      text = `Eleanor ate ${meals.length} recorded meals over the last week — breakfast and lunch every day. ` +
        `But no dinner was observed on ${skipped.length} of the last 3 evenings, which is new for her. ` +
        `Her usual dinner time is about 6:20 PM.`;
      citations = cite([...skipped, ...meals]);
    } else if (/walk|exercise|active|moving/.test(q)) {
      const walks = evs.filter((e) => e.type === 'walk_completed');
      text = `She's walking less this week: one walk a day for the last three days, down from her usual two. ` +
        `Her morning walk is intact — it's the afternoon walk she's dropped.`;
      citations = cite(walks);
    } else if (/sleep|night|up at|3 ?am|wake/.test(q)) {
      const night = evs.filter((e) => e.type === 'night_activity');
      text = night.length
        ? `Mostly normal. She was up once at 3:12 AM on ${citationsLabel(night[0])} for about 9 minutes, ` +
          `which is unusual — otherwise she's slept through and woken near her usual 6:40 AM.`
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
        ? `There is an active alert right now — open it from the home screen for the live ladder.`
        : `No falls this week. Her band has raised no alerts, and I have no observations that suggest one.`;
    } else {
      text = `I can only answer from what Dhyaan observed. I don't have observations that answer that — ` +
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
