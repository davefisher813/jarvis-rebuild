# Colour Key sweep — the rulebook every agent gets, verbatim

Paste this whole file into every finder, fixer and reviewer prompt. Agents
judged 2026-09-22's findings against exactly this text; changing it mid-sweep
makes old and new findings disagree.

You are working on the JARVIS app (React + TS + CSS, working dir
`/home/user/jarvis-rebuild/jarvis-app`). The owner, Dave, ruled on all of the
following on 2026-09-22 and wants them to hold on EVERY page, modal, sheet,
settings panel, Brain screen, email page, chat box, text box, preview and
admin screen, including ones not written yet. Primary sources, read them if
a rule is unclear: `STYLING_CATALOG_V3.md` sections `## §AK`, `## §AL`,
`## §AM`; `src/laws/subtextLaw.test.ts`, `colourKey.test.ts`,
`capsuleLaw.test.ts`, `typeLaw.test.ts`, `astra.test.ts`.

**Critical fact:** `--tx-2` and `--tx-3` are the SAME HEX in both themes (dark
`#D2D2D6`, light `#3A3A40`). `--tx-2` text beside `--tx-3` text is the same
grey. Bolding it does not make it different.

## The rules

- **R1 One grey per row (§AK V5.2).** On any row or card, under its title, at
  most ONE run of text is secondary ink (`--tx-2`, `--tx-3`, `--tx-quiet`, or
  inherited grey) at regular weight. WEIGHT ALONE IS NOT A DISTINCTION. Every
  other run on that row differs by a COLOUR from the key (R3), a MARK
  (category dot, glyph, ring), a FILL (chip or pill), or CAPS. A separator
  and the row title do not count. A PLACEHOLDER line that states nothing
  ("Nothing under it yet", "No category", "None", "No date") is itself a
  violation: a row with nothing to say shows nothing.
- **R2 The capsule (§AL).** `.pill-act` and `.row-act` are capsules:
  `background-color: var(--capsule-fill)`, `box-shadow: none`, label `--tint`
  (dark) / `--on-light-red` (light). Never the `background:` shorthand on a
  rule whose subject is `.pill-act` or `.row-act` (it resets
  `background-clip`). `.quiet-action` is not red and never shares a rule with
  `.row-act`.
- **R3 The Colour Key (§AM).** Colour is for MEANING, nothing else.

  | Meaning | Colour | Token |
  | --- | --- | --- |
  | done, on track, paid, logged, in range | green | `--good` |
  | needs you soon: due, next, stalled, near a limit | amber | `--warn` |
  | late, overdue, over the limit, missed | red | `--sys-red` |
  | an estimate the app worked out | sky | `--cat-sky` |
  | which area of life | the category colour, ON A DOT ONLY | `--cat-*` on `.cd` / `.cat-dot` |
  | tappable (link, control, not button-shaped) | brand red | `--tint` |
  | a number with no state that must stand out | white | `--tx-1` |
  | everything else, once per row | grey | `--tx-3` |

  Brand red (`--tint`, `--accent*`, `--on-light-red`) on something that
  CANNOT be tapped is a violation. A category colour on WORDS is a violation.
  A raw hex or `rgb()` text colour in a TSX inline style, or in a CSS rule for
  a fact or meta line, bypasses the key and is a violation. Health screens
  use brighter inks with the SAME meanings (lime done, cyan now, amber
  next/over, violet budget/pair, blue cool-down), and only under
  `.ruled.health-ruled` or `.sheet-scrim > .card`.
- **R4 (F1).** An emphasis (`<b>`, `<strong>`, `Nums`) inside a grey line takes
  a key colour or `--tx-1`. Never `--tx-2` or `--tx-3` bolded.
- **R5 (F2).** A second fact on one line differs by colour, mark, caps or fill
  (R1, stated for `.facts`, `.sched-cat`, `.r-k`, `.conn-meta` lines).
