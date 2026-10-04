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

## Slice 05: the Email tab, inbox, search, accounts and provider evidence (2026-10-03)

Same branch, on top of slice 04. Not merged. Not deployed. Nothing applied to
a live database. The tab is behind `VITE_JARVIS_FLAGS=email_intake_v1`, so a
build with the flag off mounts exactly the MessagesFlow it always did.

### What landed

| Area | Files |
|---|---|
| Schema | `jarvis-core/supabase/migrations/0048_email_cache_and_provider.sql`: `email_message_body.html` (the HTML as sent, sanitised only in the app's frame), the inbox index; the server's writers `email_account_upsert`, `email_account_state`, `email_sync_apply` (rows upserted by provider id, removals, the cursor, freshness only on success), `email_sync_failed`, `email_body_store`, `email_labels_set`, `email_action_record` (the receipt for archive, unarchive, trash, untrash, after Gmail's answer, idempotent by the command); the person's readers `email_accounts`, `email_inbox` (keyset, newest first, id tiebreak, INBOX rows of live accounts only), `email_message_read`, `email_search_cached` (literal, wildcards escaped, says it is the cache); the category question `policy_suggestion_offer` and `policy_suggestion_answer`. Additive; explicit grants; every writer refuses the browser with 42501. |
| Rollback | `jarvis-core/supabase/rollback/0048_email_cache_and_provider_down.sql`. |
| Proof | `jarvis-core/supabase/tests/email.sh`: 57 checks against the stubbed Supabase, UTF8. |
| Routes | `api/_email.ts` (the session checked, the token minted from the stored sign-in and never returned, Gmail with three bounded retries on a safe read and none on a write, the vocabulary's codes, headers read without a DOM, bidi marks out of names, attachment metadata and never bytes), `api/email/sync.ts`, `api/email/message.ts`, `api/email/search.ts`, `api/email/attachment.ts`, `api/email/accounts.ts`. No new environment variable: the Supabase and Google blocks of `.env.example` already name every read. |
| Screens | `src/email/EmailFlow.tsx` (the tab: freshness, Inbox and Waiting, area chips, the list, pull to refresh, the states), `InboxList.tsx`, `MailRow.tsx` (the approved row anatomy), `MessageScreen.tsx` (M2), `SearchScreen.tsx` (M8), `AccountsScreen.tsx` (M9), `EmptyState.tsx`, `emailClient.ts` (the cache through the session, the routes through the session, the Gmail link, the one order), `deviceCache.ts` (the offline page and the opened messages, under the mail cache's owner prefix), `categories.ts` (tags, taps, rules, the question), `format.ts`, `usePull.ts`, `copy.ts`. |
| Surface | `src/styles/email.css` (the freshness line, the quiet note, the coverage line, the message head, the headers, the body, the pull hint), loaded from `main.tsx`; the sanitiser gained `remoteImages: false` (`messages/mailHtml.ts`, `MailHtmlView.tsx`), default unchanged; `messages/mailCache.ts` exports its owner prefix. |
| Door | `shell/AppShell.tsx`: behind the flag the Email tab mounts `EmailFlow`; off, the MessagesFlow line is untouched. |
| Tests | `api/email/routes.test.ts` (the five routes over a fake Gmail and a fake Supabase), `api/_email.test.ts`, `src/email/EmailFlow.test.tsx` (17, every screen through the real components against a recording session), `emailClient.test.ts`, `format.test.ts`, `categories.test.ts`, `sanitizer.test.ts`. |
| Laws | `laws.test.ts`: `categoryTaps.ts` off the unwired list (wired now). No other roster moved. |
| QA | `qa/checklists/2026-10-03-unified-substrate-05.md` (device rows open), `qa/previews/unified-substrate-05/` (seven screens, light and dark, 390 wide, from a scratch bench through the real stylesheets; the bench was deleted before the commit). |
| Docs | REPO-MAP.md section 4 (the Gmail adapter's home, built) and section 6 (deviations 22 to 27); ACCEPTANCE-MATRIX.md rows E01 to E06, E20 to E23, E28, E29. |

### What the database proof shows (`tests/email.sh`, exit 0, 57 ok)

- Rollback and forward again are clean; forward twice is idempotent.
- Accounts: the server mirrors a connected mailbox into one row, lowercased, with its private credential reference; upsert again is the same row; the browser cannot upsert an account, insert a message, set labels, store a body or write a receipt (42501 each); the person reads their accounts with freshness.
- E01, E02: a sync lands rows (the fixture's two updated in place, never duplicated, wearing the provider's labels), sets the cursor and the freshness; the first page is newest first with equal timestamps broken by id descending; the next page continues after the last row's time and id with nothing repeated and nothing skipped; `read` is derived from the labels; a row without INBOX is cached but off the page and `cached_total` counts inbox rows; another owner sees nothing.
- E21: two accounts in one page, newest first across them; one account only when asked; a failed sync records its error and moves neither freshness nor state; the other account's page is untouched; a revoked grant is `reauth` and its rows still show; a disconnected account leaves the page and keeps its cache; connecting again brings it back.
- The cache follows the provider: a removed id is marked gone and leaves the page; the provider's labels replace the cache's and the row reads as read; archive (INBOX gone) takes the row off the page and keeps it cached; no receipt is written for a read or a label mirror.
- E29: an archive receipt is a user action on the email surface, confirmed, with `provider_ack` assurance, the account as scope and the exact verb; Gmail's answer rides on the receipt; the same key again is the same action marked replay; a trash receipt is its own action; a read is refused as a receipt kind; another owner's message cannot be recorded; the person sees both in their Email activity, newest first.
- E05: no body until stored; the message reads back with its text, its HTML as sent, its attachments' metadata and its account; the list row says it has a body; storing again replaces, never duplicates; another owner cannot read it.
- E03: a sender hit, newest first; a body hit through the stored text alone; a subject hit across accounts; `%` is literal, not wild; the answer says it is the cache and how wide the window is; an empty query is an empty answer; another owner's search finds nothing.
- The category question: offered as a `policy_suggestion` row with the three taps as evidence; offered again while open is the same question; an empty rule is refused; Remember accepts it; answering twice changes nothing; another owner cannot answer it.
- E04 and S16: every INBOX row of a live account is in the page; no candidate is created by a sync (the fixture's count stands).

### What the route tests show (`api/email/routes.test.ts`, `api/_email.test.ts`)

Sync: the first sync reads the mailbox's clock, the first inbox page and metadata per id, and tells the cache to advance with the profile's history id; the next page is appended with the cursor and the freshness untouched; a refresh from the cursor reads history, fetches added and relabelled ids, removes deleted ones and keeps the new cursor; an expired cursor (Gmail 404) is a full resync of the first page, said so; a Gmail outage is retried three times for a safe read, then recorded, leaving the cache as it was; a mailbox with no stored sign-in is 410 PROVIDER_AUTH recorded as reauth with no Gmail call, and a revoked grant at Google's door is the same answer; no session is 401, a bad payload 422, the wrong method 405; no answer carries a token. Message: open reads the full message in and stores text, HTML as sent, attachment metadata and the current labels; read removes UNREAD through a modify, mirrors Gmail's answer and writes no receipt; the cache follows Gmail and not the request; archive removes INBOX and writes one receipt with the provider's answer and the command as its key; trash and untrash use Gmail's reversible verbs, unarchive puts INBOX back, each its own receipt kind, and nothing ever calls delete; a message not in the person's cache is never fetched from an id it was handed; an operation the route does not have is refused. Search: the words are one quoted literal phrase; every connected account is asked, the hits cached without moving freshness, merged newest first with the id tiebreak; an account that cannot answer is named as failed while the other is covered; a named account is the only one asked; an empty query is refused. Attachment: the bytes Gmail holds come back with the cache's name and type; an attachment the metadata does not name is 404 with no fetch; one over the cap is 413 with no fetch. Accounts: every stored sign-in is mirrored and a row whose sign-in is gone is marked disconnected. The pure half: addresses split and lowercased with bidi marks removed, entities decoded, nested attachments collected as metadata, a cached row built from the provider's facts, Gmail's statuses mapped to codes, and the one order.

### What the component tests show (`src/email/EmailFlow.test.tsx`, 17 passing)

The inbox is every account newest first, equal timestamps by id, under day headers, each row saying whose it is, one sync per live account caused by the open and one page read after; thirty a page, Load More continuing after the last row's time and id and appending in order with no repeat; chips filter what is loaded with a count, All restores every row, nothing is hidden by a rule; Waiting is the honest empty state with a way back. The message opens sanitised with scripts gone and remote images off until Show Images, sends `read` as a provider command the open caused, and the list follows; a refused read restores the badge with Retry; a conflicting remote state is said, not hidden; Archive is explicit, leaves the inbox, and Undo is the reverse provider command that brings the row back, with no capture, candidate, item or save call anywhere; Archive and Move to Trash are offered only when the account can; Open in Gmail is exact for a Gmail thread id and says Open Gmail, with why, when the id is not Gmail's; an attachment over the cap is refused before any call. Search answers from saved mail first, labelled, then from Gmail with its coverage naming the account that did not answer, and a result opens and comes back to the query; a transport failure keeps the saved hits and never says No Matching Mail, and no saved hit is its own distinct state; no match anywhere is No Matching Mail with a way out. Offline shows the saved page with the banner and asks nothing of Gmail; a mailbox that needs reconnecting keeps its mail and the banner's Reconnect opens Connections; the accounts screen says each state and what a disconnect keeps while a disconnected mailbox is off the page; one account failing to refresh is a line, not a blank, and File Under tags a message into an area chip that filters and All restores.

### Repository checks

| Check | Command | Result |
|---|---|---|
| Database proofs | `tests/email.sh`, `tests/review.sh`, `tests/commands.sh`, `tests/substrate.sh`, `tests/gateway.sh` | exit 0, 57 ok; the four earlier proofs unchanged |
| App typecheck | `npx tsc --noEmit` | exit 0 (the routes typecheck under the same flags, run by hand: the app's `tsconfig` includes `src` only) |
| App lint | `npx eslint src` | 0 errors, the baseline's warnings and none from `src/email` |
| The slice's tests | `npx vitest run src/email api/_email.test.ts api/email` | 7 files, 75 tests passed |
| Laws, email, touched messages, shell and API | `npx vitest run src/laws src/email src/messages/MailHtmlView.test.tsx src/messages/mailCache.test.ts src/shell api` | 64 files, every law passing once the scratch bench was removed (the reachability law names it while it exists, as it should) |
| Previews | the scratch bench served by `vite` on 5183, captured by Playwright at 390 by 844, 2x, light and dark | 14 shots under `qa/previews/unified-substrate-05/` |
| Full gate | `QA_PUBLISH=0 node qa/check.js` | Every stage PASS (core-types, core-tests, app-types, app-lint at the same 41 warnings as before this slice, app-tests the whole suite with the Email tab's 75 tests and every law in 257s, app-build, app-legal); `house` lists exactly slice 01's nine pre-existing em-dash files, none touched here. The gate's own exit is 1 for that house list and for the open manual checklist (ten device rows), as it was for slices 01 to 04. Reports under `qa/reports/`, gitignored. |

### What the previews show, and what they do not

The inbox with two mailboxes (the account as small caps on each row, the whole address when two mailboxes share a local part), day headers, the unread row bold, a machine sender's rail and a person's face as the approved anatomy draws them, the area chips with counts, the freshness line, the floor; the message with its subject and facts, Show Headers, the remote-images note with Show Images, the body in the sandboxed frame, the attachment row, and one filled red (Open in Gmail); search with account and area chips, the coverage line naming the account that did not answer, and chronological hits; the accounts screen with states, freshness and the retention note; the offline banner over the saved page; the reauth banner with Reconnect Gmail; the empty state with Add Gmail. The tab wears the app's own theme (REPO-MAP.md deviation 22). They run on Linux with no SF font. They are not a device check: rows 1 to 10 of the checklist stay open.

### Gates this session did not pass, stated plainly

1. **Migrations 0044 to 0048 not applied; the five routes not deployed; the flag not set.** All Dave's. With `VITE_JARVIS_FLAGS` empty the Email tab is unchanged; with `email_intake_v1` on and the migrations absent the tab shows "Couldn't Reach JARVIS · Try Again" with Retry, never a blank; with the routes absent a sync answers 404 and the line says the account did not refresh while the cache, if any, stays readable.
2. **No live Gmail.** Every provider behaviour is proven against a fake Gmail (history, paging, an expired cursor, a 503, a revoked grant, a 404 on an id) and against the real cache functions in Postgres; the live round trip, the exact thread link opening and the share sheet for an attachment are the device rows.
3. **The palette.** The tab keeps the app's tokens (deviation 22); the Hub's cream island is the sample. One decision for Dave covers both.
4. **Waiting, compose, reply, capture and cards** are slices 06 to 08: the Waiting segment is an honest empty state, the message has no Reply and no Capture yet, and no candidate is created anywhere in this slice.
5. **The category question's row is not in the Activity feed yet** (deviation 26).

## Slice 06: deterministic candidates and destination captures (2026-10-03)

Same branch, on top of slice 05. Not merged. Not deployed. Nothing applied to
a live database. The cards live inside the Email tab behind
`VITE_JARVIS_FLAGS=email_intake_v1`; with the flag off nothing here mounts.

### What landed

| Area | Files |
|---|---|
| Schema | `jarvis-core/supabase/migrations/0049_candidates.sql`: `candidate_propose` (the browser's door for a reading: dedupe by fingerprint; a dismissed fingerprint stays dismissed, replayed; a saved one is replayed as saved; a changed source or payload refreshes the card with a new revision and the older reading of the message is marked stale; a source hash that is not the message's, or a deleted message, is SOURCE_CHANGED; no item is ever written) and `candidates_for` (a page's cards, every status or without the dismissed, each with the message's current source hash and the saved sibling of the same kind). Additive; explicit grants to the signed-in session. |
| Rollback | `jarvis-core/supabase/rollback/0049_candidates_down.sql`. |
| Proof | `jarvis-core/supabase/tests/candidates.sh`: 31 checks against the stubbed Supabase, UTF8. |
| Rules | `src/substrate/extract/`: `text.ts` (the text the rules read: quoted mail and signatures dropped, excerpts and sentences), `money.ts` (amounts with their currency, a bare symbol asks for the currency, "1,234" is ambiguous), `dates.ts` (dates with a year supplied or asked, relative days, times, ranges by a dash character range, durations, the zone and the instant with the DST cases named), `templates.ts` (the five cards of section 10 with provenance per field and the fields still missing; the ICS and the flight itinerary), `index.ts` (`extractCandidates`, `fingerprintOf`, `readingKey`, `EXTRACTOR_VERSION`). A pure function; no network, no model. |
| Screens | `src/email/CandidateCards.tsx` (the cards under a row or a message), `CaptureSheet.tsx` (the Details sheet per kind, Save Changes, Keep in Email, Source Evidence, what the save adds), `candidates.ts` (the row's shape, `candidates_for` and `candidate_propose` through the session, the one reading per message per version on this device, the card's lines from its payload alone, the words for each kind), `EmailFlow.tsx` (reads a page's cards, runs the rules over loaded rows and opened messages, the receipt screen, Review Latest Details, Capture by hand from More, the conflict check against Money's own list), `InboxList.tsx` (`renderBelow`), `MessageScreen.tsx` (`cards`, `moreActions`, `onBodyText`), `copy.ts`. |
| Surface | `src/styles/email.css`: the cards in the module fills with dark text on the fill, the badges, the receipt line, the count, the evidence block, the comparison, the sheet's actions and fields. No card is red. |
| Door | `shell/AppShell.tsx`: a receipt's destination opens its own screen; a module with no screen for the record opens its tab (Money, Tasks, Schedule). |
| Tests | `src/substrate/extract/extract.test.ts` (21: the four fixture cards and the two rows with none; three of each kind; missing currency, date and zone; a bill's date that never becomes a task or an event; a flight's receipt and itinerary as two cards; the DST and non-existent instants; the same fingerprints on every run), `src/substrate/extract/toModules.test.ts` (7: a fixture mail read by the rules, prepared by the adapter the card would use, inserted exactly as `capture_approve` inserts it and read back through LedgerService, TasksService, ScheduleService and WaitingService; a bill lands only in Money), `src/email/EmailFlow.cards.test.tsx` (9: the screens against a fake session with the candidate table's rules), `src/email/EmailFlow.test.tsx` (17, two expectations widened for the new reads). |
| Laws | `src/laws/substrateBoundary.test.ts`: `src/email/` is the Email module (it has been since slice 05); the provisional store may be named there. No other law moved. |
| QA | `qa/checklists/2026-10-03-unified-substrate-06.md` (device rows open), `qa/previews/unified-substrate-06/` (nine screens, light and dark, 390 wide, from a scratch bench through the real stylesheets; the bench was deleted before the commit). |
| Docs | REPO-MAP.md section 4 (the rules and the two functions, built; the slice 03 row names its callers) and section 6 (deviations 28 to 31); ACCEPTANCE-MATRIX.md rows E07 to E11, E24, E25. |

### What the database proof shows (`tests/candidates.sh`, exit 0, 31 ok)

- Rollback and forward again are clean; forward twice is idempotent.
- E07: a reading becomes one proposed card with its payload hash, revision 1, its provenance and the rules version; the same fingerprint again is the same card, replayed, with nothing changed; a reading with a different payload under the same fingerprint refreshes the card (new revision, new hash, still proposed); a reading whose source hash is not the message's is refused as SOURCE_CHANGED and nothing is written; a missing field makes the card needs_details; an origin other than rule or manual is refused; no item exists after any proposal.
- E10: a dismissed card proposed again stays dismissed and says so; a restore brings it back as proposed.
- E25: a new reading of a message marks the message's older provisional readings stale and reports how many; a saved card is never marked stale; a saved card of the same kind rides along as the saved sibling of the fresh card.
- The page read: `candidates_for` returns a page's cards in the order they were made, each with the message's current source hash; the dismissed are out unless asked for; another owner sees nothing; a bill candidate can never point at a task item (the 0044 trigger, checked again here).

### What the rules show (`extract.test.ts`, 21 passing)

Con Edison is one bill, $142.30 due October 15, every field from the email, the issuer from the sender, nothing missing; Coach Miller's promise is one waiting card from the sender's own words; Delta's payment receipt is one receipt and never an event; Mrs. Rodriguez's call is one event on October 4 at 10:00 Eastern for fifteen minutes with the offset chosen; Wei's summary and the promo make nothing. Three of each: invoices and balances and a symbol with no currency (asks); a hotel, a purchase with the message's date, a refund kept as a refund; three tasks with and without deadlines; an advisor meeting, a practice with a range, an ICS; three waits. The bill's date never becomes a task or an event; a flight's itinerary is an event and its receipt a receipt, and neither makes the other; a time in a zone the email does not name asks for the zone; a time that does not exist on the spring-forward night and a time that happens twice in the autumn are named, with the offsets offered earliest first; the same text gives the same cards and the same fingerprints on every run.

### What the component tests show (`EmailFlow.cards.test.tsx`, 9 passing)

The rules read the loaded rows: Con Edison gets a bill card and Coach Miller a waiting card, Wei and the promo none, each proposal carrying its fingerprint, provenance and version, no item anywhere, and no second reading of a row this phone already read. One tap on Save Bill is one `capture_approve` with the shown revision and payload hash and the adapter's exact record (vendor, cents, due date), the card becomes "Saved Bill · $142.30" with View, and Undo on the toast is one `action_undo` that brings the card back. View opens the receipt with its destination. Two cards under one mail save independently. The cross dismisses the card and only the card; Show Dismissed Suggestions lists it with Restore; the same fingerprint proposed again is the dismissed row. A card read from an older copy of the email says Email Changed with Review Latest Details and no Save. Money not ready keeps the bill's door shut with the module's own line while the task's door stays open. Capture a Task from More opens the sheet empty, the typed title opens Add Task, the save is an edit and then the one approval, the task is in the list with the exact text, and no model and no network beyond the email routes were touched. Save Changes edits the card and writes nothing anywhere else.

### Repository checks

| Check | Command | Result |
|---|---|---|
| Database proofs | `tests/candidates.sh` | exit 0, 31 ok; `email.sh`, `review.sh`, `commands.sh`, `substrate.sh`, `gateway.sh` unchanged |
| App typecheck | `npx tsc --noEmit` | exit 0 |
| App lint | `npx eslint src/email src/substrate/extract src/substrate/destinations src/shell/AppShell.tsx` | 0 errors, 0 warnings |
| The slice's tests | `npx vitest run src/email src/substrate/extract src/substrate/destinations` | 9 files, 104 tests passed |
| Laws | `npx vitest run src/laws src/substrate/extract` | 42 files, 828 tests passed (once the scratch bench was removed; the reachability law names it while it exists, as it should) |
| Previews | the scratch bench served by `vite` on 5183, captured by Playwright at 390 by 844, 2x, light and dark | 18 shots under `qa/previews/unified-substrate-06/` |
| Full gate | `QA_PUBLISH=0 node qa/check.js` | Every stage PASS (core-types, core-tests, app-types, app-lint at the same 41 warnings as before this slice, app-tests the whole suite with the cards' tests and every law in 262s, app-build, app-legal); `house` lists exactly slice 01's nine pre-existing em-dash files, none touched here. The gate's own exit is 1 for that house list and for the open manual checklist (ten device rows), as it was for slices 01 to 05. Reports under `qa/reports/`, gitignored. |

### What the previews show, and what they do not

The inbox with a green Money card under Con Edison (the amount large, "Due Oct 15 · Con Edison", Save Bill and Details, the cross) and an amber Waiting card under Coach Miller, nothing under Wei or the promo; the message with its card above the body; the Details sheet with the bill's fields, the summary line, the message's text as Source Evidence, the provenance line and "Saves Only the Bill · Sends Nothing"; the saved card as a receipt line with View, and the receipt itself in the Hub's island with its before and after, its evidence and Undo; a mail with three readings showing two cards and "1 More Suggestion"; a stale card with Email Changed and Review Latest Details; Money not ready with the bill's door shut and the task's open; Capture a Task by hand with its empty sheet. The cards wear the module fills and none is red. They run on Linux with no SF font, and the sheet's title truncates there sooner than on the phone. They are not a device check: rows 1 to 10 of the checklist stay open.

### Gates this session did not pass, stated plainly

1. **Migrations 0044 to 0049 not applied; the flag not set.** All Dave's. With the flag off nothing here mounts; with it on and 0049 absent, `candidates_for` and `candidate_propose` are missing functions: the page shows its rows with no cards and says nothing about them (the readings are not remembered, so they run again once the migration lands), and a Capture by hand says "Couldn't Reach JARVIS · Try Again" on a toast. Never a blank.
2. **No live Gmail and no device.** The rules are proven on fixture mail; real mail's wording is the device rows. The sheet above a real keyboard, 200% text and the scroll of a long card list are device rows.
3. **Money's conflict check reads the device's loaded ledger** (deviation 31); the server's fingerprint dedupe stands behind it, so a duplicate is refused either way, but the "May Already Exist" line is only as current as the last ledger read.
4. **Compose, replies and sending** are slice 07; the Waiting segment and the Today feed slice 08. A waiting card saves a Waiting row today; the segment that lists them is next.

## Slice 07: compose, replies and the exact send (2026-10-03)

Same branch, on top of slice 06. Not merged. Not deployed. Nothing applied to
a live database. No real mail was sent: every send below is against a fake
Gmail or the local Postgres. The composer, the review, the outcome and the
drafts live inside the Email tab behind `VITE_JARVIS_FLAGS=email_intake_v1`;
with the flag off nothing here mounts.

### What landed

| Area | Files |
|---|---|
| Schema | `jarvis-core/supabase/migrations/0050_compose_and_send.sql`: the cached body keeps the reply headers (`email_message_body.reply_headers`; `email_body_store` gains `p_headers`, its old signature dropped; `email_message_read` carries them); drafts by revision (`draft_save` with DRAFT_CONFLICT carrying the server's copy, `draft_get`, `draft_list`, `draft_discard`); the exact send (`send_review`: the snapshot built from the row, every address checked and its domain lowercased, Bcc inside, the From identity the account's, attachments owned and hashed, header breaks refused, empty subject and body as warnings, then slice 03's `command_review`; `send_approve`: the draft row as the lock, `command_approve` inside, a second tap or device the same action or DRAFT_SENT, an edit after the review REVIEW_CHANGED); the worker's `outbox_claim_action` (one action, 0046's checks and fence) and `draft_outcome` (server only). Additive; explicit grants; the browser cannot claim, settle or mark an outcome. |
| Rollback | `jarvis-core/supabase/rollback/0050_compose_and_send_down.sql` (puts 0048's body store and message read back). |
| Proof | `jarvis-core/supabase/tests/sends.sh`: 72 checks against the stubbed Supabase, UTF8. |
| Routes | `api/email/send.ts` (the tap as the person through `send_approve`; then, as the server and outside any transaction, `runOutboxOnce` for that action alone; the draft marked from the settled state; the draft answered as the person may read it), `api/email/reconcile.ts` (an unknown settled only on the message found under its Message-ID), `api/_send.ts` (the dispatch: re-derive the draft, the account and the From identity, fetch and hash each attachment with the service role, build the message, one Gmail call with a twenty-second clock; 401 reauth, 403 PROVIDER_SCOPE, 429, 4xx refused; a timeout, a dropped connection or a 5xx after the body went unknown), `api/_mime.ts` (the RFC 822 message: From, To, Cc, Bcc, Subject as an encoded word, Date, the deterministic Message-ID, In-Reply-To, References, CRLF, multipart/mixed with base64 parts; a header with a line break throws), `api/email/message.ts` (stores Message-ID, References, In-Reply-To and Reply-To with the body on open), `api/_email.ts` (`bearerOf`, `userRpc`: a call as the person). `tsconfig.api.json` typechecks the routes under the app's own flags. |
| Worker | `src/substrate/outbox/worker.ts`: `action` names one command (`outbox_claim_action`); the rest unchanged. `src/substrate/commands/errors.ts`: DRAFT_SENT, DRAFT_CONFLICT, PROVIDER_SCOPE with their lines. |
| Screens | `src/email/ComposeScreen.tsx` (M5: account, To, Cc and Bcc, subject, body, attachments from the app's storage with their SHA-256, saved on this device after a pause and on blur, on the server after a longer pause by revision, the conflict with both copies, Close keeps the draft, Discard with Undo, Review Send shut offline or while an attachment uploads or until there is a recipient), `SendReviewScreen.tsx` (M6: From, every recipient including Bcc, the subject or its warning, the whole body, the attachments, the scope line, one tap, Edit, Review Again once expired or refused), `SendOutcomeScreen.tsx` (M7: Sent with "Gmail Accepted It · Accepted Is Not Read", Not Sent with the reason and Review Again, Send Status Unknown with Check Again, Open Gmail and resend shut, the receipt), `DraftsScreen.tsx` (drafts and failed sends newest saved first with the device-only copies, the sends newest first with their state), `drafts.ts` (the row's shape, the functions through the session, the two routes, address splitting and checking, Reply and Reply All from the message's own headers, the local store, the outcome word), `MessageScreen.tsx` (Reply and Reply All; Forward in Gmail in More, said so), `AccountsScreen.tsx` (the door to Drafts and Sent From JARVIS, as section 09 places it), `EmailFlow.tsx` (the four screens, Compose in the header, the send and the check, the receipt from the outcome), `copy.ts`. |
| Surface | `src/styles/email.css`: the composer's fields, the review card, the outcome card's left rule by state, the actions. One filled red a screen. |
| Tests | `api/_mime.test.ts` (7), `api/email/send.test.ts` (14: the send and the reconcile routes over a fake Gmail, a fake Supabase and a fake storage), `src/email/drafts.test.ts` (10), `src/email/EmailFlow.send.test.tsx` (16: the screens against a fake session with the draft table's rules), `src/substrate/outbox/worker.test.ts` (the per-action claim), `src/email/EmailFlow.test.tsx` and `EmailFlow.cards.test.tsx` unchanged and passing. |
| Laws | `laws.test.ts`: `sends.ts` and `worker.ts` off the unwired list (wired now). `rowTap`: the Cc / Bcc and Attach rows are doors. No other roster moved. |
| QA | `qa/checklists/2026-10-03-unified-substrate-07.md` (device rows open), `qa/previews/unified-substrate-07/` (eight screens, light and dark, 390 wide, from a scratch bench through the real stylesheets; the bench was deleted before the commit). |
| Docs | REPO-MAP.md section 4 (the send row, built) and section 6 (deviations 32 to 35); ACCEPTANCE-MATRIX.md rows E16 to E19, E22. |

### What the database proof shows (`tests/sends.sh`, exit 0, 72 ok)

- Rollback and forward again are clean; forward twice is idempotent; the body store has one signature.
- E17: the headers a reply needs are stored with the body and read back with the message; storing the body again without them keeps them; the browser cannot store a body.
- E16: a new draft is revision 1; a save at the revision the device saw is revision 2; a save at a revision that moved on is DRAFT_CONFLICT carrying the server's copy, with the server's copy untouched; a save with no revision is a plain save (Keep This Draft); a subject or an address with a header break, an attachment ref with a bad hash, a body over the review's limit, another owner's account are refused with the field named; another owner cannot read or save over the draft; anon cannot save; the list is newest saved first; discard returns the copy and the row is gone.
- E18, the review: a 64-character hash, a nonce, an expiry, the outbox row reviewed; the snapshot's From identity is the account's, the domain lowercased, Bcc inside, the draft revision bound, the reply headers and the deterministic client Message-ID carried; the verb counts Bcc ("Sent Reply to Coach@example.test and 1 More"); no warnings when subject and body are there; a review at a revision that moved on is a conflict; the same draft reviewed again has the same hash and a new nonce; an address that is not one refuses the review naming the line; Cc alone is no recipient; empty subject and body are warnings, never text the server makes up; an attachment under another owner's folder, one still uploading (no hash), and attachments over 20 MB together are refused; an owned, hashed attachment rides in the snapshot; a header break planted past the save is caught at the review; another owner cannot review; a review names a connected account only.
- E18, the tap: a wrong hash is refused before anything is consumed; another draft's nonce is refused; another owner cannot tap; the tap is approved, the outbox queued, the draft sending with its action; a second tap on the same review is the same action, replayed; the other review of the same draft cannot send it again; a sending draft is not the browser's to edit, review or discard; exactly one action was approved; a recipient added after the review refuses the tap and the draft stays a draft; an expired approval is refused with the draft a draft and the review cancelled; an unknown nonce is not found.
- 07.3, the worker: the browser cannot claim; a claim for an action that is not queued is nothing; the worker claims the queued send with the snapshot it will send; the same action cannot be claimed twice while the lease holds; the one-way mark; the provider's answer settles it confirmed with a provider_ack receipt; the browser cannot mark an outcome; the draft is sent with the provider's id; the sent list carries it first with the action's state and the provider's answer; a sent draft stays sent (no edit, review, discard or second outcome); the tap replays after the send too; a refusal before the provider call is failed with its code and the draft is failed, listed among the drafts; a failed draft reviews again as it is and a save makes it a draft again; a timeout after dispatch is an unknown outcome; the draft is unknown (no edit, OUTCOME_UNKNOWN on review, no discard); the worker never claims an unknown command again; absence of a search hit is not evidence; evidence settles it confirmed and the draft sent with the id.
- S16: no item was written; every receipt on the sends is the person's, on the email surface.

### What the route tests show (`api/email/send.test.ts`, 14; `api/_mime.test.ts`, 7)

Send: the tap goes to the database as the person (the session's token, the anon key); this action alone is claimed (`outbox_claim_action`, never `outbox_claim`); the raw message carries From, To, Bcc, the bound Message-ID, In-Reply-To and References with CRLF endings and the body as written; Gmail's ack settles it confirmed with the provider's id, thread and the client Message-ID on the receipt, and the draft is marked sent; no token or refresh token appears in the answer. A refusal from the database (REVIEW_CHANGED, APPROVAL_EXPIRED, DRAFT_SENT) passes through with its own code and nothing is claimed or sent. A second tap replays: nothing to claim, the settled state read back, no second send. Re-derived before anything leaves: a draft that moved on after the review fails the command with REVIEW_CHANGED and Gmail is never called. An attachment whose bytes no longer match the reviewed hash refuses the send; matching bytes ride along as a base64 part, fetched with the service role; an attachment under another owner's folder is never fetched. Gmail refusing the scope is Not Sent with PROVIDER_SCOPE; a revoked token marks the account reauth. A timeout after the body went is unknown: one Gmail call, settled unknown, the draft blocked, never a second call; a 5xx is unknown too; a 4xx that names the request is Not Sent. No session is 401, a malformed tap 422, the wrong method 405, none of them reaching the database. Reconcile: the message found in Gmail under the bound Message-ID settles the unknown send as confirmed with the provider's id on the receipt and the draft; not found is not proof (nothing reconciled, nothing resent); a send that is not unknown answers its state without asking Gmail; a command that is not the person's is not found. The message: every header, CRLF endings, Bcc and Cc in the raw, a line break in any header throws, a non-ASCII subject is an encoded word with the body left as UTF-8, an attachment part named and typed from the snapshot, the bytes matched one for one, the date and the hash helpers exact.

### What the component tests show (`EmailFlow.send.test.tsx`, 16; `drafts.test.ts`, 10)

Typing saves on this device after a pause and on the server after a longer one, with the account; a recipient is required and checked before any review; Close keeps an inert draft and Discard removes it with an Undo that saves the same words again. The review shows From, To, Bcc, the subject, the whole body and the scope line, asked with the saved revision; an empty subject is a warning; Send This Message posts the review's nonce and hash with one request id, two fast taps are one post, and the outcome is Sent with the receipt's words; Edit after the review cancels it and the next Review Send is a new review of the new words; an expired approval is Review Again, not Send, with nothing posted; the server refusing the tap is said on the review with Review Again and the draft intact. A failure before dispatch is Not Sent with the reason and Review Again, which opens the same draft; an unknown outcome shuts resend and Check Again settles only when Gmail has the message. Offline, Review Send is shut with the line, the words stay on this device, and no route is called. A draft saved on this device and never on the server is listed under Drafts as On This Device and opens with its words; a save at a revision that moved on shows both copies, and Keep This Draft saves this device's at the new revision. Reply answers the sender with Re:, the thread and the ids; Reply All keeps the other recipient on Cc and never invents a Bcc; a message with nobody else on it offers Reply but not Reply All. The pure half: addresses split only between entries (a quoted name may hold a comma), checked and normalised by domain; replies with and without headers; the local store newest first; equal words equal whatever the object order; the outcome word; the five-minute review.

### Repository checks

| Check | Command | Result |
|---|---|---|
| Database proofs | `tests/sends.sh` | exit 0, 72 ok; `candidates.sh`, `email.sh`, `review.sh`, `commands.sh`, `substrate.sh`, `gateway.sh` unchanged |
| App typecheck | `npx tsc --noEmit` | exit 0 |
| Routes typecheck | `npx tsc -p tsconfig.api.json` | exit 0 (the new config; the three older test files it excludes have their own long-standing errors, untouched here) |
| App lint | `npx eslint src/email src/substrate/outbox src/substrate/commands src/shell/AppShell.tsx` | 0 errors, 0 warnings |
| The slice's tests | `npx vitest run src/email api src/substrate` | 33 files, 359 tests passed before the component suite grew; see the gate for the whole |
| Laws | `npx vitest run src/laws` | every law passing once the scratch bench was removed (the reachability law names it while it exists, as it should) |
| Previews | the scratch bench served by `vite` on 5183, captured by Playwright at 390 by 844, 2x, light and dark | 16 shots under `qa/previews/unified-substrate-07/` |
| Full gate | `QA_PUBLISH=0 node qa/check.js` | Every stage PASS (core-types, core-tests, app-types, app-lint at the same 41 warnings as before this slice, app-tests the whole suite with the send tests and every law in 266s, app-build, app-legal); `house` lists exactly slice 01's nine pre-existing em-dash files, none touched here. The gate's own exit is 1 for that house list and for the open manual checklist (twelve device rows), as it was for slices 01 to 06. Reports under `qa/reports/`, gitignored. |

### What the previews show, and what they do not

The composer with From, To, the Cc / Bcc row, the subject and the body, Attach a File (the bench has no storage, so it says so), the save line and Review Send; the review with Not Sent Yet, From, To, Bcc, the subject, the whole body, the scope line, Send This Message and Edit Message; Sent with "Gmail Accepted It · Accepted Is Not Read", Open Gmail and View Receipt; Not Sent with the reason ("Gmail Needs Permission to Send · Reconnect in Connections") and Review Again; Send Status Unknown with Check Again, Resend Unavailable While Unknown and Open Gmail; Drafts with a device-only copy, a draft, a failed send, and Sent From JARVIS with a sent and an unknown; the message with Reply and Reply All; the conflict with both copies and the two choices. They run on Linux with no SF font. They are not a device check: rows 1 to 12 of the checklist stay open, and no real message was sent anywhere.

### Gates this session did not pass, stated plainly

1. **Migrations 0044 to 0050 not applied; `api/email/send` and `api/email/reconcile` not deployed; the flag not set.** All Dave's. With the flag off nothing here mounts; with it on and 0050 absent, Compose saves on this device and says "Couldn't Save to JARVIS · Kept on This Device", Review Send says "Couldn't Reach JARVIS · Try Again", and nothing is sent.
2. **No real send.** Every send is proven against a fake Gmail and the real functions in Postgres. The first real send is checklist row 3, to Dave's own address, after the deploy; nothing in this session sent, queued or scheduled mail.
3. **Attachments on a device.** The upload path runs through the app's own storage (`useFileStore`), which the bench and the tests do not have; the hash check at dispatch is proven in the route test with fake storage. A real upload from a phone is the device row.
4. **The two older route test files** (`api/_google.test.ts`, `api/_receipt.test.ts`, `api/_email.test.ts`) do not typecheck under the strict flags and never did; `tsconfig.api.json` excludes test files so the routes themselves are checked. They run and pass under vitest as before.
5. **Waiting and Today** are slice 08: a Waiting row saved from a card has no segment to list it yet; the Today feed does not know about sends.


## Slice 08: Waiting and the restrained Today feed (2026-10-03)

Same branch, on top of slice 07. Not merged. Not deployed. Nothing applied to
a live database. Waiting lives inside the Email tab and the Email band on
Today behind `VITE_JARVIS_FLAGS=email_intake_v1`; with the flag off Today's
mail band and the Email tab are untouched. The frozen Today TV guide in
`YourDay.tsx` was not touched (its hash law holds).

### What landed

| Area | Files |
|---|---|
| Schema | `jarvis-core/supabase/migrations/0051_waiting_and_today.sql`: `waiting_resolve`, `waiting_reopen`, `waiting_follow_up` (through one internal writer: lock the record, check it has not moved, patch it, record the action and its receipt, as the person; a second tap replays; a follow-up date is a field on the record, never a task or an event); `thread_messages` (the source and every cached message of its thread, newest first, with the Reply-To, Message-ID and References the body kept), `threads_latest` (the newest cached message per thread), `evidence_read` (the excerpt and the source's state), `candidate_review_count` (cards per card, on messages still here, in mailboxes not disconnected; no title, no amount). Additive; explicit grants; the writer is not the browser's to call. |
| Rollback | `jarvis-core/supabase/rollback/0051_waiting_and_today_down.sql`. |
| Proof | `jarvis-core/supabase/tests/waiting.sh`: 39 checks against the stubbed Supabase, UTF8. |
| Screens | `src/email/WaitingList.tsx` (M4: Open and Resolved, who, how long in local dates, the follow-up date and its tone only when chosen, New Reply), `WaitingDetail.tsx` (the record, the follow-up date with Clear, the New Reply with Review Reply, the excerpt it was tracked from with the source's state, Open Source Message and Open in Gmail as plain door rows, one filled red that is Resolve or Reopen, an optional note, Draft Follow-Up), `waiting.ts` (the functions through the session, ages and follow-up states in local dates, New Reply, the follow-up's real recipients, the ordering, and the Today rows as a pure function), `EmailFlow.tsx` (the Waiting segment, the record screen, the focus from Today: the inbox narrowed to its cards with Show All, or one record; the follow-up into slice 07's composer, threaded), `copy.ts`. |
| Today | `src/today/EmailToday.tsx` (the band: the count first, then committed email-origin tasks due today or overdue, events today, open waiting records with a follow-up due; five at most; each destination once and never the dealt task; a tap opens Email on a focus or the record's own module), `TodayFlow.tsx` (behind the flag the band replaces MailNotices as the page's mail band; the Waiting store from the app's Store), `TodayPage.tsx` (`mailHead`: the band's own head, "Email · Open Email"), `shell/AppShell.tsx` (the focus as a one-shot beside the thread one; a waiting entity opens the record). |
| Surface | `src/styles/email.css`: the Waiting chips, the record card, the quote, the Today band's rows and icons. |
| Tests | `src/email/waiting.test.ts` (10: ages across a zone boundary, follow-up states, the ordering, New Reply, the follow-up's recipients, the Today rows with 0, 1, 3, 5 and 8 items, the cap, dedupe, tomorrow kept off, no proposed title), `src/email/EmailFlow.waiting.test.tsx` (8: Track then Waiting then Resolve then Reopen against the real in-memory Store, a resolution note, a follow-up date making no task and no event, deleted evidence, New Reply without closure, Draft Follow-Up to the real address threaded under the newest message, two senders asking, the focus from Today), `src/today/EmailToday.test.tsx` (5: the count per card with nothing proposed, eligible items and the cap, nothing when empty, eight items and the dealt task excluded, a waiting row opening Email). |
| QA | `qa/checklists/2026-10-03-unified-substrate-08.md` (device rows open), `qa/previews/unified-substrate-08/` (Waiting, a record with New Reply, a resolved record, the Today band; light and dark, 390 wide, from a scratch bench deleted before the commit). |
| Docs | REPO-MAP.md section 4 (the Waiting row, built) and section 6 (deviations 36 to 39); ACCEPTANCE-MATRIX.md rows E12 to E15. |

### What the database proof shows (`tests/waiting.sh`, exit 0, 39 ok)

- Rollback and forward again are clean; forward twice is idempotent.
- E13: Resolve leaves the record resolved with the time and the note; one action (the person's, on the email surface, confirmed, pointing at the record) and one receipt saying "Resolved · Peña's Transcript" with the status before and after; the Activity feed lists it; a second tap with the same key is the same action; resolving a resolved record is the same answer with no new action; another owner cannot touch it; anon cannot; a task is not a waiting record; a record that moved under the person is DESTINATION_CHANGED; Reopen leaves it open with the note and the time gone, with its own receipt; reopening an open record is the same answer; no send_email action and no outbox row came of any of it.
- 12: a follow-up date lands on the record with a receipt naming the date; no task and no event was made; the same date again is the same answer; cleared, the date is gone and the receipt says so; the record count never moved.
- E12: the thread reads back with the source's sender, account and the Reply-To the body kept; another owner reads nothing; before a reply the thread's latest is the source; after a reply it is the reply, from the counterparty, and an unknown thread is absent; the record is still open; the thread reads two messages newest first; the evidence keeps its excerpt and is available; a deleted source is said so with the excerpt kept and the thread read marks the message deleted; another owner cannot read the evidence.
- E15: the count is the fixture's two proposed cards; the answer carries no title, amount or payload; a dismissed card drops out; a card on a message that is gone drops out; a mailbox that needs reconnecting still counts; a disconnected one does not; another owner's number is their own; anon has none.

### What the component tests show (`EmailFlow.waiting.test.tsx`, 8; `EmailToday.test.tsx`, 5; `waiting.test.ts`, 10)

A tracked record is listed under Open with who and how long and nothing red; Resolve is one call with the receipt's verb on the toast and the record moves to Resolved; Reopen reverses it; nothing is sent and the Store holds one record throughout; a resolution note rides on the record. Setting a follow-up date writes the record and no task or event; the list shows it in a warning tone only when due; Clear Date removes it. Deleted evidence keeps its excerpt and says so, with no door to a message that is gone. An incoming reply is New Reply on the row and the record, Review Reply opens the message, and the record stays open with Resolve still the person's. Draft Follow-Up opens the composer to the thread's real address, threaded under its newest message, sending nothing; two senders make the person pick. The review focus narrows the inbox to rows with cards and Show All restores; a waiting focus opens the record. On Today: the count leads, labelled per card, carrying no title or amount, and opens Email on the review focus; committed email-origin items due today or overdue ride under it while a plain task, a done task and a tomorrow callback do not, five at most, nothing padded; with no count and nothing due the band renders nothing and says so; eight eligible items are five rows and the task Today deals itself is left to it; a waiting row opens Email on that record. The pure half: ages in whole local days with the person's date winning across midnight, follow-up states, the ordering, New Reply, recipients from the thread's own senders (Reply-To first, never the person), the Today rows with 0, 1, 3, 5 and 8 items.

### Repository checks

| Check | Command | Result |
|---|---|---|
| Database proofs | `tests/waiting.sh` | exit 0, 39 ok; the earlier proofs unchanged |
| App typecheck | `npx tsc --noEmit` | exit 0 |
| App lint | `npx eslint src/email src/today/EmailToday.tsx src/today/TodayFlow.tsx src/today/TodayPage.tsx src/shell/AppShell.tsx` | 0 errors, 0 warnings |
| The slice's tests | `npx vitest run src/email src/today/EmailToday.test.tsx src/today/TodayFlow.test.tsx src/today/TodayPage.test.tsx` | see the gate for the whole; the three new suites are 23 tests |
| Laws | `npx vitest run src/laws` | every law passing once the scratch bench was removed, the TV guide's hash among them; the one-filled-red law caught Resolve and Reopen as two primaries on the record and they are one button now |
| Previews | the scratch bench served by `vite` on 5183, captured by Playwright at 390 by 844, 2x, light and dark | 8 shots under `qa/previews/unified-substrate-08/` |
| Full gate | `QA_PUBLISH=0 node qa/check.js` | Every stage PASS (core-types, core-tests, app-types, app-lint at the same 41 warnings as before this slice, app-tests the whole suite with the Waiting and Today tests and every law in 264s, app-build, app-legal); `house` lists exactly slice 01's nine pre-existing em-dash files, none touched here. The gate's own exit is 1 for that house list and for the open manual checklist (twelve device rows), as it was for slices 01 to 07. Reports under `qa/reports/`, gitignored. |

### What the previews show, and what they do not

Waiting under Open with three records (one with Follow Up Today in a warning tone, one with New Reply, one plain) and the Resolved count on its chip; a record with New Reply and Review Reply, the follow-up date field, the excerpt it was tracked from, Open Source Message and Open in Gmail as door rows, Resolve as the screen's one red, Add a Note and Draft Follow-Up; a resolved record with its note and Reopen; Today's Email band under its own head with "2 Email Items to Review", an overdue task, a record whose follow-up is today and a call at 10:00. They run on Linux with no SF font. They are not a device check: rows 1 to 12 of the checklist stay open.

### Gates this session did not pass, stated plainly

1. **Migrations 0044 to 0051 not applied; the flag not set.** All Dave's. With the flag off nothing here mounts; with it on and 0051 absent, the Waiting list still reads from the app's Store, Resolve says "Couldn't Reach JARVIS · Try Again" and changes nothing, and Today's band shows no count (the function is missing, read as nothing to say) while the committed items still list.
2. **No live Gmail and no device.** A real reply arriving, a source deleted in Gmail and the band on a real Today are the device rows.
3. **Notifications** stay off and out of scope (12): nothing here notifies.
4. **Hardening, the full integration pass and production verification** are slice 09.

## Slice 09: hardening, full integration and production verification (2026-10-03)

Same branch, on top of slice 08. Not merged, not deployed, nothing applied to
a live database: this session holds no deploy authorisation and was told to
wait for Dave's word before any merge. What follows is what the repository
and a local Postgres can prove, what they found, and the exact gates left.

### What landed

| Area | Files |
|---|---|
| The audit's three findings, fixed | `src/shell/AppShell.tsx`: with `email_intake_v1` on, the four timers of the earlier Email module (the Today and Email outboxes, the heads-down auto-reply, the snapshot refresh that reads Gmail and asks the model) no longer mount; with the flag off the shell is unchanged. `src/settings/clearLocalData.ts`: sign-out now removes the area taps and rules (`jarvis.mail.categoryTaps.v1`, `jarvis.mail.categoryRules.v1`), the two email keys it left behind. `src/email/EmailFlow.tsx`, `candidates.ts`, `copy.ts`: Today's "N Email Items to Review" and the Email review focus count the same set (cards proposed or needing details) in the same unit (cards); the focus line says "M More in Older Mail" when the loaded pages hold less than Today's count. |
| Hardening | `src/email/MailRow.tsx` (memoised: a row redraws only when its own row, label or handler changed or the minute turned), `EmailFlow.tsx` (one handler for every row), `src/email/categories.ts` (`rowsUnderRule`, `ruleKeptLine`: Remember's receipt names the exact count, S10), `src/email/WaitingDetail.tsx` was already one red (slice 08). |
| Laws | `src/laws/substrateBoundary.test.ts` law 5: every file under `src/email`, `src/substrate`, `src/hub` and the Today band imports no AI client (the Hub's own switch modules excepted), names no AI route, and runs on no timer beyond the two debounces. |
| Rehearsal | `jarvis-core/supabase/tests/rehearsal.sh`: fresh install 0001 to 0051, rollback 0051 to 0044 in reverse, forward again, forward twice, the leakage inspection, every proof. |
| Proofs | `jarvis-core/supabase/tests/email.sh`: after its own rollback-and-forward of 0048 it forwards 0049 to 0051 again and checks the chain ends as a deployment would (what the rehearsal found, below). |
| QA | `qa/checklists/2026-10-03-unified-substrate-09.md` (fourteen rows: device, project and Dave); `qa/previews/unified-substrate-09/` (the review focus with one card loaded and three more past the loaded pages, light and dark, 390 wide, from a scratch bench deleted before the commit). |
| Tests | `src/email/InboxList.test.tsx` (500 rows: drawn once, no redraw on the parent's re-render, one changed row redraws alone, a minute's turn redraws once; a fresh closure would redraw all, which is why the flow keeps one), `src/email/categories.test.ts` (the receipt after Remember), `src/settings/clearLocalData.test.ts` (the two keys). |
| Docs | ACCEPTANCE-MATRIX.md rows E26 (partial, the device half named), E27, E30, S01, S08, S09, S10, S23, S24; REPO-MAP.md deviations 40 to 46. |

### The production-surface audit (read-only, the whole app)

Run before anything was changed, over `jarvis-app/src`, `jarvis-app/api` and
migrations 0044 to 0051, for five things. Findings, and what was done:

1. **Demo identities, fake OAuth, fixture sends, scenario controls.** None on a production surface. Sample addresses live in tests and comments; the three older bench pages (`condBench`, `emailBench`, `healthBench`) are reached only by their own HTML files, which the build does not take (`index.html` loads `main.tsx` alone; `laws/noDemoData.test.ts` reads `dist/`); the old demo seed is a dynamic import behind a build-time flag that is false here. The composer's To placeholder is `name@example.com`, a format hint. Nothing changed.
2. **Background scanning and autonomous actions.** No Vercel cron, no `pg_cron`, no service-worker periodic sync; the Email tab syncs on open, pull, Refresh, Load More and on a message's open; the rules run on those triggers and never on a timer; the send route runs the worker for the tapped action only. **Found:** the shell mounted the earlier Email module's four pumps whatever the flag said: a snapshot refresh every few hours that reads Gmail and asks the model, an auto-reply that sends during a focus block with no tap, an outbox pump that after each send asks the model for a commitment and creates a task, and the Today outbox. **Fixed:** with `email_intake_v1` on none of them mounts; their queues are left as they were; with the flag off nothing changed. Law 5 now fails any timer the module might grow.
3. **Sign-out purge.** The sign-out path removes the mail cache, the cached bodies, the drafts, the readings and the tags under the mail prefix. **Found:** the area taps and rules were not under it and not scoped to a person. **Fixed:** both keys join the identity keys the purge removes; the test names them.
4. **Exact language.** No vague "handled" counts; no delivery promise ("Gmail Accepted It · Accepted Is Not Read"; receipts say "Sent Reply to …"); the Gmail link says "Open in Gmail" only for a thread id of Gmail's own shape and "Open Gmail" with why otherwise; rule cards say "Suggested by a Rule · Approved by You" and only an agent's card says Assistant. **Found:** Today's review count counted cards while the Email filter it opened counted loaded rows with any provisional card. **Fixed:** one set, one unit, and the line names what sits past the loaded pages.
5. **Receipt retention and deletion.** No retention period and no scheduled purge exist for actions, receipts, approvals or outbox rows; receipts are append-only by trigger; Delete Receipt (`receipt_erase`) blanks a receipt to the one word Erased and keeps the rows; approvals expire at five minutes, queued sends at five minutes, suggestions at thirty days; `approvals_sweep` and `context_packages_sweep` exist and nothing calls them yet (the former expires, the latter deletes shared-context snapshots a day after expiry); rows are hard-deleted only by account deletion (`delete_owned`). Section 03.5's 24-hour purges after a disconnect are not built: a disconnect removes the token at once and leaves cached bodies and candidate payloads in place until Remove Cached Mail or account deletion. Listed under the gates below; nothing changed here.

### What the rehearsal shows (`tests/rehearsal.sh`, local Postgres 16, UTF8)

- Fresh install of 0001 to 0051 on an empty UTF8 database: 29 tables and 117 functions in `public`; the eighteen substrate tables present.
- Rollback 0051 to 0044 in reverse order: the eighteen tables and the private schema gone; the older app's eleven tables untouched.
- Forward again, 0044 to 0051: the same 29 tables and 117 functions as the fresh install. Forward a second time: nothing changes.
- Leakage inspection: no secret, credential, password, key or token column in the substrate's public tables; row security on all eighteen; no substrate function PUBLIC may run; no outbox function a browser role may run (the worker's lease token has no power from a browser); the browser roles cannot use `jarvis_private`. For the record, the older app's `google_tokens.token_enc` (0018): AES-GCM ciphertext under the server's key, row security on with no policy, so the browser roles' default table privilege reads no row; it predates the substrate and is not changed.
- Every proof, in order, each on its own fresh database: `substrate.sh` 144, `gateway.sh` 113, `commands.sh` 167, `review.sh` 77, `email.sh` 58, `candidates.sh` 31, `sends.sh` 72, `waiting.sh` 39, `ai_budget.sh` 48: 749 checks, every script exit 0, ALL OK.
- What the first run found: `email.sh` stopped at its 38th check. Its own rehearsal step forwards 0048 again after the whole chain, which brings back the five-argument `email_body_store` that 0050 replaced with the six-argument one, and two overloads make every positional call ambiguous. A deployment never runs 0048 after 0050, and the route calls the function by named arguments, so nothing in production was wrong; the proof now forwards 0049 to 0051 again after its own step and checks that one `email_body_store` remains, the six-argument one. Slice 07's note that the older proofs were "unchanged" was true and insufficient: they had not been re-run after 0050. They all have now.

### What the component tests show

`InboxList.test.tsx`: 500 cached rows draw once; the parent re-rendering with the same rows, a new groups array over the same rows, or the clock ten seconds on draws no row again; one changed row redraws that row alone; the minute turning redraws each row once; a fresh handler closure on every render would redraw every row, which is why `EmailFlow` keeps one. `categories.test.ts`: the count a rule tags is the exact sender in that account, case aside; the receipt reads "Grouped 41 Updates by Category · Only Tags, Never Hides", "Grouped 1 Update by Category · …", and "Remembered · Only Tags, Never Hides" with nothing loaded. `clearLocalData.test.ts`: sign-out takes the two keys with it; Clear Local Data leaves them, like every identity key.

### Repository checks

| Check | Command | Result |
|---|---|---|
| App typecheck | `npx tsc --noEmit` | exit 0 |
| Routes typecheck | `npx tsc -p tsconfig.api.json` | exit 0 |
| App lint | `npx eslint` on every file this slice touched | 0 errors, 0 warnings |
| The slice's tests | `npx vitest run src/email src/laws src/settings/clearLocalData.test.ts src/today/EmailToday.test.tsx src/shell` | 63 files, 949 tests passed |
| Laws | `npx vitest run src/laws` | every law passing, law 5 among them; the TV guide's hash holds |
| Rehearsal | `tests/rehearsal.sh` | exit 0, ALL OK: 12 checks of the chain and 749 across the nine proofs |
| Production build | inside the gate (`npm run build`) | `dist/` 5.1MB; the largest chunks: the entry 1.29MB, `dist` 404KB, `jspdf` 399KB, `BrainFlow` 371KB, `NotesProvider` 204KB (sizes before compression, unchanged in shape by this branch) |
| Full gate | `QA_PUBLISH=0 node qa/check.js` | Run 1 (before the previews): every stage PASS (core-types, core-tests, app-types, app-lint at the same 41 warnings as before this slice, app-tests the whole suite with law 5 and the new tests in 277s, app-build, app-legal); `house` listed slice 01's nine pre-existing em-dash files and noted that a touched screen had no shots, which the two review-focus shots then answered. Run 2, on the final tree with the bench removed: every stage PASS (app-tests 266s); `house` lists exactly the nine files and the open manual checklist (fourteen rows: device, project and Dave), the same two reasons its exit has been 1 for every slice. Reports under `qa/reports/`, gitignored. |

### Integration with main

`origin/main` is `199e4bd` (Money, PR 47) and has not moved since slice 01 branched from it; the branch is nine commits on top of it with no conflict and nothing to rebase. Money's contracts are the ones the adapters were written against: the destination contract tests write through `LedgerService`, `TasksService`, `ScheduleService` and `WaitingService` (`destinations.contract.test.ts`, `toModules.test.ts`), and `substrate_readiness` is asked before any Save opens. No merge was made: Dave asked to be told first.

### The rollout, in order, and the way back

1. Apply `0044` to `0051` on the project, in order; each is additive and idempotent (the rehearsal ran every forward script twice). Nothing in the app changes yet: every new surface is behind a flag.
2. Set the server variables the routes need and do not have yet: `JARVIS_CONTEXT_KEY` (the gateway's key); `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` (already set for the older routes); the Google client values are the ones the older Gmail connection uses.
3. Deploy with `VITE_JARVIS_FLAGS=substrate_v1,email_intake_v1`. The Email tab becomes the unified one, Today's mail band becomes the Email band, the old mail pumps stop mounting. More > Advanced lists the flags on.
4. Send one message to your own address through Review Send (checklist row 13) before anyone else's.
5. **Back:** redeploy with `VITE_JARVIS_FLAGS` empty. The old tab and its pumps return exactly; nothing the person saved is lost, since every card, draft, send and receipt is a row in its own table and every destination write is an ordinary item. The schema can stay. If it must go: `rollback/0051_…_down.sql` to `0044_…_down.sql`, in that order, which drops the substrate's tables and the private schema and leaves the older tables as they were (rehearsed); do that only on a database with no substrate rows worth keeping, because the rows go with the tables.

### Gates this session did not pass, stated plainly

1. **Merge.** Not done, on Dave's instruction. The branch is green at every stage of the gate with the same house list as `main` has. The merge goes through the protected workflow on his word.
2. **Deploy and live verification.** No deploy authorisation in this session; nothing was deployed; no live commit or route was verified. The rollout above is the procedure, not a report.
3. **Migrations and variables.** Not applied, not set. Dave's.
4. **A phone.** Rows 1 and 3 to 13 of checklist 09: AI off end to end on a device, offline, a revoked grant, a second person after sign-out, 200% text, VoiceOver, the 500-row scroll's timing, the first real send. The automated halves are in the laws and the suites; the device halves are open.
5. **A real Gmail.** Every provider path is proven against a fake Gmail and the real functions in Postgres; no real mail was read, sent, queued or scheduled in this session.
6. **Retention (section 03.5).** The 24-hour purge of cached bodies and candidate payloads after a disconnect, the 15-minute job snapshot expiry sweep and the context-package sweep are not scheduled: nothing in this deployment runs on a schedule, by the same rule that keeps the module off timers. The functions that exist (`approvals_sweep`, `context_packages_sweep`) are called by nothing. A deliberate decision is needed on where a sweep may run (a user-triggered sweep on sign-in, or a scheduled database job with no AI and no external action), and it is not made here.
7. **The nine pre-existing em-dash files** on `main`, untouched by this branch; the gate's `house` stage names them and will until they are cleaned on `main`.
8. **The palette.** The light-mode flip is another chat's work in progress; this branch's screens were drawn against the stylesheets as they are on `main` today.

### Pre-merge review (after the slice, before the merge)

On Dave's word to merge, the whole diff against `main` (`199e4bd..6cee0d4`) went through an adversarial review before anything moved: eight finders, one dimension each (flag-off inertness; the security of the routes that go live on deploy; the exact-send path end to end; authorization inside the SQL; regressions in shared screens; what GitHub Actions could fail on that the gate did not; applying the migrations to a live, populated database; nothing unapproved escaping Email), each finding then judged by three independent lenses (real as stated; reachable, and how bad, given the flag off and the migrations unapplied; reproduces from the source). The container runs two of these agents at a time, so the review is long: the merge waited for the two dimensions that decide whether today's users see anything (flag-off inertness and the routes), and the rest continue, their findings to land in a follow-up before the migrations are applied.

Found and fixed before the merge:

1. **Flag-off inertness: one visible change, in Settings.** More > Advanced rendered a Unified Substrate section and asked `substrate_readiness` on every open whatever the flags said: with the flags unset the screen gained rows ("Migration 0044 Not Applied", every destination "Not Ready", "Flags: All Off") and a call to a function that does not exist yet. The section and the call now wait for a substrate flag (`AdvancedPage.tsx`, `useReadiness.ts`; deviation 47). Every other change to a pre-existing file was confirmed gated or inert.
2. **Routes: the attachment path guard was a prefix.** `fetchAttachment` accepted `<owner>/../<other>/x` and the URL it built would fold the dots away and read with the service role; the SQL that admits the ref was no stricter. The route now checks the path segment by segment (`insideOwnerFolder`), and `draft_save` and `send_review` refuse a folded path before it can be reviewed (`0050`, applied nowhere yet; deviation 48). Rated should-fix: unreachable until 0050 is applied, and the bytes themselves would only leave for a caller who already knew the object's exact size and hash; the real loss was an existence oracle. Tests: `send.test.ts` (never fetched, `insideOwnerFolder` over the bad shapes), `sends.sh` (refused at save).
3. **Routes: a mailbox row from a request body.** `ensureAccount` upserted an `email_account` row for any address a signed-in caller named, before finding there was no stored sign-in for it. It now checks the sign-in first, answers an address that already has a row with that row (so a failed refresh still marks it reauth), and creates nothing otherwise (`_email.ts`; deviation 49). Rated should-fix: owner-scoped rows only, unreachable until 0048 is applied. Tests: `routes.test.ts` (nothing created, no reauth recorded, no Gmail call).

4. **The exact-send path: the dispatch refused every send.** The send-path finder traced the tap end to end and found that 0044's revision trigger fired on the state writes too, so after `send_approve` the draft sat one revision past the snapshot and `draftStillExact` answered REVIEW_CHANGED every time: with the flag on and 0050 applied, no message could have reached Gmail (it failed closed: no double send, no wrong content, Not Sent forever). Reproduced on the local Postgres (a state-only update moved revision 4 to 5). Fixed in 0050: the trigger is on the content columns only, so the tap and the outcome leave the revision where the review bound it, which also stops a settled send from reading as a conflict on the device (deviation 50). Proof: `sends.sh` checks the revision after the tap and after the outcome.
5. **The exact-send path: a cancelled send left its draft stuck.** The review's Edit after a lost response cancels the command (`command_cancel`) and left the draft `sending`, after which every save, review and discard answered DRAFT_SENT for a message that never left. Fixed in 0050: a cancelled `send_email` command puts its draft back to `draft` (deviation 51). Proof: `sends.sh`, the freed draft saves and reviews again.

6. **Authorization inside the SQL: a blocker.** `jarvis_is_server()` is true for every caller inside a SECURITY DEFINER body (`current_user` is the function's owner there), so the gate that let `context_preview` and `context_issue` take the server's path on the caller's word never fired: any signed-in user who knew another person's uid, job id and connection id could read that person's context package. Not reachable until 0045 is applied; reproduced on the local Postgres with the committed 0045 (the other person's call answered `ok`) and refused after the fix (`42501`). Fixed: 0044 adds `jarvis_is_service_request()`, the request's JWT role alone, and 0045's two functions gate on it (deviation 52). Proof: `gateway.sh`, two new checks, 115 ok. The same finder's should-fix, the twenty-eight raise-only "server only" gates being dead the same way, is covered today by every one of those functions being revoked from the browser roles, which the rehearsal's inspection checks; moving them to the request's role is the follow-up's, after a caller-by-caller read, because some are called from inside the person's own functions.

Found and deferred to the follow-up, before any migration is applied (none reachable with the flag off):

- A command left `queued` or `claimed` by a request that died is never swept (`outbox_sweep` handles `dispatched` only, and runs only at the start of another send), so such a draft shows Sending with no door. The fix is a wider sweep that cancels those rows and frees their drafts, a sweep at the top of `reconcile` too, and Check Again on the outcome screen while a send reads as sending. It is a small design, not a line, and goes in the follow-up.
- `exploration_keep` (0047) stores client-supplied evidence ids without the ownership check `decision_save` performs: a note from the authorization finder.
- The shared-screen finder found no flag-off regression in the eighteen pre-existing files and left four notes: the Hub rides in the Brain chunk and seven substrate modules in the eager startup chunk whatever the flag (bundle shape, not behaviour); the Email focus intent is not in the shell's cancel-all list; a backup carrying the two new item kinds, imported before 0044 is applied, aborts the restore instead of skipping them (no such backup can exist before the flag is on); the AI Hub door is gated by `substrate_v1` while the Email tab is gated by `email_intake_v1`, by design.
- Four notes from the send-path finder: the five-minute undispatched TTL is not applied to a lapsed claim; `command_review` is callable for `send_email` by a session, so a custom client could hand `send_approve` a snapshot `send_review` never built (the hash still binds what is sent to what was shown); the attachment hash the review binds and the bytes in storage come from two upload runs; `send_approve`'s replay returns the action without comparing the shown hash. Each is recorded for the follow-up's judgement.

The route finder read 33 files and confirmed the rest: every route authenticates before any provider or database work; every service-role query is scoped by the session's owner and the SQL re-checks it; no access or refresh token reaches a response, a log or a receipt; bodies are validated and the error vocabulary is fixed; the gateway refuses authority keys at any depth and applies the mode ceiling before any call; there are no CORS headers and `vercel.json` rewrites only non-API paths; a second send is stopped by the outbox fence, one non-retried Gmail call and the nonce consumed on approval.

Checks after the fixes: `tsc` exit 0 for the app and the routes; eslint 0 errors on every touched file; `npx vitest run api` 9 files, 140 tests; `tests/sends.sh` 79 ok and `tests/commands.sh` 167 ok with the replaced `command_cancel`; `tests/gateway.sh` 115 ok; `src/settings` and `src/laws` 58 files, 967 tests; the rehearsal run again on the final SQL: ALL OK, 12 checks of the chain and 758 across the nine proofs (`gateway.sh` 115, `sends.sh` 79, the rest unchanged). The full gate on this tree: every stage PASS (core-types, core-tests, app-types, app-lint at the same 41 warnings, app-tests the whole suite in 263s, app-build, app-legal); `house` lists exactly the nine pre-existing em-dash files and the open device checklist, as for every slice.

### Merged and deployed (2026-10-03, on Dave's word)

Dave's word was "Merge". Pull request davefisher813/jarvis-rebuild#48 went to `main` as a merge commit, `2484642`, so every slice commit the sections above cite stays reachable from `main`. Its head was `c22f17b`: the nine slices plus the pre-merge review's two fix commits (`0d4df1a`, `c22f17b`). CI was green on that head twice (the push run 37133238439 and the pull request run 37133241867: jarvis-core, jarvis-app, npm audit) and the pull request read clean against `main` at `199e4bd`. `main` carries no branch protection; the pull request was the repository's own convention (PRs 42 to 47).

Vercel deployed `main` as it does on every merge: deployment `dpl_FVHPeKKnRiHC4id41AZHTqSGMesp`, production, commit `2484642`, READY at 15:37:05 UTC, aliased to `jarvis-rebuild.vercel.app`. Live checks through the Vercel connector (the container's own egress to that host is denied by network policy): the page answers 200 with the new build (last modified 15:37:35 UTC); `GET /api/email/accounts` answers 405, the route is live and refuses the wrong method before anything else. No session was used and no mail was read or sent.

What the deployed app does differently today: nothing a person sees. `VITE_JARVIS_FLAGS` is unset on the project, so every new surface is off and the old mail pumps still run; the `api/email/*` routes and the agent gateway are reachable and answer `UNAVAILABLE` to a signed-in caller until the migrations exist. Migrations 0044 to 0051 are not applied; `JARVIS_CONTEXT_KEY` is not set.

Still running at the time of the merge: the pre-merge review's last dimensions (CI parity, live-migration safety, privacy escape) and the three-lens verification of every finding. The merge did not wait for them because none can touch a person before the migrations are applied and the flags are set; their confirmed findings, the deferred items named above (the wider outbox sweep, the twenty-eight raise-only gates, the notes) and this record go in a follow-up pull request that waits for Dave's word like this one did. **Do not apply the migrations before that follow-up is in.**

### Production QA fixes (2026-10-04, on Dave's word)

Dave's QA with `VITE_JARVIS_FLAGS=substrate_v1,email_intake_v1` live found three faults: the AI Hub row on Brain did nothing, the Email tab said Couldn't Reach JARVIS, and five taps on About's build line did not open Admin. He also approved one light-mode style fix for this batch.

Code (deviations 53 and 54):

1. **AI Hub.** `aihub` joined `BrainFlow`'s known keys. Before, the row opened the Hub and the unknown-key guard closed it a frame later.
2. **Admin door.** It is always wired; the Admin screen decides. The admin check retries a transient failure and shows Couldn't Check Access with Try Again, so only a real no reads Not Authorized. Dave's account (`90c8a179-737f-4dcb-b315-c5f5c64c63e7`) is on the server's allow-list. The variable is write-only in Vercel, so this was shown from the record instead: his was the only session active between 11:45 and 14:45 UTC, and `/api/admin/usage`, which answers 200 only to an allow-listed account, answered 200 six times in that window.
3. **Notification titles in light mode** keep 700 (`jarvis-design-system.css`, scoped to `.notif-row`).

Tests: each of the three new tests in `BrainFlow.test.tsx`, `AboutPage.test.tsx` and `settings.test.tsx` fails with the fix removed and passes with it; `useIsAdmin.test.tsx` and three new `AdminPanel.test.tsx` cases cover the probe.

Database (deviation 55): the Email backend fault was the migrations. 0044 to 0051 were applied to production on 2026-10-03 and 10-04 by another session, in hand-rewritten chunks. This session fingerprinted production against a fresh local install of `main`'s migrations: triggers, indexes, seed rows, tables, policies and grants matched; functions did not. Seventeen functions were replaced from `main`'s text in nine migrations named `repair_main_safe_1` to `_9`, and each hashed identically to `main`. Among them is the request-role gate of deviation 52, which production lacked. The remaining four items contained DROP or DELETE, which the Supabase connector holds for approval inside the connector, and it timed out each time; nothing was routed around that gate. They went to Dave as one SQL file of `main`'s own text, in one transaction, and Dave ran it in the SQL Editor on 2026-10-04. Afterwards production was fingerprinted again with the same query as the local `main` install: md5 `24c80ab602c1a16abc7b72b9a70a0414` over 127 objects (functions, ACLs, table columns, row security, policies, constraints and grants) on both sides, so production now equals `main`. `action_undo`, `draft_discard`, `context_packages_sweep`, `connection_revoke` exist, `delete_owned` is current, `proposal_created_by_check` allows `system`, the older `email_body_store` is gone and `public.zz_probe` is dropped. The Clear Expired Shares row therefore has its database function and answers with a count.

Vercel: `JARVIS_CONTEXT_KEY` (32 random bytes, base64, sensitive) set for Production and Preview on 2026-10-04.

### Production audit fixes (2026-10-04, build 57d792c, on Dave's word)

Dave's audit of the live build found six faults, all fixed in code (deviations 56 to 61):

1. **Export Shared Context failed** with "The request didn't match the protocol": the Hub asked for a grant the database refuses when there is no assistant. The export no longer asks. Test: `HubFlow.test.tsx`, fails without the fix.
2. **Theme mixing:** the Hub and its sheet are in the app's active theme.
3. **Today's overlap:** "18 More in Anytime" and "Clear This Plan" each answer their own taps. Reproduced and re-checked in a real browser at 390px wide.
4. **Export Data JSON** exports in place instead of opening Backup. Test: `AdvancedPage.test.tsx`.
5. **Search Everything** shows the results on Enter and opens nothing. Test: `SearchFlow.test.tsx`.
6. **The context sweep** has a door: AI Hub > Agents > Clear Expired Shares, through `api/context/sweep` (tests: `api/context/sweep.test.ts`, `HubFlow.test.tsx`). The function is in production since the repair SQL was run (see the Database paragraph above).

Not changed, as Dave noted: Discard Draft works live; Undo in Activity and Revoke Assistant could not be tapped (no activity, no assistant) and need no action now that the database functions are in.

### Card titles, one weight in both themes (2026-10-04, on Dave's word)

Dave's screenshot of the live Today (light mode) showed the Your Move and Email card titles still regular weight after the notification-title fix, and he ruled that light and dark differ only in color. Measured in a real browser on the five rows he named: before, light 600, 400, 400, 400, 600 and dark 700, 500, 500, 500, 700; after, 700 for all five in both themes. The cause was two things: the light block stepped every weight down a notch, and the notice-row title was set to the regular weight in both themes. Both are fixed at the token, not by a longer selector (deviation 62), and two Type Law tests hold them (`typeLaw.test.ts`). Left for Dave's yes or no: the light-only sizes and the filled-versus-outline icons, which also differ between the themes.

### Password-reset and sign-in links bounced to localhost (2026-10-04, P0, a demo tester was blocked)

**Cause, from the auth log.** The app asks for the production origin on every auth email (`POST /recover?redirect_to=https://jarvis-rebuild.vercel.app`, `POST /otp?redirect_to=...`). The link in the email that Supabase sent carried `redirect_to=http://localhost:3000`, on Dave's Mac at 03:31 and on four iPhones between 19:05 and 19:20 UTC. Supabase uses the redirect the app names only when it is on the project's allow list and otherwise falls back to the Site URL, which was still the default. Nothing in the repo sets either, so the fix has a dashboard half and a code half.

**Dashboard (Dave's, not done by this session; no tool here reaches the auth settings).** Authentication > URL Configuration: Site URL `https://jarvis-rebuild.vercel.app`; Redirect URLs `https://jarvis-rebuild.vercel.app/**` and `jarvis://auth`. Emails already sent keep the old link; ask for a new one. To confirm it afterwards, request one reset or sign-in link and read the next `/verify` line in the auth log: `redirect_to` must be the production origin.

**Code.** Apple on the web and sign-up named no redirect and now do. `authRedirects.test.ts` holds every auth email and OAuth call to naming one and none to naming localhost (it fails with any one of them removed). A first visit's service-worker claim no longer reloads the page (the reload had been wiping a half-typed password and the in-memory recovery flag three seconds after a reset link landed), and the recovery flag survives a reload.

**What was run, and what was not.** A local stand-in for Supabase Auth that applies the allow-list rule, a real Chromium at 390px with a brand-new session for each step: with the origin not allowed the reset email links to localhost and the browser cannot connect (the bug, reproduced); with it allowed the link opens the app, Set a New Password appears, the new password reaches the auth server and signing in with it works; the magic link and create-account flows land in the app with no session to begin with. Before the service-worker fix the same run stopped at the new-password screen. This is the app against a stand-in, not production: this session cannot send email or reach the project's auth endpoints, so the production confirmation is the auth-log check above once the dashboard is changed. Tests: `AuthProvider.test.tsx` (28 cases), `serviceWorkerReload.test.ts`, `authRedirects.test.ts`.
