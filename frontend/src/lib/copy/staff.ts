// Copy for the staff app, onboarding, and the navigation shell. See README.md
// for the rule: every string a person reads lives here; the screen imports it.
//
// Sections: `shell` (root layout, both tab bars, stack titles), `onboard.*`
// (one sub-section per onboarding screen), `triage`, `resident`, `floor`,
// `rounds`, and `reason` (the one-line "why this row is here" shared by triage
// and rounds). `readout` holds the stand-in values a DataLabel shows when the
// wire has nothing: they are words a person reads, so they are reviewed here.
//
// Anything that interpolates is a function returning the whole sentence, and
// plurals are decided here, not at the call site.
//
// Staff screens MAY name rooms (DECISIONS.md D-001). Nothing under
// `shell.familyTabs` may.

import type { CameraZone } from '@/lib/types';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// The navigation shell
// ---------------------------------------------------------------------------

export const shell = {
  // The family tab bar is rendered by the shell, which is why its titles are
  // here and not in family.ts. None of these may name a room (D-001).
  familyTabs: {
    today: 'Today',
    herDay: 'Her day',
    ask: 'Ask',
    camera: 'Camera',
    settings: 'Settings',
  },
  staffTabs: {
    triage: 'Triage',
    floor: 'Floor',
    rounds: 'Rounds',
  },
  // Native stack titles inside the staff tabs.
  stacks: {
    triage: 'Tonight',
    resident: 'Resident',
    rounds: 'Rounds',
    floor: 'Floor',
  },
  onboard: {
    /** The header carries no title; the screens keep their own headings. */
    title: '',
    cancel: 'Cancel',
  },
} as const;

// ---------------------------------------------------------------------------
// Stand-in readouts: what a DataLabel or stamp shows when there is no value.
// ---------------------------------------------------------------------------

export const readout = {
  noTime: '--:--',
  /** The missing-value glyph. Typography, not prose. */
  blank: '—',
  noRoomStamp: 'NO ROOM',
  none: 'NONE',
  coldBaseline: 'COLD',
} as const;

// ---------------------------------------------------------------------------
// Why a row is where it is. Shared by triage and rounds.
// ---------------------------------------------------------------------------

const ALERT_WORD: Record<string, string> = {
  fall: 'Possible fall',
  bathroom: 'Long bathroom stay',
  sos: 'Help button pressed',
  inactivity: 'Unusually still',
  baseline_deviation: 'Change in routine',
};

export const reason = {
  /** An open alert of `kind`, opened `ago` (already formatted). */
  alertOpened: (kind: string, ago: string) => `${ALERT_WORD[kind] ?? 'Alert'}, opened ${ago}`,
  alertOpen: 'An alert is open for this resident',
  noSignalSince: (ago: string) => `No signal from the band since ${ago}`,
  neverCheckedIn: 'The band has never checked in',
} as const;

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

export const triage = {
  loading: 'Loading tonight’s list…',
  loadError: 'Couldn’t reach the floor list.',
  slab: {
    needsCheck: 'Needs a check',
    onFloor: 'On the floor',
    updated: 'Updated',
  },
  row: {
    seen: 'Seen',
    zone: 'Zone',
    band: 'Band',
    roomStamp: (room: string) => `RM ${room}`,
    a11y: (name: string, room: string | null | undefined) =>
      `${name}, ${room ? `room ${room}` : 'no room'}`,
    acknowledge: 'Acknowledge',
  },
  needsCheck: 'Needs a check',
  ofMeta: (needing: string, total: string) => `${needing} of ${total}`,
  emptyNoResidents: 'No residents on this floor yet.',
  emptyNobody: 'Nobody needs a check right now.',
  doingFine: 'Doing fine',
  hide: 'Hide',
  showN: (n: string) => `Show ${n}`,
  /** Who acknowledged, when the session has no name for this user. */
  ackActorFallback: 'Staff',
  demo: {
    title: 'Demo',
    meta: 'Admin',
    simulateFall: 'Simulate a fall',
    familyApp: 'Family app',
    nothingCrossed: 'The event went in, but nothing crossed an alert threshold.',
    backendError: 'Couldn’t reach the backend.',
  },
} as const;

// ---------------------------------------------------------------------------
// Resident detail
// ---------------------------------------------------------------------------