- **R6 (F3).** The separator between facts is DRAWN BY CSS
  (`.fact + .fact::before`, or `<span className="sched-sep">`), never a `·` /
  `·` / `&middot;` baked into a string that renders INSIDE a facts or
  meta line. A middot inside a sentence that is not a facts line (a toast,
  an error sentence, an aria-label, an AI prompt, an export, a document body,
  a comment) is out of scope. Trace where the string renders before judging.
- **R7 (F4).** Subtext uses TWO sizes: `--t-sub` (14) for facts, `--t-eyebrow`
  or `--t-micro` (11) for UPPERCASE kickers. `--t-meta` is also 14. A quiet
  line at `--t-caption` (13), `--t-body` (15) or a raw
  `calc(Npx * var(--type-scale))` is a violation unless it is a title, an
  input's own text, a big display number, or a height-clamped line with a
  stated reason.
- **R8 (F5).** A neutral date or time shown as a fact on a row is small caps
  (`.fact.date`). A date WITH a meaning takes the key colour instead: due is
  `.fact.warn`, late is `.fact.red`.
- **R9 (F6).** The note under a form field is `.input-hint` (14px, `--tx-3`,
  italic). `.input-help` and `.input-note` resolve to the same rule. Any other
  class drawing a note under a field is a violation.
- **R10 (F7).** A section head is `.sh2` with `.t`: one rule in
  `components.css`, 700 weight at 0.1em. Any other rule restyling `.sh2 .t`'s
  weight or tracking is a violation.
- **R11.** The Today "Your Day" card (`.sched-ticker`) renders at all times.
  **Never change its behaviour** (Dave, 2026-09-22 and 2026-09-25).

## The primitives — use these, never a new class per screen

| To draw | Use |
| --- | --- |
| a neutral date or time in a facts line | `<span className="fact date">` |
| an estimate | `<span className="fact est">` (in a `.r-k` row: `.r-goal.r-est`) |
| done / due / late | `.fact.good` / `.fact.warn` / `.fact.red` |
| a number with no state | `<b>` inside the fact (styled white by `.facts b`) |
| a category | `<span className="fact cat"><span className="cd cat-bg-X" />Name</span>` |
| a state word (13 closed words only, `astra.test.ts`) | `.fact.st` |
| the separator | separate `.fact` spans in a `.facts` line; `.sched-fact` + `.sched-sep` in a `.sched-cat`; separate `.r-goal` spans in a `.r-k` (gap, no glyph) |
| a note under a field | `.input-hint` |

If none fits, STOP and report it; do not invent a class. A new primitive is a
decision for the lead session, added once in `components.css` with a law.

## Known legitimate — never report or "fix" these

- `.sched-until-btn`, `.sched-loc` (an `<a>` to Apple Maps), `.see-all`,
  `.nav-action*`, links: tappable, so `--tint` is correct.
- `.fact.st`: a small-caps state word from a closed set of 13. It counts as CAPS.
- `.fact.cat` + `.cd`, `.cat-dot`, `.r-pg` glyph: the category MARK. Words stay `--tx-3`.
- `.fact + .fact::before` and `.r-cue::before` may be `--tx-4` (separator glyphs).
- `.r-goal.r-rec` must be `--tx-quiet` (pinned). `.rdy-n.rdy-off` stays
  `--tx-2` (an OFF state).
- Section heads: **"Only Now wears the accent"** (§AJ G0). A red "Now" head is correct.
- `.empty-title` and `.empty-sub` on an EMPTY STATE are not a row's subtext.
- A row's title (`.conn-name`, `.task-name`, `.sched-title`) is primary ink.
- Input and textarea TEXT, `::placeholder`, and document or editor BODY text
  are not subtext.
- `src/bench/`, `src/testpanel/`, `*.test.ts(x)` and `src/laws/` are not
  shipped UI.

## Settled by the lead (2026-09-26): apply these, never reopen them

