# JARVIS, working notes

Decisions that outlive the session that made them. Short, dated, and only
the ones a future session would otherwise get wrong.

## The Colour Key sweep closed (2026-10-30)

The sweep that made the 2026-09-22 rulings (§AK one grey, §AL the capsule, §AM the Colour Key) hold on every screen is closed:
676 findings, 594 done, 82 rejected with reasons. The
record is `qa/findings/2026-09-22-RESUME.md` and the findings JSON beside it. The on-screen proof is
`tools/visual-audit.mjs` at 390 in both themes: 106 screens, 42 sheets, nothing outside its ruled exemptions but two dark
reds below. Two things about that tool a future session must not undo:
- The fixed `.app-shell` is not a layer or a modal root (it holds the tab bar). Taking it for one made every screen look like
  an open sheet, so for weeks no sheet was really audited and sheet audits measured the page underneath.
- A form row that forwards its tap in code must say so in the DOM: spread `fieldDoor` (shared/FormSheet) instead of
  `onClick={tapField}`, or give `Row` a `forwardTo`. The audit reads `data-forwards`; without it a 44px row is measured
  as its 11px chevron.
Dave settled the last three on 2026-10-30. In dark, a sheet row's quick action (`.xs-row .row-ctx`) is `--tint-on-sheet`
(white) and Edit Event's picked day sits on a filled capsule ("White, chosen day filled"); dark `--sys-red-on-sheet` is
#FF6B63 ("Nudge to #FF6B63", 4.52:1 on the grouped card). The deferred finding closed too (below).

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

Amended once (2026-10-17): the loop copies are hidden from the text layer.
Asked to choose between hiding the copies from assistive technology and
changing the loop, Dave said "Whatever you think is best"; Alfred ruled: hide
them. The moving track carries a ref and its copy count, an effect above the
region marks every copy after the first `aria-hidden`, and the hash was
updated with his quote. The loop, the copies and every pixel are as they were.

Amended (2026-10-18): Dave unfroze the Whole Day rows FOR ONE ITEM, in his word, "Unfreeze" (his Oct 15 ask, decisions card 1): each row
shows its area as the app's one unified chip (`shared/CatChipLine`, not restyled) under the title, first on a second line, with its
project's name after it in grey, as a task row draws it; no area marked, no chip and no second line. The "Flexible until" subtitle stays
gone (Oct 13). It lives in the rows (`schedule/screens/DayRow.tsx` and `ProposedRow.tsx`, plain mode, via `rowChip.tsx`), and the
project names reach them through `RowChipWordsContext`, provided by `TodayFlow`, so the frozen region and its hash did not change.
Nothing else about the section is unfrozen.

Amended (2026-10-30): a day holding only protected blocks reaches the guide. Asked, Dave said "Whatever is best". It said
"Nothing Scheduled Today" and drew none of the blocks, because the emptiness test in `YourDay.tsx` (above the frozen region)
counted events and proposals only; it counts `locked` too now. The frozen region and its hash did not change.


## The Whole Day card is measured in a real browser (Dave, 2026-10-19: "The schedule is broke")

The 2026-10-18 area chip on the Whole Day rows joined the held-task rows' two-column grid with no column of its own and squeezed every held title
into a one-letter strip (`.block-held-col > .r-k { grid-column: 2 }` is the fix). Every jsdom test passed, because jsdom has no layout engine.
`src/laws/wholeDayRender.test.ts` renders the real Today day card (`bench-whole-day.html`, through the real stylesheets) at 390px in Chromium
and measures it; CI installs Chromium for it, and `CHROMIUM_PATH` points at one anywhere else. Any change to a row inside the day card (event,
proposed, held) or to the `.block-held-*` grid runs that law before it is called done, and a new kind of row goes into the bench.

## Linked pickers follow the Area, both ways (Dave, 2026-10-22)

