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
blue. Alarm is not a colour but depth on the blue ramp, under a heavy rule.
Nothing in the light app is black. There is a real dark mode, and it is not
the light mode with the values flipped. The app watches over someone's
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
win when given. `Surface` is exported for the rare layout that owns a blue
ground without going through `Screen` or `Slab`.

What each surface is, in each scheme:

| Surface | Light | Dark |
| --- | --- | --- |
| `paper` (the page, a card) | near-white, ink text | near-black, near-white text |
| `night` (Rounds, the camera pane) | `blue[100]`, ink text; white cards with a `blue[200]` edge | `blue[900]`, light text; `blue[800]` cards |
| `ink` (`Slab`) | `blue[200]` plate, ink text | `blue[800]` plate, light text |
| `cream` (`Slab`, Rounds counter) | white plate, always | the same |
| `alarm` (the takeover) | `blue[300]` ground, ink text, a 4px ink rule under the status bar | `blue[700]` ground, light text, the same rule |
| `alarm` (`Slab`: the readout, the alerting Floor tile) | `blue[100]` inside a 2px ink rule | `blue[800]` inside a 2px rule |

No plate in the light scheme is dark. A focal plate is a *deeper step on the
blue ramp* than whatever it sits on, with the same ink text as the page; the
takeover is the deepest light step there is. Text on any light plate comes
from `onLight` (seven alphas of ink) and on any deep plate (the dark scheme's
paper and its blue plates) from `onDeep` (the same seven alphas of white).
There is no eighth alpha. `onDark` still exists and is `onLight` by another
name: the plates it was written for are light now. `ink`, `inkMuted`,
`inkFaint`, `line` are the greys on paper, full stop, and each has a light and
a dark value.

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
- **A shadow on a deep ground is invisible, and on a blue one it is lost.**
  `Card` draws a hairline edge instead of an elevation on the night ground and
  in dark mode. That is the one border the system allows around a card, and
  only there.

## Colour

Three colours: **blue, white, black**, and the greys between white and black.
No yellow, cream, green, red or purple anywhere, and no yellow ground of any
kind: the page is white or a blue-tinted near-white, and in dark mode
near-black. Black is text, never a surface: the only black grounds in the app
are the dark scheme's own paper.

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
| **Depth** | a deeper step on the blue ramp than the ground, with the page's own ink on it: `blue[200]` for a `Slab`, `blue[300]` for the takeover (`blue[800]` / `blue[700]` in dark) | the alarm takeover; `Slab`; the alerting tile on Floor; `Mark` |
| **The navy plate** | `blue[800]` with white text on any light surface (`blue[200]` with ink on a deep one): the far end of the ramp, the loudest thing a control can be | the alerting `StateChip`; `Btn danger` / `inverse` |
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

**Alarm** (was rust) used to be inversion: white on black. Black is gone from
the light app, so alarm is now four things stacked, none of them a hue of its
own. This is the decision that matters, so here it is in full:

- The takeover (`Screen tone="alarm"`) is the **only screen whose whole ground
  is blue**: `blue[300]`, the deepest step the light ramp has before ink stops
  clearing AA on it (8.3:1 body, 5.0:1 for the muted metadata). Every other
  screen is paper or the pale `blue[100]` night ground. A `Slab` is `blue[200]`;
  the takeover is a screen-sized step past it. In dark mode it is `blue[700]`,
  the brightest ground in that scheme, on a page that is otherwise black.
- A **4px ink rule** is pinned across the top of the takeover, just under the
  status bar (`rule.heavy`, `Screen` draws it). It is the brutalist gesture
  the system already uses for a section heading, at twice the weight, and it
  is there from the first frame, before anything scrolls.
- The one commitment ("I've got her", "Assign to me") is `Btn kind="inverse"`:
  the **navy plate**, `blue[800]` with white text, the only navy button on any
  screen. The takeover's secondary actions are `outline`. No accent blue on
  the takeover: blue[600] is Dhyaan pointing, and on the takeover it is the
  family who acts.
