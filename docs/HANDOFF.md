# Session handoff, 14 Sep 2026

**Remote main is the writing system's second wave (copy, clean paste, export) on top of its first on top of Cowork's Exercises and Today patch, the approved Health design and the 14 Sep reference pass (the Health pages rebuilt to the ChatGPT reference in six waves plus the three modals from Dave's screenshots), on top of the 13 Sep Health, audit and Part 3 passes. Local equals remote. Tree clean apart from the untracked `Claude outputs/` folder. All gates green; CI green on every push except f9472b3, whose laws red (a file committed before its importer) the next push closed. Dave sees main through the Vercel web app on his phone (jarvis-rebuild.vercel.app, added to the home screen): a push to main is live on his next open. No `v*` tags were pushed this session; tags only trigger unused Codemagic builds. Waves 5 and 6 left in one push (a rebase refused on an unstaged doc), so CI ran once, on f84c5c4.**

## What shipped this session

Dave, 2026-09-14: "Do all of this [the Track 3 master and preview]. Also update all of the formatting and functionality of the health page based on the html chatgpt created. The only thing you are to not adjust is the actual styling (font, font size, color coding, ect)." And on three modal screenshots: "please actually address these modals ... Bundle this all together and knock it out in waves. You don't need my permission to push."

| wave | commit | what |
|---|---|---|
| 1 | `a4946f8` | the three modals: the Edit Exercise sheet's chips reach the portal (Last295, 454525 fixed), a set is two lines, rest is a menu, the strip behind Customize Individual Sets, no sentences under Muscle and Equipment, the reminder count without the study median |
| 2 | `77646be` | the Health overview to the reference: three tabs, Start with Have Less Time?, the four default shortcuts and Check In (migration 0040), Training at a Glance, the dated week, the Logs tab with its doors |
| 3 | `f9472b3` | the daily pages: sleep hours beside the bedtime mark, recent meals and When, Time Taken on a dose, discomfort details after the tap, a balance correction, Check Ins in the export, a Workout Reminder in Customize |
| 4 | `8258ff9` | the focused workout: editable set rows with a tick, the sets meter, Up Next, Adjust Time, the plate calculator; rest on the plan rows, Done and Current on the day rows |
| 5 | `e7fc161` | the lift page: Best Recorded Set, the Epley estimate behind a row, Milestones |
| 6 | `f84c5c4` | Track 3: the schema as five unapplied files under `jarvis-core/supabase/track3/`, Settings > Booking (Your Times), `docs/TRACK3.md` |
| 7 | `b856c34` | this document, the catalog's §AD, the migration paste |
| 9 | `c141035` | Cowork's Exercise Library handoff (applied from `Claude outputs/jarvis-exercise-library-and-today-2026-09-14.patch`): one classification per exercise across nine axes (`gym/classify.ts`, nothing inferred from a name, a law keeps it so), the merge as a state machine that finishes or says why (`gym/merge.ts`), duplicates in their own review, the library page renamed Exercises with search, filters, sorts and a batch, the lift page's grey subtext replaced, and the three doors (Exercises · Program · History) under the week on Health |
| 10 | `03aefc7` | Cowork: Start Workout reaches Today. The live-session read runs on mount, on the door closing and on the app returning to the foreground; the card no longer waits on a Health category; `gym/liveCard.ts` renders the whole plan with what is logged, never what is owed |
| 8 | `e900709` | Cowork's Dave's Five (PASSOFF_2026_09_14_HEALTH_FIVE.md, applied from its format-patch): Equipment and Counted As as two rows, assisted lifts score lower-is-better, per-hand and per-side tonnage counted whole, Your Lifts Edit and the merge review as portals, muscles by library key as a list, duplicate lifts suggested and never merged, Add from Your Lifts, Weekly Volume rows open and a coverage card, the Health home reordered (This Week before a compact Quick Log) |

The reference itself is `Claude outputs/Jarvis_Health_Complete.html`; its markup is an escaped iframe (`data-srcdoc`), extracted with the scratchpad's `extract.js` and split per view. `STYLING_CATALOG_V3.md` §AD records every ruling of the pass.

## The approved Health design (the last push of the session)

Dave approved a visual direction for Health and Insights (the image in the chat, "Your week, in view." and "See what's changing.") with a twelve-item brief. Built as one push on top of `e900709`:

- **Definitions once** (`jarvis-app/src/insights/analytics.ts`, prose in `docs/ANALYTICS.md`): working set, completed workout, the three duration readings (elapsed, active, set span) and the review flag, a night dated the morning it ended, inclusive local periods, null for no records.
- **The landing page** (`brain/HealthBody.tsx`): Health / Insights / All Data as one segmented nav; Your Week, in View (range, count, seven bars on real dates, working sets, training time, sleep over logged nights, each opening its records; a bar opens that day); Next Workout with Start, Adjust Time (the fit sheet, which previews every lever before the start) and Change Workout; Resume Workout with no Start beside it while a session is open; Your Progress with up to three findings (`insights/findings.ts`: a same-lift, same-reps, same-equipment, same-unit gain; sleep over nights or working sets against the period before; unassigned sets or a flagged duration); All Data and Log Something (every logger and metric as one sheet); Customize.
- **Insights** (`insights/InsightsPage.tsx`): 7, 28, 90 days or two dates; Overview (the best comparable gain with its dated chart and list twin, Where Your Sets Went with the unassigned bar and the coverage stated, Sleep over nights with the gaps drawn, then the evidence cards Cowork built), Strength (any lift's sessions, sets and comparable trend), Rest and Readings (every metric and log as values, dates, counts and gaps). A chart point opens its session. A chart that spans more than the period says so.
- **All Data** (`insights/AllDataPage.tsx`, `insights/records.ts`): every record in nine categories with date, value, unit and source; search, period, one day, category; open, edit (a metric log on its own date), delete with Undo; filters and scroll kept across a record.
- **Assign Muscles** (`insights/AssignMusclesSheet.tsx`): the untagged exercises with their set counts, a batch choice and per-row choices, one write with Undo. Muscles live on the library key (Cowork's `muscleByKey`), first whole and the rest half, and the card names that as the app's convention.
- **Export** (`insights/ExportSheet.tsx`, `exportData.ts`): CSV of the chosen categories and period, or a text summary with the notes on how each number was made; a genuine file through the share sheet or a download; a dismissed sheet says nothing. PDF is not produced (no library in the web app; a renamed file is not a PDF).
- **The 627-minute session** (`gym/DurationCard.tsx`): the end is stamped when Finish is tapped, so a session left open records the whole wall clock; parked time is the only stretch subtracted. Nothing is capped. The card on a saved session shows start, end, parked, the span of the logged sets, and offers End at the Last Set or a typed end time; each correction is a revision that keeps the value it replaced (`WorkoutData.revisions`).

Validation: every card, chart point, chip and door has a test that reaches its destination (`insights/*.test.*`, `brain/CategoryDetail.test.tsx`, `gym/DurationCard.test.tsx`); date filters, null-for-missing, unassigned-in-totals, the resume-not-start rule, the export contents and the corrections are all asserted. Not performed: real-device iPhone testing, and any browser walk beyond jsdom. Larger text and long names are handled by the same tokens and ellipsis rules the rest of the app uses and were not measured on a device.

Left out on purpose: PDF export; an inline effort select on the finish page (the receipt's door stands); a session-time "Adjust time" that rewrites the plan (the fit sheet is the preview and the plan is never edited); AI explanations of the new findings (the evidence cards keep theirs).

## The writing system, wave 1 (Notes on the shared document editor)

Dave's brief `jarvis-writing-system-spec.md` (2026-09-14, "apply notes update once the health update is complete"), built in the order its section 12 sets. Wave 1 is section 12's first step: reliable typing, selection, keyboard behaviour, lists, saving and undo.

- **The decision on the stack.** The brief asks whether Tiptap needs a build step; the app already builds with Vite, so Tiptap, jspdf and docx are ordinary dependencies and no step was added. The single-file PWA constraint in the brief is out of date.
- **One shared editor** (`shared/DocEditor.tsx`): Tiptap on ProseMirror with StarterKit, task lists (a line remembers the task made from it), highlight, tables, a callout node and the placeholder. Three levels: document, compact, quick. The writing bar above the keyboard, the body class that retracts the tab bar and the composer, the idle-only refresh that never resets a caret. The editing-primitives law now names it as the second primitive and pins that Tiptap is imported nowhere else (planted, watched fail, reverted).
- **The note model** (`notes/docModel.ts`): `NoteData.doc` is the document and the truth when present; `blocks` is written beside it on every save as a projection, so search, Create Tasks, older builds and every reader of blocks keep working. A note without a document is built from its blocks on open. Rich markers round-trip as marks; a nested list flattens in the projection only. Checklist edits made on the blocks (a task made from a line, a task ticked in Tasks) are copied onto the document in the same write.
- **The note screen** (`notes/screens/NoteEditor.tsx`): Back and More; Delete, Connections, Pin, Tags, Archive and Make Tasks from Checklist inside More; the title above the document, the connections, JARVIS Found, Linked From, Related and the word count under it; the save line (Saving, Saved on device, Synced, Couldn't save with Retry). Field Notes and Command Deck, the block menus, the Add Block sheet, the six-chip toolbar and the per-block placeholders are gone.
- **Saving** (`notes/NotesFlow.tsx`): every change goes to a draft on device at once and to the store 600ms after the last keystroke, through the one write queue; flushed on hide, pagehide, unmount and Back. A draft newer than the store is written first when the note opens again. The blank template has no title; the first line names the note everywhere it is named (`displayTitle`).
- **Departures, stated:** the note-level undo history is the editor's now (title edits are not in it); the Tracker table's computed sum row is not carried into the document; "Make It a Task" by long press on one line is replaced by the More door and, in the AI wave, a selection action; the brief's preview harness is not built (Dave 2026-09-13: no previews unless asked, Cowork does those).
- **Tested in automation, not on a device:** typing through the input rules, Return in and out of lists, the bar's order and mousedown guard, the idle refresh, the draft flush on unmount, the projection round trip. The keyboard placement over the visual viewport and dictation were not measured on a phone.

## The writing system, wave 2 (copy, clean paste, export)

Section 12's second step, one push.

- **Copy** (`notes/screens/NoteEditor.tsx`): the header Copy takes the whole note, title first, as readable text; Copy As in More offers the body only, plain text or Markdown; the confirmation comes only after the clipboard accepted it, and a browser that refuses the clipboard opens the words in a field already selected instead of a false toast. Native copy of a selection is untouched.
- **Clean paste** (`shared/DocEditor.tsx`): the schema keeps paragraphs, lists, headings, links, emphasis and code and drops fonts, sizes, colours, scripts and controls on its own; after a paste with structure, one row over the writing bar offers Text Only, Format Markdown when the paste reads as Markdown, and Undo, for eight seconds. The clipboard is read only inside the paste event. A paste replaced into an empty line takes the line.
- **Markdown both ways** (`notes/markdown.ts`): the document to Markdown (title as the top heading, body headings one level under it, nested lists, checklists, tables, links) and to plain text; a small parser back (headings, lists, checklists, quotes, fenced code, rules, tables, inline marks) that round-trips its own output.
- **Export** (`notes/screens/ExportSheet.tsx`, `notes/exportDoc.ts`, `shared/saveFile.ts`): the header Export opens one sheet on the latest editor content, unsaved edits included: the filename from the title, PDF / Word / Markdown / Text with what each is for, the one filled Export File, a Preview and More Options (Include the Title, what the attachments do) behind disclosures. The file is prepared when the sheet opens and on every choice, so Export File is the share itself inside the browser's activation window; two taps from the header start an export. PDF is built by jspdf (Helvetica, wrapped lines, headings kept with what follows, page breaks, links, photos embedded); Word by docx (Arial, real headings, bullets, checkboxes as glyphs, photos embedded); Markdown and text by the serialisers. The share sheet takes the file where `navigator.canShare` says it can, a download otherwise; a dismissed sheet says nothing; success says shared or downloaded, never "saved to Files"; a failure keeps the note and offers Retry and the other formats. The last format that worked is remembered on the device. Export Selection in More exports the selected part. Nothing is renamed with a false extension.
- **Stated limits:** the PDF's built-in fonts carry accented Latin text but no other scripts and no emoji (the sheet says so and points at Word); the Word file's photo sizes are read from the image and default to 400 by 300 when they cannot be; the Tracker table's sum row is not computed in exports.
- **Tested in automation, not on a device:** the four files' bytes and contents, the sheet's defaults, memory, cancel and failure paths, the paste hint's three actions, the copy paths and the clipboard fallback. The iOS share sheet's handling of a file, and where a shared file lands, were not verified.

Waves 3 and 4 (folding, outline, find, version history and the other surfaces; the AI actions) and the ink ruling follow, each its own push.

## How Cowork work lands

Cowork cannot push to this repo (403). It hands over a `git format-patch` file in `Claude outputs/`; apply it with `git checkout -b claude/<name> <base>` and `git am <file>`, run the full gate, fast-forward main, push, poll CI. The 14 Sep patch applied clean on `b856c34`, gated green (5,551 tests) and CI green as `e900709`.

The second 14 Sep patch (Exercises and Today) was cut on `602ff89`, before the approved Health design, and conflicted in four files. Resolved on the design's side: `HealthBody` keeps the week card, Next Workout and Your Progress, and Cowork's three-door row is grafted between the week and Next Workout (its test repinned to the design's props); `CategoryDetail` keeps the typed `gymHistory` segment, so the History door opens History on Sessions; `GymFlow` keeps `startLift`, `startHistory` as a segment and `startWorkoutId`; both CSS blocks stand. Cowork widened the muscle map's value to two named lists with a scope window, so `insights/analytics.muscleBreakdown` now reads it through the exported `rolesFor` (primaries whole, secondaries half, never twice), the same reader the Weekly Volume card uses. Gate green at 5,710 tests.

## Migrations to apply

None outstanding. Migrations 0038 to 0040 are applied on the live project (verified 2026-09-14 by reading `entity_type` through the Supabase MCP).

The live project is ref `roonancpktqigdndrumo` ("Javris Project", org "Jarvis", free plan, us-east-2). The MCP's project listing does not show that org, but every call that takes the ref directly works. The Track 3 project is `zxszpuyhwvalfpfqgutq` ("Jarvis Track 3", same org, free, us-east-2), created through the MCP on 2026-09-14 once Dave asked for it directly; files 0001 to 0007 under `jarvis-core/supabase/track3/` are applied there in order (0006 is the advisor's findings: row security on the two org tables, pinned search paths, btree_gist out of public; 0007 is the MCP rate limiter as a per-org token bucket) and the advisor is clean. The 0005 policy combination and the rate limiter were each proven by a migration that raised at its end and rolled back. Vault is on by default. Clerk as the third-party auth provider is the one step left and needs a Clerk account and domain, which the repo does not have; `docs/TRACK3.md` has the rest.

## Departures from the reference, all stated in their commits

- The bedtime tile keeps the name Bedtime rather than the reference's Sleep: his Sleep metric (hours) is a tile of its own, and two tiles named Sleep would be the fork the hue law exists to stop.
- Meal nutrition is not built: the privacy law bans calorie and macro fields in `src/health`, and Dave's 09-13 ruling keeps a meal as text.
- The reference's metrics page is not built: the tiles already log every metric and Other Metrics opens the library.
- Reduce Motion and Focus View switches are not built (nothing behind them).
- The discomfort form's intensity words depart from the original Point at It note ("no severity scale") on Dave's instruction to build the reference; nothing is trended or scored from them.
- Swap stays allowed after a logged set (the reference blocks it); Part 3 wave 5 made a swap keep its records, which is the better rule.
- The finish page's effort select is the receipt's Rate a Session door, which opens the 1 to 10 screen.
- Track 3: only Your Times is built in-app. The public slot grid, the confirmed screen, Connections and Shared Project need Clerk (two real user ids) and a server function; the project and its schema exist now; `docs/TRACK3.md` names each blocker. A screen with no data behind it was left out rather than drawn empty.
- The earlier asks about the two modals could not be found in this machine's transcripts (they were made elsewhere), so wave 1 worked from the screenshots, the row-density rule and the reference editor. If a modal is still wrong, the specific change is what is needed.

## The gate, and where it runs

`docs/WORKFLOW_AND_GATE.md` is the contract. On this Windows machine: `npx tsc --noEmit`, `npx eslint src` (39 known `unused eslint-disable` warnings), `npx vitest run` with `TZ=UTC` and `NODE_OPTIONS=--no-experimental-webstorage` (about nine minutes, one vitest at a time), `npm run build`, `npm run build:legal && git diff --exit-code public/`, the jarvis-core tsc and vitest (95), the case-sensitivity scan, and an em-dash scan over added lines. CI on Node 22 is the authoritative gate; poll `actions/runs?head_sha=<full sha>` (a short sha returns nothing). A failed job's log needs the stored git credential (`git credential fill`); `gh` is not installed.

**Commit a new file with its importer.** The laws step runs first on CI and its reachability law fails a file nothing imports; f9472b3 went red that way.

**Always `git fetch origin` and rebase before pushing.** Never force-push.

## Open items

- Migration 0040, to apply.
- Track 3's blockers above; the round-robin booking shape is undesigned.
- The reference's finish page has an effort select inline; JARVIS opens the 1 to 10 screen from the receipt. Fine unless Dave wants it inline.
- The demo has no sets in its workouts, so History's Sessions rows read 0 sets there; the phone has real ones.
- Coming back from a workout opened from History returns to the Lifts segment rather than Sessions.

## Standing constraints

- No em dashes anywhere, comments and strings included.
- Title Case for anything that names or acts; ALL CAPS only from CSS.
- One filled primary per screen; every other action is a capsule.
- The reference governs Health layout and behaviour; the styling is JARVIS's own and is not to be restyled. Dave builds previews in Cowork; do not build them here unless he asks.
- Meds are log and track only; research bands are settings, nothing hard wired.
- Do not touch bundle splitting until Dave says building is done.
- Do not fix the 39 pre-existing `unused eslint-disable` warnings.
- Do-not-touch items 1 (events are not first-class) and 3 (iOS modals) stand.
- Do not push `v*` tags unless asked; the phone runs the web app.