His phone: Area said Elite Squad and the Goal picker still listed every goal. The rule, in one place (`src/shared/areaLinks.ts`), read by every editor that
carries an Area beside a Person, Project or Goal (the task sheet, the event sheet, the project sheet, the project page's own rows):

1. **Area first.** With an Area, the other pickers list only what is tied to it, None on top, a search searching what is left, and an Area with nothing of a
   kind leaves just None. No Area, no filter.
2. **Reverse.** A Goal, Project or Person picked while the Area is blank brings its own Area in (the first it names); a pick never moves an Area already chosen.
3. **A change of Area clears** any picked Goal, Project or Person that is not tied to the new one, back to None. None for the Area clears nothing.

"Tied" is each kind's stored link: a project's `category`, a goal's `tags`, a person's `categoryIds`. An item with no area is tied to none, so an Area hides
it; assigning areas to contacts and goals is what makes them appear. A record opened with a link that already disagrees keeps showing it (and keeps it
listed) until the Area changes; opening a record never edits it. The event sheet's Area defaults to the first area, so it is not in force until somebody
chooses one (or the sheet opens into one, or it is an edit); a Project pick brings its Area in until then. `laws/areaLinks.test.ts` finds the editors by what
they draw, so a new editor with the same pair fails until it is wired. Not covered by this rule: the Event picker on the task sheet, and the reminder sheet's
Linked Item (a mixed-type link, not a Project, Person or Goal field).

## AI failures are read from the provider's body, and the thread says which (Dave, 2026-10-24, the chat box order)

Anthropic sends an account out of credit as a 400 `invalid_request_error` whose message says so, never as a 402, so a status alone files it with
client bugs, and every AI-lane failure read "Couldn't reach the AI · Try again". `src/ai/providerFailure.ts` (shared by `api/ai.ts` and the app)
reads the body first (its words, then its type, the status only for a body with nothing in it) and the proxy answers
`{ error, code, retryable, detail }` with a stable code (`AI_PROVIDER_CREDIT`, `_LIMIT`, `_AUTH`, `_ACCESS`, `_RATE`, `_BUSY`, `_TOO_LARGE`,
`_REJECTED`). The app throws it typed (`AIProviderError`; `AIUnavailableError` for Off, the admin switch and a build with no backend),
`chat/failureWords.ts` turns what was thrown into the thread's line, and Try Again appears only where a second try can work (busy, rate, a
dropped connection). An outage only a person can fix (credit, usage limit, key, model access) is remembered in `providerBlock.ts` so background
callers stop knocking, and lapses after 15 minutes because the fix happens outside the app. The money rules did not move: a provider 4xx releases
the hold, a 5xx or a dropped connection keeps it. The words are two fragments joined by a middle dot, cause then fix, because the short-copy law
(2026-08-15) is Dave's; the spending limit's two sentences are its one exemption and are his words, not a precedent. A failure bubble is stored with
provenance `error` and never rides back to the model as conversation. Not done and not claimed: this is the words and the retry advice, not the
credit itself (Dave restores that) and not a circuit breaker on the server.

## The chat's model has hands, and they are a closed menu (Dave's chat box order, 2026-10-24)

`src/chat/tools/`, mapped in `docs/jarvis-unified/CHAT-TOOLS.md`. The model proposes; only the dispatcher acts. The app names tools by NAME, the proxy
attaches the definitions from the registry it holds (`registry.ts`), and the dispatcher checks every call in code: the name, the turn's budget, the
input's schema, that every ref is one a search in this chat returned, and the tier. The menu is six reads (tier 0) and three proposals (tier 1:
`create_task`, `update_task`, `capture_decision`), dark behind `chat_tools_v1` (a `VITE_JARVIS_FLAGS` build variable: a per-deploy switch).

**A write is a card, and only a tap makes it real.** The dispatcher turns a tier 1 call into a proposal (`proposals.ts`): the exact content, a hash of it in
the app's one canonical form, five minutes, one use. The thread draws it as a bubble of the card's own lines with the change named on a capsule beside Not Now
(`ProposalCards.tsx`). The tap goes through `approval.ts`, the only module that imports `execute.ts`, and `writeDeps.ts` is the only tool-layer file that
calls a service write. The receipt in the thread is built from what was made, with an Undo from the record as it was (a write the service refuses, or that
wrote nothing, is no success; a step that will not go back is said to be "saved in part", never "nothing changed"); a repeating task's tick says it is done for
today and gives the date it moved to. A claim of a change in the model's own words is taken out sentence by sentence in code (`turnWords.ts`, and what is said
instead comes from the live state of the turn's cards), because in the tool lane nothing is done until a tap. The cards live per signed-in USER: the provider
rebuilds every service on each token refresh, so a store keyed to a service lost the card. `laws/chatTools.test.ts` holds the roster, bans escape-hatch
tools (`run_query`, `call_api`), and holds the path above in its shape; a new tool, or tier 2 or 3, is a decision made in that law. The substrate's
server-side approvals cover only email candidates and email-draft sends, so the chat keeps the same rules in its own store, and a send is never the agent's: it
ends in the composer. "Move X to today or tomorrow", "complete X" and "delete task X" are still read by the app itself first and act on the spot with their own
receipt and Undo (addendum item 23, the Uncertainty Protocol, built before the tools); the model is reached for the rest. Whether those three
should also ask first is Dave's call, not made here.

## Speech, chat talk and stacked Undos (Dave's order, 2026-10-27)

