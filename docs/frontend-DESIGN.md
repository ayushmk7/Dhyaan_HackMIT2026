# Dhyaan app — design system & build rules

Read this before writing any screen. Deviations from this doc are bugs.
`src/theme/tokens.ts` is the machine-readable half of this document; where the
two disagree, tokens win and this file is stale.

## The reference

**Apple Liquid Glass, with hints of brutalism.** Floating, translucent,
depth-layered surfaces carry the chrome; an occasional hard, honest gesture —
a 2px ink rule, a monospace reading, a bare corner tick — keeps it from being
soft mush.

The two halves do different jobs and never blur into each other:

- **Glass is for chrome.** Anything content travels *under*: the tab bar, a
  pinned action, a header, a sheet, the alert takeover, the presence hero.
- **Brutalism is for machine origin.** Telemetry, timestamps, counters, the
  camera console's frame. It marks *"a machine produced this"*.
- **Everything between the two is calm, opaque and quiet** — which is most of
  the app, and deliberately so.

## Voice

Dhyaan watches over someone's mother, and the app is for her adult child. Every
screen is reassurance at a distance: it must read like a calm, competent human —
never like a hospital monitor, never like a SaaS dashboard. Big statements are
full sentences. Labels are sentence case. No ALL-CAPS eyebrows in prose, no
middle-dot metadata rows, no icon soup.

**ALL-CAPS is telemetry-only.** `FPS`, `LATENCY`, `MODEL`, `REC`, `SOURCE`,
`DEVICE` — machine words, rendered through `<DataLabel>`. If a person would say
the words out loud to another person, caps are a bug. Brutalism never touches
the reassuring human sentences; that is the single rule that keeps the style
from eating the product.

**Family screens never name a room.** "She's at home", "Out of view since 10:12",
"settled in her usual spot" — never "She's in the kitchen". This is structural,
not stylistic: `Presence` and `ActivityItem` in `lib/types.ts` have no zone field
at all, so there is nothing on a family screen to leak (`VLM_PLAN.md` §1 and §5.2,
`DECISIONS.md` D-001). Room names belong on staff screens only.

**No emojis. Anywhere.** Not in copy, not as icons, not as section markers. Icons
are SF Symbols via `<Icon>`. CI check: a grep for `[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]`
over `src/` must return nothing.

**Three kinds, always labelled.** Anything the app tells the family came from one
of three places, and it says which: *Dhyaan saw* (observed), *You told us* (told),
*From her pattern* (pattern). That is `KindTag`, and every citation, timeline row
and presence line goes through it.

## Colour — import from `@/theme/tokens`

**Chrome carries no hue.** Interactive = ink. Affordance comes from form (a
filled button, a chevron, a weight), never from colour. Every hue in the app has
exactly one meaning:

- `moss` = OK. `ochre` = worth a look. `rust` = **alarm, and nothing else.**
- `hue.*` = data category (the Apple Health taxonomy: activity, sleep, heart…).
- `amber` / `amberWash` = the camera's colour, "Dhyaan saw this just now". Not a
  status, never an alert.
- `zoneColor.*` = rooms, staff screens only.
- Everything else is `paper` / `raised` / `ink` / `inkMuted` / `line`, plus the
  `night*` set for the staff Rounds screen and the alert takeover.

Glass adds **no hue**. `glass.tint.*` is near-colourless on purpose — a glass
surface borrows its colour from whatever is scrolling beneath it. Do not repaint
the app to make glass visible; add depth instead.

Spacing: `sp(n)` = 4px grid. Radius: `radius.card` (16), `radius.glass` (22),
`radius.sheet` (28), `radius.bar` (30), `radius.pill`. Never invent hex values
or magic paddings.

## Depth — four tiers, and they mean things

`elevation.*` in tokens. A surface picks a tier; it does not invent a shadow.

| tier | what sits there |
| --- | --- |
| `flat` | the page ground itself |
| `raised` | content cards resting on it (the old `cardShadow`) |
| `float` | chrome content passes **under** — bars, headers, the hero |
| `takeover` | the alert, which owns the whole screen |

