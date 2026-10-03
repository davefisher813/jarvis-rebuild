# JARVIS • Shared intelligence substrate + Email
Version 1.0 • October 3, 2026 • Implementation contract

## 00. Authority, delivery, and fixed decisions
This package joins the two supplied drafts under Dave's latest request. Priority: the latest hard constraints, this resolved contract, prototype behavior, then historical drafts. Examples use synthetic fixture addresses and amounts; they are not imported user records. The package specifies an implementation in `davefisher813/jarvis-rebuild`, a React PWA with Supabase and an existing universal `item` table. It does not claim that the repository, existing schemas, provider connections, or production deployment were inspected or changed. The builder must map the logical contracts below onto the actual repository before migrations. No replacement app, duplicate Email tab, duplicate Money store, or parallel Tasks/Schedule systems.

The prototype is an executable design reference with local fixture data. Real provider authorization, mail delivery, backend concurrency, and RLS belong in the build and acceptance tests. Its scenario selector is preview tooling, never product UI.

### 00.1 Resolved conflicts
| Question | Binding v1 decision |
|---|---|
| Three agent modes versus explicit approval | Modes express ceilings, not bypasses. Read only allows scoped context reads. Help me adds proposals and inert drafts. Just handle it adds ONLY explicitly granted reversible local organization. Every Email life write and send still requires a fresh user action. |
| Standing grants learned from taps | Learn suggestions for local category tagging, never authority. After the third matching manual categorization in 30 days, offer “Use this category next time?” with “Remember” and “Not now”. No grant without Remember. No inferred send, read expansion, filing, or life-write permission. |
| Agent approval execution capability | Agent may retrieve the outcome of a user-triggered command; it cannot create approval or initiate execution. Only the JARVIS authenticated user command endpoint dispatches. |
| AI Hub Review versus Email-local candidates | Review holds project decision proposals. Email candidates stay in Email, including their values and text. Hub can show “4 email items to review” linked to Email, never their payloads. Activity may record “Suggested an email item” without its fields until approval. |
| Background scanning versus sync | Existing provider synchronization may transport/cache mail and update freshness. Deterministic extraction runs only on visible loaded messages or explicit “Find useful details” on a selected message. No historical scan job, scheduled extraction, background AI inference, embeddings job, or autonomous mail action. |
| Connection promises | Build a provider-neutral gateway and manual context export/import first. Show live Connect only for a verified adapter and account capability. No fabricated ChatGPT/Claude/Gemini sign-in. A consumer subscription is not an API credential or a promise of integration availability. |
| Brain and onboarding | Paid JARVIS inference, pricing, automatic interviews and billing are out of v1. Manual “Choose a project → add context → connect or export” onboarding is useful without AI. No paywall gates core features. Future server-side Dave entitlement can be unmetered; never hardcode identity in browser code. |
| Today timing | Today is the user's current date. A callback for tomorrow does not appear as a today commitment. It appears in Schedule and optionally an explicitly labeled Tomorrow preview owned by the existing Today design. |
| Receipts and erasure | Receipts are append-only during retention, kept until user deletion. Explicit deletion removes private payload and creates a minimal non-content tombstone for integrity/idempotency; deletion is not Undo. No eternal shadow copy of content. |
| Launch provider | Gmail is the Email v1 adapter. Other mail providers display “Not available yet”; no simulated connection. Multiple connected Gmail accounts are supported. |

## 01. Product structure and navigation
Keep the app's existing bottom navigation and Email destination. AI Hub lives under the existing Brain/More route as “AI Hub”; do not add a seventh nav item. AI Hub has exactly Agents, Review, Activity tabs. Email has Inbox and Waiting tabs, a search field and compose button in its header; Drafts and Sent are accessible through its mailbox picker. Inbox remains newest first with every mail row present. Category chips are All, Money, Travel, Work, Personal; user-created category names are allowed through an inline rename/add sheet, with no nested rules builder. Categories supplement chronology; active filters are explicit and All restores the complete list.

Shared infrastructure owns authorization, context packages, proposals, command dispatch, approvals, receipts, decisions, provenance and revocation. Email owns provider cache, extraction, candidates, draft/send presentation and waiting evidence. Money/Tasks/Schedule own destination record semantics. The substrate does not become another life module.

## 02. Design system
Fixed light theme requested for this package. Respect the existing Today structure; apply tokens within the new surfaces without moving its navigation or main sections.

| Token | Value / use |
|---|---|
| Canvas | #FFF8EF, warm cream |
| Surface | #FFFFFF; secondary #F4EEE5 |
| Text | #20283D; supporting text #364057, never pale gray |
| Primary | #C92B3A, white labels; pressed #A91D2D |
| Money | #087D65; tint #E4F7EE |
| Travel / schedule | #285EC9; tint #EAF0FF |
| Review / agent | #7542BC; tint #F2EAFE |
| Waiting | #975500; tint #FFF0CD |
| Error | #A82230 on #FFE8EA |
| Focus | 3px #285EC9 outline, 3px offset |
| Radii | cards 24px; fields/buttons 16px; chips 999px; sheet top 30px |
| Shadows | 0 8px 28px rgba(47,35,24,.06), no hard black borders |
| Type | system Apple stack; heading 30/34 750, section 21/26 700, body 16/23 400, action 16/22 650, metadata 13/19 550 |
| Spacing | 4px base; 20px screen gutter, 16px card padding, 12px internal gaps, 24px section gaps |
| Targets | at least 44×44 CSS px; primary buttons 48px high; never encode meaning in color alone |

Phone: 320–430px CSS width, no horizontal scrolling, safe-area padding, bottom navigation remains reachable. Desktop: same app shell, content max 860px; no phone bezel in production. Preview uses a phone frame. Text supports 200% zoom; stack controls instead of truncating essential money/date/recipient values. Long subject may wrap; sender address is available in detail. Buttons have visible keyboard focus and accessible names. Modal sheets trap focus, Escape/back closes, and return focus to the opener. Toast uses polite live region; errors use alert once. Reduced motion removes translation and keeps instantaneous state replacement. Card success morph lasts 180ms, sheets 220ms; never delay network feedback for animation. Loading action changes label immediately to Saving…/Sending… and disables only the corresponding command.

