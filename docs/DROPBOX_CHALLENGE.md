# Dropbox challenge — Turn digital chaos into something useful

## The chaos

Every family caring for an aging parent carries the folder: discharge summaries,
handwritten med lists, insurance cards, appointment letters, the POA. It's the
most consequential pile of fragmented content most people will ever own, and it
lives in a kitchen drawer.

## The transformation — files into action

**Her care file** in Dhyaan: paste or photograph any care document and Claude
reads it into structure that *acts*:

- Medications become a schedule in her day's terms ("with breakfast", "at bedtime")
- Appointments land in the app with a one-tap "Text Dev about driving her"
- Allergies, conditions, and her doctor become an **emergency card on the fall-alert
  screen, directly above the 911 guidance** — the crumpled discharge sheet turned
  into life-safety information at the exact moment it matters

Extraction never infers: only what the document states, with the source list kept
("Pasted · 3 medications, 1 appointment, 1 allergy · 2 min ago"). More broadly,
Dhyaan's whole spine is this challenge's verb chain — a fragmented stream of
observations becomes organized (timeline), understandable (daily narratives,
evidence-cited answers), and actionable (an escalation ladder that makes phone
calls).

## Try it

`frontend/` → family demo → Settings → "Her care file" → "Use an example discharge
summary" (works with no API key), or paste/photograph a real one with
`EXPO_PUBLIC_OPENAI_API_KEY` set. Then Settings → "Rehearse a fall alert" to see
the emergency card on the takeover. Deep link for the stage: `dhyaan://carefile?demo=1`.