### When glass is spent, and when a surface stays flat

Glass costs legibility and battery, and frosted text over frosted text is how a
design system dies. So:

**Spend glass when** something scrolls beneath the surface (a `FloatingBar`, a
tab bar, a sticky header), when the surface floats over the atmospheric `Wash`
(the sign-in door, the presence hero, the alert takeover), or when a control
must stay readable over moving content.

**Stay opaque when** the surface's job is to hold a paragraph or a list of rows.
`<Card>` is opaque by default and should stay that way; `glass` is an opt-in
prop, and opting in over body copy is a bug. Inputs, timeline rows, metric rows
and sheets full of text are all flat.

At most **one glass layer deep**. Glass inside glass is mud.

`<Glass>` is the only component allowed to call `expo-glass-effect` directly. It
gates on **both** `isGlassEffectAPIAvailable()` and `isLiquidGlassAvailable()` —
some iOS 26 betas ship the design without the API and calling in crashes — and
falls back to a deliberate frosted plate (translucent fill + hairline + the same
elevation) on Android, older iOS and anywhere the native module is absent. The
fallback is designed, not degraded.

**The opacity trap:** `opacity: 0` on a `GlassView` *or any ancestor* silently
kills the effect and leaves a dead grey box. `Entrance` therefore floors its fade
at `0.01`, which is invisible to the eye and alive to the effect. Do not
"clean that up".

## Type — SF for chrome, mono for machines, serif for her

The old claim that "everything is Fraunces" is retired. Three faces, three jobs:

- **SF (system) is the app.** Screen titles, section headings, body copy,
  buttons, captions. An app whose chrome speaks in a display serif is a website.
  Hierarchy comes from weight contrast (700/800 against regular), not size alone.
- **Fraunces survives for exactly one job:** Eleanor's own quoted words —
  content, never chrome. That is `<Txt kind="quote">`. `Fraunces_300Light` and
  friends stay in the `useFonts` call for it.
- **Menlo (`mono.*`) is the machine voice.** Tabular figures, so a live number
  never shifts its own layout. Timestamps, counters, latencies, readings.

Kinds on `<Txt>`: `hero` `display` `title` `heading` `stat` `body` `label`
`caption` `quote` | `mono` `data` `stamp` `micro`. Use the component for ALL
text; raw `<Text>` is a bug.

## Motion

`motion.*` in tokens: one stagger step, one enter spring, one press spring.

Orchestrated entrance, not scattered micro-interactions: a screen gets ONE
staggered load sequence — wrap its column in `<Stagger>`, or place `<Entrance
index={n}>` by hand for odd layouts. Nothing else animates unprompted. Every
tappable primitive dips on the same press spring, so the app has one feel.

Everything honours `AccessibilityInfo.isReduceMotionEnabled` — `Entrance` and
`useReducedMotion` do it for you, and reduced motion renders the final state
immediately with no flash. The alert takeover additionally pulses
(`LadderTimeline`) and fires heavy haptics; haptics live on the alert screen and
nowhere else.

## Backgrounds

`<Wash>` is the atmospheric ground: a base ramp plus two crossed linear blooms
faking a mesh gradient, plus `assets/images/grain.png` tiled at 4%. Tones: `day`,
`night`, `alarm`. Glass is only as good as what it refracts, so a screen that
spends glass should usually spend a wash too — `<Screen wash>` does both.

Everything else stays flat paper. Depth is spent, not sprinkled.

## Components — use these, don't rebuild them

All from `@/components`.

**Surfaces & layout**
- `Screen` — page wrapper. `scroll`, `night`, `native` (native-stack header),
  `padded`, `refreshControl`, plus `wash` (atmospheric ground) and `floatingBar`
  (pinned action; clearance is added to the scroll padding for you).
- `Glass` — the one glass surface. `tone` (neutral/night/alarm), `clear`,
  `radius`, `lift`, `interactive`. Every glass usage goes through it.
- `GlassGroup` — `spacing`; adjacent glass surfaces merge into one liquid pill.
- `FloatingBar` — the pinned bottom action content scrolls under. One or two
  buttons, never a toolbar of six.
