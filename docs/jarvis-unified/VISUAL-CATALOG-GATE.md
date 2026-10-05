# The visual catalog gate

2026-10-05. Dave: "visual catalog compliance is now a HARD GATE, not a guideline. EVERY single addition or change to the UI gets run through the visual catalog rules BEFORE it ships. No exceptions." A thin grey subtext came back on the live Email card after the catalog had been fixed once, at the cost of hours. This file is the catalog written down in one place, the checklist every UI change passes before it is called done, and what enforces it by machine.

The authority behind it is not rewritten here. Where this file and a ruling disagree, the ruling wins: `qa/findings/RULEBOOK.md` (rules R1 to R11, the primitives, what is settled and decided), `jarvis-app/STYLING_CATALOG_V3.md` (§AJ to §AQ), and the laws in `jarvis-app/src/laws/`. This file is the short form a builder holds in their head.

## 1. Text, exactly

| Role | Size token | Weight | Ink | Notes |
|---|---|---|---|---|
| Row or card title (a name) | `--t-name` 16 (scaled) | 700 (`--w-name`) | `--tx-1` | Wraps to two lines before it truncates (Dave 2026-09-26). |
| Subtext under a title (a fact) | `--t-sub` 14 (scaled) | 400 (`--w-sub`) | `--tx-3` | The row's ONE grey. |
| Uppercase kicker, state word | `--t-eyebrow` or `--t-micro` 11 | 700, caps, tracked | `--tx-3` or a key colour | A label, never a sentence. |
| Section head | `.sh2 .t` | 700, 0.1em | per catalog | One rule only (R10). |
| Note under a form field | `.input-hint` | 14, italic | `--tx-3` | The only class for it (R9). |
| Capsule label | its own | 700 | `--tint` on `--capsule-fill` | R2. |

There are two subtext sizes (14 and 11) and two rungs of weight under a title (700 above, 400 below). No third size, no weight under 400, no opacity used to fade text, no raw `calc(Npx * var(--type-scale))` on a quiet line.

Ink, dark and light (`--tx-2` and `--tx-3` are the SAME hex in both themes; bolding one does not make it a different grey):

| Token | Dark | Light |
|---|---|---|
| `--tx-1` primary | `#F7F1EA` | `#1F1A16` |
| `--tx-2`, `--tx-3` secondary | `#D6D0CA` | `#4A423A` and `#5E554C` |
| `--tx-4` separators only | `#948B84` | `#7A7068` |
| `--tx-quiet` (pinned for `.r-goal.r-rec`) | `rgba(247,241,234,0.62)` | `#5E554C` |

These are the warm neutrals (Dave 2026-10-05, locked). The grounds they sit on: dark page `#1C1917`, card `#201C19`, sheet `#2C2723`, raised `#36312D`; light page `#FAF6F0`, card `#F3EEE6`, raised `#ECE5DA`, chrome (tab bar, top bars, sheets, modals) `#FFFDFA`. Brand red `#FF2B3C` (light action red `#D12416`) is unchanged. `laws/warmPalette.test.ts` pins them and measures the contrast.

Contrast floor: text under 4.5:1 on the surface it sits on is a defect. `--tx-3` is the only grey that clears it. Text on a sheet grey uses the `-on-sheet` twin (`--tint-on-sheet`, `--sys-red-on-sheet`, `--warn-on-sheet`).

## 2. The rules, in the order they get broken

1. **One grey per row (R1, §AK).** Under its title, a row has at most one run of secondary ink. Everything else on the row differs by colour from the key, a mark, a fill or caps. Weight alone never counts.
2. **A row with nothing to say shows nothing.** No placeholder ("None", "No date", "Nothing here yet"), and no line that repeats the title or states the action the row already is (`5 Email Items to Review` over `Open Email to Review` was this).
3. **Facts are spans, and CSS draws the dot (R5, R6).** Separate `.fact` spans in a `.facts` line. Never a middle dot baked into a string that renders into a facts or meta line, and that includes a data builder in a `.ts` file that returns `"Task · Due Today"` for a component to print. A dot inside a toast, an aria-label or a prompt is out of scope; trace where the string renders before judging.
4. **Colour is for meaning (R3, §AM).** Done green `--good`; due or next amber `--warn`; late red `--sys-red`; estimate sky; area on a dot only; tappable brand red `--tint`; a stateless number that must stand out white; everything else grey once. A due date drawn grey is a violation. Brand red on something that cannot be tapped is a violation. A category colour on words is a violation. A raw hex or `rgb()` in an inline style, or in a rule for a fact or meta line, is a violation.
5. **A date or time (R8).** A neutral one on a row is small caps `.fact.date`. One with a meaning takes the key colour: past `.fact.red`, today or tomorrow `.fact.warn`, later `.fact.date`. Clock times are 12-hour with AM/PM, durations "45 Min" or "1h 30m", estimates "About".
6. **Emphasis inside a grey line (R4)** takes a key colour or `--tx-1`, never bolded grey.
7. **Casing.** Every line the app writes is Title Case, including every grey subline and the part after every middle dot and every number. Sentence case stays only for chat, note bodies, onboarding and check-in prompts, and a full-sentence field note. His own typed titles are shown in Title Case and stored as typed.
   **The number rule, spelled out (Dave 2026-10-05, caught live as "Earlier 2 blocks").** In any phrase that opens with a number, the word behind the number is capitalized. "2 Blocks", never "2 blocks". "5 Email Items", "45 Min", "1 Block", "3 Tasks Due". A phrase is a run of text between middle dots, line breaks and element edges, so a count in its own span (`<span>{n} Blocks</span>`) is a phrase of its own. The only exception is a small word joining two numbers ("2 of 5 Lifts"). A pluralized word is capitalized in both forms ("1 Block" and "2 Blocks"); write both branches of a ternary capitalized. A count built in JSX is the likeliest place for this to slip, because a source scan cannot see it: it is checked on the DOM (section 4).