## 03. Shared data model
Logical field names below are authoritative DTO names, not permission to rename existing physical columns. UUID identifiers; all timestamps UTC ISO 8601; local calendar dates YYYY-MM-DD; timezones IANA identifiers; monetary values integer minor units plus ISO currency. Every persisted row has id, owner_id, created_at, updated_at, schema_version; mutable rows additionally have integer revision. All foreign references must have the same owner, or explicit existing project membership authorization. An email address is never ownership proof.

### 03.1 Universal item usage
Committed life entities remain in `item`: existing kinds for task, event, bill/receipt and project; add `decision`, `waiting`, `exploration_note` only if no equivalent kind exists. Use existing module writer adapters. An email candidate is NOT an item and must not enter global item search, embeddings, Today queries, calendar feeds, notifications or external agent context. A project decision in Review is likewise provisional until Save decision. Source links point to stable evidence records rather than mutable display text.

### 03.2 Control-plane entities
| Entity | Required domain fields and constraints |
|---|---|
| agent_connection | provider_key, display_name, status (manual/connected/revoked/expired/unavailable), transport, verified_capabilities[], capability_verified_at, mode, credential_ref private, auth_epoch integer, last_used_at nullable. Unique owner/provider/remote subject when present. |
| scope_grant | agent_id, project_id nullable only for explicit resource-slice grants, resource_ids[], fields[], purposes[], capability, expires_at nullable, approved_by, approved_at, revoked_at, grant_revision. Empty resource set grants nothing. Wildcard entire DB forbidden. |
| policy_suggestion | agent_id nullable, surface, action='local.category.apply', rule {sender_exact, account_id, category_id}, evidence_tap_ids[], status suggested/accepted/dismissed, expires_at. No arbitrary code/expression rules. |
| job | agent_id nullable for manual, project_id, purpose, status open/closed/cancelled, created_by, scope_revision. Exactly one normal project boundary; exceptional resource slices explicit. |
| context_package | job_id, agent_id, manifest entries {resource_id, revision, fields, redactions, evidence_refs}, expires_at, auth_epoch, package_hash, status active/revoked/expired, omitted_counts. Store manifest and encrypted permitted snapshot with retention below. |
| proposal | job_id, agent_id nullable, surface project/email, type, payload_version, payload_hash, evidence_refs[], status proposed/accepted/dismissed/superseded/stale, created_by. Email payload lives only in email_candidate; shared proposal has its opaque reference. |
| approval | user_id, action_id, payload_hash, source_revision, destination_revision nullable, account_id nullable, granted_at, expires_at, consumed_at, auth_epoch nullable, nonce unique. Server created only after user session command, never client supplied status. |
| action | actor_kind user/rule/agent, actor_id nullable, initiated_by_user_id, proposal_id nullable, verb, surface, state, payload_hash, idempotency_key, expected_revision, provider_account_id nullable, destination_id nullable, attempt, authorization_snapshot, error_code nullable. Unique(owner_id,idempotency_key). |
| receipt_event | action_id, sequence integer, state, exact_verb, timestamp, actor, initiator, scope_summary, before_ref nullable, after_ref nullable, diff, evidence_refs[], provider_ack nullable, error_code nullable, reversal_action_id nullable, assurance verified_jarvis/provider_ack/reported_external. Unique action/sequence. |
| source_evidence | type email/manual/import, account_id nullable, provider_message_id nullable, thread_id nullable, source_hash, excerpt, captured_at, source_timezone nullable, availability available/deleted/disconnected, encrypted_snapshot_ref nullable. Per-field extracts retain offsets or structured attachment path. |
| decision_version | item_id, version, title, statement, rationale, alternatives[], constraints[], dependency_refs[], evidence_refs[], committed_by, committed_at, status active/superseded/withdrawn, supersedes_version_id nullable, withdrawal_reason nullable. Unique item/version. |
| decision_dependency | from_version_id, to_item_id, expected_revision, kind depends_on/blocked_by/informed_by, status current/changed/missing. No self edge or depends_on cycle. |
| email_candidate | account_id, message_id, source_hash, extractor_version, kind, fields, provenance_by_field, missing_fields[], status proposed/needs_details/saved/dismissed/stale/conflict, revision, destination_id nullable, proposal_id nullable, dismissed_fingerprint nullable. Unique owner/account/message/kind/fingerprint. |
| email_account | provider gmail, provider_subject, address, credential_ref private, scopes[], state connected/reauth/disconnected, last_sync_at, cursor, sync_error, capabilities. Never return credentials to browser/agents. |
| email_message | account_id, provider_id, thread_id, internal_date, from/to/cc, subject, snippet, sanitized_body_ref, attachment_metadata[], provider_labels[], provider_revision, deleted_at nullable. Unique account/provider_id. |
| email_draft | account_id, thread_id nullable, to/cc/bcc[], subject, body_text, attachment_refs[], reply_headers, revision, saved_at, send_state draft/sending/sent/unknown/failed. Server hash of canonical outgoing MIME inputs. |
| waiting payload on item | title, waiting_for, counterparty_display, contact_id nullable, source_evidence_id, status open/resolved/withdrawn, started_at, follow_up_on nullable, resolved_at nullable, resolution_note nullable. No implicit task creation. |

### 03.3 Integrity and indexes
Index control rows on owner_id and active status; scope grants on owner/agent/project; candidates on owner/account/status/internal_date; messages on account/internal_date/provider_id; actions on owner/idempotency_key; receipts on owner/action/sequence; dependencies on to_item_id. Enforce uniqueness in the database, not only React state. Composite owner-aware foreign keys or server checks inside transactions prevent cross-tenant references. Payload schemas reject unknown action types and extra authority fields. Keep validated JSON payloads versioned; migrate readers before writing new versions.

### 03.4 Access and privacy
RLS on every exposed table, owner policies plus actual project ACL membership where sharing exists. Agents have no universal `item` credential and no direct Supabase table access. Agent token resolves owner, connection, job and explicit scope on the server, never trusts token-supplied owner/resource claims alone. User browser cannot insert confirmed receipts, agent capabilities or approvals directly. User mutable data routes preserve both USING and WITH CHECK ownership. Service credentials stay server-only. Privileged functions use restricted schema/search path, explicit actor checks and narrowly granted execute; default to invoker. Security-invoker views or private views only. Existing admin AI switch is checked from current server state, not stale JWT user metadata. Separate encryption for provider tokens; scrub message body, authorization tokens, bank fields and recipients from telemetry. Sanitized body strips scripts, event handlers, forms, iframes and tracking images; remote images load only after user “Load images” and never during extraction. Treat every email and agent output as untrusted data, never executable instructions.

