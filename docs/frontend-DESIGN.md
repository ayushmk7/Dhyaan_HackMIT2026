# Dhyaan app — design law

Read this before writing any screen. Deviations from this document are bugs.
`frontend/src/theme/tokens.ts` is the machine-readable half; where the two
disagree, tokens win and this file is stale. Everything a screen renders comes
from `@/components`; a screen never invents a surface, a colour, a shadow, a
padding or a text style of its own.

## What it is

**Apple Liquid Glass, with hints of brutalism, in blue, white and black.**
Floating, translucent chrome over an atmospheric ground; opaque, quiet
content; an occasional hard, honest gesture (a 2px ink rule, a mono reading, a
corner tick) marking where a machine produced something. One accent, and it is
blue. Alarm is not a colour but an inversion. There is a real dark mode, and it
is not the light mode with the values flipped. The app watches over someone's
mother, for her adult child, at a distance. It must read like a calm,
competent human, never like a hospital monitor or a SaaS dashboard.

## The decision table

Use this first. If your case is not here, it is one of these in disguise.

| You need | Reach for | Never |
| --- | --- | --- |
| A page | `Screen` (`native` under a stack header; `wash` on every tab root; `tone="night"`/`"alarm"` for the night ground and the takeover; `keyboard` for a form or composer; `floatingBar` for the one pinned action) | your own ScrollView, KeyboardAvoidingView or bottom padding |
| A colour, in a component | `useTheme()` (the resolved palette) or `useSurfaceColors()` (what this surface hands its children) | `palette.*` (light-only) in anything that renders |
| Any text | `Txt kind=…` | raw `<Text>` |
| A section heading | `Marquee` (`meta` for a machine reading, `right` for a chip or button, `first` on the first section) | a bold `Txt` with a margin |
| A plate holding a paragraph | `Card` | a `View` with a background |
| A plate holding rows | `RowGroup` (hairlines are inserted for you) | `Card` + `{i > 0 && <Hairline/>}` |
| The screen's one contrast moment (the inverse plate) | `Slab` (`tone="cream"` for the white plate on the night ground, `"alarm"` on the takeover; `onPress` to make it a button) | `Card style={{backgroundColor: ink}}`, a `View` with `elevation.float`, or a second glass layer |
| A bar or header that content scrolls under | `FloatingBar` / `Glass` | `Card glass` |
| A full-width action | `Btn` (`primary` once per screen, `quiet` for the rest, `danger` only for a confirmed destructive act) | a `Pressable` with a background |
| A text-only action ("Stop the camera", "Try again", "Use the demo account") | `Btn kind="link"` (`tone="alert"` only to open a confirmed destructive step; it is heavier, not redder) | `Pressable` + `Txt` |
| A round icon button (call, send, reorder, page) | `IconBtn` (`label` is the VoiceOver name and is required) | a hand-sized `Pressable` |
| The inverse plate button on the takeover | `Btn kind="inverse"`; secondary actions `kind="outline"` | `BigWhiteBtn`, `OutlineBtn` |
| A button beside a field or inside a row | `Btn size="small"` | `style={{ minHeight: 44 }}` |
| A selectable pill or filter | `Chip` (selected = the accent) | a coloured `Pressable` |
| A labelled input | `Field` (`code` for a pairing code, `minHeight` for a paste area; `label` may be omitted when a sentence above already names it; `autoComplete` on a sign-in form) | a raw `TextInput` |
| "Room  Kitchen" / "Camera  Agreed" inside a card | `KeyValue` | two captions in a `Row` |
| The passive "this opens" mark | `Chevron` | `Icon name="chevron.right"` with a hex |
| A row of data with a category | `MetricRow` / `EventRow` (the glyph is the category; omit `hue` unless Dhyaan is pointing) | a bespoke row |
| A resident's state | `StatusDot` / `StateChip` (form + word, never a colour you pick) | a coloured dot |
| A person | `Avatar` (`avatarTone(i)` cycles a roster) | initials in a `View` |
| The app's logo | `Mark` | a `View` with an icon |
| Nothing here yet | `EmptyState` (inside a `Card` when the section owns a plate) | `Txt tone="muted"` with a `voice-ok` |
| Still fetching | `LoadingState` | a bare `ActivityIndicator` or "Loading…" |
| A request failed | `ErrorState` (block) / `ErrorState inline` (one line, inside a form) | `Txt tone="alert"` / `tone="warn"` |
| Dhyaan declines to answer | `Refusal` | anything accented, inverted, or with a retry |
| Machine telemetry (FPS, SOURCE, a count, a timestamp) | `DataLabel`, `Txt kind="stamp"/"mono"/"data"/"readout"` | uppercase in a human sentence |
| A hard line | `Rule` (`ink` 2px, `heavy` 4px, `hair`) | a 1px `View` |
| A load sequence | one `Stagger` around the column, or `Entrance index` by hand | any other unprompted motion |

