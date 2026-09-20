# Dhyaan app — design law

Read this before writing any screen. Deviations from this document are bugs.
`frontend/src/theme/tokens.ts` is the machine-readable half; where the two
disagree, tokens win and this file is stale. Everything a screen renders comes
from `@/components`; a screen never invents a surface, a colour, a shadow, a
padding, a text style or a sentence of its own.

## What it is

**Apple Liquid Glass, with hints of brutalism, in blue, white and black, light
only.** Floating, translucent chrome over an atmospheric ground; opaque, quiet
content; an occasional hard, honest gesture (a 2px ink rule, a mono reading, a
corner tick) marking where a machine produced something. One accent, and it is
blue. Alarm is not a colour but depth on the blue ramp, under a heavy rule.
Nothing in the app is black, and there is no dark ground anywhere: the user
asked for none. A dark palette exists in the tokens, passes its contrast
checks, and is unreachable (see "Dark mode"). The app watches over someone's
mother, for her adult child, at a distance. It must read like a calm,
competent human, never like a hospital monitor or a SaaS dashboard.

**There is no login and no auth.** The app opens straight into onboarding, or
into Today once onboarding is done. There is no sign-in screen, no API key the
user enters, no token, no `session.user`. `useSession` (`store/session.ts`)
holds the resident id, the lane (`family` or `staff`), the onboarding state
and the consent draft; nothing in it is a credential. Any screen, copy or
doc that describes a sign-in flow, a gate on a signed-in person or an auth
header describes something that does not exist. One vestige remains in code:
`lib/http.ts` still sends `Authorization: Bearer dev-key-change-me` and the
websocket URL still carries `?token=`, because a backend process that
predates the no-auth change may still be serving the demo. The HEAD backend
ignores both (`backend/app/main.py`, first line). Delete them from
`lib/config.ts` and `lib/http.ts` once that process is rebuilt.

## The decision table

Use this first. If your case is not here, it is one of these in disguise.

| You need | Reach for | Never |
| --- | --- | --- |
| A page | `Screen` (`native` under a stack header; `wash` on every tab root; `tone="alarm"` for the takeover; `keyboard` for a form or composer; `floatingBar` for the one pinned action) | your own ScrollView, KeyboardAvoidingView or bottom padding |
| A colour, in a component | `useTheme()` (the resolved palette) or `useSurfaceColors()` (what this surface hands its children) | `palette.*` (static, light-only) in anything that renders |
| Any text | `Txt kind=…` | raw `<Text>` |
| Any words a person reads | an export of `lib/copy/family.ts` or `lib/copy/staff.ts` | a string literal in a screen (the audit fails the build) |
| A section heading | `Marquee` (`meta` for a machine reading, `right` for a chip or button, `first` on the first section) | a bold `Txt` with a margin |
| A plate holding a paragraph | `Card` | a `View` with a background |
| A plate holding rows | `RowGroup` (hairlines are inserted for you) | `Card` + `{i > 0 && <Hairline/>}` |
| The screen's one contrast moment (the focal plate) | `Slab` (default `ink`, the light blue plate; `"alarm"` for the takeover's readout and the alerting Floor tile; `"cream"` for a plate that must stay white; `onPress` to make it a button) | `Card style={{backgroundColor: ink}}`, a `View` with `elevation.float`, or a second glass layer |
| A bar or header that content scrolls under | `FloatingBar` / `Glass` | `Card glass` |
| A full-width action | `Btn` (`primary` once per screen, `quiet` for the rest, `danger` only for a confirmed destructive act) | a `Pressable` with a background |
| A text-only action ("Stop the camera", "Delete this note", "Try again") | `Btn kind="link"` (`tone="alert"` only to open a confirmed destructive step; it is heavier, not redder) | `Pressable` + `Txt` |
| A round icon button (call, send, reorder, page) | `IconBtn` (`label` is the VoiceOver name and is required) | a hand-sized `Pressable` |
| The commitment button on the takeover | `Btn kind="inverse"` (the navy plate); secondary actions `kind="outline"` | `BigWhiteBtn`, `OutlineBtn` |
| A button beside a field or inside a row | `Btn size="small"` | `style={{ minHeight: 44 }}` |
| A selectable pill or filter | `Chip` (selected = the accent) | a coloured `Pressable` |
| A labelled input | `Field` (`code` for a pairing code, `minHeight` for a paste area; `label` may be omitted when a sentence above already names it) | a raw `TextInput` |
| "Room  Kitchen" / "Camera  Agreed" inside a card | `KeyValue` | two captions in a `Row` |
| The passive "this opens" mark | `Chevron` | `Icon name="chevron.right"` with a hex |
| A row of data with a category | `MetricRow` / `EventRow` (the glyph is the category; omit `hue` unless Dhyaan is pointing) | a bespoke row |
| A resident's state | `StatusDot` / `StateChip` (form + word, never a colour you pick) | a coloured dot |
| A person | `Avatar` (`avatarTone(i)` cycles a roster) | initials in a `View` |
| The app's logo | `Mark` | a `View` with an icon |
| Nothing here yet | `EmptyState` (inside a `Card` or `RowGroup` when the section owns a plate) | `Txt tone="muted"` with a `voice-ok` |
| Still fetching | `LoadingState` | a bare `ActivityIndicator` or "Loading…" |
| A request failed | `ErrorState` (block) / `ErrorState inline` (one line, inside a form) | `Txt tone="alert"` / `tone="warn"` |
| Dhyaan declines to answer | `Refusal` | anything accented, inverted, or with a retry |
| Machine telemetry (FPS, SOURCE, a count, a timestamp) | `DataLabel`, `Txt kind="stamp"/"mono"/"data"/"readout"` | uppercase in a human sentence |
| A hard line | `Rule` (`ink` 2px, `heavy` 4px, `hair`) | a 1px `View` |
| A load sequence | one `Stagger` around the column, or `Entrance index` by hand | any other unprompted motion |