8. **Capsules (R2, §AL).** `.pill-act`, `.row-act`: `background-color: var(--capsule-fill)`, never the `background:` shorthand, label `--tint`. A control that is not the screen's one filled primary is a capsule.
9. **Taps.** 44px minimum hit area on everything tappable.
10. **Light and dark differ in colour only.** Size, weight, spacing, shape and icon style are identical (Dave's standing ruling; the four light-only sizes and the filled-versus-outline icons recorded in deviation 62 are a known open breach waiting on his choice).
11. **No new class per screen.** Use the primitives in RULEBOOK.md. If none fits, stop and ask; a new primitive is added once, in `components.css`, with a law.
12. **An action never sits alone in a box (Dave 2026-10-05, the grey rectangle round Add a Reminder).** A card whose only content is an action is not drawn: with nothing to list, the section is its head and the action stands by itself as the same capsule New Event, Schedule and Add All to Calendar are (`.notice-clear-row` > `.row-act`). Dave's earlier rulings stand beside it and are not overturned here: an in-list create row at the END of a card that has rows (Add a Task under tasks) stays a centred `.row-act` (§AK, "NO FLOATING ADD ROWS").  An empty state that has its own title and words (No Matches, Nothing Here Yet) keeps its card; only a card that holds nothing but the button goes. Checked on the DOM (`loneActionBoxes`).
13. **A type icon carries its type's colour (Dave 2026-10-05: the envelope and the task check were flat black in light).** An icon that says what a row IS is never `--tx-1`, `--tx-2` or `--tx-3`. It takes the type's tone: Email teal, Task red, Event sky, Waiting purple, Reminder, Goal, Project, Money and the rest as their sheets and tiles already draw them, through `.cat-fg-*`, with the light twin from the glyph set (`--cat-ic-*`, 3:1 non-text bar), never the text ink. Chrome icons (chevrons, close, back) stay neutral. Both themes, every card type.
14. **Frozen.** The Today TV guide (`.sched-ticker`) is never touched.

## 3. Definition of done, for any change that draws something

A UI change is not done, and is not committed as done, until every line below is true and written in the report.

1. **Name what is drawn.** List every new or changed text run, chip, fact, button and row, and which primitive draws each.
2. **Run each against section 2.** For every run: its size, weight and ink come from the tokens; one grey per row; no redundant or placeholder line; no baked dot; meaning carries its key colour; time and casing correct; taps are 44px. Include strings built in `.ts` data helpers, not only in `.tsx`.
3. **Prove it in the DOM.** A test renders the real component and asserts the catalog property (no `·` inside a `.fact`, a tone class where the fact has a meaning, no `.facts` when there is nothing to say, at most one untoned `.fact` per row, 12-hour time). It fails without the change.
4. **See it.** For anything new or restyled, render the real component through the real stylesheets (a scratch bench, captured with Playwright at a phone size, dark and light, text size pinned) and look at it. A preview is not proof of what his phone does, but it catches what a class name cannot.
5. **Run the gate.** The laws (`vitest run src/laws`) and the tap sweep pass; no rule in this file is broken. A law that blocks a correct change is reported, never edited around.
6. **Say so in the report.** One line: "Catalog: checked, no drift" or the list of what was found and fixed.

Anything touching copy, colour, weight, size, spacing, a new row or a new sheet counts. "It is a small change" is not an exemption; the Email band was a small change.

## 4. What enforces it

- **Static laws (every push):** `subtextLaw`, `colourKey`, `capsuleLaw`, `typeLaw`, `shortCopy`, `astra`, `laws.test.ts` casing and tap-target laws, `catalogFacts` (section 5).
- **DOM checks (every push):** the structural catalog assertions in the component tests, including the Email on Today band. `src/laws/catalogSetup.ts` runs in every jsdom test and fails the test that draws a lowercase word behind a leading number (`laws/catalogCheck.ts`, `numberCaseViolations`); the tap sweep runs the same rule on every screen it reaches in the browser. The roster of exceptions (`laws/catalogRoster.ts`) is empty and stays empty without Dave's word.
- **Computed-style audit:** `tools/visual-audit.mjs` measures the rendered colour, weight, size and contrast of every text run on every screen it reaches (check 8, `grey-twice`, and the rest). It needs a running app and is run by hand today; section 5 says what is added to make it part of the build.
- **The tap sweep (every push):** every control in the demo build is tapped; a dead one fails the build.

## 5. What was missing, and the gap this closes

The catalog was enforced by class names and by hand-run measurement. The Email band slipped through because: it renders through a **data helper** (`email/waiting.ts` returned `"Task · Due Today"` and `"Open Email to Review"` as strings), so no static law looking at JSX saw a middle dot; it sits **behind a build flag** and needs a backend client, so the demo build the auditor walks never draws it; and the computed audit is **not in CI**. The new law (`catalogFacts.test.ts`) scans data helpers and components for dotted strings that feed fact lines and for the other mechanical patterns found in the 2026-10-05 audit, ratcheted so nothing new can be added, and each surface that is invisible to the demo build gets a DOM catalog test of its own.
