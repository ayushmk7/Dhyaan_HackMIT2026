# Kestrel app — design system & build rules

Read this before writing any screen. Deviations from this doc are bugs.

## Voice

Kestrel watches over someone's mother. The app must read like a calm, competent
human — never like a hospital monitor, never like a SaaS dashboard. Big statements
are full sentences in a serif ("Eleanor is OK", "She's in the kitchen"). Labels are
sentence case. No ALL-CAPS eyebrows, no middle-dot metadata rows, no icon soup.

## Tokens — import from `@/theme/tokens`

Palette is drawn from the kestrel itself: slate-blue of the wing, rust of the back.
Rust is **reserved for alerts** — if rust appears anywhere but an alert/attention
surface, it's wrong.

- `paper` warm ground, `ink` text, `inkMuted` secondary, `line` hairlines
- `slate` primary/interactive, `slateDeep` pressed
- `moss` = OK, `ochre` = attention/warn, `rust` = alert/critical, `rustDeep` pressed
- `night*` variants: staff Rounds screen and alert takeover use the night ground

Spacing: `sp(n)` = 4px grid. Radius: `radius.card` (14), `radius.pill` (999).
Never invent hex values or magic paddings.

## Type

- Display / status sentences / screen titles: **Fraunces** via `<Txt kind="display">`,
  `"title"`, `"stat"`.
- UI labels, data, buttons: system sans via `<Txt kind="body">`, `"label"`, `"caption"`.
- Use the `Txt` component for ALL text. Raw `<Text>` is a bug.

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

## Data — never fetch or invent data inline

- Server reads: TanStack Query hooks in `@/lib/hooks` (`useResidents`,
  `useResident`, `useTimeline`, `useSummary`, `useAlert`, `useLocationHistory`…).
- Live state (websocket-owned): zustand `useLive` from `@/store/live` —
  resident state, location, activeAlert, ladder, live transcript.
- Session/role/onboarding: `useSession` from `@/store/session`.
- Mutations (`ack`, `resolve`, `feedback`, `simulate`, pairing, survey): `api` from `@/lib/api`.
- The mock backend (`@/lib/mock/kestrel`) simulates the fall ladder in real time.
  `api.simulate('fall')` starts it. Don't touch its internals from screens.

## Motion & feedback

One purpose per motion. The alert takeover pulses (Animated loop already in
`LadderTimeline`); everywhere else prefer none. Use `Vibration` only on the alert
screen. Respect `useReducedMotion` if you add any animation.

## The rules that keep this distinctive

1. Spend boldness once per screen — one serif sentence, one big surface. Everything
   else quiet.
2. Structure encodes info: hairlines separate days, numbered steps only in the
   escalation ladder (it is genuinely sequential).
3. Never show an image/video of the resident. Evidence is always a sentence.
4. Empty states invite action ("No walks recorded yet today") — never mood copy.
5. Buttons say what they do: "I've got her", "Call Eleanor", "This was expected".