- `Card` — opaque floating card. `lift` picks the elevation tier, `glass` opts
  into glass (rarely correct — see the law above).
- `Row`, `Hairline` — layout helpers. `Hairline` separates rows *inside* a card.

**Structure (the brutalist half)**
- `Marquee` — section heading sitting on a hard 2px ink rule, with optional
  machine `meta` on the right or arbitrary `right` content. This is the app's
  exposed-structure gesture.
- `SectionTitle` — `Marquee` with just a title. Kept for the screens that use it.
- `Rule` — the hard line on its own. `hair` / `ink` (2px) / `heavy` (4px).
- `DataLabel` — the uppercase mono micro-label. Telemetry only.
- `CornerTicks` — corner tick marks for the camera console: "a machine is
  looking". Not decoration; do not put them on a card of prose.

**Controls & text**
- `Txt` — all typography (see the kinds above; `tone` for colour).
- `Btn` — `primary` / `quiet` / `danger` / `ghost` / `glass`. Full-width by
  default, presses on the shared spring.
- `Chip` — selectable pill, same spring.
- `Field` — the one labelled input: a plate with an exposed rule beneath it that
  goes 2px ink on focus. No box outline; a border on four sides is a wireframe.
- `LoadingState` / `ErrorState` — every fetching screen renders one or the other.

**Content**
- `StatusDot`, `StateChip` — resident state colours (single source of truth).
- `MetricRow` — THE row species: tinted glyph + label, datum in black below.
  Screens repeat this row; they do not invent widget-posters.
- `EventRow`, `RoomTimeBar`, `LadderTimeline`, `Sparkline`, `StatTile` — the
  information graphics. Pure Views, no chart library.
- `PresenceHero` — the one sentence per screen, plus its sub-line. Takes a
  required `emptySentence`, because "nothing yet" is the state the demo opens in.
- `KindTag`, `CitationChip`, `FactRow` — observed / told / pattern, and the
  things a family told Dhyaan.

**Motion**
- `Stagger` — wrap a screen's column; each child becomes the next beat.
- `Entrance` — one beat, by `index`. For layouts `Stagger` can't express.
- `useReducedMotion` — if you are animating by hand, check it.

## Data — never fetch or invent data inline

- Server reads: TanStack Query hooks in `@/lib/hooks` (`useResidents`,
  `useResident`, `useTimeline`, `useSummary`, `useAlert`, `useLocationHistory`…).
- Live state (websocket-owned): zustand `useLive` from `@/store/live`.
- Camera lane: `usePresence`, `useActivity`, `useProfile` from `@/lib/hooks`.
- Session/sign-in/onboarding draft: `useSession` from `@/store/session`. The app
  is gated on `session.user`: no user, no screens.
- Mutations (`ack`, `resolve`, `feedback`, `simulate`, pairing, survey): `api`
  from `@/lib/api`.
- The mock backend (`@/lib/mock/dhyaan`) simulates the fall ladder in real time.
  Don't touch its internals from screens.

## The rules that keep this distinctive

1. **One uncompromising contrast moment per screen.** Black on white, or white
   on rust — one, and the rest of the screen stays quiet. Two is noise.
2. Spend boldness once per screen — one hero sentence, one floating surface.
3. Structure encodes info: a hard rule opens a section, hairlines separate days,
   numbered steps only in the escalation ladder (it is genuinely sequential).
4. Never show an image or video of the resident. Evidence is always a sentence.
5. Empty states invite action ("No walks recorded yet today") — never mood copy,
   and they are written before the full state. "Nothing yet today" is the
   most-seen screen in this build.
6. Buttons say what they do: "I've got her", "Call Eleanor", "This was expected".
7. A refusal is not an error. When the chatbot declines a surveillance question
   it renders quietly — a `hand.raised` symbol, ink, a plain sentence, no retry.
   Never red, never amber. Saying so calmly is the product working.
8. Destructive controls confirm with a real gesture: *Forget her profile* makes
   you type her name, because it cannot be undone.
