# Audit of 2026-09-11: what is still open

Six read-only reviewers swept the app (messages, schedule/tasks/today, gym/health,
data/auth/core, brain/paste/notes/people, settings/life/shell) and found about 48
defects. Most were fixed and shipped the same day; the commits between
`1e34826` and `0b68773` carry them, each naming the bug it fixes.

This file is the remainder. Everything below was **confirmed by reading the code**
but not fixed, with the reason. Nothing here is speculative.

## Needs a decision before it can be built

### 1. Open Session opens a blank screen with no way out
`gym/GymFlow.tsx:1450`, reached from `brain/HealthBody.tsx` ("Open Session").

The scratch day starts an empty session on purpose, "one the athlete fills with
Add Exercise" (`GymFlow.tsx:1049-1053`). But Add Exercise lives inside
`SessionScreen`, and `SessionScreen` is only rendered when there is a current
exercise. With none, the gym renders `<div className="screen ruled health-ruled" />`:
no nav bar, no button, nothing. `isStillActive` keeps that session for the rest of
the day, so every later visit to the gym lands on the same blank screen. The only
exits are another tab or clearing storage.

The fix is whatever that screen should SHOW with zero exercises (header, Add
Exercise, Finish, Back, presumably). That is a design, so it wants a mock first
rather than an invented layout. It is the most severe thing left in this list.

### 2. Projects still clear themselves as Done
`bigger/progress.ts:170`, pinned by `progress.test.ts:75`.

A project folds away as Done the moment its last task is ticked. The 2026-09-09
ruling that nothing clears as done without a confirmation was applied to goals
(`measure.ts`) and never to projects.

Dave, 2026-09-11: "the user should be able to decide if it automatically clears or
needs permission." So this is a setting covering projects and goals, defaulting to
Ask First (the 09-09 ruling), plus the confirmation step for projects. New setting
row and new confirmation: design first.

### 3. Magic links and reset links may do nothing on the phone
`auth/authLink.ts:289-304`, with `auth/supabaseClient.ts:10`.

The client is created without `flowType`, so auth-js uses `implicit`, and with
Supabase's default email template the link arrives as
`jarvis://auth#access_token=...&refresh_token=...&type=magiclink`. `parseAuthLink`
reads only `code` and `token_hash`, so it returns null and the tap does nothing,
with no toast. This only works today if the dashboard's email template was changed
to send `token_hash`, and no template lives in this repo.

Two ways out, and they are not equivalent: create the client with
`flowType: "pkce"` (changes the web flow too, and a PKCE link only opens in the
browser that asked for it), or accept the hash pair and call `setSession`. Someone
has to look at the actual template in the Supabase dashboard before choosing.

## Fixable, just not done yet

These had a fix agent assigned and lost it to a rate limit mid-run. Each was
confirmed by reading the code; the file and line are the reviewer's.

- **`people/MessageDraftSheet.tsx:57`** — the first draft fires on mount with
  `userVoice` as it is then, and every caller (People, Tasks, Today, Chat) fills
  that prop asynchronously afterwards. So the first draft of every message is
  written without "How You Write"; only changing the tone picks it up. Redraft once
  when the voice first arrives, if the text has not been edited.
- **`notes/NotesFlow.tsx:328-345, 443-450`** — a queued blur-save of note A calls
  `loadCurrent(A)`, which can `setCurrent(A)` after note B has opened: the editor
  shows A while `currentId` is B, edits target blocks B does not have and are
  dropped, and Delete removes B. Keep a `currentIdRef` and skip the state update
  when the id is stale.
- **`review/seal.ts:290`** — the monthly seal reads a fixed 35-day window, so an
  app first opened after about the 5th seals a partial previous month, and the
  earliest seal wins forever. Compute the window from the first of the previous
  month.
- **`search/SearchFlow.tsx:41-47`** — eleven list reads in one `Promise.all` with
  no catch: one failure blanks search entirely, with no "No matches" and an
  unhandled rejection. `.catch(() => [])` per read, as `useAIContext` does.
- **`onboarding/OnboardingFlow.tsx:217,277`** — Redo Setup restores the saved AI
  choice only when it is "everything" or "draft", then writes `ai: { level }` over
  the whole object (the profile merge is shallow). A user who had AI Off and skips
  the step lands on Draft Only, with background calls allowed and per-feature pins
  gone. Write `ai` only when a chip was picked, and merge.
- **`onboarding/OnboardingFlow.tsx:268-297`** — `onboarded: true` and
  `areasSeeded: true` are written before the areas are created, so a failure
  partway leaves an account permanently missing areas, people and the first task.
  Write the flags last; seed only what is missing.
- **`onboarding/OnboardingFlow.tsx:728,745` and `screens/SignIn.tsx:138`** —
  `’` and `·` escapes sit in JSX text, where they are not interpreted, so
  the first screen a new user sees reads `Here’s your day, already moving.`
  Use the real characters.
- **`shell/AppShell.tsx:269-312`** — the startup block has no error handling, so a
  failed `categories.list()` or `seedDefaults()` never reaches `setReady(true)` and
  the app sits on a blank screen until relaunch. `App.tsx` grew a retry card for
  the profile read (SHELL-F-13); this step never got one.
- **`chat/ChatFlow.tsx:699-704`** — "Move to ..." re-delivers without removing the
  earlier destination, so the file ends up filed in both places.
- **`messages/MessagesFlow.tsx:1561-1582`** — `runSearch` has no stale-response
  guard: type "mar" then "marco" and the slower "mar" response can replace the
  newer results.
- **`messages/DeckFlow.tsx:343-350`** — Archive never sets `busy`, so a double tap
  archives twice and inflates the sweep receipts and the Cleared Today count.
  `runPrimary` already guards itself; copy it.
- **`backup/BackupService.ts:126-135, 156-158`** — restore pass one mints a fresh
  id even for records pass two will skip as duplicates, so references point at ids
  that are never created and the dependent record imports again as an orphan
  duplicate. Reproduced by importing one v2 backup twice.
- **`connections/google/gis.ts:60-69`** — `initCodeClient` has no `error_callback`,
  so closing the Google popup never settles the promise and Connections stays on
  "Connecting..." with every control disabled until a reload.

## Accepted, not a defect

- **3 moderate npm advisories** in `@capacitor/cli -> xcode -> uuid@7`. Every
  current Capacitor CLI carries it; the CLI edits the Xcode project on a developer
  machine and never ships inside the app. Revisit when Capacitor updates `xcode`.
- **39 ESLint warnings**, all unused `eslint-disable` directives across 19 files.
  Pre-existing and identical on a clean checkout. A 40th, or any error, is new.