## The screens, in one line each

So a new reader knows what "Today" means before reading the rules.

- **Today** (`(family)/home`) is a dashboard, not a wall. The presence
  answer at `hero` size on bare paper (`PresenceHero`, which is text, not
  glass), one `Slab` holding the day's four figures as tabular `data`
  readings, and one `RowGroup` of one-line `MetricRow`s that render only when
  there is something to say. Nothing on the screen is a paragraph.
- **Her day**, **Ask** and the alert takeover are unchanged in shape: a
  timeline, a conversation with a composer on a `FloatingBar`, and the
  full-screen alarm.
- **Camera** (`(family)/camera`) is an in-app CCTV console with no video in
  it. The vision worker is the only process that holds pixels and the API has
  no endpoint that returns a frame, so the console renders the derived scene:
  normalised box geometry (`CornerTicks`, the person box on the accent wash),
  the worker's sentence, and telemetry (`DataLabel`s: FPS, MODEL, REC, BATCH).
  It never fabricates a tick; every "no reading" path ends in words.
- **Settings** went from nine equal sections to one. Her name at `display`
  size on bare paper, then the screen's only `Marquee` over a `RowGroup` of
  what Dhyaan was told, then a second `RowGroup` of everything that is only
  sometimes worth opening, one line each. The two irreversible controls,
  "Forget her profile" and "Delete everything and stop Dhyaan", sit apart from
  all of it under a `Rule weight="heavy"`, each opened by a `Btn link
  tone="alert"` and confirmed by typing her name into a `Field` before the
  `danger` button enables. Every control does exactly what its label says;
  there are no toggles standing in for endpoints that do not exist.
- **Staff** (Triage, Floor, Rounds) sits behind the family app and is reached
  from Settings. Every staff screen is on paper now, Rounds included.

## Surfaces

Every primitive reads the **surface** it sits on and picks its own colour.
`Screen` declares the ground (paper or alarm); `Card` declares paper; `Slab`
declares ink, cream or alarm. Inside a `Slab` or on the takeover you pass
**no** tones: `Txt`, `Rule`, `Hairline`, `Marquee`, `DataLabel`, `Chip`, `Btn`
and `IconBtn` already know. Explicit `tone` and `color` props still win when
given. `Surface` and `useSurface` are exported for the rare layout that owns a
blue ground without going through `Screen` or `Slab`.

What each surface is:

