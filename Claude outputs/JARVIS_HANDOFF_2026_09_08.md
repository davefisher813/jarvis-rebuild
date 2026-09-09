# JARVIS Track 3 — Handoff for a New Cowork Session

Generated 2026-09-08. Read this top to bottom before touching code — it's written so a session with zero prior context can resume seamlessly.

---

## 1. Repo state right now

- Repo: `davefisher813/jarvis-rebuild`, branch `main`.
- Latest commit: `430d5d4` — confirmed identical on local `HEAD` and `origin/main` (fetched and checked 2026-09-08). Nothing is unpushed. Nothing is uncommitted.
- Last 5 commits on `main`:
  ```
  430d5d4 Fix: Plan My Day's context assembly had no failure path, and the test that should have caught it was testing the wrong scenario
  3a94043 UP-MIND-09: set a thread aside for a desk, and get it back there
  4e36be4 Hide Auto-Sweep provenance lines from row display
  7a1a067 Ten fixes: brain patterns, task trace, notice receipts, goals tap, protect lines, voice doors, linked notes, Plan My Day brain, recurring overdue
  82d0114 TRACE-04: an AI failure says which server error you got, all of it
  ```
- Working tree clean.

## 2. Critical infrastructure limitation: this sandbox cannot push to GitHub

Every `git push origin main` from a Claude Cowork/Code cloud sandbox for this repo fails with:

```
access denied by the git proxy: davefisher813/jarvis-rebuild is not in this session's authorized repository set
```

This is **not fixable from inside a session**. Don't waste time retrying it, changing remotes, or debugging git config — it's a sandbox-side authorization list, not a code or credentials problem. Someone would need to add the repo to the session's authorized set externally, or delivery goes through the bundle workflow below.

### The delivery pattern that works

1. From the sandbox: `git bundle create <name>.bundle HEAD` (or a commit range), then `SendUserFile` it to Dave.
2. Write a PowerShell script (paste into the chat as a file, e.g. `paste-<name>.ps1`) that Dave runs on his own machine at `C:\jarvis-clean`, which:
   - Verifies it's in the right folder (`.git` exists).
   - Locates the bundle in common save spots (Downloads, Desktop, the repo folder itself).
   - **SHA256-verifies the bundle file** against a hash computed in the sandbox before trusting it.
   - `git fetch origin` + `git reset --hard origin/main`, and checks the resulting HEAD matches the exact expected base commit — aborts loudly if origin has moved (someone else pushed since the bundle was built).
   - `git bundle verify`, `git fetch <bundle> HEAD`, checks `FETCH_HEAD` matches the expected commit hash from the bundle.
   - `git merge --ff-only FETCH_HEAD`, checks the resulting tree hash and commit-ahead-count match expectations.
   - Only then `git push origin main`.
   - Every failure mode prints a distinct, copy-pasteable message telling Dave exactly what to tell Claude (e.g. "tell Claude: bundle checksum mismatch").
3. Dave saves the bundle to Downloads and runs the script. Report back the console output if anything other than the green "DONE" line appears.

