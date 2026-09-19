# Meta challenge — Bringing People Closer Together with AI

## Who it's for

Priya, 46, and her mother Eleanor, 81, who lives alone. And every family like them —
where love has quietly turned into logistics, and every phone call opens with a
wellness interrogation: *did you eat, did you take your pills, why didn't you answer.*

## How it strengthens connection

Dhyaan takes custody of "is she okay?" so the humans can get their conversation back.

- **"Worth mentioning when you call"** — AI reads her observed day and hands Priya
  openers instead of checkboxes: *"She was out for her morning walk — ask where she
  went, not whether she went."* Telemetry becomes intimacy.
- **"A message from Eleanor"** — when a safety check-in call ends well, the agent
  asks if she'd like to pass anything along. Her words, verbatim, arrive as a card
  in the family app. The scariest artifact in eldercare — the alert call — ends as
  a human moment. She has a voice in the system, not just a sensor on her wrist.
- **Ask about her week** — natural-language questions answered only from what was
  observed, with tappable evidence. The 8 p.m. anxiety call becomes optional; the
  Sunday call becomes about life.

Consent-first by design: Eleanor (or her legal decision-maker) agrees to what is
sensed; video never leaves the home; family can never watch a feed. Connection
built on her dignity, not on surveillance.

## Why AI is essential

Without AI this is a fall-detection pendant — the thing that *replaced* connection
with monitoring. AI is the layer that converts raw observation into human meaning:
a voice agent that hears a frightened person and chooses who to wake up
(`escalate` vs `mark_ok`, live on a phone call); a per-person model of her normal
that knows a missed dinner is a story only on the second night; retrieval that
answers "has mum been eating?" with evidence instead of vibes; and generation that
turns a day of sensor events into something worth talking about.

Meta stack fit: **Muse Spark** generates the "worth mentioning" prompts and the
weekly family letter from the event stream (provider seam in
`frontend/src/lib/http.ts` / `mock/dhyaan.ts`); a **Muse connector** can expose
`POST /chat` so "Muse, how's my grandmother this week?" answers from Dhyaan's
observations.

## Demo

2–3 min video: fall → the room/band notices → Dhyaan calls Eleanor first → her
answer picks the escalation tier → Priya taps "I've got her" → and the alert ends
with Eleanor's own message arriving in Priya's app — then Priya asks "has she been
eating?" and gets an evidenced answer plus what to bring up on tonight's call.