| Surface | What it is |
| --- | --- |
| `paper` (the page, a card) | near-white with a blue cast (`#F3F5F9`), white cards, ink text |
| `ink` (`Slab`) | `blue[200]` plate, ink text |
| `cream` (`Slab tone="cream"`) | a white plate, ink text |
| `alarm` (the takeover) | `blue[300]` ground, ink text, a 4px ink rule under the status bar |
| `alarm` (`Slab`: the readout, the alerting Floor tile) | `blue[100]` inside a 2px ink rule |
| `night` | **specified, unused.** `blue[100]` page with white cards. `Screen`, `Slab` and `Surface` still accept it and the tokens still carry `night*`, but no screen passes `tone="night"` today: Rounds moved to paper and the camera pane is the accent wash, not a night ground. |

No plate is dark. A focal plate is a *deeper step on the blue ramp* than
whatever it sits on, with the same ink text as the page; the takeover is the
deepest step there is. Text on any plate comes from `onLight` (seven alphas of
ink). There is no eighth alpha. `onDark` and `onCream` still exist and are
`onLight` by another name; `onDeep` (the same seven alphas of white) is what
the unreachable dark scheme uses. `ink`, `inkMuted`, `inkFaint`, `line` are
the greys on paper, full stop.

### Glass, opaque, or slab

| Surface | Tier | Radius | When |
| --- | --- | --- | --- |
| `Glass` / `FloatingBar` / the tab bar | `float` | `glass` 22 / `bar` 30 | content passes **under** it: the tab bar, a pinned action, a day pager, the chat composer |
| `Card` | `raised` | `card` 16 | holds a paragraph or rows; opaque, always |
| `Slab` | `float` | `glass` 22 | the screen's one uncompromising contrast moment: Today's four figures, a counter, the takeover's readout |
| `Field` | flat | plate + rule | every input, everywhere; glass never holds text you type |
| the page | `flat` | none | everything else |

Rules that keep this honest:

- **Radius follows tier.** raised = 16, float = 22, a sheet = 28, a pill bar
  = 30. An opaque tile at `raised` is 16, not 22.
- **At most one glass layer deep, and at most one floating surface per
  screen** besides the bar. The takeover's readouts are `Slab tone="alarm"`,
  not a second glass.
- **Glass holds chrome, not prose.** The presence hero used to float in glass
  over the wash; it is bare text on paper now, and that is the rule working.
- **Spend a wash where you spend glass.** Every tab root screen gets `wash`.
  Glass is only as good as what it refracts.
- `Glass` is the only component allowed to call `expo-glass-effect`. It gates
  on both `isGlassEffectAPIAvailable()` and `isLiquidGlassAvailable()`
  (`glassAvailable`, decided once at module scope) and falls back to a
  designed frosted plate. `opacity: 0` on any ancestor kills the effect;
  `Entrance` floors its fade at 0.01 for that reason.
- `Card` draws no border in the light scheme. The hairline edge it would draw
  on a deep ground is dark-scheme code and never runs.

## Chrome floats

Both tab bars are inset glass capsules that content scrolls under.
`FloatingTabBar` and `TabBarInsets` live in `app/(family)/_layout.tsx` and the
staff layout imports them from there (they belong in
`components/tab-bar.tsx`; move them when the file lock lifts). The bar is a
custom `tabBar` renderer on `expo-router/js-tabs`, **not**
`expo-router/unstable-native-tabs`, on purpose:

- Native tabs only float on iOS 26. Everywhere else they are the old
  edge-anchored `UITabBar`, and the ask was a floating bar, unconditionally.
- Native tabs give JS no bar height. Every pinned `FloatingBar` positions
  itself from the bottom safe-area inset, so with a bar of unknown height the
  chat composer and the camera controls would sit under it.
- The API is explicitly unstable. This renderer uses only `Glass`, which the
  app already ships on, and react-navigation's documented `tabBar` contract.

Geometry: `TAB_BAR_HEIGHT` 60 (two `radius.bar` corners meeting, so it is a
true pill), `TAB_BAR_GAP` 8, and `TAB_BAR_CLEARANCE` is their sum.
`TabBarInsets` raises every descendant's safe-area bottom by the clearance,
so `Screen`, `FloatingBar` and any `useSafeAreaInsets()` reader clear the bar
without knowing it exists. The bar itself is handed the real inset. Selection
is an ink pill at 7% alpha that springs between tabs on `motion.enter`; under
reduce-motion it simply appears. Tab labels are `mono.micro` with the mono
face removed, weight carrying the focused state.