**Known failure mode, already hit once this session:** Dave running a *stale* script/bundle pair left over from an earlier chat (different expected base commit hash than what's actually on `origin/main` now). The script's own safety check catches this cleanly — it aborts with "ORIGIN HAS MOVED... nothing was written," no damage done. If you see that, it means Dave has an old script/bundle from a previous session sitting around; make sure you hand him the **current** pair and tell him plainly which file names are current so he doesn't reach for a leftover one.

The two most recent bundle+script pairs from this session both worked and are now historical (their target commits are already merged, so re-running them is a no-op at best): `jarvis-desk.bundle`/`paste-jarvis-desk.ps1` (2 commits) and `jarvis-desk2.bundle`/`paste-jarvis-desk2.ps1` (3 commits, superset — this is the one that actually landed `430d5d4`). Don't reuse either; build a fresh bundle for new work.

## 3. Build, test, lint

From `jarvis-app/`:

```
npx vitest run          # full suite: ~423 files, ~5000 tests as of last count
npx tsc --noEmit         # typecheck (package.json script: "typecheck")
npx eslint src            # lint (package.json script: "lint")
npm run build             # production build (strips demo fixtures — __DEMO_SEED__ false)
```

There is no `test` script in `package.json` — call `vitest` directly (the binary is at `node_modules/.bin/vitest`, or `npx vitest run`).

`vitest.config.ts` sets `environment: "node"` by default; test files that touch the DOM need `// @vitest-environment jsdom` as the first line.

Known flake, not a regression: `nativeAuth.test.ts` has one intermittent test — reconfirm in isolation before treating it as a real failure.

Every commit should leave: tsc clean, eslint 0 errors, full vitest suite green, and both demo + clean vite builds green.

## 4. Repo laws (enforced by tests in `src/laws/`)

These aren't style suggestions — they're tests that fail the build. Files: `laws.test.ts` (the big one), `aiControl.test.ts`, `appStore.test.ts`, `browserWalk.test.ts`, `controlBytes.test.ts`, `editingPrimitives.test.ts`, `entityRegistry.test.ts`, `env.test.ts`, `healthPrivacy.test.ts`, `injection.test.ts`, `noDemoData.test.ts`, `shortCopy.test.ts`, `typedQueries.test.ts`.

Rules that have bitten this session and are worth knowing cold before writing code:

- **No em dashes anywhere in source.** Not in comments, not in strings. Caught one this session in a `provenance.ts` comment.
- **A line that leads with a number capitalizes the word behind it.** E.g. "4 For a Desk", not "4 for a desk." Caught this session in `deskLine()`.
- **Every section head outside Today's "Now" card carries the `sh2-quiet` class.** Caught this session on the new "For a Desk" section.
- **No "coming soon" / placeholder copy** (`shortCopy.test.ts`, `noDemoData.test.ts`) — demo data never ships to the real build.
- **`route`-family mail actions require a named human colleague** — don't reuse `family: "route"` for anything that isn't literally routing to another person. This session needed a genuinely new `ActionFamily` value (`"defer"`) for a feature that sets a thread aside rather than routing it, rather than overloading `route`.

## 5. Do-not-touch items (explicit standing instruction from Dave)

Originally 4 items Dave said "add to the list, don't do." One of them — the "Moved by Auto-Sweep" grey provenance subtext — was fixed this session with Dave's explicit unambiguous permission. **3 remain untouched, standing instruction still in force:**

1. Events aren't first-class entities.
2. "How did I do today" never re-evaluated.
3. Modals still buggy on real iOS.

Do not work on these unless Dave explicitly says so in the moment — a general "fix bugs" instruction does not cover these three.

## 6. Communication style (Dave's standing preferences — see system prompt for full list)

Short version for a fast-context session: no filler, no em dashes, action before explanation when he asks for something, complete but not padded, never fabricate/never lie, ask before consequential actions, all-caps means he's frustrated — skip explaining, just fix it. Use the multi-choice question widget for clarifying questions, not prose questions.

## 7. What happened this session (2026-09-08), for continuity

Three commits landed, in order:

**`4e36be4` — Hide Auto-Sweep provenance lines.** Removed the "Moved by Auto-Sweep" grey subtext from the Life tab. `shared/provenance.ts`: `sourceLine()` returns `null` for `source.type === "sweep"`; `rowSource()` no longer lets a sweep-move outrank the row's real origin. Test file `provenance.test.ts` updated to match. This required Dave's explicit, unambiguous permission in the moment (there was a prior "don't touch" instruction from an earlier session on this exact item — see do-not-touch list history above).

**`3a94043` — UP-MIND-09, "At a Desk."** New email-deferral feature: set a thread aside, get it back later at a desk (wide screen, or past the work day's end). Built end to end:
- `messages/desk.ts` (new): the store — `loadDesk`/`setAtDesk`/`clearAtDesk`/`isAtDesk`/`deskCount`/`deskLine`/`dropAtDesk`/`deskRows`/`isDeskNow`/`minsOfDay`. Capped at 200 entries, oldest evicted first. Re-setting an already-set thread keeps its original timestamp (answers "how long has this waited," not "when did I last tap it").
- `messages/desk.test.ts` (new): 14 tests.
- `messages/mailAction.ts`: added `ActionFamily` value `"defer"` (a genuinely new taxonomy value — see law note above) and the `A.atDesk()` action.
- `messages/mailSync.ts` + test: `desk` is now the 6th cross-device-mirrored mail store (keyed-object, local-wins-on-conflict merge, same pattern as `links`).
- `messages/MessagesFlow.tsx`: wiring, plus `window.matchMedia` feature-detection (jsdom doesn't implement it; also handles legacy Safari `addListener`/`removeListener`) to detect "is this currently a desk."

**`430d5d4` — Two real fixes found while chasing one reported bug.**
1. `ai/useAIContext.ts`: `gatherFrom()` had an unguarded `Promise.all` over 13 reads — one failed read (e.g. one flaky service call) would have broken the entire AI context assembly instead of degrading gracefully. Wrapped every read in `.catch()` with an honest fallback, matching the "thinner context, never a broken one" pattern already used elsewhere in the same file.
2. `today/TodayFlow.test.tsx`: a pre-existing test failure. **Root cause was NOT what I first told Dave** — I initially (incorrectly) attributed it to the `Promise.all` bug above; fixing that did not fix the test. Actual cause, found by adding a temporary diagnostic `console.log` to `PlanDaySheet.tsx`'s mount effect (removed afterward, verified via `git diff --stat` showing zero net change to that file): TodayFlow's Day Loop auto-drafts a proposed day the instant `loading` goes false. By the time the test opens the Plan My Day sheet, it seeds from that standing draft — and by deliberate, documented design, a sheet seeded from an existing draft stands its AI-refine effect down (`PlanDaySheet.tsx`: "the card already showed him a plan; re-plan must not silently renumber it"). The test was asserting a scenario the app is supposed to skip refine on. Fixed by adding a `Not Today` dismissal click before the test's `Plan My Day` click, so the draft is cleared first. This was a test bug, not a product bug — the product behavior was correct all along.

Backlog re-baselining done this session (see §8-10 below): cross-referenced the 145-item upgrade catalog against actual source via `grep -rho -E "UP-[A-Z]+-[0-9]+" jarvis-app/src jarvis-core/src`. Result: **81 built, 64 unbuilt** (was stale before this pass). The Function Audit doc's 273/273-closed claim was also spot-checked and holds.

Full session detail (more than fits here) is in the Project doc `claude/SESSION_2026_09_08_AUTOSWEEP_AND_DESK.md`.

## 8. The full 64-item unbuilt list

"Unbuilt" here means: the item's `UP-*` ID does not appear anywhere in `jarvis-app/src` or `jarvis-core/src` via grep. This is a strong signal (every built item this session left a real trail of comments/tests referencing its own ID at the point of implementation) but it is grep-based, not feature-tested — treat "built" claims for items *not* on this list as reliable-but-not-exhaustively-verified, and treat everything below as genuinely not started. A light spot-check of 9 LAUNCH items that reference other LAUNCH IDs in `critPath` (04, 05, 07, 10, 11, 12, 16, 17, 23 — all real source + tests, confirmed via targeted grep) came back clean, giving confidence in the method.

Columns: **eff** = effort (S/M/L/XL), **val** = value score, **rec** = recommendation (v3 = build in this rebuild, later = defer, skip = don't build).

### ATHLETE (17 unbuilt)

| ID | Eff | Val | Rec | Depends on | Title |
|---|---|---|---|---|---|
| UP-ATH-06 | S | 3 | v3 | none | Student areas match the approved set |
| UP-ATH-09 | M | 5 | v3 | UP-ATH-01, BRAIN-F-07 (recurring events in `upcoming`) | The calendar feeds the Health arithmetic |
| UP-ATH-12 | S | 3 | v3 | none (asked); Apple Developer enrollment (native) | How old is the athlete, asked once |
| UP-ATH-13 | S | 4 | v3 | GYM-F-17 (upload creates, never merges) | The coach link, the room: program provenance and a program file |
| UP-ATH-14 | M | 5 | v3 | UP-ATH-09 (org category flag), UP-ATH-10 (commit path) | The Season Feed from the team's calendar link |
| UP-ATH-15 | S | 3 | v3 | UP-ATH-09 | After practice: one card, two taps |
| UP-ATH-16 | S | 3 | v3 | UP-ATH-01, UP-ATH-09 | The Bag, bound to the next practice |
| UP-ATH-20 | M | 4 | v3 | UP-ATH-01, UP-ATH-10 | The Locker holds the real documents and books the renewal |
| UP-ATH-23 | S | 2 | later | none | Set types beyond warm-up: top set, back-off, open reps |
| UP-ATH-24 | S | 2 | later | UP-ATH-09 (optional) | Hours You Got, a flat number |
| UP-ATH-25 | S | 3 | v3 | UP-ATH-06 | Athlete or parent: the one question Student onboarding does not ask |
| UP-ATH-26 | M | 4 | v3 | UP-ATH-06 | Academic core: classes and assignments that cannot fall through |
| UP-ATH-27 | M | 3 | later | UP-ATH-06, UP-ATH-14 (extract path) | Recruiting dates on the calendar, with the people attached |
| UP-ATH-28 | M | 2 | v3 | UP-ATH-09, UP-ATH-10, UP-ATH-12, UP-ATH-15 | Throw Count, only if the org throws |
| UP-ATH-29 | XL | 5 | v3 | UP-ATH-01, UP-ATH-12, UP-ATH-25, F legal list (ToS, privacy policy, LLC) | The parent link: two accounts, consent-gated reads |
| UP-ATH-30 | L | 5 | later | UP-ATH-29, UP-ATH-25, UP-ATH-09, UP-ATH-16, UP-ATH-20 | The Handoff: the parent's home screen |
| UP-ATH-32 | S | 2 | later | UP-ATH-12, UP-ATH-29 | Handover at 18 |

### CORE (6 unbuilt)

| ID | Eff | Val | Rec | Depends on | Title |
|---|---|---|---|---|---|
| UP-CORE-19 | S | 3 | later | HMN-F-09, HMN-F-13 (credit sign convention) | Pay from an account |
| UP-CORE-21 | M | 2 | later | HMN-F-01 (serialised per-block writes), HMN-F-02 (flush on background) | Notes: drag blocks, swipe a block away |
| UP-CORE-22 | M | 2 | later | SHARED-F-09 (toast replacement drops an Undo), SHARED-F-03 | Multi-step Undo |
| UP-CORE-23 | M | 3 | later | none | Speak into the JARVIS bar |
| UP-CORE-24 | L | 4 | later | Apple Developer account; UP-CORE-01 for richer routing | Share into JARVIS from any app |
| UP-CORE-25 | M | 1 | skip | none | Today sections: drag to reorder, swipe to hide |

### LAUNCH (19 unbuilt) — see §10 for the ordered critical-path subset

| ID | Eff | Val | Rec | Depends on | Title |
|---|---|---|---|---|---|
| UP-LAUNCH-01 | S | 5 | v3 | none | An Apple Developer account, an app record and the key Codemagic is waiting for |
| UP-LAUNCH-02 | S | 5 | v3 | a domain (UP-LAUNCH-28 if it's the LLC's) | Sign-up and reset emails that reach a stranger |
| UP-LAUNCH-08 | S | 3 | v3 | UP-LAUNCH-04, UP-LAUNCH-13 | Admin panel that shows real users, with plan read from a table nobody can self-edit |
| UP-LAUNCH-09 | S | 4 | v3 | UP-LAUNCH-01, 02, 03, 05, 06 | A TestFlight lane for the first parents |
| UP-LAUNCH-13 | M | 5 | v3 | none | God, Paid, Free as a fact the server knows |
| UP-LAUNCH-14 | S | 4 | v3 | UP-LAUNCH-13 | The paid fence: manual core free forever, the AI layer is the product |
| UP-LAUNCH-15 | M | 5 | v3 | UP-LAUNCH-13 | A per-user AI cost ceiling, and the model matched to the tier |
| UP-LAUNCH-18 | M | 5 | v3 | none | Athlete or Parent: the one question Student onboarding does not ask |
| UP-LAUNCH-19 | M | 4 | v3 | UP-LAUNCH-12 (native connect step), UP-LAUNCH-18 | The first thirty seconds |
| UP-LAUNCH-20 | M | 3 | v3 | UP-LAUNCH-01, 03, 05 | The App Store listing kit |
| UP-LAUNCH-21 | L | 5 | v3 | UP-LAUNCH-01, 13, 14 | Apple subscription with Family Sharing |
| UP-LAUNCH-22 | L | 4 | v3 | UP-LAUNCH-13, 18; UP-LAUNCH-21 for offer codes | Invite codes and org rollout, without a coach dashboard |
| UP-LAUNCH-24 | L | 4 | v3 | UP-LAUNCH-01, 18 | Age assurance: the Declared Age Range API and the 2026 state laws |
| UP-LAUNCH-25 | XL | 4 | later | UP-LAUNCH-18, 24; UP-LAUNCH-21 for billing | Household link: a parent sees exactly what the athlete granted |
| UP-LAUNCH-26 | XL | 5 | v3 | UP-LAUNCH-05, 28 (domain and entity) | Google OAuth verification and the annual CASA |
| UP-LAUNCH-27 | L | 3 | later | UP-LAUNCH-13, 21 | A Stripe web lane for orgs and web users |
| UP-LAUNCH-28 | XL | 4 | v3 | none; start now in parallel with UP-LAUNCH-01 | LLC, a trademark search before a filing, a timestamped concept doc |
| UP-LAUNCH-29 | ? | 0 | v3 | none | PWA or native at launch (open question for Dave, not a build item) |
| UP-LAUNCH-30 | S | 3 | later | UP-LAUNCH-24, 25 | Handover at 18 |

### MINDMAIL (5 unbuilt)

| ID | Eff | Val | Rec | Depends on | Title |
|---|---|---|---|---|---|
| UP-MIND-25 | M | 3 | later | none | How You Write learns from what you changed |
| UP-MIND-27 | S | 2 | later | UP-MIND-05 | What the AI concluded, and what you did with it |
| UP-MIND-28 | M | 2 | later | UP-MIND-05 | Values and Philosophy grow from what you actually protect |
| UP-MIND-29 | S | 2 | later | BRAIN-F-11 (a thin seal must not propose) | The monthly report proposes what it noticed |
| UP-MIND-30 | S | 2 | later | BRAIN-F-14 | The revisit card says what changed since |

*(Note: UP-MIND-09, "At a Desk," was built this session and is no longer on this list.)*

### PLATFORM (17 unbuilt)

| ID | Eff | Val | Rec | Depends on | Title |
|---|---|---|---|---|---|
| UP-PLAT-07 | M | 5 | v3 | UP-PLAT-04, payments decision (F) | Three tiers of AI: God, Paid, Free, decided by the server |
| UP-PLAT-11 | M | 4 | v3 | PLUMB-F-11 | Know when it breaks: crash reports and privacy-respecting analytics, with a switch |
| UP-PLAT-12 | M | 3 | later | PLUMB-F-12, UP-PLAT-10 | A backup that really has everything, and one that happens by itself |
| UP-PLAT-13 | L | 4 | later | Apple Developer enrollment | Apple Health workouts, steps and sleep flow into JARVIS |
| UP-PLAT-14 | L | 4 | later | PLUMB-F-07 | Apple Calendar and Reminders in the schedule, with the one completion write |
| UP-PLAT-15 | M | 3 | later | none | Fill in phone numbers and photos from Contacts, never the other way |
| UP-PLAT-16 | XL | 4 | later | Apple Developer enrollment, UP-PLAT-06 | Server push: the foundation for anything that must reach the phone while JARVIS is closed |
| UP-PLAT-17 | M | 3 | later | SHARED-F-05, SHARED-F-08, UP-PLAT-16 (option C) | Reminders keep firing when the app stays closed for days |
| UP-PLAT-18 | M | 3 | later | PLUMB-F-14 | Get off the 5 MB cliff: caches and queues in IndexedDB |
| UP-PLAT-19 | M | 3 | later | SHARED-F-16, UP-PLAT-10 | Skins and the gaming-mode seam made real: one skin, one mode, and the picker |
| UP-PLAT-20 | M | 2 | later | SHARED-F-03, SHARED-F-15 | Shake to undo, on top of every Undo toast |
| UP-PLAT-21 | M | 3 | later | SHARED-F-22, SHELL-F-22 | VoiceOver baseline: sheets are dialogs, focus lands and returns, every icon button speaks |
| UP-PLAT-22 | XL | 4 | later | Apple Developer enrollment, UP-PLAT-24 (shared `jarvis://` router) | Home Screen and Lock Screen widget that shows exactly Up Next |
| UP-PLAT-23 | XL | 3 | later | UP-PLAT-22 | Leave By on the lock screen as a Live Activity |
| UP-PLAT-24 | XL | 4 | later | Apple Developer enrollment, PLUMB-F-05 | "Hey Siri, add a task" and the Action Button capture into Smart Paste |
| UP-PLAT-25 | L | 4 | later | H (parent vs athlete account), UP-PLAT-06 | Sharing foundation: a grant table so a second person can read exactly what they were granted |
| UP-PLAT-27 | S | 2 | later | none | A Money CSV that a bookkeeper can open |

## 9. Banned / deliberately not-proposed (don't waste effort re-proposing these)

These were considered and explicitly rejected, or already covered elsewhere. By area:

**ATHLETE:** Percentages/training max/tempo/training age (Later — needs coach link first). e1RM headline, 1RM testing prompts, deload recommendations, RPE/RIR slider, auto rep detection, workout generator, movement screens, form checks, demo video library, templated programs, leaderboards, streaks, ACWR, social feed — all banned (e1RM stays an internal chart series only). `MetricsCard`/dead exports — delete, don't wire. Calorie/macro/food logging, weight/body-comp as a feature, photos — banned. Readiness/recovery/wellness scores, sleep stages/score, HRV/RHR rendered, clinical screeners as scores — banned. Concussion assessment/Head Check — banned, counsel required before any string exists. Injury prediction, medication dose/timing advice, cycle-phase prescriptions — banned. Location sharing, screen time, message monitoring, silent parent alerts — banned (UP-ATH-29 is reads-only, athlete-granted, visible — different thing). Coach dashboards in v1 — banned. "Ask, Don't Watch" Health feature — build later, needs UP-ATH-29 + rate limit first. Growth Line (height) — open question for Dave. Cycle tracking — needs privacy architecture (Kid's Room id) first, after UP-ATH-29. Two Words/mood, After The Game voice note, Nap Window, Heat Row, Exception File, Off Day, Wearables In, direct Whoop/Oura APIs — Later or banned. Gradebook/grade fields — never, a grade rendered by JARVIS on a home screen must never be red. Recruiting CRM with offer stages — declined, a 16-year-old doesn't need a pipeline. Gym "top set and count" row change — leave it, Dave ruled the row is a receipt not a ledger. Rest-timer "smart" adjustment — a prescription, declined.

**CORE:** Location-based reminders/nudges — not worth the permission prompt. Bank/card sync (Plaid-style) — cost/compliance dwarfs value at 100 users; honest-money law (self-reported, dated balances) was a deliberate decision. Task streaks anywhere new — banned, `doneCount` is the sanctioned metric. AI "Summarize my day"/"Ask JARVIS" button on Today/Notes/Money — banned, Chat is the one door. Shared lists/assignees/mentions — deferred until Business/Student ships. Sub-steps past one nesting level — capped at one. Recording/transcribing meetings — deferred to Notes Phase 2. Import from Todoist/Notion/Reminders as migration — deferred (Reminders *read* is in the Native Seven, different thing). Writing JARVIS events back to Google Calendar — never, by design. "Where You Were" for events/gym — low value, declined. "Plan the week" multi-day Day Loop — declined, doubles engine surface for a Personal-only ask. Habit rings/badges/leaderboards/wellness scores — banned across Health and Training. Money envelope sync, credit-account sign, Remove Payday — these are findings (bugs), not upgrades. "Directions" pill on Now card — folded into UP-CORE-07 instead of a separate item.

**LAUNCH:** Clerk migration — decided: stay on Supabase Auth, nothing gained for the cost. Plausible analytics — no mobile SDK, can't answer D1/D7 or onboarding funnel. Android build — after a paying persona; every gate in this catalog is iOS-shaped. "Try with sample data" in the real build — banned, demo data never ships to the real build. Coach/org admin views of athlete data — banned, even aggregate. Streaks/badges/referral rewards for invites — banned; referral stays an invite code with no scoreboard. Chatbot support widget/AI button on Support page — banned, feedback is one box. Rebuilding admin panel as separate web app — declined, in-app panel is enough at this scale. Sign-out hygiene, reset landing, version label, export-cancel toast — these are bug fixes owned by the function catalog, not launch upgrades. APNs for Auto-Sweep actions — owned by shell/today areas, just needs the same Apple account's entitlement. Height exception, Business-seeds-Personal — carried as open questions to Health/templates, not launch items.

**MINDMAIL:** Project page listing linked email threads — already covered by EMAIL-F-19 fix. Server-side nightly proposal-writing pass — banned as a second memory store; client consolidation (UP-MIND-05) covers the intent. Auto-strengthening a strand on AI-output acceptance — declined, silent state change with no tap. Per-sender response-time score / "emails handled per day" — banned, Brain refuses productivity scores outright. Chat as an AI panel inside Email tab — banned, Chat stays app-wide only. Chat file uploads and money answers — out of scope for this area. Outlook connector — Later, second connector before first is finished. "Find the file I already have" — Later, needs Gmail attachment search + files bucket. Parent-facing school/team mail extraction — belongs to Health catalog (The Handoff, The Season Feed), not this area. Body baseline in sentences — needs HealthKit, belongs to Health/native area. Removing "Best run" from Sweep finish screen — this is a violated-ban bug fix, not an upgrade proposal. A 6th/7th deterministic chat shape for money — declined, `leftToSpend` is null on purpose pending the money pass.

**PLATFORM:** App icon badge on iOS — already tracked as SHARED-F-12, not re-proposed here. Error sink wiring alone — that's PLUMB-F-11; UP-PLAT-11 only adds the analytics half. Reminders past-two-days window — that's SHARED-F-08; UP-PLAT-17 only covers the background/push layer above it. Provenance tap-to-open, undo-stack cleanup, and 8 other items — all already tracked as function-catalog findings (SHARED-F-15/16/17, PLUMB-F-01/02/03/04/07/13/21), not re-proposed here. List virtualization — no measured scroll problem exists yet, no proposal until one is measured. Bundle size work — vendor chunking + lazy tab loading already exist, nothing left worth a line. A second offline queue for gym/health — area-owned, flagged to those areas instead. Streak/usage badges anywhere — banned outright. Coach dashboards / parent live location via sharing — banned (Health rails). Direct Whoop/Oura API import — banned. HRV/RHR/sleep stages from HealthKit — banned (UP-PLAT-13 reads workouts/steps/sleep-minutes only, nothing clinical). Clerk migration — same as Launch, decided stay. PWA vs native — not a build item, both ship today, open question for Dave. Chat as a chatbot panel on every screen — banned. Realtime collaboration — deferred until Business/Student; UP-PLAT-25 only lays the read-grant foundation.

## 10. Launch critical path (ordered — this is the TestFlight sequence)

From the catalog's `critPath.launch`, in order:

1. **UP-LAUNCH-01** — enroll in the Apple Developer Program (individual today, or LLC + D-U-N-S first), create the App Store Connect app record for `com.bridge.jarvis`, issue an ASC API key with App Manager role, add it to Codemagic as the `JARVIS` integration.
2. **UP-LAUNCH-02** — custom SMTP for Supabase Auth so a stranger's sign-up and reset emails actually arrive.
3. **UP-LAUNCH-03** — paste the Location and Camera usage strings and a trimmed `PrivacyInfo.xcprivacy` into `ios/App/App`. Without them the build crashes on Weather or Take Photo. *(Note: not in the unbuilt-64 list — grep-confirmed as already implemented.)*
4. **UP-LAUNCH-04** — set the launch env: `AI_REQUIRE_LIMITS=1`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_USER_IDS`, `VITE_ADMIN_API=1`, `VITE_API_BASE`, `VITE_SENTRY_DSN`; commit a `.env.example`. *(Already implemented, grep-confirmed.)*
5. **UP-LAUNCH-05** — real in-app legal copy (mirror `public/privacy.html`), a support address that exists, no template banner in a real build. *(Already implemented, grep-confirmed.)*
6. **UP-LAUNCH-06** — `api/account/delete.ts` so Delete Account actually works (App Review 5.1.1(v)). *(Already implemented — verified via `src/account/deleteAccount.ts`.)*
7. **UP-LAUNCH-11** — a landing page for the password reset link (or magic link primary), so a locked-out tester isn't stuck. *(Already implemented, grep-confirmed via `auth/authLink.ts`.)*
8. **UP-LAUNCH-12** — native Google connect, or Email and Calendar are dead in the TestFlight build. *(Already implemented, grep-confirmed via `connections/google/nativeAuth.ts`.)*
9. **UP-LAUNCH-07** — Sentry through the existing seam, before the first stranger installs. *(Already implemented, grep-confirmed via `monitoring/`.)*
10. **First Codemagic build** to internal testers (up to 100), then Beta App Review for the external group and the public TestFlight link (**UP-LAUNCH-09** — still unbuilt, S effort, v3).

**Sign in with Apple (UP-LAUNCH-10) is deliberately NOT on this critical path** — grep-confirmed already implemented anyway (`auth/appleSignIn.ts`) — because App Review guideline 4.8 only requires it as an equivalent when a third-party/social login sets up the primary account, and today primary account creation is email+password only. It becomes load-bearing the day Google Sign-In becomes an account-creation path, and it's the right default for parents regardless of the gate.

**Bottom line on critical path:** steps 3–9 (UP-LAUNCH-03/04/05/06/07/11/12) are all already built and grep-confirmed. What's actually left to reach a TestFlight build is **UP-LAUNCH-01** (Apple Developer enrollment — an account-and-paperwork task, not code), **UP-LAUNCH-02** (SMTP), and **UP-LAUNCH-09** (the TestFlight lane itself, which also depends on 01/02/03/05/06 all being done). Everything else on the numbered list is infrastructure/account setup, not a coding task for a Cowork session.

## 11. Where the full detail lives (Project docs, `claude/` namespace)

- `claude/SESSION_2026_09_08_AUTOSWEEP_AND_DESK.md` — full detail on this session's 3 commits.
- `claude/UPGRADE_CATALOG_2026_09_05_PROPOSALS.json` — the source-of-truth 145-item catalog this handoff's §8-10 was generated from (also mirrored locally in the sandbox at `/home/claude/audit-docs/UPGRADE_CATALOG_2026_09_05_PROPOSALS.json` if a new session inherits this filesystem, though a fresh sandbox will need to re-fetch it from the Project).
- `claude/SESSION_2026_09_05_UPDATE54_UPGRADE_CATALOG.md` — narrative context for how the catalog was built.
- `claude/FUNCTION_AUDIT_2026_09_05_FINDINGS.json` + `claude/SESSION_2026_09_05_UPDATE53_FULL_FUNCTION_AUDIT.md` — the separate 273-item bug/defect audit (distinct from the upgrade catalog — this one is existing-feature defects, the catalog is unbuilt features). Confirmed 273/273 closed as of this session's re-check.
- `claude/SESSION_2026_09_07_FIVE_QUICK_FIXES.md` — source of the do-not-touch list wording in §5.
- Project instructions (visible in every session attached to this Project) — the three-template architecture, Supabase/Clerk/Stripe stack decisions, pre-launch legal checklist, commercial milestones. Worth rereading once per new session since it doesn't change often but sets the frame for every "should we build X" call.

## 12. Suggested next move for a new session

No task is currently in flight. Natural entry points, cheapest first:

- Anything in the LAUNCH critical path table (§10) that's genuinely unbuilt: UP-LAUNCH-09 is the smallest (S effort) and directly unblocks the first TestFlight build once 01/02 (account/domain setup, not coding) are done by Dave outside any coding session.
- UP-LAUNCH-13 (M effort, val 5) — "God, Paid, Free as a fact the server knows" — is a dependency for a cluster of other high-value LAUNCH items (08, 14, 15, 21, 22) and PLAT-07, so building it early unblocks the most downstream work.
- If Dave says "what's the next lowest-effort item" again, re-derive from §8's Eff column rather than trusting this snapshot forever — a new session's own commits will change what's built.
