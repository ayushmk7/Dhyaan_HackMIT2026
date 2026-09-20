# Dhyaan app — design law

Read this before writing any screen. Deviations from this document are bugs.
`frontend/src/theme/tokens.ts` is the machine-readable half; where the two
disagree, tokens win and this file is stale. Everything a screen renders comes
from `@/components`; a screen never invents a surface, a colour, a shadow, a
padding or a text style of its own.

## What it is

**Apple Liquid Glass, with hints of brutalism.** Floating, translucent chrome
over an atmospheric ground; opaque, quiet content; an occasional hard, honest
gesture (a 2px ink rule, a mono reading, a corner tick) marking where a machine
produced something. The app watches over someone's mother, for her adult child,
at a distance. It must read like a calm, competent human, never like a hospital
monitor or a SaaS dashboard.

## The decision table

Use this first. If your case is not here, it is one of these in disguise.

| You need | Reach for | Never |
| --- | --- | --- |
| A page | `Screen` (`native` under a stack header; `wash` on every tab root; `tone="night"`/`"alarm"` for the dark grounds; `keyboard` for a form or composer; `floatingBar` for the one pinned action) | your own ScrollView, KeyboardAvoidingView or bottom padding |
| Any text | `Txt kind=…` | raw `<Text>` |
| A section heading | `Marquee` (`meta` for a machine reading, `right` for a chip or button, `first` on the first section) | a bold `Txt` with a margin |
| A white plate holding a paragraph | `Card` | a `View` with a background |
| A white plate holding rows | `RowGroup` (hairlines are inserted for you) | `Card` + `{i > 0 && <Hairline/>}` |
| The screen's one contrast moment (black plate, paper text) | `Slab` (`tone="cream"` on the night ground, `"alarm"` on the takeover; `onPress` to make it a button) | `Card style={{backgroundColor: ink}}`, a `View` with `elevation.float`, or a second glass layer |
| A bar or header that content scrolls under | `FloatingBar` / `Glass` | `Card glass` |
| A full-width action | `Btn` (`primary` once per screen, `quiet` for the rest, `danger` only for a confirmed destructive act) | a `Pressable` with a background |
| A text-only action ("Stop the camera", "Try again", "Use the demo account") | `Btn kind="link"` (`tone="alert"` only to open a confirmed destructive step) | `Pressable` + `Txt` |
| A round icon button (call, send, reorder, page) | `IconBtn` (`label` is the VoiceOver name and is required) | a hand-sized `Pressable` |
| The white plate button on the takeover | `Btn kind="inverse"`; secondary actions `kind="outline"` | `BigWhiteBtn`, `OutlineBtn` |
| A button beside a field or inside a row | `Btn size="small"` | `style={{ minHeight: 44 }}` |
| A selectable pill or filter | `Chip` | a coloured `Pressable` |
| A labelled input | `Field` (`code` for a pairing code, `minHeight` for a paste area; `label` may be omitted when a sentence above already names it) | a raw `TextInput` |
| "Room  Kitchen" / "Camera  Agreed" inside a card | `KeyValue` | two captions in a `Row` |
| The passive "this opens" mark | `Chevron` | `Icon name="chevron.right"` with a hex |
| A row of data with a tinted category | `MetricRow` / `EventRow` | a bespoke row |
| A person | `Avatar` (`avatarTone(i)` cycles a roster) | initials in a `View` |
| The app's logo | `Mark` | a black `View` with an icon |
| Nothing here yet | `EmptyState` (inside a `Card` when the section owns a plate) | `Txt tone="muted"` with a `voice-ok` |
| Still fetching | `LoadingState` | a bare `ActivityIndicator` or "Loading…" |
| A request failed | `ErrorState` (block) / `ErrorState inline` (one line, inside a form) | `Txt tone="alert"` / `tone="warn"` |
| Dhyaan declines to answer | `Refusal` | anything red, amber, or with a retry |
| Machine telemetry (FPS, SOURCE, a count, a timestamp) | `DataLabel`, `Txt kind="stamp"/"mono"/"data"/"readout"` | uppercase in a human sentence |
| A hard line | `Rule` (`ink` 2px, `heavy` 4px, `hair`) | a 1px `View` |
| A load sequence | one `Stagger` around the column, or `Entrance index` by hand | any other unprompted motion |

