// Every sentence the family screens say, one section per screen, so a screen's
// voice can be read top to bottom here without opening the component.
//
// Anything that takes a value is a function that returns the whole sentence:
// word order is not universal, and half a sentence cannot be reviewed.
// Plurals are decided here too, never with a ternary at the call site.
//
// Not here, by design: values from the server (her name, a sentence Dhyaan
// wrote), the camera console's telemetry keys and readings (FPS, MODEL, REC,
// PERSON 01), and the missing-value glyph.

/** "1 note" / "3 notes". */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Names on a family screen are first names. */
const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export const family = {
  // Native stack titles for each tab's screens.
  titles: {
    home: 'Dhyaan',
    timeline: 'Her day',
    event: 'Details',
    chat: 'Ask Dhyaan',
    plan: 'Family Plan',
    settings: 'Settings',
    carefile: 'Care File',
    camera: 'Camera',
  },

  // The band's fall record arrives as a log line ("Band band_a3f2 reported
  // fall_suspected"); Today, Her day and Details all read it as this instead.
  shared: {
    fallSuspected: 'Her band reported a possible fall.',
    fallConfirmed: 'Her band confirmed a fall.',
  },

  // ---- Today ---------------------------------------------------------------
  home: {
    loading: (name: string) => `Checking on ${name}…`,
    loadError: (name: string) => `Couldn’t reach Dhyaan to check on ${name}.`,

    // What the camera is doing, under her name. Never where she is.
    subline: {
      noCamera: 'No camera set up yet',
      consentOff: 'Camera off · falls still watched',
      pausedFromApp: (until: string | null) => until ? `Paused from this app until ${until}` : 'Paused from this app',
      pausedByHer: (until: string | null) => until ? `She paused the camera until ${until}` : 'She paused the camera',
      offline: 'Camera not running',
      on: 'Camera on',
      onNoticed: (ago: string) => `Camera on · noticed ${ago}`,
    },

    // The hero, when the server has no sentence yet.
    empty: {
      nothingYet: 'Nothing noticed yet today',
      noCamera: 'No camera yet, so only her band is watching',
      cameraOff: 'The camera is off, so only her band is watching',
      cameraPaused: 'The camera is paused for now',
      pausedBy: (name: string) => `${name} paused the camera for now`,
    },

    call: (name: string) => `Call ${name}`,
    noPhoneFor: (name: string) => `No phone number saved for ${name}, so there is nothing to dial from here`,

    todayError: 'Couldn’t load today’s figures. The rest of the screen is still current.',
    tryAgain: 'Try again',
    // The figures plate opens her day; this is the label on it.
    seeHerDay: 'Her day',
    openHerDay: 'Open her day, hour by hour',
    // Four figures on one plate, a quarter of the screen each: short words.
    tiles: {
      meals: 'Meals',
      minutesInView: 'Minutes seen',
      upAtNight: 'Up at night',
      timesOut: 'Went out',
    },

    // The collapsed rows under the plate. Each is one line and a tap.
    lastNoticed: 'Last noticed',
    fromHer: (name: string) => `From ${name}`,
    replyBody: 'Got your message. ',
    replyByText: 'Reply by text',
    whenYouCall: 'When you call',
    whenYouCallNote: 'Drafted from what Dhyaan saw today, not from things she has said.',
    appointment: 'Appointment',
  },

  // ---- Her day --------------------------------------------------------------
  timeline: {
    filters: {
      all: 'All',
      meals: 'Meals',
      visitors: 'Visitors',
      outAndAbout: 'Out and about',
      nights: 'Nights',
    },

    shareWeek: 'Share her week',
    share: {
      needsAI: 'Writing her week needs Dhyaan’s writing service, which isn’t connected on this phone. Nothing was shared.',
      noLetter: (name: string) => `Dhyaan couldn’t put ${name}’s week into words just now. Nothing was shared.`,
      unreachable: (name: string) => `Dhyaan couldn’t reach far enough to write ${name}’s week. Nothing was shared.`,
    },
    dismiss: 'Dismiss',
    tryAgain: 'Try again',

    previousDay: 'Previous day',
    nextDay: 'Next day',
    noticed: 'Noticed',
    first: 'First',
    last: 'Last',

    loading: 'Reading her day…',
    loadError: 'Couldn’t load her day.',

    story: 'The day’s story',
    storyWritten: (time: string) => `written ${time}`,
    storyDetail: 'the day’s story',
    writeStory: (isToday: boolean) => isToday ? 'Write today’s story now' : 'Write this day’s story now',
    nothingToWrite: (isToday: boolean) =>
      `Dhyaan went back through ${isToday ? 'today' : 'that day'} and didn’t have enough yet to write about.`,
    notWritten: (isToday: boolean) =>
      isToday
        ? 'Dhyaan writes the day’s story each evening. Today’s isn’t written yet.'
        : 'Dhyaan writes the day’s story each evening. There isn’t one for this day.',
    writeNote: 'It takes a few seconds. Dhyaan normally does this overnight.',
    writeError: 'Dhyaan couldn’t write it just now. Nothing was lost.',

    whatItNoticed: 'What it noticed',
    shownOf: (shown: number, total: number) => `${shown} of ${total}`,
    noActivity: (isToday: boolean) =>
      `No activity noticed ${isToday ? 'yet today' : 'on this day'}. Dhyaan only writes a line when it is confident enough to say a whole sentence.`,
    nothingUnder: (filter: string, isToday: boolean) =>
      `Nothing filed under “${filter}” ${isToday ? 'today' : 'on this day'}. Everything else from the day is still here.`,
    showAll: 'Show the whole day',
    openRow: (sentence: string) => `${sentence} Opens the details.`,
    rowLabel: (sentence: string, time: string) => `${sentence} ${time}`,
  },

  // ---- Details (one observation) -------------------------------------------
  event: {
    loadError: 'Couldn’t load that observation.',
    loading: 'Looking that up…',
    gone: 'That observation isn’t here any more. It may have been deleted from her profile, or the link is out of date.',
    backToDay: 'Back to her day',

    // Who noticed it, by the event's source. Never a room.
    source: {
      camera: 'The camera in her home',
      band: 'Her band',
      voice: 'A phone call',
      derived: 'The pattern of her day',
      other: 'A person',
    },
    filedAs: (source: string, title: string) => `${source} noticed this, and Dhyaan filed it as “${title}”.`,
    certainty: (confidence: number) =>
      confidence >= 0.95
        ? 'It is sure enough about this one to say it as a plain sentence.'
        : confidence >= 0.8
          ? 'It is fairly sure about this one. Tell it below if it got this wrong.'
          : 'It is not certain about this one. Tell it below if it got this wrong.',

    recorded: 'Recorded',
    sourceLabel: 'Source',
    confidence: 'Confidence',

    didItGetThisRight: 'Did Dhyaan get this right?',
    feedbackSaved: 'Got it. That’s recorded against this observation.',
    feedbackError: 'Couldn’t save that. Nothing was recorded.',
    tryAgain: 'Try again',
    wasExpected: 'This was expected',
    didNotHappen: 'This didn’t happen',
  },

  // ---- Ask ------------------------------------------------------------------
  chat: {
    // Openers for an empty conversation. Each must be something Dhyaan will
    // answer on a family screen: what it saw, what it was told, her pattern.
    suggestions: [
      'Has she eaten today?',
      'What does she usually have for breakfast?',
      'Did anyone visit this week?',
      'How were her nights this week?',
    ],
    planFromChat: 'Turn a family group chat into a plan',

    // The empty screen's one big sentence, and the law under it.
    hero: (name: string) => `Ask anything about ${name}’s week.`,
    everyAnswer: 'Every answer says where it came from.',
    openCitation: (label: string) => `Open ${label}`,

    // Why an answer was withheld, above the answer itself.
    refusal: {
      surveillance: 'Dhyaan doesn’t answer this, for anyone',
      medical: 'Outside what Dhyaan can answer',
      no_data: 'Dhyaan hasn’t been told or shown this',
      other: 'Dhyaan doesn’t answer this',
    },

    askAbout: (name: string) => `Ask about ${name}`,
    placeholder: (name: string) => `A question about ${name}`,
    ask: 'Ask',
    thinking: 'Reading her day…',
    sendError: 'Couldn’t reach Dhyaan, so your question wasn’t answered. It is still typed below the answer.',
    tryAgain: 'Ask again',
  },

  // ---- Family plan ----------------------------------------------------------
  plan: {
    // The empty screen: what this does, in one sentence, above the paste box.
    hero: 'Paste the thread. Get the plan.',
    threadLabel: 'The family thread',
    threadPlaceholder: 'Paste the family group chat',
    threadHint: 'It is read once to write the plan below. Dhyaan doesn’t keep it.',
    make: 'Write the plan',
    tryAgain: 'Try again',
    tryExample: 'Try an example',

    unreadable: 'Dhyaan couldn’t read that thread just now. Nothing was sent anywhere. Try again in a moment.',
    needsAI: 'Reading a thread needs Dhyaan’s writing service, which isn’t connected on this phone. Nothing was sent anywhere.',

    // The machine reading under the decision: WHEN  Saturday 2pm.
    when: 'When',
    startOver: 'Start over with another thread',
    startOverNote: 'This clears the plan above. The thread you pasted was never kept, so paste it again if you want it back.',
    whoDoingWhat: 'Who’s doing what',
    nobodyAnswered: 'Nobody answered yet',
    replyReady: 'A reply, ready to send',
    copyOut: 'Share this reply',
    shareNote: 'This opens your share sheet. Dhyaan doesn’t post to your group chat itself.',
  },

  // ---- Settings -------------------------------------------------------------
  settings: {
    // Who a note is attributed to when the consent record has no name.
    defaultTeller: 'Family',

    told: {
      title: 'What Dhyaan was told about her',
      notes: (n: number) => count(n, 'note', 'notes'),
      loading: 'Loading her profile…',
      loadError: 'Couldn’t load what Dhyaan was told.',
      empty: 'Nothing told to Dhyaan yet. Until you add what you know, it will say it wasn’t told, rather than guess.',
      howDescribed: 'How you described her',
      usualSpots: 'Her usual spots',
      about: 'About',
      aboutKey: (key: string) => `About ${key.replace(/_/g, ' ')}`,
      whatToRemember: 'What Dhyaan should remember',
      keyPlaceholder: 'breakfast, walk, visitors',
      sentencePlaceholder: 'A whole sentence',
      cancel: 'Cancel',
      save: 'Save',
      saveError: 'Couldn’t save that note. What you typed is still here.',
      deleteWarning: 'Dhyaan will stop knowing this. Answers it already gave keep the words they quoted.',
      deleteNote: 'Delete this note',
      deleteError: 'Couldn’t delete that note. It is still there.',
      keepIt: 'Keep it',
      addNote: 'Add a note',
    },

    camera: {
      title: 'Her camera',
      noCamera: 'No camera is set up. Start it on the computer in her home, then finish setup from there.',
      // The one room name allowed on a family screen: where the family put
      // the camera, not where she is.
      whereInstalled: 'Where it’s installed',
      installedIn: (where: string) => `Installed in the ${where.toLowerCase()}.`,
      notSetUp: 'Not set up',
      state: 'State',
      stateWord: (state: string, pausedUntil: string | null) =>
        state === 'watching' ? 'Watching'
          : state === 'paused' ? (pausedUntil ? `Paused until ${pausedUntil}` : 'Paused')
            : state === 'offline' ? 'Not running'
              : 'Consent off',
      stop: 'Stop the camera',
      stopExplained: 'This turns the camera consent off. The camera on her computer stops within ten seconds. Fall detection is unaffected. There is no switch here to turn it back on; that takes setup again, with her.',
      stopError: 'Couldn’t reach her home hub, so the camera is still running.',
      leaveRunning: 'Leave it running',
    },

    ladder: {
      title: 'Who Dhyaan calls, in order',
      contacts: (n: number) => count(n, 'contact', 'contacts'),
      // "Priya, then Raj, then Meera": the order is the point.
      inOrder: (names: string[]) => names.join(', then '),
      loading: 'Loading…',
      loadError: 'Couldn’t load her contacts.',
      empty: 'Nobody on the list yet, so a call she doesn’t answer has nowhere to go. The list is written during setup, and there isn’t a way to change it from here yet.',
    },

    careFile: {
      title: 'Care file',
      summary: (medications: number, upcoming: number) =>
        `${count(medications, 'medication', 'medications')} · ${upcoming} upcoming`,
      intro: 'Med lists and letters become an emergency card for the alert screen and a note of what’s coming up on Today.',
      open: 'Open her care file',
      addFirst: 'Add the first document',
    },

    happens: {
      title: 'What Dhyaan does when something happens',
      ifFall: 'If her band detects a fall',
      ifFallBody: 'It gives her thirty seconds to cancel, then Dhyaan calls her. If she does not answer, it calls the people above, in order, and your phone is told at the same time.',
      everythingElse: 'Everything else',
      everythingElseBody: 'Meals, walks, visitors, a long stay in one place: these go on her timeline for you to read. Nobody is phoned about them.',
      nothingToSwitch: 'There is nothing to switch here. A fall always calls; nothing else ever does. If that ever becomes a choice, it will be made here.',
      // The one line the collapsed row shows.
      short: 'A fall always calls. Nothing else ever does.',
    },

    consent: {
      title: 'Consent',
      // The plate's machine stamp: CONSENT  12/03/2026.
      stamp: 'Consent',
      recorded: (name: string, by: string, relationship: string, on: string) =>
        `Recorded for ${name}${by ? ` by ${by}` : ''}${relationship ? ` (${relationship})` : ''}${on ? ` on ${on}` : ''}.`,
      falls: 'Fall detection',
      camera: 'Camera',
      memory: 'Keeping a memory of her',
      agreed: 'Agreed',
      declined: 'Declined',
    },

    profile: {
      title: 'Her profile',
      livesAtHome: (name: string) => `Everything Dhyaan keeps about ${name} lives on the computer in her home. No frame of video was ever kept.`,
      shareJson: 'Share her data as JSON',
      shareJsonNote: 'Opens the share sheet with JSON text: her daily summaries, the last seven days of her timeline, and the notes you typed. It is not a printable report.',
      exportTitle: (name: string) => `${name} export`,
      exportError: 'Couldn’t put that together. Nothing was shared.',
      tryAgain: 'Try again',

      // Over the three irreversible controls, which sit apart from everything else.
      cannotUndo: 'None of these can be undone.',
      forget: 'Forget her profile',
      forgetExplained: 'This deletes every note, every observation and everything Dhyaan learned about where she sits. It cannot be undone. Fall detection and the camera keep running, and you stay signed in.',
      typeToConfirm: (name: string) => `Type “${name}” to confirm`,
      forgetEverything: 'Forget everything about her',
      keepProfile: 'Keep her profile',
      forgot: (notes: number, observations: number, cameraEvents: number) =>
        `Deleted ${count(notes, 'note', 'notes')}, ${count(observations, 'observation', 'observations')} and ${count(cameraEvents, 'camera event', 'camera events')}. There was never a picture to delete.`,
      nothingDeleted: 'Nothing was deleted. Check the connection and try again.',

      wipe: 'Delete everything and stop Dhyaan',
      wipeExplained: 'This deletes everything above, then turns off fall detection, the camera and her profile, and signs this phone out. Dhyaan stops watching and stops calling. It cannot be undone.',
      leaveRunning: 'Leave Dhyaan running',
      stillRunning: (notes: number, observations: number, cameraEvents: number, why: string) =>
        `Deleted ${count(notes, 'note', 'notes')}, ${count(observations, 'observation', 'observations')} and ${count(cameraEvents, 'camera event', 'camera events')}, but Dhyaan is still running: ${why}. Try again.`,
      hubNoAnswer: 'the hub did not answer',
    },

    band: {
      title: 'Her band',
      body: 'Her band was paired during setup, and the rooms were walked then. There isn’t a way to pair a new band or walk the rooms again from here yet.',
    },


    // Behind a long-press. Demo and diagnostics, never visible chrome.
    debug: {
      mode: 'Mode',
      apiBase: 'API base',
      lastOk: 'Last ok',
      noneYet: 'none yet',
      easProject: 'EAS project',
      unset: 'unset',
      testConnection: 'Test connection',
      reached: (time: string) => `Reached it · ${time}`,
      failed: (why: string) => `Failed: ${why}`,
      unknownError: 'unknown error',
      rehearseFall: 'Rehearse a fall alert',
      rehearsalError: 'Couldn’t start the rehearsal.',
      simulateMeal: 'Simulate a meal',
      simulateVisitor: 'Simulate a visitor',
      simulateOutOfView: 'Simulate out of view',
      simulated: (kind: string) => `Simulated ${kind.replace(/_/g, ' ')}`,
      registerPush: 'Register for push',
      pushNeedsId: 'Push needs an EAS project id',
      easMissing: (id: string) =>
        `app.json still has extra.eas.projectId = ${id || 'nothing'}. Run npx eas init on a machine signed in to an Expo account, put the id it writes into app.json, and rebuild.`,
      pushRegistered: (tail: string) => `Push registered · …${tail}`,
      sendTestPush: 'Send a test notification',
      staffSide: 'Staff side',
    },
  },

  // ---- Care file ------------------------------------------------------------
  carefile: {
    intro: 'Paste or photograph a care document.',
    introNote: 'What it finds stays on this phone until the app is closed. It is not sent to her home hub.',
    placeholder: 'Paste a document here',
    fieldLabel: 'The care document',
    readIt: 'Read this document',
    tryAgain: 'Try again',
    addPhoto: 'Add a photo',
    tryExample: 'Try an example',
    // The summary is the model's own sentence and usually brings its own
    // full stop; never add a second one.
    added: (what: string) => `Added: ${/[.!?]$/.test(what.trim()) ? what.trim() : `${what.trim()}.`}`,
    unreadable: 'Couldn’t read that as a care document. Try a clearer copy.',
    needsAI: 'Reading a document needs Dhyaan’s reading service, which isn’t connected on this phone. Nothing was added.',

    medications: 'Medications',
    comingUp: 'Coming up',
    textAboutDriving: (contactName: string) => `Text ${first(contactName)} about driving her`,
    drivingMessage: (name: string, title: string, when: string) => `${name} has ${title} on ${when}. Can you drive her?`,

    inEmergency: 'In an emergency',
    allergicTo: (allergies: string[]) => `Allergic to ${allergies.join(', ')}`,

    documentsRead: 'Documents read',
    source: (kind: 'photo' | 'paste', summary: string) => `${kind === 'photo' ? 'Photo' : 'Pasted'} · ${summary}`,
    addAnother: 'Add another document',
  },

  // ---- Camera console -------------------------------------------------------
  // The telemetry strip's keys and readings are the machine's own and stay in
  // the screen; this is only what a person reads.
  camera: {
    paneLabel: (people: number, sentence: string) =>
      `Derived camera view. ${people === 1 ? 'One person' : `${people} people`} in frame. ${sentence || 'No sentence yet.'} No video is shown.`,
    noSentence: 'No sentence yet. The model has not been asked.',
    privacy: 'No picture is kept, and none ever leaves her computer. What you are watching is the shape the camera found and the sentence it wrote about it. That is the whole of what Dhyaan ever has.',

    loading: 'Looking for her camera…',
    camerasError: 'Couldn’t reach the hub to ask what cameras exist.',
    openSettings: 'Open Settings',
    noCamera: 'No camera is set up.',
    noCameraBody: 'Nothing is watching, and nothing is posting. Point a camera at one common room in Settings, then start the vision worker on her computer. This screen fills in the moment it says something.',
    consentOff: 'The camera is off.',
    consentOffBody: 'Consent for the camera hasn’t been given, so the worker doesn’t run and there is nothing to show. Her band still watches for falls.',
    paused: (until: string) => `Paused until ${until}.`,
    pausedBody: 'While it’s paused the worker stops looking, so no ticks arrive and this stays empty. It starts again on its own, or you can resume it below.',
    listening: 'Listening for the worker…',
    monitorError: 'Couldn’t reach the hub to ask what the worker is doing. Nothing is being shown rather than something out of date.',
    notPosting: 'The worker isn’t posting anything.',
    notPostingBody: 'Nothing has arrived from her computer in the last few seconds. Start the vision worker there and this fills in by itself. Until then there is nothing to show, and inventing a reading would be worse than an empty screen.',

    // Uppercase machine meta under an empty state.
    meta: {
      camera: (id: string) => `CAMERA ${id}`,
      lastHeartbeat: (ago: string) => `LAST HEARTBEAT ${ago}`,
      noHeartbeat: 'NO HEARTBEAT YET',
    },

    // The one heading under the pane: the cascade and the readings together.
    worker: 'The worker',

    simulate: 'Simulate',
    meal: 'Meal',
    visitor: 'Visitor',
    outOfView: 'Out of view',
    resume: 'Resume the camera',
    pauseTwoHours: 'Pause for 2 hours',
    trouble: 'That didn’t go through, so nothing changed. The hub may not be reachable.',
  },

  // ---- The live alert -------------------------------------------------------
  alert: {
    kind: {
      fall: 'Possible fall',
      bathroom: 'Long bathroom stay',
      sos: 'Help button pressed',
      inactivity: 'Unusually still',
      baseline_deviation: 'Change in routine',
    } as Record<string, string>,
    headline: (kind: string, name: string) =>
      kind === 'bathroom' ? `${name} has been in the bathroom a long time.` : `${name} may have fallen.`,

    // When the session has no name for who is involved.
    unknownResident: 'the resident',
    unknownFamily: 'her family',
    actorStaff: 'Staff',
    actorFamily: 'Family',

    loading: 'Loading the alert…',
    loadError: 'Couldn’t reach Dhyaan to load this alert. If you can’t wait, call her directly.',
    backHome: 'Back to Today',
    alreadyHandled: 'That alert has already been handled.',
    actionError: 'That didn’t go through. Someone else may already be on it; this screen is checking.',

    /**
     * How it ended, from the FSM's closing state. Only one of the five ways an
     * alert closes means a person picked up, so each gets its own sentence.
     */
    closed: (state: string, resolution: string | null, who: string | undefined, name: string): string => {
      switch (state) {
        case 'cancelled':
          return resolution === 'false_positive' && !who
            ? `${name} cancelled it from her band. Nobody was called.`
            : who ? `Cancelled by ${who}. Nobody was called.` : 'Cancelled. Nobody was called.';
        case 'resolved_ok':
        case 'resolved':
          return `${name} answered and said she is all right. Nobody else was called.`;
        case 'exhausted':
          return 'Nobody answered. Dhyaan has run out of people to call.';
        case 'acknowledged':
          return who ? `${who} is on it. The ladder has stopped.` : 'Someone has got her. The ladder has stopped.';
        case 'manually_resolved':
          switch (resolution) {
            case 'ok': return 'Resolved. Someone checked on her.';
            case 'fell_ok': return `${name} fell but is all right.`;
            case 'ems': return 'Paramedics were called. The ladder has stopped.';
            case 'false_positive': return 'Marked as a false alarm. Nothing else will happen.';
            default: return 'Closed. The ladder has stopped.';
          }
        default:
          return resolution === 'false_positive'
            ? 'Marked as a false alarm. Nothing else will happen.'
            : 'This alert has been closed. The ladder has stopped.';
      }
    },
    savedToTimeline: (name: string) => `Saved to ${name}’s timeline.`,
    noRecordOfWho: 'Dhyaan didn’t record who answered it.',

    call: (name: string) => `Call ${name}`,
    noNumber: (name: string) => `Dhyaan doesn’t have a number for ${name}, so it can’t hand you one to dial.`,
    noNumberCalling: (name: string) =>
      `Dhyaan doesn’t have a number for ${name}, only for her contacts, so it can’t hand you one to dial. Dhyaan is calling her itself.`,
    call911: 'Call 911',
    dialerNote: 'Opens your dialer. Dhyaan never calls 911 itself.',
    dialerNoteFinal: 'Dhyaan does not dial 911 for you. If you can’t reach her, this button opens your dialer.',

    // The middle of the takeover, by phase.
    workingOut: 'Dhyaan is working out what to do next.',
    calling: (name: string) => `Calling ${name} now…`,
    noAnswer: (state: string, name: string): string => {
      switch (state) {
        case 'retry_resident':
          return `${name} didn’t pick up. Dhyaan is trying her once more.`;
        case 'voicemail':
          return `${name} didn’t pick up. Dhyaan left her a message and is calling her family next.`;
        case 'fell_but_fine':
          return `${name} says she fell but is all right. Dhyaan is telling her family anyway.`;
        case 'scheduled_callback':
          return `${name} asked Dhyaan to call back. Her family is being told too.`;
        default:
          return `${name} didn’t answer. Calling her family next.`;
      }
    },
    callingBoth: (a: string, b: string) => `Calling ${a} and ${b} at the same time`,
    callingThenNext: (a: string, b: string) => `Calling ${a} · ${b} is next if she doesn’t pick up`,
    callingOne: (a: string) => `Calling ${a}`,
    nobodyYet: 'Nobody has answered yet. Every contact is being told, with her address.',

    assignToMe: 'Assign to me',
    assigned: 'Assigned to you. The ladder has stopped.',
    gotHer: 'I’ve got her',
    youHaveGotHer: 'You’ve got her. The ladder has stopped.',

    whatDone: 'What Dhyaan has done',
    state: 'State',
    opened: 'Opened',
    noHistory: 'Dhyaan isn’t sending the step-by-step history for this alert. This is where it has got to, and it is updating as it goes.',

    hearing: 'What the call is hearing',
    heard: 'What the call heard',
    speakerDhyaan: 'Dhyaan: ',
    speakerHer: (name: string) => `${name}: `,

    ratherYourself: 'If you’d rather do it yourself',
    resolvedChecked: 'Resolved, checked on her',
    resolvedNote: 'Resolved. Noted on her record.',
    falseAlarm: 'False alarm',
    falseAlarmNote: 'Marked as a false alarm. Nothing else will happen.',

    paramedics: 'For the paramedics',
    fromCareFile: 'From her care file',
  },

  // ---- Rehearsal (deep link) ------------------------------------------------
  simulate: {
    rehearsal: 'Rehearsal',
    sending: 'Sending a rehearsal fall through the real pipeline…',
    wentThrough: 'The rehearsal went through, and nothing needed an alert.',
    didNotGoThrough: 'The rehearsal didn’t go through.',
    recorded: 'Dhyaan recorded the event. It only opens an alert when the ladder has a reason to start, so there is nothing here to take over the screen.',
    requestFailed: 'The request didn’t reach her home hub. Nothing was recorded.',
    backToToday: 'Back to Today',
    tryAgain: 'Try the rehearsal again',
  },
} as const;

export type FamilyCopy = typeof family;