### 03.5 Retention
User-facing committed items and receipts remain until user deletes them. Revoked/expired context snapshots purge within 24 hours; manifests retain only non-content identifiers until user deletes activity. Active job snapshots expire in 15 minutes and are not long-term memory. Unapproved/dismissed candidates remain in Email until user deletes or disconnects with Remove cached mail. Default disconnect removes tokens immediately and cached bodies/candidate payloads within 24 hours; retain approved life records and their minimal evidence excerpts unless user separately deletes them. Purging content must cascade into search caches, exports stored server-side and attachment snapshots. Minimal action tombstone keeps owner, opaque idempotency hash, state and destination ID with no subject/body/amount; account deletion purges it too. Show “Deleting this receipt does not undo the action.”

## 04. Permission engine
Effective authorization is the intersection of: authenticated actor → current master AI switch (for AI only) → active connection → verified capability → explicit resource/field grant → job purpose → surface ceiling → current per-action approval when required → revision/idempotency checks. Deny wins at every layer. No client capability can widen the server result.

| Operation | Read only | Help me | Just handle it | Additional ceiling |
|---|---|---|---|---|
| Read selected project fields | allowed by explicit grant | same | same | Log manifest receipt before releasing bytes |
| Propose a project decision | denied | allowed | allowed | Never committed automatically |
| Suggest Email candidate | denied | allowed | allowed | Explicit user invocation; payload confined to Email |
| Create inert draft | denied | capability + grant | same | Never sends; Email-local draft |
| Commit decision / life record | user only | user only | user only | User taps exact shown action |
| Apply local category rule | denied to agent | propose | explicitly accepted rule only | No hide, archive, collapse or provider modification |
| Send/reply/forward | denied to agent | user only | user only | Exact per-message approval, all fields bound |
| Expand scope / alter constraints | user only | user only | user only | Preview before granting/saving |

Mode change is immediately visible as a summary, never activates unchecked grants. Selecting Just handle it shows “Only remembered local organization runs automatically. Saves and sends still need your tap.” Button “Use this mode” is the grant confirmation; subsequent direct scoped choices may be changed inline. Read-only connect defaults to no data until the user selects a project and sees the manifest. Help me can be selected deliberately during connect; never enabled just because it is recommended.

Revocation increments auth_epoch, revokes tokens, invalidates unconsumed agent-linked approvals/context packages, blocks queued undispatched jobs and records Revoked access. Recheck authorization just before bytes leave the server and just before dispatch. A dispatched external operation cannot be recalled; receipt says “Already sent to provider; checking result.” A locally revoked agent cannot cancel or poison a separately user-authored draft. Master AI off disables all inference, AI reads and new proposals; manual/rule actions and cached receipt viewing remain. Existing AI suggestions may be manually inspected and edited; accepting one is a user action, not new inference.

## 05. Agent-context protocol v1
Transport independent JSON contract; implement HTTPS gateway first. A verified connector may expose it through the client-supported transport. Manual export/import works without any connector. Do not ship undocumented authentication flows. OAuth authorization uses exact redirect allowlists, state and PKCE when supported; tokens are scoped to the gateway, never Gmail credentials.

### 05.1 Methods
| Method | Input | Output / semantics |
|---|---|---|
| `capabilities` | authenticated connection | server verified capability list, protocol_version=1, unavailable reasons |
| `context.preview` | job_id, requested_resource_ids, requested_fields, purpose | permitted manifest, redactions, omitted count, requires_user_grant boolean; no unauthorized existence leaks |
| `context.issue` | user-approved manifest_hash, job_id | package_id, expires_at, snapshot revisions, minimal data; generates read/disclosure receipt |
| `proposal.submit` | package_id, surface, type, payload, evidence_refs, idempotency_key | proposal_id, status; cannot commit; reject evidence outside package |
| `draft.submit` | package_id, draft payload | inert draft_id/revision, review link; exact account must already be in scope |
| `review.link` | owned proposal_id | JARVIS internal path, no bearer credentials in query |
| `action.status` | owned action_id | state and scoped receipt; no execution method exposed to agents |
| `connection.revoke` | authenticated user connection_id | revocation epoch; unavailable to unrelated agent |

Protocol errors: 401 AUTH_REQUIRED; 403 AI_DISABLED/SCOPE_DENIED/CAPABILITY_UNVERIFIED; 409 SOURCE_CHANGED/STALE_SCOPE; 410 PACKAGE_EXPIRED/CONNECTION_REVOKED; 422 INVALID_PAYLOAD; 429 RATE_LIMITED with retry-after. Error response `{code, safe_message, retryable, correlation_id}` never leaks withheld record titles. Reject additional properties. Cap package at 50 records and 32KB UTF-8 content; if larger, let user narrow explicit selection, do not silently truncate crucial constraints. No pagination that implicitly increases authority. Agent proposals reference exact snapshot revision and must be revalidated against current revisions.

### 05.2 Scope selection
Normal flow: choose project → purpose → default project brief containing title, active committed decisions, selected tasks and constraints → preview exactly what will be shared → Share context. Sensitive Health/Money/raw mailbox attachments are excluded unless separately selected with named fields. A linked contact is not permission to disclose the contact's entire history. A trip project can request an availability slice using busy time blocks only; details/titles stay excluded by default. Wider requests produce “Also share these 3 busy times?”; rejecting keeps the original grant. Standing project read grants must be explicitly accepted with visible expiry choices Once (15 minutes), This project (until revoked); no whole-life option.

Manual export is an explicit disclosure: a downloadable JSON/text package includes manifest, purpose, expiry advisory, source references and “Imported suggestions are unverified until reviewed.” Offline copies cannot be technically revoked; show that before export. Imported JSON is size/schema validated; pasted prose goes into Mentioned, never Decided automatically. No cross-AI conversation history imports. Exported context includes committed decisions only; a user may explicitly include exploration with status marked uncommitted.

## 06. Review and durable decisions
Screen H2 heading “Save what we decided”; project picker; Decided/Mentioned segments; source/session card; each proposal displays statement, reason, evidence link, dependency chips and Edit. Decided means proposed commitment, not yet saved: badge “Not saved yet”. Mentioned means exploration. Agent classification is advisory; user can move an item between segments. Manual paste starts in Mentioned. Save decision creates a durable decision item/version with explicit user commitment; “Keep as note” creates an exploration_note that cannot enter active-constraint queries. No bulk “accept everything” v1.