export const resident = {
  loading: 'Loading…',
  loadError: 'Couldn’t load this resident.',
  notFound: 'Resident not found.',
  openAlert: 'Open the live alert',
  slab: {
    room: 'Room',
    seen: 'Seen',
    band: 'Band',
  },
  where: {
    inZoneSince: (label: string, since: string) => `${label} · since ${since}`,
    noZoneLastHeard: (ago: string) => `No zone signal · last heard ${ago}`,
    noSignalYet: 'No signal from this band yet',
  },
  deviation: {
    /** One sentence for every feature that has drifted from her own routine. */
    summary: (
      firstName: string,
      items: { label: string; value: string; unit: string; usual: string }[],
    ) =>
      `Different from ${firstName}’s own routine: ${items
        .map((i) => `${i.label.toLowerCase()} at ${i.value} ${i.unit} against a usual ${i.usual}`)
        .join('; ')}.`,
  },
  whereToday: {
    title: 'Where they’ve been today',
    meta: (n: number) => plural(n, 'segment', 'segments'),
    nowIn: (label: string, since: string | null) =>
      `Now in the ${label.toLowerCase()}${since ? `, since ${since}` : ''}.`,
    noZone: 'No current zone reading.',
  },
  routine: {
    title: 'Routine',
    meta: (n: number) => plural(n, 'baseline', 'baselines'),
    empty: (firstName: string) => `No baseline has been learned for ${firstName} yet.`,
    usual: 'Usual',
    obs: 'Obs',
    baseline: 'Baseline',
    updated: 'Updated',
    noReading: 'No reading recorded yet.',
    oneReading: (unit: string) => `${unit} · one reading, no trend yet`,
  },
  today: {
    title: 'Today',
    meta: (n: number) => plural(n, 'entry', 'entries'),
    empty: 'Nothing recorded yet today.',
    savingNote: 'Saving note',
  },
  note: {
    label: 'Note',
    placeholder: (firstName: string) => `One line about ${firstName}`,
    save: 'Save note',
    cancel: 'Cancel',
    add: 'Add a note',
    saveError: 'That note didn’t save. Try again.',
  },
  ask: {
    title: (firstName: string) => `Ask about ${firstName}`,
    label: 'Question',
    placeholder: (firstName: string) => `Has ${firstName} been eating?`,
    button: 'Ask',
    error: 'Couldn’t reach Dhyaan. Try again.',
  },
} as const;

// ---------------------------------------------------------------------------
// Floor
// ---------------------------------------------------------------------------

export const floor = {
  loading: 'Loading rooms…',
  loadError: 'Couldn’t reach the floor list.',
  slab: {
    rooms: 'Rooms',
    needSomeone: 'Need someone',
    updated: 'Updated',
  },
  tile: {
    inRoom: 'In room',
    noSignal: 'No signal',
    seen: 'Seen',
    a11y: (room: string | null | undefined, name: string, stateWord: string) =>
      `${room ? `Room ${room}` : 'No room'}, ${name}, ${stateWord}`,
  },
  empty: 'No rooms are set up on this floor yet.',
} as const;

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

export const rounds = {
  loading: 'Loading tonight’s rounds…',
  loadError: 'Couldn’t reach the floor list.',
  slab: {
    needsLook: 'Needs a look',
    onFloor: 'On the floor',
    updated: 'Updated',
  },
  needsLookTonight: 'Needs a look tonight',
  emptyQuiet: 'Nothing has deviated tonight. Every band is still reporting.',
  card: {
    room: 'Room',
    seen: 'Seen',
    band: 'Band',
    a11y: (name: string, room: string | null | undefined) =>
      `${name}, ${room ? `room ${room}` : 'no room'}`,
  },
  rollCall: 'Roll call',
  quietMeta: (n: string) => `${n} quiet`,
  quietA11y: (name: string) => `${name}, quiet`,
  roomStamp: (room: string) => `RM ${room}`,
  emptyNoResidents: 'No residents are set up on this floor yet.',
} as const;

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export type AboutQuestion = {
  /** §4.2's key, exactly: the backend slugs facts by it. */
  key: string;
  prompt: string;
  hint?: string;
  placeholder: string;
  maxLength?: number;
  /** A short pill that writes a whole sentence; the sentence, not the pill,
   *  is what gets stored and read back. */
  chips: (name: string) => { label: string; text: string }[];
};

