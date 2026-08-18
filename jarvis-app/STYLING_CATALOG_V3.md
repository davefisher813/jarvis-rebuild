# JARVIS Styling Catalog V3.1 (DRAFT · pending Dave's approval 2026-08-18)

Revised per Dave: full 15-color palette, alignment grid law, Title Case everywhere with an extended law test, cleaner visuals with the approved polish set.

Supersedes the old 25 catalog files as the styling rulebook. Visual truth stays jarvis-design-system.css + uniformity.css + components.css (flagged sections). This document is the rules layer: what every screen must do with those pieces. Once approved, every new screen and every rebuilt screen is gated against this.

## A. Color is systemic, and the palette is FULL

1. FIFTEEN systemic colors: red, coral, orange, sand, yellow, lime, green, teal, sky, blue, indigo, purple, magenta, pink, graphite. The category picker offers all 15; type tiles draw from the same 15 (nav-tile-* expands to cover every one). Nothing that has an identity is ever gray.
2. Category color follows the category everywhere it appears: tile, dot, chip, avatar accent. Same category, same color, every time.
3. Fixed type-tile assignments stay: task blue, event sky, note yellow, money green, person teal, project indigo, goal purple, gym and time orange, insight purple, mail teal, chat and JARVIS-made red.
4. Intent colors: good green, warn amber, error red, info sky. Status always wears its intent color.
5. Every palette color gets a matching TINT token (16% alpha family) for banners, pills, and stat tiles, so tinted surfaces scale with the palette instead of being limited to red, amber, green, sky.
6. Interactive elements wear the accent. Grey is only for secondary text and dividers.

## B. Every string has a role

Legal text roles, and nothing else:

- Page title (nav-large) and eyebrow above it
- Section head: colored tile + Title Case name, count pill on the right when there is a count
- Row: name (conn-name) + meta (conn-meta), meta short with middle-dot dividers, never a sentence
- Urgency span: colored uppercase, never a filled pill
- Pill: status, tier, or count only
- Stat tile: a number worth reading at a glance, tinted by meaning
- Day divider: the day said once above a group, never repeated per row
- Banner title + meta (see D)
- Empty state title + sub (see E)
- Legal pages and onboarding conversation are the only prose surfaces

A string that fits none of these gets restructured, not styled in place. No standalone explainer paragraphs outside cards ("page-explainer" is retired; its content moves into card rows or dies).

## C. Everything actionable is a control

1. Copy that names an action IS the button. "Needs Google setup · Settings, Connections" is illegal; "Open Connections" as a button is the law.
2. Choices are chips. Selected state is the filled chip. Bounded choosers (chat, pickers) are chip rows, capped, with a Never Mind escape.
3. Numbers the user sets are steppers; tapping the number opens the keypad (stepper-tap / stepper-edit).
4. Mode switches are segmented controls. On/off is the switch. Both iOS-native forms.
5. One primary action per surface, in accent. Secondary actions are quiet buttons or chips.
6. Counts render as pills (count-pill amber for pushed or slipped work; pill-blue and friends for status counts). Figures render as stat tiles.

## D. Banners carry meaning

- Amber banner (left bar + warn tint + orange tile + count pill): work that moved without you. Sweep receipt, slipped blocks, overflow. The repeat offender line is warn-colored (slip-warn).
- Accent-bar banner: an offer (Where You Were, weather connect). Leads with the type tile of what it offers. Tappable everywhere, gone the moment the user acts.
- Error form (sweep-error): louder than success, does not animate away, tap to retry.
- Success is quiet; failed automation is loud. Every banner leads with a tile, never bare text.

## E. Empty states

Icon tile + Title Case title + short sub. When an action exists, the button is IN the empty state. An empty state that tells the user where to go instead of taking them there fails the gate.

## F. Feedback

1. Every mutation shows a receipt toast, with Undo whenever undo is possible.
2. Destructive actions arm: first tap flips the button to "Tap Again to Confirm". Hard deletes state their count in the receipt.
3. Provenance is one short line (madeBy/sourceLine), rendered as meta, never a sentence.

## G. Copy laws (already tests, restated as catalog rules)

1. No em dashes anywhere (law-tested).
2. No sentences in rendered strings: no ". " followed by a capital (shortCopy law). Middle dots divide clauses.
3. Title Case for titles, buttons, section heads, with small words lowercase; sentence case only in conversational surfaces (casing law).
4. ALL CAPS only for eyebrows, kickers, pills, urgency, times.

## H. The alignment grid (LAW)

Four locked columns on every screen: page margin at 16, leading tile at 16 (28pt tile + 12 gap), text edge at 56, trailing edge at -16.

1. One text edge per card: tiled cards indent every text to 56; untiled cards all at 16; a card never mixes.
2. Dividers inset to the card's text edge, never full-bleed through a tile.
3. Trailing column: values, times, chevrons, pills share one right edge at -16; the chevron is always outermost.
4. Numbers are tabular (font-variant-numeric) wherever they stack: times, weights, money, counts.
5. Steppers share one fixed width so their values form a straight column across rows.
6. Section heads sit at 16, flush with the card edge; a section's count pill right-aligns at -16.

Plus the iOS baseline: 44pt minimum hit targets, 8/12/16 rhythm, 4pt grid, safe areas, cards elevated, both themes always. Tokens and classes only; no inline styles in app code; new CSS lands in the flagged sections of components.css.

## H2. Title Case, everywhere (law extended)

Title Case: page titles, section heads, row names, buttons, chips, sheet titles, tab labels. Small words (4 letters or fewer, mid-title) stay lowercase: a, an, the, to, of, in, with, for. ALL CAPS only for eyebrows, kickers, pills, urgency. Meta lines are lowercase fragments with middle dots. Conversation (onboarding, chat, check-ins) is sentence case. The casing law test extends beyond buttons to scan section heads, chips, row-name literals, and sheet titles; violations fail the build.

## H3. Cleaner visuals (approved polish set)

1. Depth tokens: one hairline top light and one card shadow token; cards and stat tiles use them, nothing hand-rolled.
2. Stat tile numerals bigger, tabular, tighter letter-spacing.
3. Hero light: daypart gradient wash on Today; day ring becomes a gradient arc with a soft glow, bursts at 100%.
4. Touch: rows compress on press; primary buttons carry the accent glow; native haptic on completion.
5. Glass chrome: tab bar and large-title nav translucent with real blur, solid fallback for older devices.
6. Motion: one spring token shared by banners, sheets, chips; lists stagger on first paint only; numbers roll on change.

## I. Enforcement

- Laws as tests: em dash, shortCopy, casing, CSS-class existence, versioned keys, typed queries, AI gate, editing primitives.
- Lint gate: react-hooks rules (crash class), runs with tsc + vitest + build on every commit.
- Preview discipline: any visual change ships previews at 390x844 first; Dave approves before code.
- The five no-floating-text rules (section B, C) are the sweep checklist for every existing and future screen.

## Approved conversions queued behind this catalog (from the 2026-08-18 sweep)

1. Today header counts become tappable pills (sky events → Schedule, blue due → Tasks, red overdue → Tasks overdue).
2. Weather offer becomes an accent offer banner with the sky tile.
3. Email setup empty state gets the Open Connections button.
4. Destructive warnings move inside cards as warn rows with the triangle tile (Advanced, Backup; Backup's paragraph becomes three rows).
5. Chat tile in More goes red.