Decision schema is defined in 03.2. Statement and rationale required, minimum one nonempty reason; source may be “Entered by you” rather than invented evidence. Alternatives can be empty. Dependencies are selected real IDs, not fuzzy title matching. Save shows exact project and effect; no second confirmation. If a decision conflicts with an existing active decision, label “Conflicts with Summer travel budget”; require either Edit or Replace decision, with side-by-side old/new. Replace is an explicit button that supersedes the prior version in the same transaction. History preserves earlier statement, reasons and dependencies. Withdraw opens reason input plus “Withdraw decision”; it changes active status, never erases the past or deletes downstream tasks. Reinstatement creates a new version explicitly. A stale dependency creates a constraint-change suggestion, not an automatic decision rewrite. Activity says “Budget changed. Review 2 dependent decisions.” Affected decisions show Needs review without becoming withdrawn. Dismiss suggestion records reviewed revision; a subsequent revision can generate another suggestion.

Exploration → proposal → commitment is a one-way explicit promotion, with withdrawal/supersession as versioned events. Neither conversation frequency, assistant confidence nor “sounds good” parsed from mail establishes authority.

## 07. Command dispatcher, approvals and receipts
### 07.1 State machine
proposed → approved → running → confirmed OR failed OR outcome_unknown. proposed/approved → cancelled. An approval expires after 5 minutes if undispatched. Failed may retry only when non-delivery is proven; retry is a new attempt under the same logical idempotency key and current explicit user tap. outcome_unknown can become confirmed or failed only after reconciliation evidence. User cancelling a running command records cancellation_requested, not cancelled until non-execution is proven. Keep states separate from candidate status.

### 07.2 Atomic local save
`approveAndExecute(candidate_id, expected_revision, shown_payload_hash, idempotency_key)` verifies authenticated human session, source revision, immutable normalized payload and module readiness. In one DB transaction lock candidate/action; validate Money/Tasks/Schedule adapter; consume approval; write destination item via module contract; link evidence; mark candidate saved; append confirmed receipt and action state. Transaction failure leaves no committed destination or successful receipt. Duplicate calls return the original destination and receipt. Race across devices has exactly one winner. No visible success before commit. Agent origin is credited, user is initiator.

### 07.3 Sends
Compose's “Review send” opens the exact account, From, To, Cc, Bcc, subject, full body and attachments. Final button “Send this message” is the approval; this extra review is specific to sending, not life cards. Bind hash to account, normalized recipients including Bcc, MIME/body, subject, attachments bytes hashes, reply/thread headers, draft revision and chosen send identity. Editing anything invalidates approval. Server verifies allowed From identity and provider scopes. Empty subject/body show explicit warnings on the same review sheet; recipient required. Final tap creates approval + durable outbox command; dispatcher claims it once with fencing token, rechecks authorization and submits. Approval must never be reused for another draft/account. No offline sends or automatically replayed offline send queue.

Gmail send acknowledgement records provider message ID and timestamp. Provider ack means provider accepted, not delivered/read by recipient. If timeout occurs after possible dispatch, show “Send status unknown. Check Gmail before trying again.” Disable resend of that attempt and reconcile by stable Message-ID/draft/provider evidence. Search absence alone is not proof of non-delivery. Exactly-once external delivery cannot be promised; never blind-retry ambiguous sends. A deterministic client Message-ID is correlation, not assumed provider idempotency. Gmail credentials remain inside JARVIS provider service.

### 07.4 Receipt format
User summary: “Saved $142.30 bill to Money”, “Tracked Peña transcript”, “Read 3 records in Summer travel”, “Saved reply draft”, “Sent reply to coach@example.test”, “Grouped 41 updates by category”, “Suggested a budget change”. Never “Handled 5”, “Checked your inbox” or “Done” without an exact effect. Grouped means tagged locally; chronological rows remain visible.

Detail shows: status pill, exact effect, actor (“Suggested by Claude · Approved by you”), timestamp in user timezone, selected project/account, before/after diff, source evidence, provider acknowledgement if any, Undo eligibility, related decision versions and Copy/export receipt. A claimed external action shows “Reported by assistant · Not verified by JARVIS”; it cannot mark a JARVIS command confirmed. Reads and inert drafts also get receipts. Denied accesses log only safe metadata. No email candidate fields in global activity until saved; Email receipt detail remains inside Email for provisional/draft content.

Undo is a new compensating action. For newly created local items within 10 seconds, toast offers Undo, and receipt retains it later while eligible. Undo checks destination revision and dependencies: unchanged/unreferenced item can be removed with reversed receipt; edited or referenced item shows “This item changed. Open it to review.” Never erase later work. Sent mail has no fake Undo; Gmail escape is the fallback. Resolving waiting can be reopened. Read disclosures cannot be undone.