## Surfaces

Every primitive reads the **surface** it sits on and the **scheme** it is
drawn in, and picks its own colour. `Screen` declares the ground (paper,
night, alarm); `Card` declares paper (or night); `Slab` declares ink, cream or
alarm. Inside a `Slab`, on a `tone="night"` screen, or in dark mode you pass
**no** tones: `Txt`, `Rule`, `Hairline`, `Marquee`, `DataLabel`, `Chip`, `Btn`
and `IconBtn` already know. Explicit `night`, `tone` and `color` props still
win when given. `Surface` is exported for the rare layout that owns a dark
ground without going through `Screen` or `Slab`.

What each surface is, in each scheme:

| Surface | Light | Dark |
| --- | --- | --- |
| `paper` (the page, a card) | near-white, ink text | near-black, near-white text |
| `night` (Rounds) | the night ground, always dark | the same |
| `ink` (`Slab`) | black plate, white text | **white plate, black text** |
| `cream` (`Slab`, Rounds counter) | white plate, always | the same |
| `alarm` (the takeover) | black ground, white text | **white ground, black text** |

`ink` and `alarm` are the *inverse of the scheme*, which is the whole point of
them: the screen's one contrast moment has to be the opposite of whatever the
rest of the screen is. Text on any dark plate comes from `onDark` (seven
alphas of white) and on any white plate from `onLight` (the same seven alphas
of black). There is no eighth alpha. `ink`, `inkMuted`, `inkFaint`, `line` are
the greys on paper, full stop, and each has a light and a dark value.

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
- **A shadow on black is invisible.** `Card` draws a hairline edge instead of
  an elevation on the night ground and in dark mode. That is the one border
  the system allows around a card, and only there.

## Colour

Three colours: **blue, white, black**, and the greys between white and black.
No yellow, cream, green, red or purple anywhere, and no yellow ground of any
kind: the page is white or a blue-tinted near-white, and in dark mode
near-black.

Blue is the one accent, and it means exactly one thing:

> **Blue = Dhyaan is pointing at something.** A control it offers you
> (`Btn primary`, a selected `Chip`, `IconBtn primary`), a thing it noticed
> (the camera lane: `CornerTicks`, the person box, `KindTag` *Dhyaan saw*), a
> state worth a look (`attention`, a deviation on a `Sparkline`, a fall row).

Everything else has **no colour**, and that is the design. A single accent
cannot say six things, so meaning that used to live in hue now lives in four
other places:

| Tool | What carries it | Where you see it |
| --- | --- | --- |
| **Inversion** | the opposite scheme's plate: white on black in light, black on white in dark | the alarm takeover; `Slab`; the alerting tile on Floor; the alerting `StateChip`; `Btn danger` / `inverse`; `Mark` |
| **Value** | position on the blue ramp (`blue[50]` to `blue[900]`) | `zoneColor` (one band per room), `avatarGradient` (deep / mid / graphite), pressed states |
| **Form and weight** | a ring vs a dot vs a bullseye; a filled plate vs an outline; a 2px rule vs a hairline; a heavier word | `StatusDot`, `StateChip`, `IconBadge outline`, `KindTag`, `Btn link tone="alert"`, `StatTile` |
| **Words** | `stateColor[s].word`, `KindTag` words, a button that says what it does | everywhere a state is shown; the chip always carries the word |

