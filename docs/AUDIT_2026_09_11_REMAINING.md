# Audit of 2026-09-11: what is still open

Six read-only reviewers swept the app (messages, schedule/tasks/today, gym/health,
data/auth/core, brain/paste/notes/people, settings/life/shell) and found about 48
defects. Most were fixed and shipped the same day; the commits between
`1e34826` and `0b68773` carry them, each naming the bug it fixes. A second pass on
2026-09-12 (`e040f74` to `e591812`) took the three that needed a decision and the
four most serious of the rest, once Dave had decided.

This file is the remainder. Everything below was **confirmed by reading the code**
but not fixed, with the reason. Nothing here is speculative.

## Decided and shipped on 2026-09-12

For the record, since each of these was listed here as needing Dave first:

- **Open Session opened a blank screen with no way out.** Dave: fix it with
  existing parts. An empty session now opens the same `ExerciseSheet` the Add
  Exercise button opens; cancel discards the empty session. `a4ca798`.
- **Projects cleared themselves as Done.** Dave: the user decides. One setting,
  Settings then Advanced, "Clear Done Automatically", off by default (the 09-09
  ruling). Covers projects and goals together; stored with the account.
  `e591812`.
- **Magic links could do nothing on the phone.** Dave: accept both shapes. The
  implicit link (the default Supabase template) is handled alongside the two
  that already were; no dashboard change needed. `64a9e4c`.
- Also from the list below: Redo Setup wiping the AI level and pins, the closed
  Google popup that never settled (`e040f74`); the notes editor showing the note
  he just left, and the restore that left references pointing at rows it never
  created (`853ebb6`). The restore fix recognises records by content and repeats
  into their references; a reference CYCLE (note names task, task names note) is
  still written a second time, whole and consistent, and the test pins that as
  the accepted limit.

## Fixable, just not done yet

Each was confirmed by reading the code; the file and line are the reviewer's.
Nothing here needs a decision, only time.

- **`people/MessageDraftSheet.tsx:57`** — the first draft fires on mount with
  `userVoice` as it is then, and every caller (People, Tasks, Today, Chat) fills
  that prop asynchronously afterwards. So the first draft of every message is
  written without "How You Write"; only changing the tone picks it up. Redraft once
  when the voice first arrives, if the text has not been edited.
- **`review/seal.ts:290`** — the monthly seal reads a fixed 35-day window, so an
  app first opened after about the 5th seals a partial previous month, and the
  earliest seal wins forever. Compute the window from the first of the previous
  month.
- **`search/SearchFlow.tsx:41-47`** — eleven list reads in one `Promise.all` with
  no catch: one failure blanks search entirely, with no "No matches" and an
  unhandled rejection. `.catch(() => [])` per read, as `useAIContext` does.
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

## Accepted, not a defect

- **3 moderate npm advisories** in `@capacitor/cli -> xcode -> uuid@7`. Every
  current Capacitor CLI carries it; the CLI edits the Xcode project on a developer
  machine and never ships inside the app. Revisit when Capacitor updates `xcode`.
- **39 ESLint warnings**, all unused `eslint-disable` directives across 19 files.
  Pre-existing and identical on a clean checkout. A 40th, or any error, is new.
