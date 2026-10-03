# REPO-MAP: the unified substrate, mapped onto this repository

Written 2026-10-03 for slice 01 (prompts/01). Every logical name in
IMPLEMENTATION-SPEC.md, API-AND-VALIDATION.md and CONTRACTS.ts, against the
file, table or function that owns it here. Where the package and the repo
disagree, the repo's standing rules win and the deviation is recorded in
section 6. This page is kept current by every later slice.

## 1. The repository

| Thing | Where | Notes |
|---|---|---|
| Engine | `jarvis-core/` | The data layer: `Store`, adapters, offline queue, the SQL migrations under `jarvis-core/supabase/migrations/`. |
| App | `jarvis-app/` | React 18, Vite 8, one bundle, Capacitor iOS shell around it. `@core` aliases the engine's source. |
| Server | `jarvis-app/api/` | Vercel edge functions. Everything that needs a secret: Anthropic, the Google refresh token, admin, account deletion. Outside tsconfig and the test run; logic worth testing lives in `src/`. |
| Database | Supabase, live project `roonancpktqigdndrumo` | Postgres, auth, storage. The Track 3 project (`zxszpuyhwvalfpfqgutq`) is separate and untouched by this build. |
| Package manager | npm, one lockfile per package | Node 22 (CI and the gate). |
| CI | `.github/workflows/ci.yml` | Typecheck, lint, the laws, the whole suite and a production build, both packages. |
| The gate | `docs/WORKFLOW_AND_GATE.md`, `qa/check.js` | The house rules: no em dash in a tracked text file, no secret-shaped literal, no `.only`. |
| Deploy | Vercel (web) from `main`; Codemagic (iOS) on a `v*` tag | This session holds no deploy authorization. See RELEASE-EVIDENCE.md. |
| Branch for this build | `claude/trusting-faraday-avniag` from `main` at `199e4bd` | Money module (PR #47) is in that base. `claude/light-mode-flip` (one commit, two stylesheets and three law files) is in flight beside it. Not merged by this session; Dave merges. |

## 2. The universal item table, as it actually is

```
item(id uuid, owner_id uuid default auth.uid(), entity_type text -> entity_type(key), data jsonb, created_at, updated_at)
```

- `updated_at` is the row's revision: a trigger keeps it strictly increasing (0001). The app reads it as `serverTime` (epoch millis). Where the spec says `expected_revision` on an item, this repo means that instant.
- `entity_type` is a registry; an unregistered kind rejects every insert (`laws/entityRegistry.test.ts` holds the pair). 0044 registers `waiting` and `exploration_note`.
- RLS is `owner_id = auth.uid()` on every table, no shared rows anywhere (docs/ARCHITECTURE.md).
- Patches go through `item_apply_patch` (strips nulls, 0031) and `item_apply_patch_if_older` (offline age check, 0032).
- `replica identity full` and the realtime publication (0034): a row the server inserts reaches an open app through `src/data/realtimeSync.ts`.
- Idempotent creates: a unique index on `(owner_id, data->>'clientId')` (0039); both adapters resolve a second create with the same clientId to the first row.

## 3. Logical entities to physical homes

### 3.1 Committed life records (stay in `item`)

| Spec kind | entity_type | Writer (the module contract) | Shape |
|---|---|---|---|
| task | `task` | `src/tasks/TasksService.ts` `createTask` | `src/notes/types.ts` `TaskData` |
| event | `event` | `src/schedule/ScheduleService.ts` `createEvent` | `src/schedule/types.ts` `EventData` |
| bill | `money_bill` | `src/money/ledger/LedgerService.ts` `addBill` (pure: `ledger/bill.ts` `buildBill`) | `ledger/types.ts` `BillData` |
| receipt | `money_receipt` | `LedgerService.addReceipt` | `ReceiptData` |
| project | `project` | `src/projects/ProjectsService.ts` | `ProjectData` |
| decision | `decision_record` (existing, 0025) | `src/decisions/DecisionService.ts`; versions in `decision_version` (0044) | `DecisionRecordData` plus `decision_version` rows |
| waiting | `waiting` (new, 0044) | `src/substrate/waiting/WaitingService.ts` | `src/substrate/waiting/types.ts` `WaitingData` |
| exploration_note | `exploration_note` (new, 0044) | slice 04 | `src/substrate/exploration/types.ts` |

An email candidate is NOT an item. It has its own table, so it cannot enter `Store.listForUser`, the backup export (`src/backup/entityRegistry.ts`), global search (`src/search/`), Today's item queries or the preload cache. `src/laws/substrateBoundary.test.ts` holds that.

### 3.2 Control plane (migration 0044, all `public`, RLS on, explicit grants)

| Spec entity | Table | Browser may | Server only |
|---|---|---|---|
| agent_connection | `agent_connection` | select own; insert a `manual` connection; update `display_name`, `mode`; delete a manual one | status, transport, verified_capabilities, capability_verified_at, remote_subject, auth_epoch, last_used_at, revoked_at (protect trigger) |
| scope_grant | `scope_grant` | select own | everything (written after an exact preview hash) |
| policy_suggestion | `policy_suggestion` | select, insert (status suggested, no agent), update, delete own | agent-attributed suggestions |
| job | `job` | select, insert own, update own | agent_id, project_id, resource_ids, created_by, scope_revision |
| context_package | `context_package` | select own | everything; the encrypted snapshot is `jarvis_private.context_snapshot` |
| proposal | `proposal` | select own | everything; an Email proposal carries no payload (check constraint), the payload is the candidate |
| approval | `approval` | select own | everything; nonce unique; `expires_at > granted_at` |
| action | `action` | select own | everything; `unique (owner_id, idempotency_key)` |
| receipt_event | `receipt_event` | select own | append only (trigger): no update but an erasure, no delete but account deletion |
| source_evidence | `source_evidence` | select own; insert `type = 'manual'` | email and import evidence |
| decision_version | `decision_version` | select own | the command functions of slice 04; one active version per item (partial unique) |
| decision_dependency | `decision_dependency` | select own | slice 04; no self edge (trigger); `expected_item_updated_at` is the item revision |
| email_account | `email_account` | select own | everything; the credential reference is `jarvis_private.email_credential` |
| email_message | `email_message` + `email_message_body` | select own | sync (slice 05) |
| email_candidate | `email_candidate` | select own; insert a `manual` capture; edit and dismiss while provisional; delete unless saved | saved, stale, conflict; destination_id, proposal_id, action_id, agent_id (protect trigger); destination kind asserted by trigger |
| email_draft | `email_draft` | select, insert, update, delete own while `send_state = 'draft'` | send_state, sent_action_id, provider_message_id |

Composite foreign keys on `(id, owner_id)` everywhere two owned rows meet, including into `item` (new unique index `item_id_owner_idx`). A set-null reference names its one column (Postgres 15 or newer).

### 3.3 Private storage (`jarvis_private`, not exposed by PostgREST)

| Spec field | Table | Note |
|---|---|---|
| agent_connection.credential_ref | `jarvis_private.agent_credential` | token hash and ciphertext; slice 02 fills it |
| email_account.credential_ref | `jarvis_private.email_credential` | points at the existing `google_tokens` row (0018, AES-GCM, service-role only) by address |
| context_package snapshot | `jarvis_private.context_snapshot` | `purge_after`; slice 02 |

No public substrate table has a token, secret or credential column (law 4 in `substrateBoundary.test.ts`).

### 3.4 The adapter layer (`jarvis-app/src/substrate/`)

| Spec | File |
|---|---|
| CONTRACTS.ts logical types | `substrate/contracts.ts` |
| Canonical hash | `substrate/canonical.ts` (NFC, sorted keys, SHA-256 over `schema_version` + canonical text) |
| Destination adapter contract (`prepare`, `commit`, `canUndo`) | `substrate/destinations/types.ts`; ADAPTER-CONTRACT.md is the shared written form |
| Money adapters | `substrate/destinations/money.ts` |
| Tasks, Schedule, Waiting adapters | `substrate/destinations/tasks.ts`, `schedule.ts`, `waiting.ts` |
| Registry and runtime readiness | `substrate/destinations/registry.ts` (`readinessFrom`, `fetchReadiness` over the `substrate_readiness` function) |
| Readiness on a screen | Settings > Advanced > Unified Substrate (`src/settings/AdvancedPage.tsx`, `substrate/useReadiness.ts`) |
| Feature flags `substrate_v1`, `email_intake_v1`, `verified_agent_adapters` | `substrate/flags.ts`, `VITE_JARVIS_FLAGS` in `.env.example` |
| Contract tests | `substrate/destinations/destinations.contract.test.ts` |

## 4. Logical APIs to their homes

Section 14's user commands and section 05's agent methods are built in slices 02 to 04. The homes they will take, fixed now so two slices cannot disagree:

| Logical API | Home | Slice |
|---|---|---|
| approveCandidate, editCandidate, dismissCandidate, undoAction | Postgres functions (SECURITY DEFINER, explicit `auth.uid()` actor check, one transaction, locks on candidate and action), called over PostgREST by the signed-in session | 03 |
| saveDecision, replaceDecision, withdrawDecision, keepExploration | Postgres functions, same shape | 04 |
| resolveWaiting, reopenWaiting | `WaitingService` (slice 01) plus a receipt through the command path | 08 |
| saveDraft, reviewSend, sendApproved, getAction | `api/email/*.ts` (Vercel) for anything that touches Gmail; the outbox claim and reconciliation as functions | 07 |
| getHub, setMode, grantScope, revokeAgent, toggleAI, previewContext, exportContext, importProposals, acceptCategoryPreference | `api/agent/*.ts` and functions | 02 and 04 |
| Agent gateway `capabilities`, `context.preview`, `context.issue`, `proposal.submit`, `draft.submit`, `review.link`, `action.status`, `connection.revoke` | `api/agent/*.ts`, agent token resolved server side against `agent_connection` and `jarvis_private.agent_credential` | 02 |

Why functions and not only edge functions: a local save must lock, validate, write the item, link evidence, mark the candidate and append the receipt in ONE transaction, and PostgREST offers no multi-statement transaction to an edge function. External dispatch (a send) is the opposite: it must not run inside a transaction, so it is an edge function with a durable outbox row and a fenced claim.

## 5. The things already here that the later slices reuse

| Need | Existing owner |
|---|---|
| Gmail credentials, refresh, send | `api/_google.ts` (cipher, `refreshAccessToken`, `ownerMailbox`, `sendRaw`), `api/google.ts` (sign-in, forget). Tokens never leave the server. |
| The current Email tab | `src/messages/MessagesFlow.tsx` (the tab key is `messages`, label Email, in `src/shell/destinations.tsx`). Redesigned in place by slice 05; the browser-side Gmail client in `src/connections/google/api.ts` stays until cutover. |
| HTML sanitising, hidden-text stripping, body text | `src/connections/google/map.ts` `extractBody`, `src/messages/mailHtml.ts`, `bodyText.ts`, `untrusted.ts` (the injection law in `laws/injection.test.ts`) |
| ICS parsing | `src/messages/ics.ts` |
| Zone-safe wall clocks | `src/messages/meetingWhen.ts`, `zoneTime.ts` |
| Durable idempotency for a mail appointment | `src/messages/emailSchedule.ts` (`clientId`, 0039) |
| Mail-born bills today | `src/money/ledger/emailBill.ts` (`fileEmailBill`, one thread one bill, update offers) |
| Where mail tasks go | `src/tasks/emailTasks.ts`, `tasks/origin.ts` (Today's Email band folds them) |
| Today's mail band | `src/today/MailNotices.tsx`, `TodayFlow.tsx` |
| AI master switch | profile `data.ai.level` (`src/ai/aiGate.ts`, enforced in `api/ai.ts`) and the admin switch `app_metadata.ai_allowed` (`adminAiAllowed`, read fresh per request) |
| Session | Supabase Auth; `src/auth/AuthProvider.tsx` `session.access_token`; every edge function verifies it against `/auth/v1/user` |
| Account deletion | `delete_owned(uuid)` (0036, replaced by 0044 to reach the new tables), called by `api/account/delete.ts` |
| Design tokens | `src/styles/jarvis-design-system.css`, `components.css`, `ruled.css`; the laws in `src/laws/` (casing, colour key, one red, no inline styles) |
| Brain / More route | `src/brain/BrainFlow.tsx` (the Brain tab) and `src/more/MoreFlow.tsx` (Settings). AI Hub mounts under Brain in slice 04; no seventh tab. |

## 6. Deviations from the package, each with its reason

1. **Em dashes.** The package's Markdown carried 72 of them. The repo's house rule forbids any in a tracked text file (`qa/check.js`, and Dave's own rule), so each was written as a spaced hyphen on copy. Section ids and every other character are unchanged.
2. **Composite keys, Postgres 15 or newer.** The spec allows composite owner-aware keys or server checks; this build uses the keys. A set-null reference has to name its column, which Postgres 15 added. Supabase projects on 15 and 17 both run it; the local rehearsal ran on 16.
3. **Item revision is a timestamp.** `decision_dependency.expected_item_updated_at` and every `expected_revision` against an item carry `updated_at`, because that is the revision this repo has.
4. **A saved candidate may lose its destination.** When the item is later deleted the candidate keeps `status = 'saved'` with a null destination and the card says Item removed; the check only forbids a destination on a provisional candidate. Saved-means-written is enforced by the command function, not the constraint.
5. **Transactions and module writers.** The module writers are client-side (`Store` over PostgREST). The adapter's `prepare` produces exactly the record the writer stores and the contract tests hold the two equal; the command function of slice 03 inserts that record inside its transaction. No HTTP inside a transaction, no shadow Money table.
6. **Money's shape wins over the payload's.** Integer cents, two-decimal currencies only, no zero amount, no refund kind, no receipt number field. Each refusal keeps the candidate in Email with the field named. ADAPTER-CONTRACT.md lists them as Money's open questions.
7. **Events carry no zone.** `EventData` stores a local date and wall clock; a timed instant is written in the reader's zone, the way the mail appointment door already does. A span across midnight or more than one day stays in Email with Open in Gmail. Adding an optional zone field is a Schedule decision, flagged for slice 06.
8. **Copy follows the house style.** Rendered lines are Title Case fragments joined by a middle dot (the casing and short-copy laws), so "Money isn't ready. Your bill is still here." is "Money Isn't Ready · Your Bill Is Still Here". The meaning is the spec's; the shape is the app's.
9. **The fixed light palette.** Section 02's cream canvas and accents are not applied in this slice. The repo has one token system and a light-mode flip in flight on its own branch; slice 04 raises the palette with Dave before any new surface is drawn.
10. **Flags are a build variable.** `VITE_JARVIS_FLAGS` rather than a database switch, so a slice can land inert and be turned on per deploy without a migration.