- **Speech is recorded, not recognised in the page.** `useDictation` records audio (`src/speech/recorder.ts`) and POSTs it to `/api/ai` with the `x-jarvis-transcribe` header,
  answered by `api/_transcribe.ts` (a branch of the one AI route: the function budget law allows no new route file). The words land ONCE in an editable draft; voice never
  saves or sends (Logging Standard rule 10). `TRANSCRIBE_API_KEY` (any OpenAI-compatible provider) must be set in Vercel; unset, the app says "Voice Isn't Set Up Yet" in
  words. The browser recognizer remains only for a page that cannot record. AI Off turns server voice off; calls count on the hourly AI counter as kind `speech`.
- **Chat talk is not a capture (J-01).** `chat/chatter.ts` keeps greetings, thanks, acknowledgements, feelings and requests out of the capture lane, and Chat passes
  `onUnread` to Smart Paste so a line the rules cannot read, with no AI to ask, is handed back unsaved (Try Again, Save as Task, Save as Note) instead of becoming a
  task. Quick Capture and Smart Paste keep the old read on purpose: their job is to capture and they show what they made.
- **A new Undo toast never evicts a live one (J-08).** `shared/toast.ts` sets the older Undo aside with its own deadline and brings it back when the newer is taken or
  expires, for the time it has left. Each Undo still restores its own action (the snapshot rule).
- **A test must not hard-code a date.** One asserted "not 2026-10-29", which is tomorrow once the UTC date turns, and failed CI on every branch. Read the clock.

## A name in the words never picks a person (Dave, 2026-10-27, "Text Josh Rudd")