### The four things that used to be four colours

**OK** (was moss) has no colour at all. A hollow ring for the dot, the quiet
wash for the chip, ink for the word, an outlined badge on the tile. OK is the
absence of a signal, and it should look like one; a screen full of green
ticks is a dashboard.

**Worth a look** (was ochre) is the accent: a filled blue dot, the pointed
wash (`accentWash`) with blue text, a filled blue badge on the tile. It is the
same blue as a button because it is the same act: Dhyaan directing your
attention.

**The camera** (was amber) is the accent too. Dhyaan looking *is* Dhyaan
pointing. Corner ticks, the person box (`accentGhost`), the live rule and the
*Dhyaan saw* tag are all blue. The other two sources of a claim are drawn by
form: *You told us* is ink on the quiet wash (your own words, plain), *From
her pattern* is an outline with no fill (an inference, held lightly).

**Alarm** (was rust) is inversion, and it is the only thing that is. This is
the decision that matters, so here it is in full:

- The takeover (`Screen tone="alarm"`) is the **only screen** drawn in the
  opposite scheme. Every other screen in the app is paper or the night
  ground. Opening the alert in light mode is going from white to black; in
  dark mode it is going from black to white. Both are the largest change the
  system can make, and both cost no hue.
- On a normal screen, the alerting state is the **only inverted element**: the
  alerting Floor tile is a `Slab`, the alerting `StateChip` is the inverse
  plate, the alerting `StatusDot` is a bullseye. Nothing else on that screen
  is inverted, so the eye lands on it before it can read.
- The takeover's own buttons are `inverse` (the scheme's plate, back again) and
  `outline`. No blue on the takeover, ever: blue is Dhyaan pointing, and on the
  takeover it is the family who acts.
- The live ladder step **pulses**, in the surface's ink. Motion is the fourth
  signal, and the takeover is the one place it runs unprompted.
- The words say it: "Needs someone now". Never "Alert".

A failed save, a dropped connection and a form validation line are **ink**
(`ErrorState`). They are neither pointed at nor inverted; they are sentences.

