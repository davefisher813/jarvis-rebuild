# Gaps

What the gate does NOT protect. A green `qa:check` means both packages
typecheck, lint, test and build on that commit and the house rules hold; this
file is what it cannot see.

Severity is about what breaks for Dave on his phone if the code is wrong, not
about how hard the test would be to write.

| Severity | What it means |
|---|---|
| High | It fails silently, or it fails in a way Dave notices before we do. |
| Medium | It fails loudly and locally, and someone can tell what happened. |
| Low | Contained, or already guarded from another direction. |

## High

**What his phone actually renders.** 6495 tests run in Node with a fake DOM.
None of them open the app in a WebKit engine at 390 by 844. The repo's own
answer is `tools/visual-audit.mjs` and the Playwright bench under
`src/bench/`, run by hand, and the standing rule that anything visual is
mocked and reviewed before it is built. The gate does not run them: they need
Chromium and a served build. `preview.applicable` turns true when a component
or stylesheet is touched, and the shots are owed under `qa/previews/<task>/`.

**Anything that needs a Supabase session or the Vercel functions.** The
tests stub the client. Sign in, sync, the AI proxy, account deletion, booking
links: none of it runs end to end in the gate. Vercel's own deploy of `main`
is the first place a broken edge function is visible.

**Web push, once it exists.** The plan approved 2026-09-20 puts web push in
this app through a JWT gated Vercel proxy to the Railway backend. The gate
will prove the state machine, the key decoder and the worker's push handler
in isolation. It cannot prove a notification arrives; only Dave's phone can,
and the definition of done says so.

## Medium

**The Windows pass.** About 25 tests cannot pass on Windows
(docs/WORKFLOW_AND_GATE.md). The gate runs on Linux, as CI does. A path or
case sensitivity problem that only Windows shows is caught by the manual
Windows pass, not here.

**One known flaky test.** `connections/google/nativeAuth.test.ts` can fail in
a full run with "Capacitor plugin Browser already registered", a test
isolation bug; it passes alone. When it fails, the gate fails, honestly, and
the fix is the isolation, not a retry.

**41 ESLint warnings** (docs/WORKFLOW_AND_GATE.md says 39; the gate counted
41 on 2026-09-20), unused `eslint-disable` directives, pre-existing. The gate counts warnings and prints the number without
failing on it; errors fail. A 42nd is visible in the report.

**Live AI behaviour.** `tools/ai-harness.test.ts` runs the golden set only
with a real key. In the gate its five cases are skipped by design and
baselined. Prompt regressions are found by running it by hand with the key.

## Low

**Em dashes in `jarvis-app/src`.** Forbidden by `src/laws/laws.test.ts`, run
by the tests stage. The house stage covers the rest of the repo, where 297
remain in docs, one handoff note, one migration comment and test fixtures,
baselined and shrink only.

**The category switches on the Notifications page, after web push lands.**
The backend's `sendToAll` sends every push to every device and ignores the
four category switches. Honoring them is a separate job: a filter in the
worker or on the server. Until then the copy says the master switch is all or
nothing, by Clemenza's condition.

## Rule debt burn-down

| Date | Files | Em dashes | Skips | What moved |
|---|---|---|---|---|
| 2026-09-20 | 15 | 297 | 5 | Baseline created from the gate's own first run: a hand grep had missed a tracked handoff note (127) and a migration comment (1) |

Neither number may increase.

## Suggested order

1. A served build opened in WebKit at phone width, in the gate, because that
   is what Dave sees.
2. The nativeAuth isolation bug, because a flaky red teaches people to rerun
   instead of read.
3. Category filtering for push, once push exists.