## Surfaces

Every primitive reads the **surface** it sits on and picks its own colour.
`Screen` declares the ground (paper, night, alarm); `Card` declares paper (or
night); `Slab` declares ink, cream or alarm. Inside a `Slab` or a `tone="night"`
screen you pass **no** tones: `Txt`, `Rule`, `Hairline`, `Marquee`,
`DataLabel`, `Chip`, `Btn` and `IconBtn` already know. Explicit `night`,
`tone` and `color` props still win when given, so the old screens render as
they did. `Surface` is exported for the rare layout that owns a dark ground
without going through `Screen` or `Slab`.

Colour on a dark surface comes from `onDark` (four alphas, no more) and on the
cream slab from `onCream`. There is no fifth white and no sixth grey:
`ink`, `inkMuted`, `inkFaint`, `line` are the greys on paper, full stop.

### Glass, opaque, or slab

| Surface | Tier | Radius | When |
| --- | --- | --- | --- |
| `Glass` / `FloatingBar` | `float` | `glass` 22 / `bar` 30 | content passes **under** it: a pinned action, a day pager, the sign-in door, the camera frame, the presence hero over the wash |
| `Card` | `raised` | `card` 16 | holds a paragraph or rows; opaque, always |
| `Slab` | `float` | `glass` 22 | the screen's one uncompromising contrast moment: the last-noticed sentence, a counter, an identity plate, the takeover's readout |
| `Field` | flat | plate + rule | every input, everywhere; glass never holds text you type |
| the page | `flat` | — | everything else |

Rules that keep this honest:

- **Radius follows tier.** raised = 16, float = 22, a sheet = 28, a pill bar
  = 30. An opaque tile at `raised` is 16, not 22.
- **At most one glass layer deep, and at most one floating surface per
  screen** besides the bar. The takeover's readouts are `Slab tone="alarm"`,
  not a second glass.
- **Glass holds chrome, not prose.** The presence hero is sanctioned because it
  is the screen's heading floating over the wash; an explanatory paragraph
  does not belong inside it.
- **Spend a wash where you spend glass.** Every tab root screen gets `wash`.
  Glass is only as good as what it refracts.
- `Glass` is the only component allowed to call `expo-glass-effect`. It gates
  on both `isGlassEffectAPIAvailable()` and `isLiquidGlassAvailable()` and
  falls back to a designed frosted plate. `opacity: 0` on any ancestor kills
  the effect; `Entrance` floors its fade at 0.01 for that reason.

## Colour

Chrome carries no hue. Interactive is ink; affordance comes from form (a
filled plate, a chevron, a weight). Every hue has exactly one meaning:

| Token | Means | And nothing else |
| --- | --- | --- |
| `moss` | OK | not "success" for a saved form |
| `ochre` | worth a look (a resident state, a deviation) | not an error |
| `rust` | **alarm** | not a form error, not a destructive link |
| `hue.*` | a data category (Health taxonomy) | not decoration |
| `amber` | the camera's own colour, "Dhyaan saw this just now" | not a status |
| `zoneColor.*` | rooms, **staff screens only** | never a family screen |
| `avatarGradient.*` | people | nothing else |

A failed save, a dropped connection and a form validation line are **ink**
(`ErrorState`). Rust in a form is an alarm that is not happening.

`Btn kind="danger"` is the one sanctioned rust control: the final button of a
confirmed, irreversible act ("Forget everything about her"). The link that
*opens* that confirmation may be `Btn kind="link" tone="alert"`; nothing else
on a screen is red.

## Type — SF for chrome, mono for machines, serif for her

- **SF (system) is the app.** `hero` 34 (a screen's one big sentence, on a
  screen without a native large title), `display` 30 (the alert headline and
  a question that is the whole screen), `title` 22, `heading` 20 (Marquee),
  `body` 17, `label` 15/600, `caption` 13, `tag` 13/600 (chips, tags, row
  labels), `button` 17/600, `stat` 22 (tiles). Hierarchy comes from weight,
  not size.