`Btn kind="danger"` is the inverse plate on a light screen: the one black
button, for the final step of a confirmed, irreversible act ("Forget
everything about her"). The link that *opens* that confirmation is `Btn
kind="link" tone="alert"`, which is bolder, not redder. In dark mode the same
button is the one white button, and it reads the same way.

### Rooms and people on the ramp

`zoneColor` gives each room a value on the blue ramp, interleaved so the rooms
a day actually alternates between (bedroom and bathroom, kitchen and hallway)
sit far apart on it. *Outside* is off the ramp entirely: the scheme's ink,
"she has left the picture". *Unknown* is the hairline grey. The legend is the
key; seven blues in a 20px bar are a shape until the swatch names them, which
is why `RoomTimeBar` always draws the legend and an outline around the bar.
Staff screens only, as before; a family screen never shows a room.

`avatarGradient` is three monograms on the ramp: deep, mid, graphite. The keys
`green`, `amber`, `blue` are historical and `avatarTone(i)` still cycles them.

### Compatibility keys

`palette.moss`, `ochre`, `rust`, `rustDeep`, `amber` and their washes still
exist so an unconverted screen compiles. Each resolves to what its *meaning*
now is (`moss` is ink, `ochre` and `amber` are the accent, `rust` is the
inverse plate). Reading one is a bug to fix, not a colour to use; they are
marked `@deprecated` and the editor will say so.

## Dark mode

There are two palettes with the same keys (`palette`, light; `darkPalette`),
and `useTheme()` returns the resolved one for the scheme the component is
drawn in. The scheme comes from `useColorScheme()` (react-native) and only
reports dark when `app.json` sets `userInterfaceStyle` to `"automatic"` or
`"dark"`. `<ThemeProvider scheme="dark">` forces a subtree; without a provider
`useTheme()` follows the system.

**What inverts:** the ground (`paper`, `raised`), the text greys, the hairline,
the quiet washes, the glass tint, and the two inverse surfaces (`ink`,
`alarm`), which flip *with* the scheme so they stay the opposite of it.

**What does not invert:**

- **The night ground.** Rounds is the app in dark mode, whatever the scheme.
  `night*` has one set of values.
- **The white plate** (`Slab tone="cream"`, `white`). White is white.
- **The blue.** The accent moves along the ramp instead: `blue[600]` on white
  (6.6:1 with white text), `blue[300]` on black (7.9:1 with black text). Text
  on an accent plate is `onAccent`: white in light, the near-black paper in
  dark. A light blue with white text is the failure the ramp exists to avoid.
- **Meaning.** Inversion still means alarm, the accent still means pointing,
  a hollow ring still means OK. A dark screen is not a night screen and not an
  alarm screen; it is the same screen with the lights off.

**A dark wash is not an inverted light wash.** `washTone.day` in dark mode is
the night ramp, not the day ramp with its colours flipped: the warm bloom is
halved (light pooling on black reads as glare), the bloom is blue-grey rather
than white, and the grain is heavier (7% against 4%) because on black it is
the only texture the eye has. `alarm` in dark mode is a white ramp with a
faint ink corner: the takeover has to look lit, not merely pale.

**Shadows are replaced, not dimmed.** On a dark ground `Card`, `StatTile` and
`CitationChip` draw a 1px `line` edge instead of an elevation. `Slab
tone="alarm"` carries an outline on both schemes for the same reason.

## Contrast

Measured (WCAG relative luminance), body text against its ground:

| Pair | Light | Dark |
| --- | --- | --- |
| `ink` on `paper` | 17.2:1 | 17.4:1 |
| `ink` on `raised` | 18.7:1 | 15.7:1 |
| `inkMuted` on `paper` (captions, metadata) | 5.6:1 | 8.4:1 |
| `inkMuted` on `raised` | 6.1:1 | 7.5:1 |
| `accent` as text on `paper` | 6.1:1 | 7.9:1 |
| `accent` as text on `accentWash` (chips, tags) | 5.7:1 | 6.1:1 |
| `onAccent` on `accent` (primary button label) | 6.6:1 | 7.8:1 |
| white on the takeover ground / ink on it in dark | 18.7:1 | 18.7:1 |
| `onDark.muted` on an ink plate / `onLight.muted` on a white plate | 6.7:1 | 4.8:1 |

Every text pair clears AA (4.5:1); the `readout`/`data` display numbers sit on
the same grounds and clear 3:1 by a wide margin. `inkFaint` (the chevron, a
placeholder) is decorative and does not: 2.8:1 light, 3.3:1 dark. Adjacent
bands of the room ramp are 1.3 to 1.5:1 apart, which is the cost named above.

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
  saw* (observed, the accent on a pointed fill), *You told us* (told, ink on
  the quiet wash), *From her pattern* (pattern, an outline).
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

- `theme/tokens.ts` — `palette` (light), `darkPalette`, `blue` (the ramp),
  `onDark`, `onLight`, `buildSemantics`, and the light-only statics
  `stateColor`, `hue`, `zoneColor`, `avatarGradient`, `washTone`, `glass`.
- `theme/theme.tsx` — `useTheme`, `useScheme`, `ThemeProvider`, `themes`.
- `text.tsx` — `Txt`, `Surface`, `useSurface`, `useSurfaceColors`,
  `surfaceColors`, `isDarkSurface`, `toneColor`.
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
- `icon.tsx` — `Icon`, `IconBadge` (`outline`), `eventSymbol`, `eventColor`.
- `avatar.tsx` — `Avatar`, `avatarTone`.
- `alert-extras.tsx` — `CancelCountdownRing`, `RingingPulse`, `ElapsedStat`.

All of these are exported from `@/components`, including `useTheme`.
`SectionTitle`, `Card glass`, `Btn kind="glass"`, the `night` boolean props and
the `ok`/`warn`/`alert`/`amber`/`slate` text tones are kept for compatibility;
prefer `Marquee`, `Glass`, `tone="accent"`, and letting the surface decide.