## 08. Email feature inventory
| ID | Feature | Concrete acceptance |
|---|---|---|
| E01 | Chronological mailbox | Incoming messages sort internal_date DESC then provider_id DESC, across selected accounts; no ranking or implicit collapsed threads. |
| E02 | Refresh and pagination | Pull or Refresh fetches new mail; cursor pages 30 rows without reordering old rows or losing scroll; freshness advances only on successful sync. |
| E03 | Search | Sender, subject and body literal text, optional account/category; cached results labeled until provider search finishes; clear restores prior list. |
| E04 | Category grouping | Explicit chips filter locally with visible count; All includes every cached inbox message; remembered categories never archive/hide. |
| E05 | Message detail | Full sanitized message, headers disclosure, evidence and attachments; back restores position. |
| E06 | Read/unread | Open marks read through user-origin provider command; failure restores badge and shows Retry; explicit Mark unread works. |
| E07 | Card generation | Only deterministic supported fields/explicit user capture/explicitly invoked agent suggestions create cards; no cards for ordinary promo or generic expenses mail. |
| E08 | Card edit | Details sheet edits typed fields, validates required data and dates; Save changes updates only candidate, never destination. |
| E09 | Card approval | One Save/Track/Add creates exactly shown record once with provenance and receipt; no second popup. |
| E10 | Dismiss | Dismiss removes only card, not mail; menu “Show dismissed suggestions” restores candidate; same fingerprint stays dismissed. |
| E11 | Receipts and Undo | Confirmed action becomes compact inline receipt linked to detail/destination; Undo follows 07.4 revision guard. |
| E12 | Waiting tracker | Only approved waiting items, Open/Resolved segments, explicit follow-up dates and source links. |
| E13 | Resolve/reopen | Resolve updates that waiting item only; Reopen reverses status; no automatic outbound mail. |
| E14 | Follow-up draft | Draft follow-up opens editable draft, does not send; recipient verified from source headers and displayed. |
| E15 | Today entry | Generic review count plus up to 5 eligible committed items; candidate titles/amounts never appear. |
| E16 | Compose | New draft with account, To/Cc/Bcc, subject, body and attachments; local save then server save, revision-aware. |
| E17 | Reply/reply all | Reply headers preserved; Reply all shows all recipients, excludes own identities, never pulls Bcc from history. |
| E18 | Exact send approval | Final review binds all content/account fields; any edit invalidates; single dispatch under parallel taps. |
| E19 | Drafts/Sent | Saved local drafts and confirmed sent records listed; Sent means provider accepted, not recipient read. |
| E20 | Provider escape | Validated account/thread link opens exact Gmail thread; if unavailable button says “Open Gmail”, with explanation. |
| E21 | Account states | Account picker, connected timestamp, reauth, disconnected, partial-sync error; one failing account does not blank another. |
| E22 | Offline | Cached mail and inert drafts readable; no life saves/sends queued; retry requires tap after reconnection. |
| E23 | Attachments | Metadata + download via authorized proxy; unsafe/unsupported preview falls back to download/provider. |
| E24 | Manual capture | From message choose bill/receipt/task/event/waiting, fill fields with visible source; fully useful with AI off. |
| E25 | Source updates/conflicts | Changed source invalidates stale candidate approval and shows diff before reapproval; saved records never silently mutate. |
| E26 | Accessibility | Keyboard and VoiceOver navigation, readable labels, 44px targets, 200% text and reduced motion pass. |
| E27 | AI controls | AI off retains all deterministic cards, search, capture, waiting and compose; agent call endpoints reject. |
| E28 | State recovery | Empty/loading/failure/reauth/offline states preserve edits and distinguish no results from failed loading. |
| E29 | Archive/trash | In detail menu, explicit per-message actions only when adapter supports them; Undo verified provider command; no permanent deletion. |
| E30 | Local export | Export permitted context/receipt; never includes unapproved email payload through global export. |

## 09. Screen contracts
Every screen inherits: skeleton only on first load; cached content plus freshness on refresh; empty state only after successful empty response; error with Retry preserving content; offline banner “Offline · Showing saved data”. Disable write actions with “Connect to save”/“Connect to send”, but allow inert draft editing. Retry is a real request, not a timer pretending success. Reauth uses “Reconnect Gmail”; cancel returns to cached state.

| Screen ID | Top-to-bottom layout | Actions and exact results |
|---|---|---|
| H1 Agents | AI Hub title, AI on/off, Agents/Review/Activity, brief “Your context. Your call.”, connected cards, project-scoped mode summary, Add assistant | Card → H4; Add → verified adapter list/manual export; AI toggle applies immediately, admin off locked with “Turned off by admin”. |
| H2 Review | “Save what we decided”, project picker, Decided/Mentioned, proposals, generic email count | Edit → H6; Save decision → receipt; Move to Mentioned changes provisional classification; Keep as note → exploration note. |
| H3 Activity | filter All/Actions/Reads/Drafts, dated receipts, constraint suggestions | Receipt → H7; constraint suggestion → H6 old/new; provisional Email event opens Email without preview text. |
| H4 Agent detail | Name/status, selected project, modes, compact current grants, Share context, Revoke access | Mode change exposes exact ceiling; Share → H5; Revoke immediate server revoke and status, no nested settings. |
| H5 Context preview | purpose, project, permitted records/fields, exclusions, expiry, disclosure caveat for export | Share selected context generates package/read receipt; insufficient scope → named expansion request; Cancel shares nothing. |
| H6 Decision detail | statement, rationale, alternatives, constraints, dependencies, source, history | Save, Replace or Withdraw as distinct effect labels; stale version shows “This decision changed. Review the latest version.” |
| H7 Receipt detail | exact verb, status, actor, time, scope, diff, evidence, Undo if eligible | Open destination resolves live item; missing destination shows “Item removed”; Copy receipt excludes private credentials. |
| M1 Inbox | Email title, account/freshness, search + compose, Inbox/Waiting, category chips, date headers, mail rows/cards | Row → M2; card action → receipt; Details → M3; Dismiss retains row; refresh retains scroll. |
| M2 Message | Back, sender/recipient details, subject, time, sanitized body, attachments, capture, Reply/Reply all, Open in Gmail, More | Capture → type chooser then M3; Reply → M5; open deleted source shows retained excerpt clearly labeled. |
| M3 Candidate | type/tinted header, exact destination, field editor, evidence quote, one primary action | Missing fields disables action and identifies field; Save changes edits candidate only; final Save bill etc commits directly. |
| M4 Waiting | Open/Resolved, title, person, age, follow-up date if set, evidence, Resolve, Draft follow-up | Resolve in place + Reopen; new incoming reply only offers “Review reply”, never resolves automatically. |
| M5 Composer | account, recipients, Cc/Bcc disclosure, subject, body, attachment list, save status, Review send | Close autosaves inert draft; discard requires distinct Discard draft action with undo while unchanged; Review → M6. |
| M6 Send review | exact sender/account, all recipients, subject, full body, attachments, Edit, Send this message | Edit returns preserving draft; Send dispatches once; unknown → M7; success → Email receipt + Sent entry. |
| M7 Send outcome | Sent / Not sent / Send status unknown, exact recipients, explanation, Open in Gmail | No resend while unknown; failed-before-dispatch offers Review and try again requiring new tap. |
| M8 Search | search field, account/category scopes, chronological results, query status | Empty “No matching mail”; loading “Searching Gmail…”; offline “Searching saved mail only”. |
| M9 Accounts | accounts with last successful sync, Add Gmail, reconnect/disconnect | OAuth denied leaves original state; disconnect informs cache/approved-record retention; no removal of destination records. |
| T1 Today slice | existing Today layout, “N email items to review”, committed due items, Open Email | Review entry opens M1 filtered to candidates; detail opens owning module. No proposed titles outside Email. |

Empty copy: Agents “No assistant connected. JARVIS still works.”; Review “Nothing waiting for your decision.”; Activity “Your actions will appear here.”; Inbox “You're caught up. No mail in this inbox.”; Waiting “Nothing you're waiting on. Track a request from any email.”; Drafts “No saved drafts.”; Sent “No messages sent from JARVIS yet.” A disconnected mailbox is not an empty inbox.

