# Session handoff, 13 Sep 2026

**Remote main is the Health pass through Push G, the 11 Sep audit cleanup, and the Part 3 brief in five waves, on top of the 12 Sep Astra and Email passes. Local equals remote. Tree clean apart from the untracked `Claude outputs/` folder. All gates green, CI green on every push. Builds reach the phone only through a pushed `v*` tag (Codemagic to TestFlight); v1.0.1 through v1.0.15 were pushed this session.**

## What shipped this session

The Health build (`Claude outputs/JARVIS_HEALTH_BUILD_MASTER_2026_09_12.md`, harness `JARVIS_HEALTH_PREVIEW_2026_09_12.html`), Pushes B through G, each one commit, one gate, one CI run, one tag; Push A landed 12 Sep. Between them, the fixes Dave asked for from phone screenshots.

| push | commit | tag | what |
|---|---|---|---|
| A | `3970204` | | the skin, the ramp by meaning, the light ramp as shipped, laws 1 to 4 |
| B | `ad5d418` | v1.0.5 | the live session owns the bottom edge, set states, pause and resume, the two-step finish, law 5 |
| C | `c3d761e` | v1.0.6 | Resume on the page, the shortcut tiles, Water as a +1, the Log list, Health Settings, the weekly sets band as a setting, Celebrations |
| D | `5043b04` | v1.0.7 | medication by name with the ten-minute ask and Undo, Undo by the moment, refill facts, Edit Time, effort ends and Skip, the region list, Meal, laws 6 and 7, migration 0038 |
| E | `74c7504` | v1.0.8 | aliases, Pair With, Load, History's Sessions list, the Epley caption, the chart tap |
| F | `479416e` | v1.0.9 | the export choosers, clientId on every queued write, law 9, migration 0039 |
| G | `0e9c821` | | the catalog's §AB and this document |
| audit | `bb9068b` | v1.0.10 | the eight open items of the 11 Sep audit (Part 1 of the 13 Sep passoff) and the plan's strand wired into the Why sheet |
| P3 w1 | `5276622` | v1.0.11 | favorites lead the pickers, a merge is reviewed and can be undone, History remembers its segment |
| P3 w2 | `9d93a9e` | v1.0.12 | rest after the round, no phantom turns, drop segments |
| P3 w3 | `69dad64` | v1.0.13 | every insight opens on its evidence, every minimum says why, Explain over the rows only |
| P3 w4 | `e98544c` | v1.0.14 | typed event kinds, a day finished twice is asked about, Health's More folds into Settings |
| P3 w5 | `2108946` | v1.0.15 | equipment as one chooser, the plan snapshotted at start, a swap keeps its records, Also Update the Program, the schedule row hears the finish, the Assisted engine with its basis |

