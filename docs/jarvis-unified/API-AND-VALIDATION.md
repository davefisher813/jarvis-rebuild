# API and validation supplement
Normative supplement to IMPLEMENTATION-SPEC.md sections 03–07 and 14. CONTRACTS.ts defines data transfer types, not runtime security validation. Runtime validation must reject unknown properties and enforce all constraints here.

## Endpoint envelope
Authenticated user mutations accept JSON and a request ID. Never trust owner_id, actor_kind, approval state or verified capability from the body. Derive from session or validated agent credential. Successful command returns `{action_id,state,destination_id,receipt_id,safe_message}`. Use 202 for still-running external actions, 200 for idempotent replay, 201 for newly committed local effect. Denied mutation has no item side effect; safe audit entry may be appended. Client never treats HTTP 202 as confirmed.

| User operation | Required input beyond request ID | Valid response |
|---|---|---|
| editCandidate | candidate_id, expected_revision, editable typed fields | candidate with new revision/hash and per-field user provenance |
| approveCandidate | candidate_id, expected_revision, shown_payload_hash, idempotency_key | ActionResult; stale 409 includes only owned old/new values |
| dismissCandidate | candidate_id, expected_revision | dismissed status; source row unchanged |
| saveDecision | project_id, statement, rationale, alternatives, constraints, dependency refs, evidence IDs | item ID, version 1, receipt |
| replaceDecision | current_version_id, expected_revision, new DecisionPayload | new version + old superseded atomically |
| withdrawDecision | current_version_id, expected_revision, reason | withdrawn event + retained history |
| keepExploration | project_id, text, evidence IDs | exploration_note item ID; no active-decision membership |
| resolveWaiting/reopenWaiting | item_id, expected_revision, optional note | new revision + receipt |
| saveDraft | draft_id nullable, expected_revision nullable, ExactSend content without hash/review nonce | draft ID/revision/saved_at; never send |
| reviewSend | draft_id, expected_revision | immutable SendReview snapshot with full fields |
| sendApproved | review_nonce, shown_payload_hash, idempotency_key | ActionResult; nonce can only bind one logical action |
| undoAction | original_action_id, expected_destination_revision | compensation receipt or 409; no deletion of edited destination |
| grantScope | preview_manifest_hash, job_id, duration | grant ID/revision/expiry; only exact preview accepted |
| setMode | connection_id, expected_revision, mode | effective capability summary; no silent new grant |
| revokeAgent | connection_id | revoked status/current auth_epoch; idempotent |
| acceptCategoryPreference | suggestion_id, expected_revision | exact local rule, owner-visible receipt |

GET reads use keyset pagination and authorized projections. Request limits: 64KB JSON commands, context payload max 32KB, proposal text 16KB, candidate text field max 2,000 chars, decision statement 500 chars, rationale 4,000 chars, maximum 20 dependencies, 20 evidence refs, 20 recipients per message and 20MB total raw attachment bytes. These are product limits, not provider maximum claims. Display limits before submission. Long mail view is lazy-loaded without truncating evidence silently. Import JSON max 256KB with explicit file validation error; imported records still individually scoped and bounded.

## Canonical hashes
Server canonicalizes using a single documented implementation: UTF-8, Unicode NFC, sorted object keys, arrays preserve meaningful order, addresses normalized by parsing and lowercasing domain only, normalized line endings CRLF for MIME generation. Never silently rewrite the displayed body after approval. Hash SHA-256 over canonical exact effect inputs plus schema version. Financial minor-unit integers must be safe integers; no exponent/NaN/Infinity. Currency must have supported scale from the existing Money module. A normalized change that affects visible content must appear in review before hash is approved.

For send, canonical snapshot includes every recipient, including Bcc; account/From identity; exact subject/body; attachment byte hashes and filenames; reply headers and draft revision. Server re-derives at dispatch; mismatch is 409 REVIEW_CHANGED. Review nonce expires in five minutes. Idempotency key is server-associated owner + action kind + candidate/draft version; client random request keys alone do not protect against cross-device double submission. A duplicate key with a different hash is 409 IDEMPOTENCY_CONFLICT. Sending the same content intentionally again requires a new draft/version and a new explicit review after confirmed outcome; unknown attempts cannot be cloned as a resend shortcut.