## 10. Card catalog and deterministic extraction
All examples are fixtures. A card proposes one effect, not one message. Multiple independent effects can appear under a message but never combine into an unreviewed bundle. At most two shown initially, “1 more suggestion” expands the remaining cards without hiding the mail row. Each card has type, source evidence, destination and dismiss/details controls. Ambiguous fields show Needs details; no primary commit until required fields valid. No probabilistic confidence percentage.

| Type | Required fields / trigger | Primary label and receipt | Examples |
|---|---|---|---|
| Bill | issuer, amount_minor >= 0, currency, due_date or user-selected No due date; explicit bill/invoice amount due and supported sender template | Save bill → Saved $142.30 bill to Money | Con Edison $142.30 due Oct 15; facility invoice $750 due Nov 1; tournament balance $1,200 due May 15 |
| Receipt | merchant, paid amount_minor, currency, purchase_date, explicit paid/receipt status | Save receipt → Saved $284.10 receipt to Money | Delta $284.10 Oct 2; team hotel $620 Sep 30; equipment $87.45 Oct 1 |
| Task | actionable title, destination Tasks, due_date optional explicitly None | Add task → Added transcript review to Tasks | Review Peña transcript Oct 9; submit scholarship roster Oct 12; confirm practice headcount with no deadline |
| Event | title, start/end or all_day dates, IANA zone for timed events, location optional; explicit dated appointment/ICS or manual entry | Add to schedule → Added deposit call to Schedule | Rodriguez callback Oct 4 10:00–10:15 America/New_York; advisor meeting Oct 8 18:00–19:00; practice Oct 10 14:00–16:00 |
| Waiting | title, waiting_for, counterparty display, source; explicit manual Track selection or supported request template | Track this → Tracked Peña transcript | Coach Miller transcript; hotel rooming list; signed scholarship agreement |

No automatic contact-fact card v1. Flight itinerary is an event candidate; flight receipt is a separate Money candidate. Saving either does not save the other. No payment action, bank transfer or “mark paid” derived from a bill. A past-due bill remains a Money bill, never a task. A bill's date must not generate an event or task via a generic deadline rule. A separate unrelated requested action in the same mail may generate a task only with its own explicit evidence.

### 10.1 Pipeline
1. User opens Email; fetch page of 30 mail rows via existing sync. Process only those surfaced messages using approved deterministic templates, once per account/message/source_hash/extractor_version. Alternatively user selects a message and taps Find useful details. Do not scan a full mailbox in a worker.
2. Normalize decoded text and attachment metadata; retain raw hash and offsets. Strip quoted history/signatures from extraction, but retain them in message view. Do not load remote resources. Template match requires supported structure and sender/account criteria; sender branding alone is insufficient. If provider supplies auth results use as evidence, never treat From alone as trustworthy payment instructions.
3. Structured ICS parser: accept DTSTART/DTEND/timezone, UID and recurrence metadata. Recurrences produce Needs details with “Recurring event: open Gmail to review”; do not flatten silently. Calendar invites are suggestions, not RSVP or guaranteed event writes.
4. Financial templates require explicit currency and total semantics; parse localized decimal separators only when locale unambiguous. `$` with unknown currency → Needs details. `1,234` ambiguous locale → manual. Amount stores minor units, respects currency scale; no float rounding. Refund is Money receipt with transaction_type refund and signed semantics via Money adapter; never negative bill guessing. Unknown template falls back to Capture manually, not heuristic authoritative output.
5. Task/waiting text can be highlighted and captured manually. Deterministic task template only when an explicit request and clear title exist; a casual mention does not create a card. Waiting auto-template only for explicit request to another person, never incoming request directed at Dave by default.
6. Relative dates anchored to the source message timestamp and explicit source timezone. If “tomorrow” timezone missing or forward makes original date uncertain, require date picker. Date-only deadlines remain date-only. Ambiguous DST time requires user choose exact offset; nonexistent time blocks save. Never silently pick AM/PM or timezone.
7. Candidate dedupe fingerprint from account + message + kind + normalized semantic fields; re-extraction same hash reuses record. Cross-message financial potential duplicate uses issuer/amount/currency/date/invoice ID and shows conflict “This may already be saved”; no merge without tap. Distinct receipts with same amount remain distinct unless evidence supports identity.
8. Validate field-level evidence; generate proposed or needs_details candidate; preserve missing fields. User edited values tagged user_entered rather than attributed to email. Explicit agent suggestions pass same schema and routing, with Agent suggestion badge and no authority advantage.

### 10.2 Source mutations
New message in same thread is a different source; previously shown card does not change by thread ID alone. If provider source content/hash changes, invalidate candidate revision, show “Email changed. Review these details.” For confirmed records, create an Email-local update candidate with old/new and expected destination revision, never overwrite. A cancellation email offers an explicit Schedule update only if exact event identity matches; no fuzzy auto-cancel. Deleted source after save preserves the minimal saved evidence excerpt and receipt and says “Original email unavailable”. Deleted source before save blocks provider-derived approval; user may recapture edited facts manually with source marked unavailable. Provider disconnect leaves committed records useful.

## 11. Email operations and synchronization
Gmail adapter interface: listInbox(cursor, account), getMessage(id), search(query,cursor), modifyLabels(expectedState), sendExact(approvedCommand), getAttachments, getThreadLink(capability). Reuse existing provider backend. Server owns OAuth refresh and scopes. Request least necessary scopes; reconnect explains the new requested operation. No provider tokens are exposed in agent context. Throttling honors provider backoff, caps transport retry at 3 for safe reads, and preserves last good cache. Gmail history cursor expiry triggers supported full resync of configured cache window; this is transport sync, not extraction. Never silently claim entire account was searched if only a window was fetched.

Sort by Gmail internal receipt date, stable ID tiebreaker. Inbox message-level rows, thread detail groups related mail only after opening. Combined account identity appears on each card's detail and send review. Pagination never hides mail by category automatically. Read/unread follows provider authority after sync; optimistic UI command carries desired state and revision. New remote state during pending command reconciles latest provider result, shows “Read status updated in Gmail” if conflicting. Archive removes INBOX only after explicit tap, trash uses reversible provider label; both produce receipts. Trash and archive are not allowed remembered policies. No permanent delete endpoint v1.