Also on main this session, in order: `a2e3b68` (the note editor's placeholder and list lines), `e81d0e0` (the Health page simplified: inviting tiles, no pill facts, the adds at the foot), `6fe1f53` (Codemagic stamps every build's number; v1.0.1 was the first build to reach TestFlight), `976afed` (Today's top card and the Life rows), `c22e5cc` (email tasks wait under From Email behind an opt-in switch, the What JARVIS Knows tap, project and goal rows, the cool-down in blue), `e567e17` (goals own only what is filed to them; a project row is the goal row; Next in orange; Paused, Done, Stalled, On Track), `bdf225a` (hold a project row to move it to a goal, a Paused filter, no repeated count). The other Code chat's `289dc03`, `15a2eec` and `f4bf88f` were rebased over cleanly.

## Migrations to apply, in order

Two additive migrations in `jarvis-core/supabase/migrations/` have not been applied to Supabase from this machine (the Supabase MCP here reaches other projects, not JARVIS; Dave applies them the way 0031 to 0037 were applied):

- `0038_health_med_def_and_meal.sql`: registers `health_med_def` and `health_meal` in `entity_type`. Until it lands, a medication cannot be added and a meal waits in the offline queue.
- `0039_item_client_id_unique.sql`: the partial unique index on `(owner_id, data->>'clientId')`. Until it lands the app still stamps and replays correctly; only the database-side guarantee is missing.

## The gate, and where it runs

`docs/WORKFLOW_AND_GATE.md` is the contract. On this Windows machine: `npx tsc --noEmit`, `npx eslint src` (39 known `unused eslint-disable` warnings; a 40th or any error is new), `npx vitest run` with `TZ=UTC` and `NODE_OPTIONS=--no-experimental-webstorage` on this Node 25 box, `npm run build`, `npm run build:legal && git diff --exit-code public/`, the jarvis-core tsc and vitest (95 tests now), the case-sensitivity scan, and an em-dash scan over added lines. CI on Node 22 is the authoritative gate; poll `actions/runs?head_sha=` after every push (a tag push starts a second run for the same sha).

**One vitest at a time, and nothing heavy beside it.** A full run started next to eslint, a build and the browser preview timed out one file at six minutes and flaked another; the same two files passed in isolation and the clean rerun was green. Run the suite alone.

**Always `git fetch origin` and rebase before pushing.** Never force-push.

## Every new law was planted first

Health laws 1 to 5 (`src/laws/healthSkin.test.ts`) came with Push A and B; laws 6 and 7 (`healthPrivacy.test.ts`: a medication is never a schedule, a meal is text) with Push D; law 9 (`healthIntegrity.test.ts`: one row per queued write) with Push F. Each was planted, watched fail, reverted, and the commit says so. Law 8 (the Celebrations switch) is a component test rather than a law file, by the master's own wording.

## Departures from the master, all stated in their commits

- The Health home page follows Dave's 2026-09-13 simplification, not the harness: no This Week head, the Log head only on a day with entries, Settings as a door in the Medication card, the adds at the foot.
- The weekly sets band is a setting with the studied range one tap back, per "I don't want anything hard wired that shouldn't be"; the studied range and its citation stay the default.
- Medication is log and track only: a name and an amount, no schedule, nothing that could read as missed, per Dave's 2026-09-13 ruling.
- `MealData` keeps `category: "fuel"` beside `at` and `text`, because the Share Line filters every logged shape by category; law 7 allows it.
- The Log Another ask and its two answers are Title Case per the label rule where the master writes them lower-case.
- The comeback line rides the Undo receipt: toast.ts keeps one toast, so the celebration would have been replaced before it was read.
- The History guard reads `historyOpen && !viewWorkout` so a session row opens its workout on top and Back lands on History; the branch-order law now reads that guard.
- No `docs/HEALTH.md` or `claude/HEALTH_CATALOG.md` exists in the tree (the health source comments cite the latter); the catalog entry went to `jarvis-app/STYLING_CATALOG_V3.md` §AB and nothing else was invented.

## Left out on purpose (section 10 stands)

A mood or feeling check-in; meal nutrition; discomfort intensity and notes; scheduled doses; the doc's pastel ramp and its type sizes; PDF export; full chart axes; milestone cards; sleep duration or a wake-up tap; an equipment field; a reduced-motion toggle; the prototype's Pages menu, demo state, fake save messages and sample data.

## Open items

- The two migrations above, to apply.
- Part 3 shipped in five waves against Dave's 25 answers (`Claude outputs/DECISIONS_2026_09_13_PART3.md` and the seven overlap picks, all his recommendations accepted). Left out by his answers: the brief's medication schedule, inventory, Skip and Remind Later (4a: log and track only); unilateral as two numbers per set (O7a: one number per side); a time picker for a session left open (O5a: the last write is the end); detection of concurrent edits on every record (13a: the finish only).
- The brief's acceptance scenarios (its handoff.md, fetched with his leave) are the test plan behind the wave tests; 12 (a stale check-in shows its date) and 16 (the visit report stays local until shared) were already true.
- The demo has no sets in its workouts, so History's Sessions rows read 0 sets there; the phone has real ones.
- Coming back from a workout opened from History returns to the Lifts segment rather than Sessions.

## Standing constraints

- No em dashes anywhere, comments and strings included.
- Title Case for anything that names or acts; ALL CAPS only from CSS.
- One filled primary per screen; every other action is a capsule.
- Anything visual is mocked first; the harness is the mock. Do not restyle beyond it. Dave builds previews in Cowork; do not build them here unless he asks.
- Do not touch bundle splitting until Dave says building is done. The main chunk is over the 500KB Vite warning, known and deferred.
- Do not fix the 39 pre-existing `unused eslint-disable` warnings.
- Do-not-touch items 1 (events are not first-class) and 3 (iOS modals) stand.
