# Dhyaan app — design system & build rules

Read this before writing any screen. Deviations from this doc are bugs.

## Voice

Dhyaan watches over someone's mother, and the app is for her adult child. Every
screen is reassurance at a distance: it must read like a calm, competent human —
never like a hospital monitor, never like a SaaS dashboard. Big statements are
full sentences in a serif ("Eleanor is having something to eat at the table").
Labels are sentence case. No ALL-CAPS eyebrows, no middle-dot metadata rows, no
icon soup.

**Family screens never name a room.** "She's at home", "Out of view since 10:12",
"settled in her usual spot" — never "She's in the kitchen". This is structural,
not stylistic: `Presence` and `ActivityItem` in `lib/types.ts` have no zone field
at all, so there is nothing on a family screen to leak (`VLM_PLAN.md` §1 and §5.2,
`DECISIONS.md` D-001). If a room name can reach a family screen, that is a bug.
Room names belong on staff screens only.

**No emojis. Anywhere.** Not in copy, not as icons, not as section markers. Icons
are SF Symbols via `<Icon>`. CI check: a grep for `[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]`
over `src/` must return nothing.

**Three kinds, always labelled.** Anything the app tells the family came from one
of three places, and it says which: *Dhyaan saw* (observed), *You told us* (told),
*From her pattern* (pattern). That is the `KindTag` component, and every citation,
timeline row and presence line goes through it. A family must always be able to
tell observed from assumed.

## Tokens — import from `@/theme/tokens`

**Aesthetic reference (per distinctive-frontend.md — document it):** Dhyaan (ध्यान,
"attention") — a warm, handwritten-letter calm: aged paper, indigo-slate ink,
turmeric ochre, and sindoor vermilion (`rust`) held back for the one moment that
matters. Vermilion is **reserved for alerts** — if it appears anywhere but an
alert/attention surface, it's wrong. The rest of the app stays deliberately quiet
so the alert takeover's heat lands as a genuine shock.

- `paper` warm ground, `ink` text, `inkMuted` secondary, `line` hairlines
- `slate` primary/interactive, `slateDeep` pressed
- `moss` = OK, `ochre` = attention/warn, `rust` = alert/critical, `rustDeep` pressed
- `amber`/`amberWash` = the camera's colour, "Dhyaan saw this". It is **not** a
  status colour and never means alert — rust still owns that alone.
- `night*` variants: staff Rounds screen and alert takeover use the night ground

Spacing: `sp(n)` = 4px grid. Radius: `radius.card` (14), `radius.pill` (999).
Never invent hex values or magic paddings.

## Type — extremes, one family

Everything is Fraunces, and the hierarchy is **weight contrast**, not size
(`distinctive-frontend.md` §1). The system sans is gone from body copy.

- `type.hero` — Fraunces **900** at 40/44. The one sentence per screen, and
  nothing else at that size. `PresenceHero` renders it and fades it in when the
  sentence changes under the camera.
- `type.display` / `"title"` / `"stat"` — Fraunces 900/600 for screen titles.
- `type.body` / `"caption"` — Fraunces **300 Light** at 17/13. All prose.
- `type.label` — Fraunces 600 at 13. Labels, buttons, tags.
- Use the `Txt` component for ALL text. Raw `<Text>` is a bug.

`Fraunces_300Light` must be in the `useFonts` call in `app/_layout.tsx` — the
package ships 100–900, so the weight extremes cost no new dependency.

## Components — use these, don't rebuild them

From `@/components`:
- `Screen` — safe-area page wrapper (`scroll` prop), sets ground color
- `Txt` — typography (kinds: display, title, stat, body, label, caption; `tone`)
- `Btn` — primary/quiet/danger buttons, full-width by default
- `StatusDot`, `StateChip` — resident state colors (single source of truth)
- `EventRow` — timeline row: icon glyph, sentence, time, deviation ring
- `RoomTimeBar` — stacked day bar of location segments (zone colors from tokens)
- `LadderTimeline` — live escalation steps w/ pulsing current step
- `Tile` — ADL tile (ate / walked / up at night / out of room)
- `Sparkline` — 14-day mini bars, pure Views
- `Row`, `Hairline`, `SectionTitle` — layout helpers
- `Field` — the one labelled text input. Five screens were about to copy it.
- `PresenceHero` — the 900-weight sentence + its sub-line. Takes a required
  `emptySentence`, because "nothing yet" is the state the demo opens in.
- `KindTag` — observed / told / pattern, as a word plus a colour. The word
  carries the meaning; the colour only reinforces it.
- `CitationChip` — a `KindTag` plus the cited sentence. Tappable only when there
  is an event behind it; a told fact and a pattern line get no dead tap target.
- `FactRow` — one thing the family told Dhyaan. Tapping it supersedes, never
  overwrites.
- `Wash` — the warm gradient + 4% grain ground. Two screens only: sign-in and
  Today.

## Data — never fetch or invent data inline

- Server reads: TanStack Query hooks in `@/lib/hooks` (`useResidents`,
  `useResident`, `useTimeline`, `useSummary`, `useAlert`, `useLocationHistory`…).
- Live state (websocket-owned): zustand `useLive` from `@/store/live` —
  resident state, location, activeAlert, ladder, live transcript.
- Camera lane: `usePresence` (15 s refetch under the `presence.update` socket
  push), `useActivity`, `useProfile` — all from `@/lib/hooks`.
- Session/sign-in/onboarding draft: `useSession` from `@/store/session`. The app
  is gated on `session.user`: no user, no screens.
- Mutations (`ack`, `resolve`, `feedback`, `simulate`, pairing, survey): `api` from `@/lib/api`.
- The mock backend (`@/lib/mock/dhyaan`) simulates the fall ladder in real time.
  `api.simulate('fall')` starts it. Don't touch its internals from screens.

## Motion & feedback

Orchestrated entrance, not scattered micro-interactions (distinctive-frontend.md §3):
screens with a hero moment (Home, the alert takeover) get ONE staggered load
sequence via the shared `Entrance` component — nothing else animates unprompted.
The alert takeover additionally pulses (`LadderTimeline`) and fires heavy haptics
on mount and on ack. Use `Vibration`/haptics only on the alert screen. Every
animation checks `AccessibilityInfo.isReduceMotionEnabled` (the `Entrance`
component does this for you).

## Backgrounds

Atmospheric depth where it earns its place (distinctive-frontend.md §4): the alert
takeover and staff Rounds use a layered `expo-linear-gradient` ground; sign-in and
Today use `<Wash>` — a two-stop warm gradient with `assets/images/grain.png` tiled
at 4% over it. Everything else stays flat paper — depth is spent, not sprinkled.

## The rules that keep this distinctive

1. Spend boldness once per screen — one serif sentence, one big surface. Everything
   else quiet.
2. Structure encodes info: hairlines separate days, numbered steps only in the
   escalation ladder (it is genuinely sequential).
3. Never show an image/video of the resident. Evidence is always a sentence.
4. Empty states invite action ("No walks recorded yet today") — never mood copy.
5. Buttons say what they do: "I've got her", "Call Eleanor", "This was expected".
6. A refusal is not an error. When the chatbot declines a surveillance question it
   renders quietly — a `hand.raised` symbol, slate, a plain sentence, no retry.
   Never red, never amber. The question it won't answer, it won't answer for
   anyone, and saying so calmly is the product working.
7. Every screen's empty state is written before its full state. "Nothing yet
   today" is the most-seen screen in this build.
8. Destructive controls confirm with a real gesture: *Forget her profile* makes
   you type her name, because it cannot be undone.