// The keys are §4.2's, exactly. `private` additionally feeds the chat guard's
// hard list. Each chip's `text` is stored as a profile fact and cited back to
// the family as "You told us", so every one is a sentence that stands alone.
const ABOUT_QUESTIONS: readonly AboutQuestion[] = [
  {
    key: 'wake',
    prompt: 'When is she usually up?',
    placeholder: 'She is usually up around…',
    chips: (n) => [
      { label: 'Around 5:30', text: `${n} is usually up around 5:30.` },
      { label: 'Around 6:30', text: `${n} is usually up around 6:30.` },
      { label: 'Around 7:30', text: `${n} is usually up around 7:30.` },
      { label: 'After 8', text: `${n} is usually up after 8.` },
    ],
  },
  {
    key: 'breakfast',
    prompt: 'What does breakfast usually look like?',
    placeholder: 'Toast and tea, about 8.',
    chips: () => [
      { label: 'Toast and tea', text: 'Toast and tea, about 8.' },
      { label: 'Porridge', text: 'Porridge, about 7:30.' },
      { label: 'Often skips it', text: 'She often skips breakfast.' },
    ],
  },
  {
    key: 'lunch',
    prompt: 'And lunch?',
    placeholder: 'Lunch is usually soup around 12:30.',
    chips: () => [
      { label: 'Soup, 12:30', text: 'Lunch is usually soup around 12:30.' },
      { label: 'Sandwich, 1', text: 'A sandwich around 1.' },
      { label: 'Her main meal', text: 'Lunch is her main meal.' },
    ],
  },
  {
    key: 'dinner',
    prompt: 'And dinner?',
    placeholder: 'Dinner around 6.',
    chips: () => [
      { label: 'Around 6', text: 'Dinner around 6.' },
      { label: 'Around 7', text: 'Dinner around 7, usually something she cooked earlier.' },
      { label: 'Light', text: 'Dinner is usually light.' },
    ],
  },
  {
    key: 'walk',
    prompt: 'Does she go out most days? When?',
    hint: 'The camera can’t see the front door, so this is how Dhyaan knows what being out of view might mean.',
    placeholder: 'She walks to the shops around 10 most mornings.',
    chips: () => [
      { label: 'Morning walk, 10', text: 'She walks to the shops around 10 most mornings.' },
      { label: 'Afternoon', text: 'She goes out in the afternoon most days.' },
      { label: 'Rarely alone', text: 'She rarely goes out on her own.' },
    ],
  },
  {
    key: 'mobility',
    prompt: 'How does she get around?',
    placeholder: 'Steady indoors.',
    chips: () => [
      { label: 'Steady', text: 'Steady on her feet.' },
      { label: 'Cane outdoors', text: 'Uses a cane outdoors, steady indoors.' },
      { label: 'Walker', text: 'Uses a walker indoors and out.' },
    ],
  },
  {
    key: 'afternoon',
    prompt: 'Where does she usually spend her afternoons?',
    hint: 'For example: her armchair by the window.',
    placeholder: 'In the armchair by the window, reading.',
    chips: () => [
      { label: 'Her armchair', text: 'In the armchair by the window, reading.' },
      { label: 'At the table', text: 'At the table with the radio on.' },
      { label: 'On the sofa', text: 'On the sofa with the television.' },
    ],
  },
  {
    key: 'visitors',
    prompt: 'Who visits, and when?',
    hint: 'It only records that someone visited.',
    placeholder: 'Her neighbour comes on Tuesdays.',
    chips: () => [
      { label: 'Neighbour, Tuesdays', text: 'Her neighbour comes on Tuesdays.' },
      { label: 'Family, weekends', text: 'Family visit at weekends.' },
      { label: 'Rarely', text: 'She rarely has visitors.' },
    ],
  },
  {
    key: 'appearance',
    prompt: 'How would you describe her to someone meeting her?',
    hint: 'A text description. No photos.',
    placeholder: 'Short grey hair, glasses, usually a blue cardigan.',
    maxLength: 200,
    chips: () => [
      { label: 'An example', text: 'Short grey hair, glasses, usually a blue cardigan.' },
    ],
  },
  {
    key: 'private',
    prompt: 'Anything Dhyaan should never note?',
    hint: 'These are always off.',
    placeholder: 'Never note bathroom trips.',
    chips: () => [
      { label: 'Bathroom trips', text: 'Never note bathroom trips.' },
      { label: 'Her weight', text: 'Never note anything about her weight.' },
      { label: 'Nothing', text: 'Nothing in particular.' },
    ],
  },
];

export type ConsentGrantKey = 'falls' | 'camera' | 'memory';