## Validation by payload
- Bill: nonempty issuer; integer amount >= 0; ISO currency; date or explicit no_due_date_confirmed; destination adapter restricted to Money bill kind. Never permit a caller to override destination kind to task.
- Receipt: nonempty merchant; amount >= 0; currency and purchase date; purchase/refund enum. Money adapter decides its internal sign convention; capture amount never guesses sign.
- Task: nonempty title; optional date; due-date absence displayed “No deadline”. Reject generic financial deadline capture as task when linked evidence is a bill-only obligation.
- Event: either all-day start/end-exclusive dates or timed instants/end/timezone/selected offset. End > start. Date-only one-day events use next date exclusive. Unrecognized zone, DST nonexistent local time or ambiguous local time without selected offset blocks approval. Detect overlap only as warning, not authority to move existing events.
- Waiting: nonempty title, waiting_for and counterparty display. Contact link optional and owner validated. Missing address is fine for tracking; draft follow-up requires explicit valid address selection.
- Decision: nonempty statement/rationale; dependencies within authorized owner/project scope; detect directed depends_on cycle in transaction. Conflicting active decision cannot be silently overwritten by an upsert.
- Send: at least one valid recipient; validate all To/Cc/Bcc; no CR/LF header injection; verified From identity belongs to account; each attachment ready/owned/hash-matched; show empty subject/body warnings in review rather than auto-generating text. Reply-all excludes own aliases and uses actual source headers only.

## Error vocabulary and recovery
| Code | Copy | Recovery |
|---|---|---|
| AUTH_REQUIRED | Sign in to continue. | preserve inert draft, reauthenticate |
| AI_DISABLED | AI is off. Your manual tools still work. | user tools stay available |
| ADMIN_AI_DISABLED | Turned off by admin. | no misleading enabled switch |
| SCOPE_DENIED | This context wasn’t shared with this assistant. | user-owned named scope preview only |
| CONNECTION_REVOKED | Access was revoked. | no token auto-refresh that restores grant |
| PACKAGE_EXPIRED | This shared context expired. | create a new approved package |
| SOURCE_CHANGED | Email changed. Review these details. | show fresh owned source diff |
| DESTINATION_CHANGED | This item changed. Open it to review. | no overwrite/Undo until reconciled |
| MODULE_UNAVAILABLE | Money isn’t ready. Your bill is still here. | retain candidate; retry when ready |
| MISSING_DETAILS | Add the highlighted details before saving. | focus first invalid field |
| REVIEW_CHANGED | Message changed. Review it again. | discard old approval, keep draft |
| OUTCOME_UNKNOWN | Send status unknown. Check Gmail before trying again. | reconciliation, no resend |
| OFFLINE | Connect to save. Your details are still here. | no deferred execution |
| RATE_LIMITED | Gmail needs a moment. Try again shortly. | bounded safe reads honoring retry-after |
| PROVIDER_AUTH | Reconnect Gmail to continue. | cached read mode, fresh OAuth |
| STORAGE_LIMIT | This attachment exceeds the 20 MB message limit. | remove attachment or open Gmail |
| IMPORT_INVALID | This file isn’t a supported JARVIS context response. | reject entire import, no partial commits |

## Context taint and project isolation
Imported/agent statements carry origin untrusted_suggestion. The server never accepts textual claims of approval or an “approved_by” supplied by an agent. Context snapshots contain only authorized committed records; provisional Email payload is excluded from project context even if linked to the project, unless explicitly opened within an authorized Email job. This exception allows user-invoked Email assistance, not background scanning or global exposure. An Email job is a selected message/thread with explicit field grant, and its proposals stay in Email. Project context may link to approved email-derived evidence excerpt if that excerpt is explicitly within manifest fields.

## Race handling
Candidate save locks candidate, logical action and target identity; source revision check occurs in the same transaction. For provider-sourced changes, compare latest known provider snapshot and freshness; if source cannot be refreshed, show that fact and block provider-derived approval unless the user recaptures manually. Token revocation locks/increments connection epoch; dispatch verifies epoch under claim fence before outbound request. After dispatch, revocation cannot retract the provider request. For records copied outside JARVIS no technical recall is possible; express that honestly.

## Minimum observability
Capture correlation ID, action kind/state, latency bucket, adapter version, safe error code and owner pseudonymous identifier. Do not log exact body, amount, addresses, attachment bytes, raw prompt or secret. Metrics distinguish candidates proposed, records saved, drafts saved, sends provider-accepted and sends unknown; never combine as handled. No user-data analytics training pipeline is introduced by this build.
