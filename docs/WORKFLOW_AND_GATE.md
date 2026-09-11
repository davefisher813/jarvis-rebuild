# Working flow and the gate

Agreed 2026-09-11 between the Cowork session and Claude Code. Supersedes any
earlier description of how work gets from a Cowork session to GitHub.

## The loop

1. **Dave spots it on his phone and screenshots it into Cowork.** Screenshots
   are most of the input and they only work in chat.
2. **Anything visual gets mocked before it gets built.** One container, sent as
   a rendered file, approved or redirected. This is the rule that matters most.
   On 2026-09-11 the colour pass and the first project row were both built,
   gated, delivered and rejected; the second project row was mocked first and
   took one round.
3. **Cowork builds and runs the full gate** (below). Cowork never pushes. It
   cannot: the git proxy refuses `davefisher813/jarvis-rebuild` with a 403
   because the repo is not in the session's authorized repository set.
4. **Delivery:** direct file write into `C:\jarvis-clean` when Dave's PC is
   awake and the folder is connected; zip when it is not. Not "never zips" —
   the bridge drops when the machine sleeps.
5. **Claude Code ships it.** Dave types "ship what Cowork changed".

Two standing rules: one surface edits at a time (never Cowork editing while
Code is shipping), and Cowork never sends anything to GitHub itself.

**Folder access is per-session.** `C:\jarvis-clean` must be granted again in
every new Cowork session, which puts a prompt on Dave's screen. Expect it once
per session.

## Who checks what

Three passes, no duplicated test run.

1. **Cowork owns the full gate.** Everything below, before saying it is done.
2. **Code does a Windows pass, under a minute.** Confirm only the expected
   files changed, then typecheck and build. This is what catches the
   case-sensitivity and environment problems a Linux sandbox structurally
   cannot see. It skips the 5063 tests; ~25 of them cannot pass on Windows.
3. **CI reruns everything on push.** Costs nobody time.

## The gate — Cowork runs all of it

**Node 22 or newer.** CI moved to 22 on 2026-09-11 and the suite has outgrown
20: `@supabase/realtime-js` wants the native WebSocket that arrived in 22, and
the badge tests read the global `navigator` that arrived in 21. On Node 20
those fail locally and nowhere else.

```
jarvis-core:  npx tsc --noEmit
              npx vitest run                      # 94 tests

jarvis-app:   npx tsc --noEmit
              npx eslint src
              npx vitest run src/laws
              npx vitest run                      # 425 files / 5063 tests
              npm run build
              npm run build:legal && git diff --exit-code public/
```

The two that were being skipped and are easy to skip again: **the whole
`jarvis-core` package**, and **`build:legal` + the `public/` diff**, which
fails when someone edits `src/legal/content.ts` without regenerating the
published pages. That is how the app and the App Store's linked policy drifted
apart once already.

Note that CI's app job also runs `npm ci` inside `jarvis-core`, because the
`@core` alias compiles the engine's source as part of the app and the engine's
own imports resolve from `jarvis-core/node_modules`. If the app's typecheck
dies at "Cannot find module", that install is what is missing.

### Known false alarms

- **39 ESLint warnings**, all unused `eslint-disable` directives, spread
  across 19 files (most in `MessagesFlow.tsx` 10, `TodayFlow.tsx` 6,
  `TasksFlow.tsx` 3). Pre-existing; the count is identical on a clean
  checkout. Do not fix them as part of unrelated work. A 40th, or any error,
  is new.
- **`connections/google/nativeAuth.test.ts`** can fail in a full run with
  "Capacitor plugin Browser already registered". Test-isolation bug; passes in
  isolation.

### What Cowork's gate cannot catch

**Case-sensitivity.** The sandbox is Linux, Dave's PC is Windows, iPhone builds
run on a Mac. Names that differ only by capitalization coexist here and collide
everywhere else. On 2026-09-11 `Provenance.tsx` vs `provenance.ts` and
`AutoReplyPump.tsx` vs `autoReplyPump.ts` broke the Windows build.

The scan has to be **extension-blind**, because both clashes were between files
with different extensions and a full-filename comparison returns zero on a
broken tree:

```sh
git ls-files | sed -E 's/\.(tsx?|jsx?|mjs|cjs)$//' | sort -u | sort -f | uniq -di
```

Verified: finds both pairs on `f2ac0f4`, finds none on `db9fb94`.

**Lockfile drift.** CI runs `npm ci`; the sandbox's `node_modules` can carry
things CI will not install. Reinstalling every session is too slow, so this one
is covered by CI, not here. A green Cowork gate sitting next to a CI that had
been red at typecheck since 2026-09-05 was this shape of failure: the sandbox
had `jarvis-core`'s packages installed, and CI's app job never installed them.

## Verifying against the real repo

Cowork's git history is scratch and diverges from Dave's, because his repo is
built from his own commits carrying the same content. The sandbox's commit
count means nothing and a hook may keep reporting unpushed commits. Reset the
sandbox to `origin/main` once the work has shipped rather than carrying a
parallel history.

Check parity by content, never by commit:

```sh
git fetch origin
git diff --stat origin/main HEAD -- jarvis-app/src jarvis-core   # empty == identical
```

## Rulings live in the code

Design decisions go into the code comment next to the thing they govern, in
Dave's own words with the date. "Everything with a green bar says on track",
"one negative per row", "nothing shrinks except the goal". That is why a new
session can read `pieRow` and know why it looks the way it does, and why a
ruling does not get quietly reversed six weeks later.