// =============================================================================
// CONSENT SCRIPT. VERBATIM FROM THE SPEC (docs/VLM_PLAN.md §5.4,
// docs/PRODUCT_SPEC.md §8.4). This is the text read to a resident when consent
// is taken. It is a compliance artefact, not UI writing. Do not reword,
// re-punctuate, or tidy any character of `title`, `line` or `detail`. It was
// moved here byte-for-byte from src/app/onboard/consent.tsx.
// =============================================================================
const CONSENT_GRANTS: readonly {
  key: ConsentGrantKey; icon: string; title: string; line: string; detail: string[];
}[] = [
  {
    key: 'falls',
    icon: 'figure.fall',
    title: 'Fall detection',
    line: 'Detects falls and calls her, then her contacts.',
    detail: [
      'Her band notices movement, stillness, and a fall. If it thinks she has fallen, it gives her thirty seconds to cancel, then Dhyaan calls her. If she does not answer, it calls the people on her list, in order.',
      'It does not record audio or video. It does not call 911.',
    ],
  },
  {
    key: 'camera',
    icon: 'eye',
    title: 'One room camera',
    line: 'Describes her day in text. No video is saved.',
    detail: [
      'One camera in the room she spends her day in. It is never put in a bedroom or bathroom. It notices whether she is up, whether she has eaten, whether she is settled or moving about, and whether someone is visiting. It turns that into a sentence, on the computer in her home, and throws the picture away. No video is stored. No video is ever shown to family, and there is no way to turn that on. It cannot hear anything. If someone else is alone in the room, Dhyaan may mistake them for her. She can pause it for two hours from the computer, and pausing never affects fall detection.',
    ],
  },
  {
    key: 'memory',
    icon: 'lock',
    title: 'Remembers her routine',
    line: 'Saves her routine on the computer at her house.',
    detail: [
      'To make sense of what it sees, Dhyaan keeps what you tell us about her routine, a few words describing her, and where she usually sits at different times of day. None of this leaves her home, none of it is a face or a photograph, and Forget her profile in Settings removes all of it at once.',
    ],
  },
];
// ========================== END OF VERBATIM CONSENT ==========================