Headers are the native bar's, compact and centred (`TabStack` in
`lib/nav.tsx`): `headerLargeTitleEnabled: false` (the SDK 57 name; the old
`headerLargeTitle` is deprecated, and four child-stack layouts still pass it
as a harmless duplicate), `headerTitleAlign: 'center'`, `headerTransparent`,
and **no `headerBlurEffect`**: on iOS 26 react-native-screens draws its own
scroll-edge effect on a transparent header, and setting both overlaps them
(RNScreens warns about exactly this). `Screen native` pairs the bar with
`contentInsetAdjustmentBehavior="automatic"` so nothing starts hidden beneath
it. A screen's first row therefore starts about 60pt higher than it did under
a large title.

## Colour

Three colours: **blue, white, black**, and the greys between white and black.
No yellow, cream, green, red or purple anywhere, and no dark ground of any
kind: the page is white or a blue-tinted near-white. Black is text, never a
surface.

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
| **Depth** | a deeper step on the blue ramp than the ground, with the page's own ink on it: `blue[200]` for a `Slab`, `blue[300]` for the takeover | the alarm takeover; `Slab`; the alerting tile on Floor; `Mark` |
| **The navy plate** | `blue[800]` with white text: the far end of the ramp, the loudest thing a control can be | the alerting `StateChip`; `Btn danger` / `inverse` |
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

**Alarm** (was rust) used to be inversion: white on black. Black is gone
because the user asked for no dark backgrounds, so alarm is now four things
stacked, none of them a hue of its own. This is the decision that matters, so
here it is in full:

- The takeover (`Screen tone="alarm"`) is the **only screen whose whole ground
  is blue**: `blue[300]`, the deepest step the ramp has before ink stops
  clearing AA on it (8.3:1 body, 5.0:1 for the muted metadata). Every other
  screen is paper. A `Slab` is `blue[200]`; the takeover is a screen-sized
  step past it.
- A **4px ink rule** is pinned across the top of the takeover, just under the
  status bar (`rule.heavy`, `Screen` draws it). It is the brutalist gesture
  the system already uses for a section heading, at twice the weight, and it
  is there from the first frame, before anything scrolls.
- The one commitment ("I've got her", "Assign to me") is `Btn kind="inverse"`:
  the **navy plate**, `blue[800]` with white text, the only navy button on any
  screen. The takeover's secondary actions ("Call 911") are `outline`. No
  accent blue on the takeover: blue[600] is Dhyaan pointing, and on the
  takeover it is the family who acts.
- The cancel ring **breathes** (`CancelCountdownRing`) and the live ladder
  step **pulses** (`RingingPulse`), in the surface's ink. Motion is the fourth
  signal, and the takeover is the one place it runs unprompted.
- The words say it: "Needs someone now". Never "Alert".

On a normal screen, the alerting state is the **only navy element**: the
alerting `StateChip` is the navy plate, the alerting Floor tile is a `Slab
tone="alarm"` (a `blue[100]` plate inside a 2px ink rule, on a page of white
tiles with no border at all), the alerting `StatusDot` is a bullseye. Nothing
else on that screen is navy or ruled, so the eye lands on it before it can
read.

What this costs, said plainly: **inversion was louder.** Black on white was
the largest change the system could make, and a blue[300] ground with a rule
and a navy button is a smaller one. It is still the only blue screen, the only
heavy rule and the only navy plate, and a family opening the alert sees a
different-coloured app with a hard line across the top. If that proves too
quiet in use, the lever is the ground: `palette.alarm` in `tokens.ts`, one
value, with `washTone.alarm` beside it. Not a new hue, and not black.

A failed save, a dropped connection and a form validation line are **ink**
(`ErrorState`). They are neither pointed at nor navy; they are sentences.

`Btn kind="danger"` is the navy plate: the one `blue[800]` button, for the
final step of a confirmed, irreversible act ("Forget her profile"). The link
that *opens* that confirmation is `Btn kind="link" tone="alert"`, which is
bolder, not redder.

### Rooms and people on the ramp

`zoneColor` gives each room a value on the blue ramp, interleaved so the rooms
a day actually alternates between (bedroom and bathroom, kitchen and hallway)
sit far apart on it. *Outside* is off the ramp entirely: ink, "she has left
the picture". *Unknown* is the hairline grey. The legend is the key; seven
blues in a 20px bar are a shape until the swatch names them, which is why
`RoomTimeBar` always draws the legend and an outline around the bar. Staff
screens only, as before; a family screen never shows a room.

