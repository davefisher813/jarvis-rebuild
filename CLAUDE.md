# JARVIS, working notes

Decisions that outlive the session that made them. Short, dated, and only
the ones a future session would otherwise get wrong.

## Unfinished: the Colour Key sweep (paused 2026-09-22)

Dave paused a sweep to make the 2026-09-22 rulings (§AK one grey, §AL the
capsule, §AM the Colour Key and Subtext Catalog picks) hold on every screen,
to resume when his usage resets. **If he says "resume", start at
`qa/findings/2026-09-22-RESUME.md`** and follow it in order: it holds the
questions to ask him first, the 581 pending findings, the ready-to-run
workflow, and the pitfalls already hit. Do not re-audit from scratch.

## The Today TV guide is frozen (Dave, 2026-09-27)

"For no reason are we ever getting rid of that. It should never be edited.
It should never be touched. It was the one thing I was happy with the whole
time." The scrolling day card on Today (`.sched-ticker` in
`src/today/YourDay.tsx`, between the `TV GUIDE, FROZEN` and `END TV GUIDE`
markers, and the matching block in `src/styles/components.css`) MOVES AT
ALL TIMES: a day shorter than the window is repeated until the loop has two
windows to loop; Pause holds it for the visit only. `src/laws/tvGuide.test.ts`
hashes both regions and fails the build on any edit. Do not touch it, do
not "improve" it, do not restyle the rows it contains through it, unless
Dave says so in his own words, and then update the hash with his quote.



## The visual catalog is a hard gate (Dave, 2026-10-05)

"I am sick of this shit." A thin grey subtext came back on the live Email card
("Open Email to Review" under "5 Email Items to Review", "Task · Due Today")
after Dave had spent hours fixing exactly that. Effective immediately, EVERY
addition or change that draws anything (a string, a chip, a fact, a row, a
colour, a weight, a size, a spacing, a sheet) is run through the catalog
BEFORE it is called done. No exception for a small change; the Email band was
a small change. The written catalog and the definition of done are in
`docs/jarvis-unified/VISUAL-CATALOG-GATE.md`; the authority behind it is
`qa/findings/RULEBOOK.md`, `jarvis-app/STYLING_CATALOG_V3.md` (§AJ to §AQ) and
`jarvis-app/src/laws/`. In short: one grey per row, a row with nothing to say
shows nothing, facts are spans with the dot drawn by CSS (never a dot in a
string, and that includes strings built in data helpers), colour only for
meaning, Title Case (and the word behind a leading number is capitalized:
"2 Blocks", never "2 blocks", Dave 2026-10-05; checked on the DOM by every
jsdom test and by the tap sweep), 12-hour times, 44px taps, no action alone in a box (a card with only a
button in it is not drawn; the capsule stands by itself), a type icon wears its
type's colour (Email teal, Task red, Event sky, Waiting purple; never flat
black), light and dark differ in colour only. A report on any UI change ends with one line: "Catalog: checked,
no drift", or what was found and fixed. A law that blocks a correct change is
reported, never edited around.

## Row actions, warm neutrals and the "perfect" bar (Dave, 2026-10-05, LOCKED)

"Everything should look PERFECT." "I want the most aesthetically pleasing app ever." Decided, and not reopened without his word:

- **Clean rows. No pills anywhere inside a card or a row.** Tap a row: its detail sheet, with every action (the primary prominent, the quieter ones beneath: Snooze, Move, Edit, Drop). Swipe left: the row's quickest contextual action (task: Done; upcoming reminder: Snooze; ready-to-work task: Start; active task: Wrap Up; low priority: Drop or Move). Swipe right: Complete. Long press: the context menu (`RowActionSheet`), never the only way to anything essential. The completion checkbox stays on the row (state, not a command). Section-level actions (Add, Plan My Day, Copy Yesterday, Add Account, Add Bill, Add Item) live in the section head, never inside a card. This supersedes the older "in-list create is a trailing `.row-act` row" ruling (§AK) and the "bare text is not a category" line for the one case below.
- **Contextual surfacing.** A row whose moment has come quietly surfaces its one action on the row (a due-now reminder shows Snooze; an overdue item shows its action). Future items stay clean. It is a quiet text action in the key colour, never a capsule, and is the same action as the swipe.
- **Discoverability, three parts and no permanent affordance:** one row on the Today list peeks open and closes once, ever; a dismissible tip at the top of the list on first run ("Swipe a task for quick actions") that is gone for good after one swipe or one dismiss; no grip dots or always-visible hints.
- **Colour.** Brand red `#FF2B3C` stays EXACTLY the signature accent, reserved for actions; never shifted toward coral. Neutrals warm up around it: light-mode background cream about `#FAF6F0`, dark mode warm charcoal about `#1C1917`, never pure black and never stark white as the dominant field. Semantic colours stay disciplined: amber due-now, red late or destructive only, green done.
- **Craft (the research playbook, `qa/findings/2026-10-05-design/aesthetic-playbook-report.md`):** one radius language (24 cards, 16 fields, pill buttons), an 8pt spacing grid, ONE shadow recipe (warm brown, about 8%, blur 24, y 8) or none, a rounded display face for headers and tabular digits for numbers, springy 100 to 200 ms press feedback, completion celebrations that vary and respect Reduced Motion, a voice in the microcopy, crafted empty, loading and error states.

When the keyboard is up in a document, two bars sit above the keys:

1. **Ours** (`.doc-kbar`, `shared/DocEditor.tsx`): Undo, Redo, Format, List,
   Insert, JARVIS, Done.
2. **iOS's own accessory pill**: the field chevrons and a tick. It belongs to
   WKWebView, not to us, and its tick duplicates our Done.

**Now, while the web app is the job: keep both.** The page renders above the
whole stack rather than under it. `DocEditor` publishes `--doc-kbar-clear`,
the distance from the top of our bar to the foot of the layout viewport, so
the room reserved on a writing screen covers our bar, the pill and the keys
without this code knowing which is which. `--doc-kbar-h` is our bar's own
height, for anything that wants only that.

**When the work moves to iOS: take option 3.** Hide the pill and put our bar
on the compact row. That is:

- `npm i @capacitor/keyboard`
- `Keyboard.setAccessoryBarVisible({ isVisible: false })` at startup, iOS only
- `npx cap sync ios`
- Compact row: `.doc-kbar-row` at 44px min-height, `.doc-kbtn` at 36px and
  14px type, icons at 18px. Measured 45px against today's 57px.

It is deferred, not rejected, for one reason: `@capacitor/keyboard` is a
**native dependency**, so it needs a pod install and a real iOS build. A web
deploy cannot carry it. Nothing else in the four options was worth the
rebuild on its own.

Options 1 and 3 were chosen from a rendered comparison of four, not from a
description. Build the same kind of preview before changing this again.

## Previews sent to Dave must pin their text size

He reviews on an iPhone. iOS Safari inflates text on a page that does not pin
it, and the app (a native webview) does not inflate, so an unpinned preview
shows text about twice the size the app draws and sends him chasing a size
problem that is not in the app. Every preview file gets:

```css
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
```

The app itself sets `text-size-adjust` nowhere; if that ever changes, this
note is why it mattered.

## Previews, generally

Dave asks to see a change before it is applied, and previews are built by
rendering the real component through the real stylesheets (a scratch bench
under `src/bench/`, captured with Playwright), never by hand-writing a mockup.
They are generated throwaways: `*-preview.html` is gitignored, and the scratch
bench is deleted before committing, or `laws.test.ts` fails it as unreachable.

A preview is not proof of what his phone does. It runs on Linux, which has no
SF font and falls back to something wider, so a title truncates earlier there
than on the phone.

## Reminders rows wear the task row's type

`.rem-card-title` takes `.ruled .task-row .task-title`'s exact numbers: 16px,
`--w-regular`, `-0.01em`. In Life the four lenses sit next to each other and
any difference reads as a mistake. If the task row's type moves, move this
with it.

## Protected blocks have per-day exceptions (2026-10-01)

A recurring protected block can carry `exceptions` (ISO date to
`{ skip } | { startMin, endMin }`), written by the Edit Protected Time sheet's
This Day scope. The weekly rule is never edited by it, and a rule edit never
touches an exception. Read a block's time for a date ONLY through
`blockForDate` / `protectedRangesOn` in `src/routine/types.ts`; the dow-only
`protectedRangesFor` does not see exceptions. Past dates are inert and pruned
on the next write.