export const onboard = {
  welcome: {
    title: 'Dhyaan',
    tagline: 'Keeps an eye on your mom and calls you if something’s wrong.',
    getStarted: 'Get started',
    exploreDemo: 'Explore the demo',
    exploreDemoA11y: 'Explore the demo. Long-press for the staff demo.',
    source: 'Source',
    sourceSample: 'sample data',
    sourceLive: 'live backend',
    disclaimer: 'Dhyaan is not a medical device and never dials 911.',
  },

  consent: {
    grants: CONSENT_GRANTS,
    title: 'Permissions',
    intro: 'She can change these anytime in Settings.',
    herName: 'Her name',
    herNamePlaceholder: 'Her name',
    yes: 'Yes',
    no: 'No',
    /** Screen-reader label for one Yes/No option on a grant. */
    yesNoA11y: (word: string, grantTitle: string) => `${word} to ${grantTitle}`,
    howItWorks: 'How it works',
    howItWorksA11y: (grantTitle: string) => `How ${grantTitle} works`,
    whoIsAgreeing: 'Who is agreeing',
    yourName: 'Your name',
    yourNamePlaceholder: 'Full name',
    relationship: 'Relationship',
    relationshipPlaceholder: 'Daughter, son, carer',
    agree: 'Agree and continue',
    needAnswers: 'Answer all three.',
    needOneYes: 'Say yes to at least one.',
    needNames: 'Add her name, your name, and your relationship.',
  },

  about: {
    questions: ABOUT_QUESTIONS,
    questionCounter: 'Question',
    fieldLabel: 'What Dhyaan should remember',
    charCount: (n: number, max: number) => `${n} of ${max} characters`,
    storedAsSentence: 'This is stored as a sentence and read back to you when it’s used.',
    next: 'Next',
    saveAll: 'Save what you told us',
    back: 'Back',
    skip: 'Skip this one',
  },

  pair: {
    title: (residentName: string) => `Pair ${residentName}’s band`,
    intro: 'Type the 6-digit code the band shows.',
    codePlaceholder: '000000',
    codeA11y: '6-digit pairing code',
    pair: 'Pair the band',
    continue: 'Continue',
    rejected: 'The hub didn’t accept that code.',
    bandOnFile: 'Band on file',
    recorded: (residentName: string) =>
      `Her hub recorded that band as ${residentName}’s. It has not heard from the band itself yet. It will count as connected the moment the band sends its first reading.`,
    checkDigits: 'Check those digits against the ones printed on the band. The hub accepts any six digits, so a typo here would file her falls under a band nobody is wearing.',
    differentCode: 'Type a different code',
  },

  survey: {
    title: 'Walk each room with the band',
    progress: (done: number, needed: number) => `${done}/${needed}`,
    intro: (residentName: string) => `30 seconds per room teaches Dhyaan where ${residentName} is.`,
    honesty: 'This phone cannot read radio signal strength, so what it sends is only the timing of each reading. Her band’s own readings are what teach the map.',
    continue: 'Continue',
    mapMore: (n: number) => `Map ${plural(n, 'more room', 'more rooms')}`,
    secondsLeft: (s: number) => `${s}s`,
    readings: 'Readings',
    walking: 'Walking now. A reading goes to her hub every two seconds.',
    stored: 'Her hub stored this walk.',
    walkAgain: 'Walk it again',
    tryAgain: 'Try this room again',
    mapRoom: 'Map this room',
    stopError: 'Her hub didn’t confirm that walk.',
    startError: 'Couldn’t start. Is her hub running?',
  },

  camera: {
    title: 'Which room is the camera in?',
    rooms: {
      kitchen: 'Kitchen',
      living_room: 'Living room',
      dining_room: 'Dining room',
      hallway: 'Hallway',
    } satisfies Partial<Record<CameraZone, string>>,
    layoutLabel: 'How is the room laid out?',
    layoutPlaceholder: 'The dining table is on the left, her armchair by the window on the right.',
    layoutHint: 'So Dhyaan can name her spot: her armchair, the table.',
    checklistTitle: 'Before you point it anywhere, check each of these',
    checklist: [
      'It cannot see into a bedroom or bathroom, even through an open doorway.',
      'If a private door is in view, mask it on the computer first. Masked pixels never reach the detector.',
      'Point it at where she usually sits.',
      'She knows it is there, and knows she can pause it for two hours from the computer.',
    ],
    checked: 'Checked',
    confirm: 'Confirm',
    test: 'Test the camera',
    startFirst: 'Start the camera on her computer first.',
    listening: 'Listening for up to 20 seconds…',
    onlineInView: 'Camera online, someone in view.',
    onlineEmpty: 'Camera online, nothing in view yet.',
    notReachable: 'Not reachable.',
    notReachableWith: (detail: string) => `Not reachable. ${detail}`,
    noCameraYet: 'No camera is running on her computer yet.',
    notRunning: 'The camera is set up but is not running right now.',
    finishLater: 'You can finish setup without it and test later.',
    pickRoom: 'Pick the room the camera is in.',
    confirmChecklist: 'Confirm each line of the checklist.',
    continue: 'Continue',
  },

  contacts: {
    title: 'Who should Dhyaan call?',
    meta: (n: number) => plural(n, 'contact', 'contacts'),
    calledInOrder: (residentName: string) => `Called in order if ${residentName} doesn’t answer.`,
    emptyBody: 'Add at least one person. If nobody is on this list, a call that she doesn’t answer has nowhere to go.',
    addFirst: 'Add the first person',
    addAnother: 'Add another person',
    contactLine: (relationship: string, phone: string) => `${relationship} · ${phone}`,
    moveEarlier: (name: string) => `Move ${name} earlier`,
    moveLater: (name: string) => `Move ${name} later`,
    remove: (name: string) => `Remove ${name}`,
    name: 'Name',
    namePlaceholder: 'Their full name',
    phone: 'Phone number',
    phonePlaceholder: '+1 617 555 0142',
    relationship: 'Relationship',
    relationshipPlaceholder: 'Daughter, neighbour',
    cancel: 'Cancel',
    add: 'Add',
    continue: 'Continue',
    saveError: 'Couldn’t save the call list. Try again.',
  },

  done: {
    hero: 'That’s\neverything.',
    getToKnow: (residentName: string) => `Dhyaan will get to know ${residentName} over the next week.`,
    expectTitle: 'What to expect',
    expect: [
      'For the first few days it mostly repeats what you told it.',
      'It learns where she usually sits at each time of day from what it sees, and starts calling it "her usual spot" once it is sure.',
      'You will never see a room name for where she is, and there is no video to see. Ask it anything in the Ask tab.',
    ],
    notesToSave: 'Notes to save',
    noNotes: 'Nothing yet. You can add notes any time in Settings.',
    notesEditable: 'Every one is editable in Settings, and Forget her profile removes all of them at once.',
    openApp: 'Open the app',
    saveAndOpen: 'Save and open the app',
    saveError: 'Couldn’t save that to her home hub.',
    nothingSaved: 'Nothing was saved. Your answers are still on this phone.',
    skipWithoutSaving: 'Skip in without saving',
  },
} as const;
