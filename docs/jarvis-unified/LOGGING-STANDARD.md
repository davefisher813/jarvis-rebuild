# The JARVIS Logging Standard (2026-10-16)

Dave's rule: "The app is built on logging. It should be the absolute best out of any app in existence for that." This standard is distilled from research into the world's best logging apps (full report: ~/workspace/research_notes/world-class-logging-ux-20261016-1852/report.md). Every rule is checkable in an audit. Benchmarks named are the apps each rule is copied from.

## Action budgets (hard caps, counted like MacroFactor's published method: count the actions, publish the count)
- Habit / mark done: 1 action.
- Log a set: 1 action (values prefilled).
- Change a weight or reps value: 2 actions (tap field, type; Enter accepts).
- Log an expense: 3 actions or fewer.
- Add a task or note: 2 actions to a saved item.
- Start a routine/workout: 2 actions or fewer.

## The rules
1. **Autofocus, always.** Every capture surface opens with the cursor already in the first field and the keyboard up. No tap-to-start-typing anywhere. (Things 3, Todoist)
2. **Prefill is pre-selected.** Prefilled values (last session, last entry, smart defaults) arrive highlighted so typing replaces them and Enter accepts them. Editing a value never starts with manual clearing. (Strong, YNAB payee prefill)
3. **One field, natural language.** Quick add parses dates, times, projects, and durations inline from one line, the way Todoist Quick Add does; extra fields live behind progressive disclosure, never in the first path.
4. **Enter saves, composer stays open.** Saving is optimistic (feels instant, under 100 ms), and rapid repeat logging never closes the composer or loses place. (Todoist, MacroFactor multi-add)
5. **Zero confirmations. Undo instead.** No "are you sure" on logging or deleting within logging flows; an Undo toast lives at least 5 seconds. (NN/g guidance; the app's own no-confirmation Delete Workout bug is why Undo must be guaranteed, not occasional.)
6. **The keyboard matches the value.** Numbers get the numeric keypad (inputmode), every time, on every numeric field in the app.
7. **Repeat-last is one tap.** Every log type offers "same as last time" as a first-class action. (Hevy Copy Workout, MacroFactor smart history)
8. **No entry is ever lost.** Drafts persist per keystroke; a killed app, a dead battery, or airplane mode loses nothing. Local first, sync second.
9. **Streaks never shame.** A broken streak is never headlined as a reset to zero; repair is offered instead. (Silverman & Barasch, Journal of Consumer Research 2023: highlighting a broken streak depresses re-engagement by itself.)
10. **Voice drafts, never commits.** Speech input produces a parsed draft the user confirms with one tap; it never saves on its own. (Todoist's own speech feature reported roughly 40 to 62 percent task success in beta, vendor figures; that is why the draft step exists.)
11. **Speed is a feature.** Capture surfaces open fast; a wait over a second on the logging path is a defect.
12. **Fast paths are never gated.** No paywall, interstitial, or upsell may sit inside a logging flow. (MyFitnessPal's premium-gated fast paths are the anti-pattern.)

## Speech box (from the same research)
- On the open web, in-page speech recognition is unreliable, especially in an installed PWA on iOS. Three honest paths exist: (a) OS keyboard dictation into an autofocused field, which works today with zero build and makes voice one tap from any field; (b) record audio in the app and transcribe server-side; (c) a native wrapper later for lock-screen and widget capture.
- The audit of the app's current speech box (what exists, what it does when tapped) lands with the logging audit; the build order takes shape from both.

## Honesty notes from the research
- The only published tap-count benchmark (MacroFactor's) is a vendor self-comparison and says so itself; we copy its counting method, not its rankings.
- Lost-entry and sync-failure churn have no solid published numbers; rules 5 and 8 rest on UX consensus, not trials.

## Addendum, 2026-10-17 (Dave's rulings on Astra's six logging calls, all six ADOPTED)

These amend the standard above; everything not amended stands as written.

1. **Planned is not done.** A record carries one of four states and they never
   blur: *planned* (on the program), *suggested* (prefilled on screen),
   *reported* (Dave logged it), *observed* (a trusted source recorded it).
   Nothing moves from planned to done without Dave logging it. A prefilled
   number never becomes a finished fact because it was on screen. In the gym
   today: the NOW card's value is a suggestion until Log; Finish writes the
   planned sets with their own state (done, skipped, not marked) and marks
   none of them done; a session with nothing logged saves nothing.
2. **Logging is scored by time to a correct, saved entry,** including the time
   spent fixing a mistake. The action budgets above are a rough guide only,
   not hard caps.
3. **Confirmations run in three buckets.** (a) A reliable trusted source
   imports on its own, with the source attached (observed). (b) Anything that
   matches a rule Dave already approved files on its own. (c) Only a
   genuinely unclear case asks Dave, and that question can wait.
   Confirmations must never become a second inbox. Bucket (b) needs a list of
   approved rules before anything files itself; until Dave gives one, (b) is
   empty and such cases sit in (c).
4. **One capture box is the front door, not the whole house.** The universal
   capture box stays as an entrance; every section keeps its own fast logging
   surface. During a workout the big Log button with prefilled values stays
   the primary way to log a set.
5. **Voice logging is built as a test.** A deliberate command phrase (never a
   bare "yes"), the app reads the weight and reps back, an undo for the last
   set, and it must beat tapping in a real gym test before it is treated as
   the better path. Tapping stays fully supported. Rule 10 (a voice draft
   never commits) stands for every other surface.
6. **One event, one record.** A hand-logged entry, its receipt and the bank
   transaction for the same event merge into a single record with the
   evidence attached; Dave is asked only when the match is unclear. A goal for
   the Money build.