It was filed under the contact "Josh (Bucknell)": the matcher counted a contact's first word. Now: **capture attaches nobody from title text**
(`paste/deterministic.ts`, nothing is stamped `inferred: personId`). A contact whose WHOLE name or alias is in the line is only OFFERED, as a chip on
the Quick Capture receipt (`people/mentions.ts` `exactMentions`); a tap attaches, a tap on the lit chip takes it off. Chat capture attaches nobody.
Looking someone up (a question, meeting prep, the card's Still Open) still reads names with the older `namePatterns`; that is reading, not filing.
- **Events carry a person** (`EventData.personId`, `ScheduleService.editPerson`, the event sheet's Person row, None removes). It is NOT in the
  item_link registry: that is SQL (`jarvis_link_paths()` in 0060), so a DB projection needs a migration and the linkLaw change with it.
- **A correction edits, it never creates** (`paste/correction.ts`). Right after a capture, "no, Josh Rudd" / "I meant ..." / "change it to ..." is read
  before the capture lane in Chat and Quick Capture. An exact contact name files that person on the same item, "nobody" takes the person off, an
  explicit lead-in retitles a task. Anything unreadable changes nothing, saves nothing, and offers Save as Task / Note. "No" needs its punctuation:
  "No meeting Friday" is still a capture.

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

## item_link is a projection (Phase 0, 2026-10-10)

item_link is a projection; write the JSONB field, never the table. The
`item_memory` trigger (migration 0060) derives every link row from the
registered id paths in `item.data`; the browser cannot write the table, and
a link written any other way would not survive the offline queue or a restore.

## Email, 2026-10-13 (issues 104, 112, 113)

- **Mail's words propose bills, receipts and events only.** The list reads a row for an event
  (`email/candidates.ts` `LIST_ROW_KINDS`); an opened message and Find Useful Details read a bill, a
  receipt or an event (`BODY_READ_KINDS`, spec AC11). A task or a Waiting is never proposed from someone's
  words: those come from the person's own Add to JARVIS and Track This. Hidden, not deleted: the templates
  and the cards already on the server are untouched.
- **A saved signature may carry one picture** (issue 113, Dave: "Upload a pic. It auto scales."). The lines
  stay plain text everywhere; the picture rides only beside the untouched built block, as inline HTML with
  the same text as the plain part. One module, `src/email/signature.ts`, draws the builder's preview and the
  sent HTML. Rules and deploy notes: `docs/jarvis-unified/EMAIL-SIGNATURE-BUILDER.md`.
- **A class that roots a screen is scope, never geometry.** `.email-compose` was also given to the Compose
  button, and its 48 pixel circle rule sized the whole Compose screen (live from 2026-10-12 until 6773297). A
  law in `emailCss.test.ts` now refuses it. Render the REAL flow, not only the new component, for anything
  that opens from the list.
- **A toast under an open sheet is invisible.** The toast dock is z-index 2 and `.sheet-scrim` is 200
  (`chromeParity.test.ts` pins 2), so a toast raised while a sheet is open is painted behind it and its Undo
  cannot be tapped. Close the sheet first, as Archive does. An app-wide fix is Dave's call.

## The Logging Standard lives in the repo (2026-10-17)

`docs/jarvis-unified/LOGGING-STANDARD.md`: the 2026-10-16 standard plus Dave's
2026-10-17 addendum (planned is never done; four states planned, suggested,
reported, observed; time to a correct saved entry is the score and tap budgets
are a guide; three confirmation buckets and never a second inbox; the capture
box is a front door and every section keeps its own fast surface; voice set
logging is built as a test with a command phrase, read-back and undo; one
event, one record). Read it before touching any capture surface.

## The tab bar and the Life header are accepted on the phone only (issue 110, 2026-10-18)

Five rounds fixed these from renders and none was seen on Dave's phone. Do not close #110, or call either one fixed, from a
render. Settings > Advanced > This Device is the phone reporting itself: running build against the latest (asked of
production), the origin it was opened from, what iOS says about being installed, whether the full-height rule is on, the
viewport, safe areas, unit heights, and the shell, page bar and tab bar boxes; Outline the Layers draws the four layers so a
screenshot of any page shows which is short, doubled or missing. Ask for that screenshot before touching a layout value.
Three traps, all measured: the service worker once answered the version check from its cache (one deploy behind, fixed with
/index.html and /version.json passing through); `window.Capacitor` exists on the web too, so the `ios-standalone` rule is on
for every page that loads the bundle, which the readout shows next to what iOS reports; and Chromium's display-mode
emulation does not reach matchMedia here, so a harness render is not a standalone render.

## Gym and logging, decided by Dave, 2026-10-17 (his decisions page)

Answers 1 to 5, 9 and 10 are his own; 6 to 8 he delegated ("Whatever makes
the most sense", "Whatever is standard") and Alfred ruled. Do not reopen.

- **Progressive overload is PREFILL.** "Fill it in for me, the next weight
  and reps are already there, I just log it." "Bring the cursor to it though
  to edit quickly if they want to change it." `overloadApply` absent reads as
  "prefill"; no settings row (he asked for prefill, not a switch).
- **An untouched prefill logged counts as accepting it** and moves the plan.
  The entry is "reported": suggested is only what sits in the fields.
- **Never argues twice.** A changed weight on a filled-in step is kept as
  `SetEntry.declined`; the same step next session is offered with Use, never
  filled in (`Suggestion.declined`), until he takes it. Changed reps at the
  step's weight is not an override.
- **The Now card's first field is focused** on every new set, lift and side,
  its number selected while it is still the app's; a restored draft keeps
  the cursor unselected; never under an open sheet. iOS may hold the keyboard
  until a tap unless the native webview allows programmatic focus to raise it.
- **Warm-ups under the step**: the computed ramp is built under the prefilled
  top; his own warm-ups stay his, and only one at or over a lighter top moves.
- **One exercise library**: stock starters and his own together on the
  Exercises page and in search-as-you-type; the day-fill picker takes a pick
  or his own typed name.
- **Cancel Workout asks to confirm** (standard; protects a misclick).
- **Voice logging is the adopted standard**: a "Log" phrase starts it, the
  set is read back, he confirms, Undo after. Session More, Log by Voice.
- **Notes keep the serif titles** (V10 closed). **The workout screens and the
  two add-on surfaces are approved as built.**

## Still open on Dave's word (do not guess these)

- The five overload spec gaps: ACSM's two-session rule against the single
  session step; the volume band (10 to 14 or 10 to 20); what counts as a
  compound; a block skeleton versus the hand-set Back-Off flag; the concrete
  strike-two offer.
- Where "time to a correct saved entry" is recorded, which the voice test
  needs before it can be scored against tapping.
- Whether Dave's edits on the library review page were read back after Oct 16.
- The fifteen template points from the stage 1 report.

## Standing rules from 2026-10-17

- **Every picker adopts a starter through the flow's one door**
  (`onAdopt`, required). A picker that writes GymSettings itself loses the
  adoption on the flow's next classification save; that is why the prop
  cannot be omitted.
- **A program exercise keeps its rep range explicitly** (`Exercise.repRange`)
  while every planned rep sits inside it; deriving the range from the reps
  made it creep down after each accepted step.
- **Money's overdraft fees are six distinct bank transactions** (Alfred's
  Plaid evidence, 2026-10-17), each labelled with its purchase and carrying
  a `ref` that enters the transaction fingerprint. Never dedupe or delete a
  fee by vendor, amount and date; the Aug 26 fee for the Ally payment has
  no posted day because the bank gave none.
