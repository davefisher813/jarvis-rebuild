# RELEASE-EVIDENCE

What was built, what was run, what it proved, and what it did not. One
section per slice, appended in order. Nothing here claims a result that was
not produced in the session that wrote it; a gate this session could not pass
is named as a gate, not described around.

## Slice 01: repository contract and shared schema (2026-10-03)

Branch `claude/trusting-faraday-avniag`, based on `main` at `199e4bd`
(Money module, PR #47). Not merged. Not deployed. Dave decides both.

### What landed

| Area | Files |
|---|---|
| The package, copied | `docs/jarvis-unified/` (START-HERE, IMPLEMENTATION-SPEC, API-AND-VALIDATION, CONTRACTS.ts, CLAUDE-CODE-PROMPTS, prompts/01 to 09, ACCEPTANCE-MATRIX, SCREEN-STATE-MAP, PREVIEW-QA, PROTOTYPE.html, the two preview images). 72 em dashes written as spaced hyphens; section ids intact. |
| The mapping | `docs/jarvis-unified/REPO-MAP.md` (every logical entity and API to its physical home; the ten deviations and their reasons) |
| The shared contract | `docs/jarvis-unified/ADAPTER-CONTRACT.md` (the destination adapter contract, Money field by field, open questions for Money) |
| Schema | `jarvis-core/supabase/migrations/0044_jarvis_unified_substrate.sql`: 17 public tables, 3 private tables in `jarvis_private`, 9 functions, the composite index on `item (id, owner_id)`, `waiting` and `exploration_note` registered, `delete_owned` extended. Additive; no existing row or column changes. |
| Rollback | `jarvis-core/supabase/rollback/0044_jarvis_unified_substrate_down.sql` |
| Proof harness | `jarvis-core/supabase/tests/local_pg.sh` (a throwaway Postgres 16), `tests/stub_supabase.sql` (roles, `auth.uid()`, `auth.users`, storage, the realtime publication, Supabase's default privileges), `tests/fixtures/substrate_fixtures.sql` (two users, test only), `tests/substrate.sh` (the checks) |
| Substrate code | `jarvis-app/src/substrate/`: `contracts.ts`, `canonical.ts`, `flags.ts`, `useReadiness.ts`, `destinations/{types,money,tasks,schedule,waiting,registry}.ts`, `waiting/{types,WaitingService}.ts`, `exploration/types.ts` |
| QA | `qa/checklists/2026-10-03-unified-substrate-01.md` (phone rows open), `qa/previews/unified-substrate-01/` (the Advanced card, four shots) |
| Tests | `substrate/canonical.test.ts`, `substrate/destinations/destinations.contract.test.ts`, `substrate/waiting/WaitingService.test.ts`, `src/laws/substrateBoundary.test.ts` (a new law, proven to bite) |
| Wiring | `src/backup/entityRegistry.ts` (two kinds added), `src/settings/AdvancedPage.tsx` (Unified Substrate card: migration state, five destinations, flags), `.env.example` (`VITE_JARVIS_FLAGS`) |

### Migration rehearsal (local only)

```
cd jarvis-core/supabase
eval "$(tests/local_pg.sh start)"      # PG_SCRATCH points at a scratch dir; needs postgresql-16 binaries
tests/substrate.sh
```

Result: exit 0, 143 checks ok, 0 failed. The script applies
`stub_supabase.sql`, then the whole chain `0001` to `0044` on an empty
database, runs the rollback, applies `0044` again twice (idempotent), and
compares `information_schema.columns` before and after: identical. It then
proves, as the browser roles with `auth.uid()` set the way PostgREST sets it:

- RLS on, and A sees only A's rows, on all 17 public tables; anon sees nothing.
- Cross-user update and delete touch zero rows; cross-user insert is refused (policy or composite key).
- A composite reference to another owner's row is refused (candidate to message, grant to project, action to item, job to agent).
- Unique keys refuse a duplicate action idempotency key, receipt sequence, candidate fingerprint and provider message id; a wildcard or empty scope grant and an `execute` capability do not exist.
- The browser can edit, dismiss, restore and manually capture a candidate; it cannot mark one saved, set a destination, plant a rule candidate, write a receipt, approval, action, scope grant, context package or decision version, grant itself a capability, move an auth epoch, connect a verified agent, or mark a draft sent.
- The private schema is unreachable from browser roles; no public substrate table has a token, secret or credential column.
- The server cannot save a bill candidate as a task (trigger); it can save it as `money_bill`; deleting the item leaves the candidate saved with Item removed.
- Receipts accept no rewrite, only an erasure; a browser cannot delete one.
- No candidate kind is an entity type; `item` knows nothing about candidates; A's item list is unchanged by the substrate.
- `item_apply_patch` and the item policies behave exactly as before 0044.
- `substrate_readiness()` lists the registered kinds; anon cannot call it; an unregistered kind drops out (never success).
- `delete_owned` is service_role only and removes every substrate row of the deleted user and nobody else's.

### Repository checks

| Check | Command | Result |
|---|---|---|
| App typecheck | `jarvis-app: npx tsc --noEmit` | exit 0 |
| App lint | `npx eslint src` | 0 errors, 39 warnings (the documented baseline, unchanged) |
| Substrate, laws, settings, backup tests | `npx vitest run src/substrate src/laws src/settings src/backup` | 63 files, 1017 tests passed |
| The new law bites | planted `export const ENTITY_BAD = "email_candidate"` under `src/substrate/`, ran `laws/substrateBoundary.test.ts` | failed naming the constant; reverted; passes again |
| Case clash scan | `git ls-files \| sed -E 's/\.(tsx?\|jsx?\|mjs\|cjs)$//' \| sort -u \| sort -f \| uniq -di` | empty |
| Full gate, run 1 | `QA_PUBLISH=0 node qa/check.js` at `68ef481` with the tree dirty | core-types, core-tests, app-types, app-lint passed; app-tests failed on ONE law, the reachability law, which named `substrateBench.tsx`: the scratch bench that rendered the Advanced card previews was in the tree during the run. It was deleted before anything was committed, as CLAUDE.md requires. |
| Full gate, run 2 | same command, bench removed, checklist and previews present | core-types, core-tests, app-types, app-lint (41 warnings, the gate's own count of the unchanged baseline), app-tests (the whole suite, laws included), app-build and app-legal all PASS. The `house` stage FAILS on nine files carrying em dashes that are not in `qa/baseline.json`: `docs/AUDIT_CHECKLIST.md`, `jarvis-app/STYLING_CATALOG_V3.md`, `src/ai/aiBudget.test.ts`, `src/ai/memoryAssembly.test.ts`, `src/ai/voiceGuards.test.ts`, `src/laws/capsuleLaw.test.ts`, `qa/findings/2026-09-22-RESUME.md`, `qa/findings/RULEBOOK.md`, `qa/findings/rewordings.json`. Every one is byte-identical on `main` and untouched by this branch (`git diff --name-only origin/main...HEAD` lists none of them), so the gate fails the same way on `main` today. Not fixed here: the files belong to other work, and the rule says a touched file loses its grandfathering, which would widen this slice into theirs. Named for Dave to decide. The manual checklist reads `open` (four phone rows), which is the truth. |
| Baseline before the slice | same tree at `199e4bd`: `tsc` exit 0; `vitest run` 723 files, 8882 passed, 5 skipped | recorded for comparison |

### Acceptance rows touched

S08 partial and local, S16 structural (ACCEPTANCE-MATRIX.md). Every E row
and the rest of the S rows remain NOT RUN; they belong to later slices.

### Gates this session did not pass, stated plainly

1. **Staging or production migration: not applied.** This session holds no
   database credentials and was asked not to merge or deploy. The migration
   is additive and inert until a later slice writes to it. When Dave applies
   it (Supabase SQL editor, live project, after a backup), the check is
   Settings > Advanced > Unified Substrate reading "Migration 0044 Applied"
   with five Ready rows, and `select substrate_readiness();` returning the
   seven kinds. The rollback file reverses it without touching an item.
2. **Merge: not done.** Dave merges after review; the branch is pushed for
   that. CI runs the same gate on push.
3. **Deploy and live verification: not done.** No pipeline authorization in
   this session. Nothing in this slice changes a live route; the only visible
   change is the Advanced card, which reads Not Ready until the migration
   runs.
4. **RLS against the live project: not run.** Proven on a stubbed local
   Postgres 16 only. The live project's Postgres must be 15 or newer for the
   set-null column lists; a 14 would refuse the migration at the first such
   constraint and leave nothing applied (every statement of that block
   fails together in the SQL editor's transaction).
5. **No real sends, no Gmail, no agent traffic.** Nothing in this slice
   talks to a provider.

### Concurrent work

- Money (PR #47) is in the base; the adapters mirror its writers and the
  contract tests hold them equal. No Money file was edited.
- `claude/light-mode-flip` touches `src/styles/components.css`,
  `src/styles/jarvis-design-system.css`, `STYLING_CATALOG_V3.md` and three
  law files. This slice touches none of them; a rebase is clean.

## Slice 02: authorization, scoped context and the gateway (2026-10-03)

Same branch, on top of slice 01. Not merged. Not deployed. Nothing applied to
a live database. No agent token exists anywhere but the test harness.

### What landed

| Area | Files |
|---|---|
| Schema | `jarvis-core/supabase/migrations/0045_authorization_and_gateway.sql`: the token index and a rate bucket in `jarvis_private`; the helpers `jarvis_ai_switch`, `jarvis_record`, `jarvis_context_fields`, `jarvis_context_rows`, `jarvis_context_shape`, `jarvis_payload_clean`; the agent-side functions `agent_connection_verify`, `agent_resolve_token`, `agent_rate_take`, `agent_capabilities`, `context_snapshot_store`, `context_packages_sweep`, `proposal_submit`, `draft_submit`, `review_link`, `action_status` (service role only); the person-side functions `context_preview`, `context_issue`, `scope_grant_create`, `connection_revoke`, `proposals_import` (the signed-in session). Additive. |
| Rollback | `jarvis-core/supabase/rollback/0045_authorization_and_gateway_down.sql`; `tests/substrate.sh` now rolls back newest first and brings everything forward again. |
| Proof | `jarvis-core/supabase/tests/gateway.sh`: 113 checks against the stubbed Supabase. |
| Gateway | `jarvis-app/api/agent.ts` (edge, one POST) over `src/substrate/gateway/handler.ts` and `gateway/protocol.ts` (methods, limits, error vocabulary with status, safe line, correlation id). |
| Engine | `src/substrate/authz/engine.ts`: the section 04 table as a pure function; the handler asks it before every function call. |
| Shapes | `src/substrate/schema.ts`: a strict validator (unknown property is a refusal) and the authority-key sweep. |
| Manual exchange | `src/substrate/context/exportImport.ts` (the export file with its disclosure and revocation note; the import parser, JSON or prose, nothing partial) and `src/substrate/agentClient.ts` (preview, grant, export, import, revoke, for the Hub screens of slice 04). |
| Category preference | `src/substrate/policy/categoryTaps.ts`: three matching taps in 30 days, one question, Remember makes an exact local tag rule, Not now makes nothing; versioned device keys. The chips that record a tap are slice 05. |
| Tests | `schema.test.ts`, `authz/engine.test.ts`, `gateway/handler.test.ts`, `context/exportImport.test.ts`, `policy/categoryTaps.test.ts`, `agentClient.test.ts` |
| Config | `.env.example`: `JARVIS_CONTEXT_KEY` (secret; without it the gateway refuses to issue context). |
| Laws | `laws.test.ts`: `agent.ts` named as a serverless route; `agentClient.ts` and `categoryTaps.ts` rostered as unwired with the slice that wires them. `shortCopy.test.ts`: the protocol's API lines and the export file's lines exempted, with the reason. |

### What the database proof shows (`tests/gateway.sh`, exit 0, 113 ok)

- Tokens: verified by the server, stored as a hash only, resolved by hash; the browser cannot resolve or verify; an unknown or revoked token resolves to nothing; the bucket refuses the 61st call in a minute.
- Capabilities are what the server verified, under the mode's ceiling: read only has no propose and no draft, by the mode; an unverified capability is named as unavailable.
- S06: the owner's preview is the project brief (project, its open tasks, its decisions) with the allowed fields only; a requested field outside the allowed set is a redaction; the agent's preview says whether a grant is still needed and never carries the unauthorized count.
- S05: an id outside the job's boundary or another owner's id is counted for the owner, never named, never returned; another owner's job and a forged owner are SCOPE_DENIED.
- The grant is the exact preview by hash: a wrong hash is STALE_SCOPE; the browser cannot write a grant row; a once grant expires.
- Issue: the disclosure receipt ("Read 3 records in Summer travel", agent, initiated by the owner) is appended in the same transaction; the data holds no field outside the manifest; the package is capped; the snapshot is stored only by the server and unreadable by the browser.
- Caps: 60 extra tasks leave 50 records kept and 13 counted over the limit; the pre-change hash is then stale.
- S02 and S21: a proposal lands with a payload-free receipt; a replay returns the same proposal; the same key with another payload conflicts; `approved_by`, `execute` and `status` refuse the payload whole; evidence outside the package is refused; nothing is stored for a refusal; a read-only agent cannot propose but keeps the package it was granted.
- S04: no function exists that commits or sends, in any mode; a saved candidate from an agent is refused by the database.
- An Email job: the one message in scope, its sanitized body in the data; a draft needs the verified capability; it lands as a draft, with the inert verb; another account is SCOPE_DENIED; 21 recipients are refused; an agent's capture becomes a provisional candidate of origin agent and the proposal row carries no payload.
- S23: AI off and admin off are read on every call; the owner's own preview still works with AI off.
- S22: an expired package is PACKAGE_EXPIRED and the sweep marks it.
- Manual exchange: the owner exports the brief with no agent ("Exported 3 records in Summer travel"); prose imports as Mentioned; a JSON item that says decided stays a proposal; an authority field refuses the whole file and nothing partial is stored; a file over 256KB is refused; another owner cannot import.
- S07: revocation moves the epoch, removes the token and the snapshots, revokes packages and grants, refuses every later call, writes "Revoked access · Claude", is idempotent, and leaves the drafts the agent made as the owner's.
- Lockdown: every agent-side function is unavailable to `authenticated`; every person-side function is unavailable to `anon`.

### Repository checks

| Check | Command | Result |
|---|---|---|
| Database proofs | `tests/substrate.sh`, `tests/gateway.sh` | exit 0, 144 ok; exit 0, 113 ok |
| App typecheck | `npx tsc --noEmit` | exit 0 |
| App lint | `npx eslint src` | 0 errors, 39 warnings (baseline) |
| Substrate and laws | `npx vitest run src/substrate src/laws` | 49 files, 872 tests passed |
| Full gate | `QA_PUBLISH=0 node qa/check.js` | core-types, core-tests (95 tests), app-types, app-lint (41 warnings, the gate's own count of the unchanged baseline; the new files under `src/substrate` add none), app-tests (733 files, 8966 tests, 5 pre-existing skips), app-build and app-legal all PASS. The `house` stage FAILS on the same nine pre-existing em-dash files slice 01 named, every one byte-identical on `main` and untouched by this branch; nothing new. The gate also notes `preview: a screen or stylesheet was touched and no shots were found`: it diffs the whole branch against `main`, so it sees slice 01's `AdvancedPage.tsx` and looks for shots under this slice's folder; slice 01's shots are under `qa/previews/unified-substrate-01/` and this slice touched no screen. The manual checklist reads `open` (three device rows), which is the truth. Report: `qa/reports/2026-10-03T06-50-17-746Z.json`, gitignored. |

### Gates this session did not pass, stated plainly

1. **No verified adapter, so no live Connect.** The spec forbids a fabricated sign-in. This deployment verifies no assistant adapter; the Hub (slice 04) offers manual export and import for every assistant, and the gateway waits for a real adapter and `JARVIS_CONTEXT_KEY` in Vercel. The door for one is `agent_connection_verify`, server side.
2. **Migrations 0044 and 0045 not applied; `JARVIS_CONTEXT_KEY` not set.** Both are Dave's, in that order. Nothing in the app changes until slice 04 draws the Hub.
3. **No deploy, no live verification.** The three phone rows in the checklist are the live checks.
4. **Denied agent calls write no receipt.** The spec asks for "safe denied receipt" (S02). This slice answers a denial and logs a correlation id; a `denied` receipt row per refused call is deferred to slice 03 with the rest of the receipt vocabulary, so one slice decides what a denied receipt carries.