- Light theme: `--good`, `--warn` and `--sys-red` are Apple's light system
  colours AS TEXT (Dave's 2026-09-12 Astra ruling). Lateness in light is
  `--sys-red`, never `--on-light-red` (that is the brand words red).
- A paid amount is `--good`. A count with no state (goal projects) is white.
- The capsule's label is its own `--tint` on its opaque fill, on sheets too.
  Red WORDS straight on a sheet grey take `--tint-on-sheet` (`.see-all`,
  `.prov-link`, `.note-fix`, `.sheet-bar-save`, `.toast-action`).
- Mail rail: solid white = unread; amber = due soon or waiting weeks; red = a
  wait past the point an email helps; hollow = read and calm.
- A schedule row's first move (the next step) is amber. A length that cannot
  be tapped is a white `<b>`, not small caps.
- Purple is not in the key: no `.fact.purp`. An estimate is `.fact.est`.
- `.btn-sm` is a capsule (§AL); the 50px base `.btn` is not.
- Caps is for a label, never a sentence. A short caveat ("Correlation, not
  cause") may be an 11px caps kicker; a sentence-length note under a card
  goes below the card as `<div className="pad-x"><div className="input-hint">`
  (the group-footer pattern, as settings' Foot does).
- A date's colour follows the reminder/project window: past = `.fact.red`,
  today or tomorrow = `.fact.warn`, later = `.fact.date`.
- A decision row shows only homes that belong to an area (dot + name); person,
  goal and task links live on the record page. A decision's outcome: worked
  green, mixed amber, didn't red.
- Field notes (`<Note>`, `<Foot>`) keep their middle dots: they are not facts
  lines, and shortCopy.test.ts (Dave, 2026-08-15) keeps notes as fragments
  joined by a dot.
- Today's stat tiles follow the key: late red from the first late task, due
  amber, done green (shown to Dave as a heads-up).
- A facts line never clips a word. In `.facts` only the LAST fact shrinks and
  ellipsizes, so order it: short toned facts first (a date, an age, a count),
  the long free-text fact last (a subject, a name, a place). A line whose job
  is to show every fact (a review or import screen, a capture receipt, a
  settings row) keeps its `.fact` spans inside a wrapping `.conn-meta`
  (two-line clamp; the CSS still draws the dots), as gym/UploadFlow does.
  Check at 390px and at type scale 1.4.
- The key's red on a sheet grey is `--sys-red-on-sheet` (dark #FF6961); the
  amber twin is `--warn-on-sheet`. A red or amber fact never sits on a grey
  card nested inside a sheet: put it on the sheet ground under the group.
- Wait ages follow ONE ladder everywhere (the rail's decide/toneFor, nudges
  included): firm red, direct amber, gentle small caps.

## Held for Dave: do not change these, report them as needs_dave if you meet them

The red Now rule and LIVE word; the Classify sheet's question colours; the
Health area card's green panel; the Account avatar's red disc; the yellow
Remember star; Brain's two red heads; the conditioning clock's 15px caps; the
disclosure `<summary>` colour; the user chat bubble's red; the receipt-line
("13 More Waiting") quiet grey. Questions are in `dave-queue.json`.

## Hard limits for any agent that edits

- Edit ONLY the files you were assigned. If a fix needs another file, report
  it as `needs_other_file` and leave it.
- Rewording is ALLOWED (Dave, 2026-09-25: "Reword freely"): reword, or drop a
  fact that only repeats another, when that is the better fix. Keep meaning.
  Report EVERY wording change in `reworded` as exact old -> new, so he can be
  shown the list.
- Schedule rows are IN SCOPE for styling (Dave, 2026-09-25: "Fix row styling
  only"): `src/schedule/`, `DayRow`, `LockedRow`, `PlanDaySheet`,
  `SchedulePage`. The Today TV guide's BEHAVIOUR is NOT: never change how
  `.sched-ticker` scrolls, pauses, measures, or when it renders (the state and
  branches in `src/today/YourDay.tsx`). Styling a row it contains is fine.
- Never edit `src/laws/`. If a law blocks a correct fix, report the law and why.
- Co-located tests (`X.test.tsx` beside `X.tsx`) may be updated when a fix
  intentionally changes what they assert; say so in the report.
- Laws read the RAW stylesheet, comments included. Do not name a class inside
  a comment right above a rule that could trip a pattern (L1's GUILT regex
  matched a comment mentioning `.u-late` above a `--sys-red` rule).
