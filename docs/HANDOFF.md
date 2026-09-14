# Session handoff, 14 Sep 2026

**Remote main is the 14 Sep reference pass (the Health pages rebuilt to the ChatGPT reference in six waves plus the three modals from Dave's screenshots), on top of the 13 Sep Health, audit and Part 3 passes. Local equals remote. Tree clean apart from the untracked `Claude outputs/` folder. All gates green; CI green on every push except f9472b3, whose laws red (a file committed before its importer) the next push closed. Dave sees main through the Vercel web app on his phone (jarvis-rebuild.vercel.app, added to the home screen): a push to main is live on his next open. No `v*` tags were pushed this session; tags only trigger unused Codemagic builds. Waves 5 and 6 left in one push (a rebase refused on an unstaged doc), so CI ran once, on f84c5c4.**

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
| 7 | the docs commit after `f84c5c4` | this document, the catalog's §AD, the migration paste |

The reference itself is `Claude outputs/Jarvis_Health_Complete.html`; its markup is an escaped iframe (`data-srcdoc`), extracted with the scratchpad's `extract.js` and split per view. `STYLING_CATALOG_V3.md` §AD records every ruling of the pass.

## Migrations to apply

- `0040_health_checkin.sql`: registers `health_checkin` in `entity_type`. Until it lands, a check-in waits in the offline queue and replays. The statement is one insert; hand it to Dave as a bare code block.

Migrations 0038 and 0039 were applied by Dave on 2026-09-14.

## Departures from the reference, all stated in their commits

- The bedtime tile keeps the name Bedtime rather than the reference's Sleep: his Sleep metric (hours) is a tile of its own, and two tiles named Sleep would be the fork the hue law exists to stop.
- Meal nutrition is not built: the privacy law bans calorie and macro fields in `src/health`, and Dave's 09-13 ruling keeps a meal as text.
- The reference's metrics page is not built: the tiles already log every metric and Other Metrics opens the library.
- Reduce Motion and Focus View switches are not built (nothing behind them).
- The discomfort form's intensity words depart from the original Point at It note ("no severity scale") on Dave's instruction to build the reference; nothing is trended or scored from them.
- Swap stays allowed after a logged set (the reference blocks it); Part 3 wave 5 made a swap keep its records, which is the better rule.
- The finish page's effort select is the receipt's Rate a Session door, which opens the 1 to 10 screen.
- Track 3: only Your Times is built in-app. The public slot grid, the confirmed screen, Connections and Shared Project need a Track 3 Supabase project, Clerk (two real user ids), Vault and a server function; `docs/TRACK3.md` names each blocker. A screen with no data behind it was left out rather than drawn empty.
- The earlier asks about the two modals could not be found in this machine's transcripts (they were made elsewhere), so wave 1 worked from the screenshots, the row-density rule and the reference editor. If a modal is still wrong, the specific change is what is needed.

## The gate, and where it runs

`docs/WORKFLOW_AND_GATE.md` is the contract. On this Windows machine: `npx tsc --noEmit`, `npx eslint src` (39 known `unused eslint-disable` warnings), `npx vitest run` with `TZ=UTC` and `NODE_OPTIONS=--no-experimental-webstorage` (about nine minutes, one vitest at a time), `npm run build`, `npm run build:legal && git diff --exit-code public/`, the jarvis-core tsc and vitest (95), the case-sensitivity scan, and an em-dash scan over added lines. CI on Node 22 is the authoritative gate; poll `actions/runs?head_sha=<full sha>` (a short sha returns nothing). A failed job's log needs the stored git credential (`git credential fill`); `gh` is not installed.

**Commit a new file with its importer.** The laws step runs first on CI and its reachability law fails a file nothing imports; f9472b3 went red that way.

**Always `git fetch origin` and rebase before pushing.** Never force-push.

## Open items

- Migration 0040, to apply.
- Track 3's blockers above; the round-robin booking shape and the MCP rate limiter are undesigned.
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
