# Dhyaan app — design contract

A judge called the old UI what it was: AI-generated. The tells were self-narrating
chrome, em-dash prose, gray paragraphs, serif-as-chrome, and six equal sections per
scroll. This contract exists to keep those dead. Deviations are bugs.

References studied (real screenshots, not memory): Gentler Streak, How We Feel,
Life360. What they share: a face or visual anchors every screen, bold black primary
text, saturated committed brand color, mute chrome.

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

## System

- Ground `paper` #F5F2EB; cards pure white, borderless, `cardShadow`, r16.
  Separators (`Hairline`) live inside cards only.
- Brand: saturated green `slate` #1E7A5A (token name is historical). Tonal
  fills (`slateWash`) for secondary buttons, chips, pills — never outlines.
  `rust` remains alert-only. Zone colors are saturated (day bar is a hero).
- People are `Avatar` (gradient monogram). Rows and tiles get `IconBadge`
  (white SF Symbol on a colored roundrect). Raw emoji = bug.
- Type tokens only: `heading` for in-screen sections, `stat` for tile values,
  `label` for row titles, `caption` for metadata. All SF.
- Navigation: every tab is a native stack (`TabStack` in `@/lib/nav`) with
  `headerLargeTitle`. Screens under one pass `native` to `Screen` (or set
  `contentInsetAdjustmentBehavior="automatic"`). Detail screens rely on the
  native back button — never a custom back row.
- Demo/dev controls never appear in visible chrome. They live behind the
  long-press DebugPanel (Settings) and deep links (`/simulate`,
  `carefile?demo=1`).

## Data rules (unchanged)

Screens read via hooks in `@/lib/hooks`, live state via `useLive`, session via
`useSession`, care file via `useCareFile`; mutations via `api`. Never import the
mock or http client directly. Evidence is always a sentence, never an image.