- The cancel ring **breathes** and the live ladder step **pulses**, in the
  surface's ink. Motion is the fourth signal, and the takeover is the one
  place it runs unprompted.
- The words say it: "Needs someone now". Never "Alert".

On a normal screen, the alerting state is the **only navy element**: the
alerting `StateChip` is the navy plate, the alerting Floor tile is a `Slab
tone="alarm"` (a `blue[100]` plate inside a 2px ink rule, on a page of white
tiles with no border at all), the alerting `StatusDot` is a bullseye. Nothing
else on that screen is navy or ruled, so the eye lands on it before it can
read.

What this costs, said plainly: inversion was louder. Black on white was the
largest change the system could make, and a blue[300] ground with a rule and
a navy button is a smaller one. It is still the only blue screen, the only
heavy rule and the only navy plate, and a family opening the alert sees a
different-coloured app with a hard line across the top. If that ever proves
too quiet in use, the lever is the ground (`palette.alarm`), not a new hue.

A failed save, a dropped connection and a form validation line are **ink**
(`ErrorState`). They are neither pointed at nor navy; they are sentences.

`Btn kind="danger"` is the navy plate on a light screen: the one `blue[800]`
button, for the final step of a confirmed, irreversible act ("Forget
everything about her"). The link that *opens* that confirmation is `Btn
kind="link" tone="alert"`, which is bolder, not redder. In dark mode the same
button is the one light blue (`blue[200]`) button, and it reads the same way.

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
the quiet washes, the glass tint, and every blue plate, which moves to the
deep end of the ramp: `ink` goes `blue[200]` to `blue[800]`, `alarm` goes
`blue[300]` to `blue[700]`, `night` goes `blue[100]` to `blue[900]`, and the
navy plate goes `blue[800]` to `blue[200]`. A light blue plate with ink text
becomes a deep blue plate with light text; it never becomes black.

**What does not invert:**

- **The white plate** (`Slab tone="cream"`, `white`). White is white.
- **The blue.** The accent moves along the ramp instead: `blue[600]` on white
  (6.6:1 with white text), `blue[300]` on black (7.9:1 with black text). Text
  on an accent plate is `onAccent`: white in light, the near-black paper in
  dark. A light blue with white text is the failure the ramp exists to avoid.
- **Meaning.** The blue ground and the navy plate still mean alarm, the
  accent still means pointing, a hollow ring still means OK. A dark screen is
  not a night screen and not an alarm screen; it is the same screen with the
  lights off.

**A dark wash is not an inverted light wash.** `washTone.day` in dark mode is
the night ramp, not the day ramp with its colours flipped: the warm bloom is
halved (light pooling on black reads as glare), the bloom is blue-grey rather
than white, and the grain is heavier (7% against 4%) because on black it is
the only texture the eye has. `night` and `alarm` in light mode pool from
white into their blue; in dark mode from a lighter blue into a deeper one.

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
| ink on `inverse` (the ink `Slab`) | 11.7:1 | 12.1:1 |
| `onLight.muted` / `onDeep.muted` on the ink `Slab` | 6.2:1 | 7.3:1 |
| ink on `alarm` (the takeover ground) | 8.3:1 | 8.8:1 |
| `.soft` on the takeover (captions at 80%) | 5.5:1 | 6.8:1 |
| `.muted` on the takeover (`DataLabel`, ladder stamps) | 5.0:1 | 5.6:1 |
| ink on `inverseRaised` (the alarm `Slab`) | 14.9:1 | 12.1:1 |
| `nightInk` on `night` (Rounds) | 14.9:1 | 15.0:1 |
| `nightMuted` on `night` / on `nightRaised` | 6.2:1 / 7.8:1 | 8.2:1 / 6.6:1 |
| `onPlate` on `plate` (`Btn inverse`, the alerting chip) | 13.4:1 | 11.7:1 |
| the surface accent as text on the ink `Slab` | 6.1:1 | 8.3:1 |
| the surface accent as text on the takeover | **4.3:1** | 6.1:1 |

Every text pair clears AA (4.5:1) except the last: the accent as *small text*
on the light takeover is 4.3:1, which is why the takeover has no accent text
(its buttons are the navy plate and `outline`; its tags are ink). `Btn
primary` on the takeover would be legible (white on `blue[600]`) but its edge
would be 2.9:1 against the ground; do not put one there. `onLight.muted` moved
from 0.62 to 0.74 alpha for this table: at 0.62 it was 3.8:1 on `blue[300]`.
The `readout`/`data` display numbers sit on the same grounds and clear 3:1 by
a wide margin. `inkFaint` (the chevron, a
placeholder) is decorative and does not: 2.8:1 light, 3.3:1 dark. Adjacent
bands of the room ramp are 1.3 to 1.5:1 apart, which is the cost named above.

## Type — SF for chrome, mono for machines, serif for her

- **Six sizes, no more: 11, 13, 17, 22, 30, 40.** Each step is a real jump
  (about 1.3x). Every `type.*` and `mono.*` key is an alias onto one of them;
  two keys at the same size differ by weight, never by a private size.
- **SF (system) is the app.** `hero` 40/800 (a screen's one big sentence),
  `display` 30/800 (the alert headline, a question that is the whole screen),
  `title` 22/700 = `heading` (Marquee) = `stat` (a tile's figure), `body` 17,
  `label` = `button` = body at 600, `caption` 13, `tag` = caption at 600.
  Line-height and tracking are one rule each: display sizes (22 and up) take
  1.12x and -(size/40); text sizes take 1.35x and 0.
- **Menlo (`mono.*`) is the machine voice**, on the same six sizes. `readout`
  40 (a slab counter; = hero), `data` 22 (= title), `mono` 13 = `stamp` 13,
  `micro` 11 uppercase, tracked +1 (`DataLabel`). Tabular figures so a live
  number never shifts its own layout.
- **Screen titles are the native bar's**, compact and centred (`lib/nav.tsx`):
  no large title, so a screen's first row starts about 60pt higher. The bar is
  translucent; content scrolls under it.
- **Fraunces survives for one job:** her own quoted words, `kind="quote"`.
  Content, never chrome. Set at the title size, as prose.

**Uppercase and mono are for machine words only**: FPS, LATENCY, SOURCE, REC,
a count, a timestamp, a band id, a request path. If a person would say the
words out loud to another person, caps are a bug. Human sentences are sentence
case, SF, and ink. Gray is metadata only (a time, a count, a unit): a grey
paragraph is the AI tell, which is why `EmptyState` renders its sentence in ink.

## The five rules

1. **Chrome is mute.** No caption ever explains a control ("Safe to press",
   "Change the order by re-running setup"). A label is its own documentation.
   Voice lives in exactly three places: empty states, errors, consent content.
2. **No em dashes in any user-facing string.** Rewrite the sentence. Max one " · "
   pair per line.
3. **Gray is metadata only** (timestamps, counts, units). Every sentence and every
   primary label is ink. A gray paragraph is an instant fail.
4. **SF only in chrome.** Native large-title headers own screen titles. The serif
   (Fraunces) is allowed for exactly one thing: Eleanor's own quoted words.
5. **No rhetoric.** UI copy is a plain label or one functional, spoken sentence
   ("Detects falls and calls her, then her contacts."). Banned: parallel
   fragments ("X. It Y."), "X, never Y", taglines, poetic inversion. If it
   sounds quotable, rewrite it or delete it.
6. **Every screen has a visual anchor** — an Avatar, an IconBadge rail, the day
   bar, the alert gradient. A screen that is only text is unfinished.

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