Search sends literal user text via provider adapter safely, supports current account or All accounts. No natural-language AI search. Show provenance Saved mail vs Gmail and coverage; failures preserve cached hits but label incomplete. Search results chronological; selecting result opens exact source and back restores query. Attachment filenames sanitized, size limits enforced server side. v1 attachment upload cap 20MB total raw bytes; if provider cap is lower use lower cap and tell user. Download and sanitized preview require ownership; do not render executable attachment content. Forward, rich formatting and complex attachment editing use Gmail fallback. Plain-text compose/reply/reply-all plus attachments ship because reading/capturing without replying would force ordinary work out of the app.

Draft text autosaves locally after 500ms inactivity and on blur; server sync after 1 second debounce online. Show Saved on this device vs Saved. Do not put sensitive mail in general service-worker static cache. User-scoped encrypted/appropriately protected local store must clear on sign out/account removal; never allow another account to reuse it. Browser local protection is not end-to-end secrecy; do not market it as such. Conflict between device revisions opens Keep this draft / Use newer draft with both versions visible; no silent last-write-wins loss. No provider-side draft sync v1 unless existing verified integration supplies it; label JARVIS drafts. Refresh or navigation never loses the latest local draft. Attachments show upload status; send review disabled until every attachment is ready.

## 12. Today and Waiting contracts
Today email contribution max 5 rows including the generic review entry; aim for 3–5 when enough real records exist, never pad. Reuse existing Today ordering by actual due time/priority; for ties due date then creation ID. Eligible: committed email-origin tasks due today/overdue, events today, and open waiting items with follow_up_on today/overdue; show Money bills only through the existing Money Today renderer if it supports them, never as Tasks. Deduplicate by destination item ID across modules. Generic entry counts actionable proposed/needs_details candidates for connected/cached available sources; exclude dismissed/saved/stale until re-review becomes actionable. Count per action candidate, not message. Label “4 email items to review”. If no candidates omit entry. Tomorrow callback must not displace a today task.

Waiting ages use user's local dates; no red urgency without a chosen follow-up date. Resolve means user confirms received/no longer waiting; optional resolution note via detail, no mandatory modal. Incoming reply creates a visible “New reply” affordance, not automatic closure. Draft follow-up must show actual address from selected source; ambiguous/no recipient requires selection, never guessed name-to-address resolution. Follow-up date is local tracker metadata, not a hidden task/event. Notifications off by default and out of v1 Email scope; existing user notifications for explicitly saved destination items follow their module settings.

## 13. Failure and edge-case matrix
| Case | Required result |
|---|---|
| Double tap / two devices | unique logical action, one destination, return same receipt |
| Local save timeout after commit | poll action by idempotency key, return committed result; no second item |
| Provider send timeout | unknown state, blocked resend, reconciliation only; never success toast |
| Source changes between review and tap | 409 with old/new; no write; user reviews fresh candidate |
| Destination edited before update or Undo | 409; preserve edit; open current destination |
| Destination module unavailable | candidate stays proposed; “Money isn't ready. Your bill is still here.”; no fallback Task |
| Duplicate bill in different email | compare invoice identity, show existing destination and Keep separate/Link existing; explicit approval |
| Two different cards in one mail | independent IDs, approvals and receipts; approving one leaves other pending |
| Expired deadline | “This date has passed”; keep date, user can save knowingly; never move to today automatically |
| Timezone changed on device | store original IANA zone/instant; display user zone plus event zone; date-only unchanged |
| Malicious HTML/prompt injection | sanitized inert display; no context expansion, execution or remote resource fetch |
| Credential revoked mid-read | final server epoch check denies before disclosure; earlier disclosure remains logged |
| Credential revoked after dispatch | no claim of reversal; finish reconciliation without new agent authority |
| AI off | all user/rule workflows pass, agent gateway 403; no paywall/blank screens |
| Admin AI disabled | switch locked “Turned off by admin”; manual app intact |
| OAuth cancelled / denied | cached inbox intact, no fake connected state, retry available |
| Missing Gmail deep link support | “Open Gmail” not “Open this email”; source identifiers available to copy |
| Large/unsupported attachment | metadata visible, clear limit, authorized download/provider fallback |
| Long mail / Unicode / RTL | wrap without overflow, Unicode preserved, neutralize bidi spoofing in address review display |
| New incoming reply | badge/evidence link; waiting remains open until Resolve |
| Decision dependent constraint changes | suggestion + needs-review status, no silent rewrite or propagation |
| Decision withdrawal | retain history; dependencies flagged; no deletion of related tasks |
| Import schema failure | “This file isn't a supported JARVIS context response”; no partial commit |
| Export scope too large | offer narrow selection, no hidden truncation or blanket grant |
| Account A draft sent from B | editing account invalidates hash and requires new exact approval |
| Offline approval tap | no execution queue; “Connect to save”; fields retained for later review |
| Sensitive session signout | clear user local cache, abort pending reads, preserve server receipts |
| Rate limit | bounded safe read retries, Retry-after UI, no send retries without proof |
| Search no matches vs transport failure | distinct copy; failure never renders “No matching mail” |
| Stale local category rule | only local tag, safe re-evaluation; user can Undo tag or Forget preference |
| Partial external outcome | never combined vague success count; individual receipt states and exact verbs |

## 14. Backend API and destination integration
User API commands (logical names, adapt route conventions): getHub, setMode, grantScope, revokeAgent, toggleAI, previewContext, exportContext, importProposals, saveDecision, replaceDecision, withdrawDecision, keepExploration, approveCandidate, editCandidate, dismissCandidate, resolveWaiting, reopenWaiting, saveDraft, reviewSend, sendApproved, getAction, undoAction, setCategory, acceptCategoryPreference. All mutations accept client_request_id and expected_revision where mutable. CSRF/session protection follows repository auth; agent tokens cannot call user endpoints. Reject requests with missing/foreign resource before details are returned.

Destination adapter contract:
`prepare(input, evidence, expectedRevision?) -> {normalizedPayload, destinationKind, displaySummary, payloadHash, moduleVersion}`
`commit(tx, normalizedPayload, evidence, actionId) -> {itemId, revision, exactEffect}`
`canUndo(itemId, revision) -> {eligible, reason}`
Prepare is side-effect-free. Commit participates in the same database transaction for local writes. If existing module APIs cannot participate, add an idempotent reservation/outbox with pending UI and confirmation only after target ack; never show saved before actual target exists. Do not use HTTP calls inside a database transaction. Match Money's existing amounts, transaction types and categories; map bill versus receipt explicitly; assert kind at both adapter and DB validation layers.