`avatarGradient` is three monograms on the ramp: deep, mid, graphite. The keys
`green`, `amber`, `blue` are historical and `avatarTone(i)` still cycles them.

### Compatibility keys

`palette.moss`, `ochre`, `rust`, `rustDeep`, `amber` and their washes still
exist so an unconverted screen compiles. Each resolves to what its *meaning*
now is (`moss` is ink, `ochre` and `amber` are the accent, `rust` is the
`inverse` plate). The per-category `hue.*` map still exists too, and is
`inkMuted` for every category except `heart` and `presence`, which are the
accent. Reading any of these is a bug to fix, not a colour to use; they are
marked `@deprecated` and the editor will say so.

## Dark mode

**Specified, built, unreachable.** There are two palettes with the same keys
(`palette`, light; `darkPalette`), `buildSemantics` derives the state styles,
zone ramp, washes and glass tints for each, and `themes.dark` is a complete
resolved theme that passes every row of the contrast table below. Nothing
can select it:

- `app.json` sets `userInterfaceStyle: "light"`, so iOS never reports dark.
- Android and web report the system scheme regardless of that setting, which
  is how a navy `Slab` and a near-black ground once reached Today on a phone
  set to dark. The root layout therefore wraps the whole app in
  `<ThemeProvider scheme="light">` (`LightOnly` in `app/_layout.tsx`), and
  `useTheme()` resolves to the light theme everywhere, on every platform.

Re-enabling it is that wrapper plus one word in `app.json`. Until then the
dark values are kept honest by the contrast table, not by use. The design
intent that would apply if it were switched on: the ground, the greys, the
hairline, the washes and every blue plate invert (`ink` goes `blue[200]` to
`blue[800]`, `alarm` `blue[300]` to `blue[700]`, the navy plate `blue[800]` to
`blue[200]`); the white plate and the meaning do not; the accent moves along
the ramp to `blue[300]` with near-black text on it; a dark wash is the black
ramp with its warm bloom halved and heavier grain; and `Card` draws a hairline
edge instead of a shadow. None of that runs today.

## Contrast

Measured (WCAG relative luminance), body text against its ground. The dark
column is the unreachable scheme, kept so it stays honest.

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
| `.soft` on the takeover (captions at 78%) | 5.5:1 | 6.8:1 |
| `.muted` on the takeover (`DataLabel`, ladder stamps) | 5.0:1 | 5.6:1 |
| ink on `inverseRaised` (the alarm `Slab`) | 14.9:1 | 12.1:1 |
| `nightInk` on `night` (unused surface) | 14.9:1 | 15.0:1 |
| `nightMuted` on `night` / on `nightRaised` | 6.2:1 / 7.8:1 | 8.2:1 / 6.6:1 |
| `onPlate` on `plate` (`Btn inverse`, the alerting chip) | 13.4:1 | 11.7:1 |
| the surface accent as text on the ink `Slab` | 6.1:1 | 8.3:1 |
| the surface accent as text on the takeover | **4.3:1** | 6.1:1 |

Every text pair clears AA (4.5:1) except the last: the accent as *small text*
on the takeover is 4.3:1, which is why the takeover has no accent text (its
buttons are the navy plate and `outline`; its tags are ink). `Btn primary` on
the takeover would be legible (white on `blue[600]`) but its edge would be
2.9:1 against the ground; do not put one there. `onLight.muted` is 0.74
alpha, not 0.62, for this table: at 0.62 it was 3.8:1 on `blue[300]`. The
`readout`/`data` display numbers sit on the same grounds and clear 3:1 by a
wide margin. `inkFaint` (the chevron, a placeholder) is decorative and does
not: 2.8:1. Adjacent bands of the room ramp are 1.3 to 1.5:1 apart, which is
the cost named above.

## Type: SF for chrome, mono for machines, serif for her

- **Six sizes, no more: `scale` = micro 11, caption 13, body 17, title 22,
  display 30, hero 40.** Each step is a real jump (about 1.3x). Every `type.*`
  and `mono.*` key is an alias onto one of them; two keys at the same size
  differ by weight, never by a private size.
- **Line-height and tracking are two rules, not per-entry numbers.** Display
  sizes (22 and up) take 1.12x and a tracking of -(size/40); text sizes take
  1.35x and 0; the serif quote takes the text ratio at the title size.
