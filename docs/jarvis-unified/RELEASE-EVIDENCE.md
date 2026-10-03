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

## Slice 03: shared commands, exact approvals and receipts (2026-10-03)

Same branch, on top of slice 02. Not merged. Not deployed. Nothing applied to
a live database. No provider was called: the Gmail send itself is slice 07's
`dispatch`; this slice is the machine that makes it safe.

### What landed

| Area | Files |
|---|---|
| Schema | `jarvis-core/supabase/migrations/0046_commands_approvals_receipts.sql`: the `outbox_command` table (reviewed, queued, claimed, dispatched, confirmed, failed, outcome_unknown, cancelled; a fencing token and a lease); the helpers `jarvis_receipt_append`, `jarvis_capture_valid`, `jarvis_undo_block`, `jarvis_action_provisional_email`, `jarvis_action_replay`, and 0044's receipt trigger extended so an erasure may set the verb to Erased; the person's functions `candidate_edit`, `candidate_dismiss`, `candidate_restore`, `capture_approve`, `action_undo`, `receipt_erase`, `command_review`, `command_approve`, `command_cancel`, `activity_feed`, `receipt_detail`; the server's `outbox_claim`, `outbox_dispatched`, `outbox_settle`, `outbox_reconcile`, `outbox_sweep`, `approvals_sweep`, `reported_external_record`, `access_denied_record`. Additive. |
| Rollback | `jarvis-core/supabase/rollback/0046_commands_approvals_receipts_down.sql` (puts 0044's trigger function back as it was). |
| Proof | `jarvis-core/supabase/tests/commands.sh`: 167 checks against the stubbed Supabase, UTF8 like the live project. |
| Client | `src/substrate/commands/errors.ts` (the command result shape, the error vocabulary with its house lines, the request id), `commands/captures.ts` (approve through the adapter's `prepare`, undo, edit, dismiss, restore, the ten-second Undo toast window), `commands/sends.ts` (review, tap, cancel, the five-minute nonce), `commands/receipts.ts` (the feed, the detail, erase, the actor and assurance and status lines, the review count line, the export text). |
| Worker | `src/substrate/outbox/worker.ts`: claim, mark dispatched, call the provider, settle; a throw after the mark is outcome_unknown; a lost lease at the mark means nothing leaves. Pure, with the provider call injected; `api/email/*.ts` runs it in slice 07. |
| Gateway | `src/substrate/gateway/handler.ts`: a refusal at the ceiling now writes the safe denied receipt (`access_denied_record`: who, method, code; never the params), closing slice 02's fourth open gate. |
| Tests | `commands/errors.test.ts`, `commands/captures.test.ts`, `commands/sends.test.ts`, `commands/receipts.test.ts`, `outbox/worker.test.ts`; `gateway/handler.test.ts` extended. |
| Laws | `laws.test.ts`: `sends.ts` and `worker.ts` rostered as unwired with the slice that wires them (07). The number-leading-line law reshaped two lines ("1 To Review in Email", the interval "2 Minutes"). |
| Docs | REPO-MAP.md section 4 (the homes, now built) and section 6 (deviations 11 to 16); ADAPTER-CONTRACT.md "What the server checks again"; ACCEPTANCE-MATRIX.md rows S04, S07, S13 to S19, S24. |

### What the database proof shows (`tests/commands.sh`, exit 0, 167 ok)

- S16, before anything is saved: the global feed omits the suggestion row, never carries the candidate's vendor, and carries only the review count; the Email scope shows the suggestion; another owner's feed holds none of it.
- Access: anon cannot approve; another owner's candidate is NOT_FOUND; no session is AUTH_REQUIRED.
- Refusals that write nothing: a stale revision and a wrong hash are SOURCE_CHANGED with the owned current values; a bill sent to Tasks is refused; a task carrying an amount is refused as bill_is_not_a_task; an unregistered destination is MODULE_UNAVAILABLE; a bill without its ledger fields is MISSING_DETAILS; an authority key in an edit refuses the edit whole; after all of them, no item, no action, the candidate still proposed.
- S14: a trigger made the receipt insert fail after the item write; no item, no action, no approval, no evidence; the candidate still proposed.
- The atomic save: confirmed with the exact verb "Saved $142.30 Bill to Money"; a Money bill owned by the person carrying the adapter's data untouched; the candidate saved and pointing at it; the key is the server's; the rule is the actor and the person the initiator; the approval created and consumed by the tap, bound to the hash and the account; one confirmed receipt with the evidence excerpt (not the message) and the card's fields as the diff.
- S15: the same request id replays; another device with another id and the same card gets the same action; an older card on another device is IDEMPOTENCY_CONFLICT with the saved action; two sessions racing for the task card name one action, write one task, and exactly one of them was the write.
- The feed after a save shows the exact verb, marks it undoable, and the review count fell; the detail carries the chain, the evidence, the actor and approved-by-you; another owner cannot read it.
- Undo: a wrong expected revision is DESTINATION_CHANGED; the undo removes the item with "Removed From Money · Con Edison", brings the card back at a new revision with no destination, records the reversal on the original's chain, replays, and the feed stops offering it; the old card's revision cannot be approved again, the current one saves as a new action under a new key; an item edited since (paid) is DESTINATION_CHANGED then REFERENCED and untouched; a task an event points at is REFERENCED; an item removed elsewhere is "Item removed".
- Edit, needs details, dismiss, restore: a missing field makes needs_details at a new revision tagged entered_by_user; approving it names the field; a stale edit is SOURCE_CHANGED; the hash moves with an edit and the old hash cannot approve the new card; dismiss is by revision, leaves the source row untouched, blocks approval; restore; a source that changed underneath is SOURCE_CHANGED and the card is marked stale.
- An agent-origin capture credits the agent (actor), names the person (initiator and approved_by), and the receipt names the assistant.
- S19: erase leaves Erased with no words anywhere, an opaque action tombstone, the item untouched; the browser cannot update or delete a receipt; a server cannot rewrite a verb outside an erasure; another owner's erase is NOT_FOUND; a settled send's snapshot is blanked; an in-flight command refuses erasure.
- Sends: an authority key in a review is refused; a review needs the person's connected account; the snapshot is held in the outbox as reviewed and nothing can claim it; S17: a different hash is REVIEW_CHANGED with the approval unconsumed; another owner cannot tap; the tap approves and queues, consumes the approval once, replays, and the nonce cannot bind another payload; the browser cannot claim or settle; the worker claims under a token with the exact payload and the action runs; a second worker finds nothing; a wrong token is NOT_FOUND; a claim never dispatched cannot be confirmed; cancel while claimed is cancellation_requested; unknown before dispatch settles as failed with no provider ack.
- S18: dispatched under the token once; cancel after dispatch cannot recall it; a failure without a refusal code is outcome_unknown with the honest line; an unknown command is never claimed again; reconciliation refuses no evidence and refuses absence of a search hit; a provider message id confirms with provider_ack assurance.
- A lapsed claim that never dispatched is claimed again as attempt 2 and the old token is dead; a dispatched command past its lease is never claimed and the sweep marks it unknown.
- Approval expiry: a tap after the nonce lapsed is APPROVAL_EXPIRED, the action closed and the snapshot cancelled; a queued command approved more than five minutes ago lapses at the claim with "Not Sent · Approval Expired · Review It Again"; the sweep closes reviews nobody tapped.
- Cancel: a review, then the tap does nothing; a queued command, then nothing to claim.
- S07 and S24: a queued command whose account needs reauth fails at the claim with "Not Sent · Reconnect Gmail"; a review with the account disconnected is PROVIDER_AUTH; disconnected after dispatch, the ack still settles it as confirmed with the provider's ack; a send cannot be called confirmed without an ack; the spent token is dead.
- S13: a reported outside action is reported_external in words, replays by key, moves no JARVIS command, cannot be recorded by the browser, and a revoked connection cannot report.
- S02: a denied agent call is recorded as who, method and code with no params; a repeat in the hour bumps the count and adds no receipt; a different code is its own row; the browser cannot record one; a non-code is refused; another owner's connection is NOT_FOUND; the person sees "Denied · Suggest" in Activity.
- Invariants over everything above: no confirmed capture receipt without its committed item (except the one the person removed in Tasks, counted); no confirmed send receipt without a provider ack; no receipt outside its action's owner; every approval bound to its action's hash; receipts a gapless sequence per action; the global feed still carries no provisional text.

### Repository checks

| Check | Command | Result |
|---|---|---|
| Database proofs | `tests/commands.sh`, `tests/substrate.sh`, `tests/gateway.sh` | exit 0, 167 ok; exit 0, 144 ok; exit 0, 113 ok |
| App typecheck | `npx tsc --noEmit` | exit 0 |
| App lint | `npx eslint src` | 0 errors, 39 warnings (baseline; the new files add none) |
| Substrate and laws | `npx vitest run src/substrate src/laws` | 54 files, 915 tests passed |
| Full gate | `QA_PUBLISH=0 node qa/check.js` | Run 1 (`qa/reports/2026-10-03T07-30-…`): every stage PASS except `house`, which added a tenth file to slice 01's nine: `src/laws/laws.test.ts`, 2 em dashes, because this branch edits that file (the rosters) and a touched file loses its grandfathering. Fixed: the comment names the character in words and the law's own probe uses the `\u2014` escape, so the law still bites and the file is clean; its baseline entry is removed. Run 2 (`qa/reports/2026-10-03T07-39-…`, gitignored): core-types, core-tests (95 tests), app-types, app-lint (41 warnings, the gate's own count of the unchanged baseline), app-tests (the whole suite, 246s), app-build and app-legal all PASS. The `house` stage FAILS on the same nine pre-existing em-dash files slice 01 named, every one byte-identical on `main` and untouched by this branch; nothing new. The preview note is the same branch-diff artifact as slice 02 (slice 01's `AdvancedPage.tsx`; this slice touched no screen). The manual checklist reads `open` (three device rows), which is the truth. |

### Gates this session did not pass, stated plainly

1. **No provider call, so no send.** The worker's `dispatch` is injected and slice 07 supplies the Gmail one; nothing in this slice can send mail, and the acceptance rows above say LOCAL PROOF, not live.
2. **Migrations 0044 to 0046 not applied.** Dave's, in order, on a Postgres 15 or newer project. Nothing in the app changes until the cards (06) and Activity (04) call these functions; the flags stay off.
3. **No deploy, no live verification.** The three phone rows in the checklist are the live checks.
4. **The phone's own reading of the Undo toast and the receipt detail waits for its screens** (slices 04 and 06); the lines and the ten-second window are tested as functions.

## Slice 04: the AI Hub and durable decision review (2026-10-03)

Same branch, on top of slice 03. Not merged. Not deployed. Nothing applied to
a live database. The Hub is behind `VITE_JARVIS_FLAGS=substrate_v1`, so a
build with the flag off shows nothing new anywhere.

### What landed

| Area | Files |
|---|---|
| Schema | `jarvis-core/supabase/migrations/0047_review_and_hub.sql`: `proposal.created_by` widened to `system`; the helpers `jarvis_decision_conflicts` (same project, same constraint key, different value), `jarvis_dependency_cycle`, `jarvis_dependencies_write`; the person's functions `decision_save` (save, and with `p_replace_item` replace in one transaction), `decision_withdraw`, `exploration_keep`, `proposal_classify`, `proposal_dismiss`, `decision_dependencies_check` (run by the person opening the Hub; never in the background), `connection_set_mode`, `connection_add_manual`, `job_open`, `hub_overview`, `decision_history`. Additive. |
| Rollback | `jarvis-core/supabase/rollback/0047_review_and_hub_down.sql` (narrows the author check back only when no system row exists). |
| Proof | `jarvis-core/supabase/tests/review.sh`: 77 checks against the stubbed Supabase, UTF8. |
| Screens | `src/hub/HubFlow.tsx` (the flow under Brain > AI Hub: Agents, Review, Activity; the AI switch; the inherited states), `AgentsTab.tsx` (H1), `AgentDetail.tsx` (H4), `ContextPreview.tsx` (H5), `ReviewTab.tsx` (H2), `DecisionSheet.tsx` (save, edit, replace, the conflict comparison), `DecisionDetail.tsx` (H6), `ActivityTab.tsx` (H3), `ReceiptDetail.tsx` (H7), `sheets.tsx` (add, withdraw, import, confirm), `hubClient.ts`, `copy.ts`, `format.ts`. |
| Surface | `src/styles/hub.css`: section 02's fixed palette as tokens on the Hub's root, the focus ring, the capsules, the compare grid, the quiet and danger row actions; loaded from `main.tsx`. |
| Doors | `brain/BrainPage.tsx` (the AI Hub row, behind the flag), `brain/BrainFlow.tsx` (the route), `shared/filledIcons.tsx` (the glyph). |
| Tests | `hub/HubFlow.test.tsx` (18, every screen through the real components against a recording session), `hub/hubClient.test.ts` (7), `hub/format.test.ts` (4). |
| Laws | `laws.test.ts`: `agentClient.ts` off the unwired list (wired now). `undoLaw.test.ts`: the receipt erasure toast rostered with its reason. |
| QA | `qa/checklists/2026-10-03-unified-substrate-04.md` (device rows open), `qa/previews/unified-substrate-04/` (eight screens, light and dark, 390 wide, from a scratch bench through the real stylesheets; the bench was deleted before the commit). |
| Docs | REPO-MAP.md section 4 (the homes, built) and section 6 (deviations 17 to 21); ACCEPTANCE-MATRIX.md rows S03, S11, S12, S16. |

### What the database proof shows (`tests/review.sh`, exit 0, 77 ok)

- The Hub's one read: the AI switch live, the person's connections with mode and verified capabilities, the proposal still a proposal, the projects, the email review count only (never a candidate's vendor); another owner's hub holds none of it; anon cannot read it.
- S03: classifying a proposal to Mentioned and back is advisory and writes no decision (the active set is unchanged); a stale revision cannot classify; another owner cannot touch it.
- Save: no statement and no reason are MISSING_DETAILS naming the field; another owner's project is NOT_FOUND; a dependency that is not the owner's is refused and nothing lands; the save from the proposal is confirmed as version 1 with the exact verb, an item the Decisions module reads (statement, reason, the project link as the module writes it), an active version with its constraint and alternative, a real dependency edge carrying the task's revision, the proposal closed as accepted, the agent credited and the person approving; saving the same proposal again replays; the active set grew by exactly one.
- Conflicts: a colliding constraint is refused and named with both values and nothing lands; Replace makes version 2, marks version 1 superseded in one transaction, keeps the earlier statement and reason, points back, leaves one active version, moves the module's item, and the receipt's diff shows old and new.
- Cycles: budget may depend on flights; flights may not then depend on budget; informed_by is not a cycle.
- S12: a replaced decision is a change its dependants review ("Flights Changed · Review 1 Dependent Decision"); a changed task raises one constraint_change suggestion by the system in Decided, marks the dependency changed and the decision untouched, says so in Activity, marks the decision Needs Review in the hub; running it again adds nothing; dismissing records the reviewed revision and a later change suggests again.
- Withdraw: no reason is MISSING_DETAILS; a stale item revision is DESTINATION_CHANGED; withdrawn with its reason, nothing erased, the item marked, the task it depended on untouched; withdraw again replays; history reads every version with its state; another owner cannot read it.
- S11: Keep as note makes an exploration_note attached to the project, with no decision_version; the active-constraint read never returns it; the hub lists it under notes, not decisions.
- Modes and assistants: a mode change answers with the ceiling's capabilities and creates no grant; a stale revision is SOURCE_CHANGED; another owner cannot set it; a manual assistant has no transport and no token; an empty name is MISSING_DETAILS.
- Jobs: one per assistant and project, reused; the person's own job for an export; another owner's project or a foreign connection is NOT_FOUND; a preview through the job is scoped to its project.

### What the component tests show (`src/hub/HubFlow.test.tsx`, 18 passing)

Three tabs, the AI switch, the brief, the assistant row with mode, project and shares; Add makes a manual assistant with the typed name. The empty Agents state carries Add Assistant and says JARVIS still works. Admin off locks the switch and a tap only says so. The agent detail shows every mode's exact ceiling; picking one sends the revision and makes no grant; Revoke is one call. The preview opens a job for the project, shows the manifest (records, fields, what is left out, the expiry), makes the grant by its hash only on Share, and Cancel shares nothing. Review: Not Saved Yet on a Decided proposal; Save opens the sheet prefilled and sends the project, the proposal and its revision; a missing reason never reaches the server; a conflict shows both values side by side and Replace sends `p_replace_item`; Mentioned's Keep as Note and Move to Decided send the right calls and no decision; the Email count is a door and the body never contains a candidate's words; the empty state carries Paste a Conversation. The decision detail shows the active version, its constraint and history; Withdraw sends the reason under the item's revision. Activity lists dated rows with their exact verbs, Reads keeps only reads, a row opens the receipt, Undo presents the item's revision, Delete asks first then erases, Copy carries no hash. First-load error shows Retry and recovers; offline shows the banner, keeps saved content and refuses a save with the offline line; no client is an honest unavailable.

### Repository checks

| Check | Command | Result |
|---|---|---|
| Database proofs | `tests/review.sh`, `tests/commands.sh`, `tests/substrate.sh`, `tests/gateway.sh` | exit 0, 77 ok; the three earlier proofs unchanged |
| App typecheck | `npx tsc --noEmit` | exit 0 |
| App lint | `npx eslint src` | 0 errors, 39 warnings (baseline) |
| Hub, substrate and laws | `npx vitest run src/hub src/laws src/substrate` | 57 files, 945 tests passed |
| Previews | the scratch bench served by `vite` on 5183, captured by Playwright at 390 by 844, 2x, light and dark | 16 shots under `qa/previews/unified-substrate-04/` |
| Full gate | `QA_PUBLISH=0 node qa/check.js` | Run 1: every stage PASS (core-types, core-tests, app-types, app-lint at the gate's own 41-warning count of the unchanged baseline, app-tests the whole suite with the Hub's 30 tests and every law in 244s, app-build, app-legal) except `house`, which this time found a TENTH em-dash file beside slice 01's nine: `src/substrate/commands/errors.test.ts`, one literal em dash inside the regex that forbids em dashes, written in slice 03 and tracked since. Fixed in this commit: the probe uses the `\u2014` escape, so the test still bites and the file is clean. Run 2, on the fixed tree: every stage PASS (core-types, core-tests, app-types, app-lint at the same 41 warnings, app-tests the whole suite in 244s, app-build, app-legal) and `house` back to exactly slice 01's nine pre-existing files, none of them touched by this slice. The gate's own exit is 1 for that house list and for the open manual checklist, as it was for slices 01 to 03. The preview note is satisfied: the shots are under `qa/previews/unified-substrate-04/`. The manual checklist reads `open` (eight device rows), which is the truth. Reports under `qa/reports/`, gitignored. |

### What the previews show, and what they do not

The eight screens in the package's cream palette inside the Hub only; in dark mode the Hub is a light island, as section 02's fixed theme asks and as REPO-MAP.md deviation 17 records, so Dave can say yes or no to the colour by looking. One filled red per screen (the primary); the other row actions are quiet; the single destructive verb on a screen wears the error tint. They run on Linux with no SF font, so a long title truncates a little earlier than on the phone. They are not a device check: rows 1 to 8 of the checklist stay open.

### Gates this session did not pass, stated plainly

1. **Migrations 0044 to 0047 not applied; the flag not set.** Both are Dave's. With `VITE_JARVIS_FLAGS` empty the Brain shows no AI Hub row and nothing changes; with `substrate_v1` on and the migrations absent the Hub would show "Couldn't Reach JARVIS · Try Again" and Retry, never a blank.
2. **The palette is Dave's call.** The spec's fixed light theme is applied inside the Hub; the previews show the island in dark mode. One block in `src/styles/hub.css` to delete if he prefers the app's own tokens; nothing else moves.
3. **No deploy, no live verification, no device.** The share sheet on export, 200% text and the keyboard over the sheets are the device rows.
4. **No verified adapter.** Add makes a manual assistant; a Connect that cannot connect is not offered.