- **Menlo (`mono.*`) is the machine voice.** `readout` 46 (a slab counter),
  `data` 26, `mono` 15, `stamp` 12, `micro` 10 uppercase (`DataLabel`). Tabular
  figures so a live number never shifts its own layout.
- **Fraunces survives for one job:** her own quoted words, `kind="quote"`.
  Content, never chrome.

**Uppercase and mono are for machine words only**: FPS, LATENCY, SOURCE, REC,
a count, a timestamp, a band id, a request path. If a person would say the
words out loud to another person, caps are a bug. Human sentences are sentence
case, SF, and ink. Gray is metadata only (a time, a count, a unit): a grey
paragraph is the AI tell, which is why `EmptyState` renders its sentence in ink.

## Voice

- No emojis anywhere (`scripts/copy-audit.py` and a CI grep enforce this).
- No em dashes in a user-facing string; at most one " · " pair per line.
- No room names on family screens, structurally: `Presence` and
  `ActivityItem` carry no zone (`VLM_PLAN.md` §5.2, `DECISIONS.md` D-001).
- Everything the app tells the family names its source: `KindTag` — *Dhyaan
  saw* (observed, amber), *You told us* (told, ink), *From her pattern*
  (pattern, moss).
- Empty states invite an action and are written before the full state. A
  refusal is not an error and renders through `Refusal`: a raised hand, ink, a
  plain sentence, no retry.
- Buttons say what they do: "I've got her", "Call Eleanor", "This was expected".
- Destructive controls confirm with a real gesture (type her name).

## Depth and motion

`elevation.flat | raised | float | takeover`. A surface picks a tier; it never
writes a shadow. `takeover` belongs to the alert and the Rounds counter alone.

`motion.*`: one stagger step, one enter spring, one press spring. A screen gets
one staggered load sequence (`Stagger`, or `Entrance index` for odd layouts).
Every tappable primitive dips on the same spring, so the app has one feel.
Everything honours reduce-motion via `useReducedMotion`.

## Spacing and size

`sp(n)` on the 4px grid, always. `size.hit` 44 is the touch floor;
`size.control` 40 is the round icon button; `size.button` 52 / `buttonSmall`
44 are the two button heights. `radius.bubble` 20 exists for the chat bubble
and nothing else.

## Data

Server reads through hooks in `@/lib/hooks`; live state through `useLive`;
session through `useSession`; the care file through `useCareFile`; mutations
through `api`. Never import the mock or the http client from a screen.
Evidence is always a sentence, never an image.

## Components, by file

- `text.tsx` — `Txt`, `Surface`, `useSurface`, `surfaceColors`.
- `ui.tsx` — `Screen`, `LoadingState`, `ErrorState`, `EmptyState`, `Refusal`,
  `Btn`, `IconBtn`, `Chevron`, `Field`, `Row`, `Hairline`, `SectionTitle`,
  `Card`, `RowGroup`, `Slab`, `KeyValue`, `Mark`, `StatusDot`, `StateChip`,
  `Chip`, `StatTile`.
- `brutal.tsx` — `Rule`, `Marquee`, `DataLabel`, `CornerTicks`.
- `glass.tsx` — `Glass`, `GlassGroup`, `FloatingBar`, `FLOATING_BAR_CLEARANCE`.
- `viz.tsx` — `MetricRow`, `EventRow`, `RoomTimeBar`, `LadderTimeline`, `Sparkline`.
- `presence.tsx` — `KindTag`, `CitationChip`, `PresenceHero`, `FactRow`.
- `entrance.tsx` — `Entrance`, `Stagger`, `useReducedMotion`.
- `wash.tsx` — `Wash`.
- `icon.tsx` — `Icon`, `IconBadge`, `eventSymbol`, `eventColor`.
- `avatar.tsx` — `Avatar`, `avatarTone`.
- `alert-extras.tsx` — `CancelCountdownRing`, `RingingPulse`, `ElapsedStat`.

All of these are exported from `@/components`. `SectionTitle`, `Card glass`,
`Btn kind="glass"` and the `night` boolean props are kept for compatibility;
prefer `Marquee`, `Glass`, and letting the surface decide.