Money module is concurrently in flight. First implementation slice inventories its branch/contracts, creates one shared adapter contract document and contract tests, and marks module readiness via runtime capability. Neither builder edits the other's schema without integrating its current changes. If target isn't ready, continue all substrate/inbox/preview work; retain candidates, disable affected Save only, and report the integration gate precisely. No fake success and no new shadow Money table. Final release requires Money/Tasks/Schedule end-to-end integration tests with real module writers.

## 15. Acceptance matrix for substrate and system
| ID | Given / when | Then / evidence |
|---|---|---|
| S01 | AI off, user opens all surfaces | manual decisions, exports, captures, compose and waiting work; no model/network inference |
| S02 | read-only agent submits draft or proposal | 403; no stored payload or destination; safe denied receipt |
| S03 | Help me proposes project decision | proposal only; active-decision query unchanged until Save |
| S04 | Just handle it sends/creates bill | denied without user-bound command; mode cannot bypass Email ceiling |
| S05 | project-scoped agent requests another project/Health | 403/no unauthorized titles/counts; no scope expansion |
| S06 | permitted context read | only manifest fields, read receipt before release, cap/expiry enforced |
| S07 | connection revoked with queued call | epoch invalidation blocks disclosure/dispatch; post-dispatch limitation honestly shown |
| S08 | two users enumerate identifiers | no cross-user reads/writes through tables, views, RPC or attachments |
| S09 | third category tap occurs | suggestion only; Remember creates exact local rule, Not now does nothing |
| S10 | rule applied to 41 updates | all 41 rows remain in All; receipt “Grouped 41 updates by category” |
| S11 | Mentioned item is kept | exploration_note not active decision; user can explicitly promote later |
| S12 | decision replaced/withdrawn | immutable history and reason, dependency suggestions, no silent downstream edits |
| S13 | assistant reports outside action | reported_external, never verified; no execution side effects |
| S14 | local commit fails mid-transaction | no orphan item/confirmed receipt; retry under same logical key safe |
| S15 | same candidate committed concurrently | one item, one logical confirmed action, all callers same result |
| S16 | candidate unapproved | absent from all life module queries/context/Today payload; generic count only |
| S17 | body/recipient/account edited after review | old approval rejected; draft retained; new review required |
| S18 | send transport timeout | unknown receipt, no automatic resend; reconciliation evidence required |
| S19 | purge receipt/content | no private payload in retention/search/export; action not undone; minimal tombstone only |
| S20 | unverified AI provider | unavailable/manual route; no misleading connected badge or fabricated OAuth |
| S21 | malformed agent/tool text includes execute=true | schema rejection, no privilege gain or hidden action |
| S22 | package expired or source revision stale | new user-approved package/review required; no stale writes |
| S23 | scope permission revocation while browser offline | server enforcement works independently; UI refresh corrects cached status |
| S24 | provider account disconnects | token unavailable to agents, cached state labeled, approved items retained |

Every E01–E30 row in section 08 is a release test. Test each screen in section 09 in normal, empty, loading, error and offline modes; also account reauth and master AI disabled. Pairwise minimum: offline+draft, offline+candidate, revoked+context, stale+save, unknown+send, missing-module+bill, empty+search, new-reply+waiting, large-text+sheet, two-users+all RPCs. Use fake provider for deterministic failures, test Gmail in a controlled account only with exact message authorization.

## 16. Scope boundaries and honest fallbacks
In v1: manual context export/import, verified gateway, all three Hub tabs, versioned decisions, full receipts, deterministic Email capture, Gmail inbox/search/plain compose/replies/attachments, waiting, exact send review, Today contribution.
Out of v1: autonomous external actions; scheduled AI/background mailbox analysis; paid in-app brain and pricing; cross-AI chat history sharing; provider-native AI ranking; hidden smart inbox; automatic bills/tasks/events; bulk send; scheduled send; automatic forwarding; complex Gmail filters/labels administration; mail delegation; advanced rich-text signatures; full offline provider operations; recurring event import; inferred contact facts; payments. Fallback for advanced mail is Open in Gmail, for ambiguous extraction Capture manually, for unavailable AI Export selected context, for unavailable target Keep in Email. No unavailable feature is represented as successful.

## 17. Build and release gates
Implement sequenced prompts in order. Each slice runs relevant tests plus typecheck, lint and production build using repository-discovered commands. No inventing successful outputs. Small vertical slices behind flags: substrate_v1, email_intake_v1, verified_agent_adapters. Existing Email remains available until cutover passes. Migrations additive and backward-compatible; no destructive production reset. Run schema and RLS tests on a local/staging database, migration rollback/forward rehearsal and key leakage inspection. Before merging integrate current main and concurrent Money changes, resolve conflicts preserving contracts. Deploy with repository's existing pipeline only when that session has authorization; otherwise prepare exact commit/PR and report deployment gate. Never bypass branch protection, checks or required deployment approval. Verify live route and deployed commit, smoke-test with non-sensitive fixtures, no unapproved real email sends. Rollback via feature flag and known good deployment; do not delete confirmed user records. Record live verification evidence or plainly say blocked/unverified.

Performance targets to measure, not promises: cached screen interactive under 300ms on reference iPhone; input feedback under 100ms; 500-row cache scroll free of repeated full-list rerenders; body/attachment lazy load; safe transport retries bounded. Security test suite includes cross-owner RLS, agent scope narrowing, approval replay/hash mismatch, source-change races, injection attempts and no AI network calls with AI off. Accessibility checks supplement automation with keyboard and phone screen reader review.

## 18. Source and verification notes
Inputs: AI-Integration-Concept-Draft.md and jarvis-email-chatgpt-build-spec-prompt.md, plus Dave's unified request. Authoritative implementation references checked October 3, 2026: https://supabase.com/docs/guides/database/postgres/row-level-security ; https://developers.google.com/workspace/gmail/api/guides/sending ; https://developers.google.com/workspace/gmail/api/guides/sync . These support RLS/grants, MIME send and provider sync behavior, respectively; they do not certify a specific repository or connector. Builder must check current docs and installed versions before using APIs. The Supabase changelog markdown endpoint could not be retrieved by the browsing tool; verify relevant changelog entries during implementation. Product constraints and schemas in this package are design decisions, not claims of existing third-party capabilities.