- **SF (system) is the app.** `hero` 40/800 (a screen's one big sentence),
  `display` 30/800 (the alert headline), `title` 22/700 = `heading` (Marquee)
  = `stat` (a tile's figure), `body` 17, `label` = `button` = body at 600,
  `caption` 13, `tag` = caption at 600.
- **Menlo is the machine voice**, on the same six sizes with tabular figures.
  Token keys are `mono.hero` 40, `mono.big` 22, `mono.data` 13 = `mono.stamp`
  13, `mono.micro` 11 uppercase, tracked +1. The `Txt` kinds map onto them
  by job: `readout` (40, a slab counter), `data` (22, Today's figures),
  `mono` and `stamp` (13, a reading, a timestamp), `micro` (`DataLabel`).
- **Zero literal `fontSize` values in `src/app`, and that is a rule.** Every
  size is a `type.*` or `mono.*` alias. The one `fontSize:` left reads
  `type.label.fontSize` (`lib/nav.tsx`, and the Rounds stack layout that
  mirrors it) for a native header title, because UIKit must be handed a
  number. Grep for it before you add another.
- **Fraunces survives for one job:** her own quoted words, `kind="quote"`.
  Content, never chrome. Set at the title size, as prose.

**Uppercase and mono are for machine words only**: FPS, LATENCY, SOURCE, REC,
a count, a timestamp, a band id, a request path. If a person would say the
words out loud to another person, caps are a bug. Human sentences are sentence
case, SF, and ink. Grey is metadata only (a time, a count, a unit): a grey
paragraph is the AI tell, which is why `EmptyState` renders its sentence in
ink.

## Copy

**All copy lives in `src/lib/copy/`, one file per area** (`family.ts`,
`staff.ts`), and a screen imports its own area directly, never through a
barrel. A string literal in a screen is a bug: it cannot be reviewed as
writing and it is where the voice drifts. What belongs there is anything a
person reads: labels, headings, button text, empty states, errors,
accessibility labels, the words inside a confirmation. What does not: values
from the server (her name, a sentence Dhyaan wrote), machine telemetry keys
rendered through `DataLabel` (`FPS`, `MODEL`), and the format helpers in
`lib/format.ts`. **Interpolation is a function that returns a whole sentence**
(`noPhoneFor(name)`, `emptyQuietHint(minutes)`), never a template a screen
fills in. `src/lib/copy/README.md` is the short version of this paragraph.

`scripts/copy-audit.py` enforces it and fails the build (exit 1). Read the
script; the rules it actually checks are:

1. **No user-facing string literal in a screen.** For every file under
   `src/app/`, a copy attribute (`label`, `title`, `placeholder`, `hint`,
   `message`, `meta`, `retryLabel`, `emptySentence`, `accessibilityLabel`,
   `accessibilityHint`, `detail`, `word`) or a JSX text node whose value has
   two real words in a row is a violation.
2. **No em dash inside a string literal with words around it**, anywhere in
   `src/`. A bare `"—"` (the missing-value glyph a telemetry readout shows
   when there is no reading) is typography, not prose, and is allowed.
3. **No ", never " rhetoric** inside a string literal.

`// voice-ok` on a line exempts it; use it for a deliberate line, not to make
the audit pass. Two rules that used to exist do not: the "muted text longer
than six words" heuristic went blind the moment screens started rendering
`{copy.x}` (there was no text node left to match), and rule 1 is what
replaced it; and a "string too long" rule was tried and dropped because every
hit was consent text or a destructive confirmation, which are long on
purpose. The audit does **not** check for emojis; that is a convention, not a
gate.

## The rules

1. **Chrome is mute.** No caption ever explains a control ("Safe to press",
   "Change the order by re-running setup"). A label is its own documentation.
   Voice lives in exactly three places: empty states, errors, consent content.
2. **No em dashes in any user-facing string.** Rewrite the sentence. Max one
   " · " pair per line.
3. **Grey is metadata only** (timestamps, counts, units). Every sentence and
   every primary label is ink. A grey paragraph is an instant fail.
4. **SF only in chrome.** The native header owns the screen title, compact and
   centred. The serif (Fraunces) is allowed for exactly one thing: her own
   quoted words.
5. **No rhetoric.** UI copy is a plain label or one functional, spoken
   sentence ("Detects falls and calls her, then her contacts."). Banned:
   parallel fragments ("X. It Y."), "X, never Y", taglines, poetic inversion.
   If it sounds quotable, rewrite it or delete it.
6. **Every screen has a visual anchor**: an Avatar, a `Slab`, the day bar,
   the alarm ground. A screen that is only text is unfinished.
7. **Copy is data.** See "Copy". A sentence in a screen file does not ship.

## Voice

- No emojis anywhere (by convention; the audit does not check).
- No em dashes in a user-facing string; at most one " · " pair per line.
- No room names on family screens, structurally: `Presence`,
  `ActivityItem` and `CameraMonitorTick` carry no zone (`VLM_PLAN.md` §5.2,
  `DECISIONS.md` D-001).
- Everything the app tells the family names its source: `KindTag` *Dhyaan
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

`sp(n)` on the 4px grid, always. **Every interactive target is at least
`size.hit` 44pt**: buttons, tab items, icon buttons (a `size.control` 40
visual with hit slop), link buttons, rows that open. `size.button` 52 /
`buttonSmall` 44 are the two button heights. `radius.bubble` 20 exists for the
chat bubble and nothing else.

## Data

Server reads through hooks in `@/lib/hooks`; live state through `useLive`;
the resident, lane and onboarding state through `useSession` (no user, no
token); the care file through `useCareFile`; mutations through `api`. Never
import the mock or the http client from a screen. Evidence is always a
sentence, never an image; the camera console renders geometry and words.

## Components, by file

- `theme/tokens.ts`: `palette` (light), `darkPalette`, `blue` (the ramp),
  `scale`, `type`, `mono`, `onLight`, `onDeep` (`onDark`, `onCream`
  deprecated aliases), `buildSemantics`, and the light-only statics
  `stateColor`, `hue`, `zoneColor`, `avatarGradient`, `washTone`, `glass`.
- `theme/theme.tsx`: `useTheme`, `useScheme`, `ThemeProvider`, `themes`.
- `text.tsx`: `Txt`, `Surface`, `useSurface`, `useSurfaceColors`,
  `surfaceColors`, `isDarkSurface`, `toneColor`.
- `ui.tsx`: `Screen`, `LoadingState`, `ErrorState`, `EmptyState`, `Refusal`,
  `Btn`, `IconBtn`, `Chevron`, `Field`, `Row`, `Hairline`, `SectionTitle`,
  `Card`, `RowGroup`, `Slab`, `KeyValue`, `Mark`, `StatusDot`, `StateChip`,
  `Chip`, `StatTile`.
- `brutal.tsx`: `Rule`, `Marquee`, `DataLabel`, `CornerTicks`.
- `glass.tsx`: `Glass`, `GlassGroup`, `FloatingBar`, `FLOATING_BAR_CLEARANCE`,
  `glassAvailable`.
- `viz.tsx`: `MetricRow`, `EventRow`, `RoomTimeBar`, `LadderTimeline`, `Sparkline`.
- `presence.tsx`: `KindTag`, `CitationChip`, `PresenceHero`, `FactRow`.
- `entrance.tsx`: `Entrance`, `Stagger`, `useReducedMotion`.
- `wash.tsx`: `Wash`.
- `icon.tsx`: `Icon`, `IconBadge` (`outline`), `eventSymbol`, `eventColor`.
- `avatar.tsx`: `Avatar`, `avatarTone`.
- `alert-extras.tsx`: `CancelCountdownRing`, `RingingPulse`, `ElapsedStat`.
- `app/(family)/_layout.tsx` (for now): `FloatingTabBar`, `TabBarInsets`,
  `TAB_BAR_HEIGHT`, `TAB_BAR_GAP`, `TAB_BAR_CLEARANCE`, `glyph`.
- `lib/nav.tsx`: `TabStack`.

All of these are exported from `@/components` except the tab bar and
`TabStack`. `SectionTitle`, `Card glass`, `Btn kind="glass"`, `Field code`,
`StatTile`, `Slab tone="cream"`, the `night` boolean props and the
`ok`/`warn`/`alert`/`amber`/`slate` text tones are kept for compatibility and
no screen uses them today; prefer `Marquee`, `Glass`, `tone="accent"`, and
letting the surface decide.
