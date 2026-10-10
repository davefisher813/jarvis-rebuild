# Permissions

Who may read and write each table and run each function, and under which role. Written 2026-10-10
(Phase 0, design D7). Every row below is read from a local Postgres after `0001` to `0062` were applied
over `tests/stub_supabase.sql` (which mirrors Supabase's default privileges), not from memory: tables
from `pg_class` and `has_table_privilege`, policies from `pg_policies`, guards from `pg_trigger`,
functions from `pg_proc` with `has_function_privilege` and `proconfig`, account deletion from the body
of `delete_owned`. The proof is `jarvis-core/supabase/tests/posture.sh` (22 checks); the migration that
closed the last open tables is `jarvis-core/supabase/migrations/0062_private_by_default.sql`. When a
migration changes a grant, a policy or a function, this page is regenerated from the same queries.

The one sentence: **a person reaches their own rows and nothing else; the server reaches everything;
an app proposes and never commits; nothing is shared.**

## The three request roles

| role | who holds it | `auth.uid()` | row level security | default grant on a new public table |
|---|---|---|---|---|
| `anon` | a request with the anon key and no session | null | applies; every owner policy reads `owner_id = auth.uid()`, so anon matches no row | Supabase grants all four verbs (the stub mirrors this); a table is closed only by an explicit revoke |
| `authenticated` | a request carrying a person's Supabase JWT | the person | applies; a policy names exactly what the person may do to their own rows | the same |
| `service_role` | the server's key: `api/` routes, the gateway, cron, the account delete | null (`auth.role()` reads `service_role`) | bypassed (`bypassrls`) | the same, and it is the role every grant below is kept for |

Two more words appear in the tables. `PUBLIC` is the pseudo role every role is a member of; a function
Postgres creates is executable by PUBLIC until revoked, which is why every function the substrate makes
carries `revoke all on function f(args) from public`. The **operator** is `postgres` in the SQL editor or
`psql`: not a request role, no JWT, every privilege; a row it writes is recorded with origin `operator`.

Inside a `security definer` function the database role is the function's owner, so `jarvis_is_server()`
(0044) is true for every caller there; a function that must know the request's own role reads
`jarvis_is_service_request()` (the JWT claim, which no definer context changes). Both helpers are
executable by every role on purpose: policies call them.

## The four origins and the one GUC

`item_change.origin` (0060) is derived by the database inside the `item_memory` trigger, never declared
by a caller:

| origin | when | `via` |
|---|---|---|
| `user` | the request role is `anon` or `authenticated` and no `security definer` PL/pgSQL frame is on the call stack (the two patch functions are invokers) | null |
| `function` | a `security definer` PL/pgSQL frame is on the stack | the innermost such function's name: the door that wrote the row (`capture_approve`, `record_approve`, `decision_save`, ...) |
| `server` | the request role is `service_role` | null |
| `operator` | anything else: the SQL editor, `psql`, a migration's own statements | null |

The one GUC is `jarvis.client_at`. `item_apply_patch` and `item_apply_patch_if_older` set it with
`set_config(..., true)` (transaction local) from their `p_client_at`; `jarvis_item_memory` reads it as the
capture moment of an update or a delete, falling back to `now()`. It carries a time and nothing else:
no authorization reads it, and a caller who sets it changes only the `client_at` recorded on their own
row. No other setting is read by any function in public.

## What an external app may do

An app (the agent backend's inbox today; Bridge and Tucci reserved; the closed list is `jarvis_vyzn_apps()`)
is an `agent_connection` row the server mints with `vyzn_app_connect`, `propose` verified, mode Help Me.
The full contract is `VYZN-SYNC-CONTRACT.md`; the permissions are:

| the app may | through | as | the app may not |
|---|---|---|---|
| hand JARVIS records | `POST /api/agent` method `record.push`, then `record_push` | service request only, after the gateway verified the app's token | call `record_push` with a browser role (revoked), reach `proposal` or `item` directly, or push through a connection that is Read Only, revoked, or not an app |
| have its records pulled | `POST /api/push?inbox=pull`, then `records_import` | the person (`authenticated`), owner from `auth.uid()` | choose the owner |
| see a proposal become an item | `record_approve`, on the person's tap | the person | approve, dismiss, undo or edit anything; write `item`; overwrite a row the person owns (a newer revision of a saved record is refused with `DESTINATION_CHANGED`) |

Mode words for an app: **Read Only pauses** pushes (`record_push` answers `SCOPE_DENIED`); **Help Me accepts**
pushes (the mode `vyzn_app_connect` mints); **Just Handle It is refused** (`connection_set_mode` answers
`SCOPE_DENIED`, `an app only proposes`). An app's proposals sit on `proposal.surface = 'app'` with no job,
which `hub_overview` never joins, so nothing an app sends is visible to a screen until Dave reads the inbox.
A backend item is consumed only after Dave accepts or dismisses it.

## No sharing

`docs/ARCHITECTURE.md:43`: row level security is per owner, on every table, with no exceptions and no
shared rows anywhere in the system. `docs/ARCHITECTURE.md:53`: today there is exactly one owner per row
and no sharing of any kind. The tables below show the shape that carries it: every owned table has one
owner column (`owner_id`, or `user_id` on the accounting and credential tables), every policy reads that
column against `auth.uid()`, no policy names a second person, no grant goes to any role but the three,
and every reference between owned rows is a composite `(id, owner_id)` foreign key (0044 rule 2), so a
row cannot point at another owner's row even when an id leaks. `client_error` has no owner column by
design and no browser verb; `entity_type` is the kind registry, readable by any signed in person and
written by migrations.

## Readiness

`substrate_readiness()` (authenticated and service_role) answers `phase0.private` true only when all
four of `email_opens`, `google_tokens`, `ai_tokens` and `feedback` exist and neither `anon` nor
`authenticated` holds any of select, insert, update or delete on any of them; `migration` reads `0062`.

## What is still open to a browser role by default grant, and why it is left

| object | grant left | what protects it | why 0062 left it |
|---|---|---|---|
| `ai_usage` | anon and authenticated hold all four verbs | RLS on with no policy: no row is visible or writable | outside the design's four (D7 names 0017, 0018, 0026, 0035); the same shape as the four and the next candidate for a revoke |
| `item`, `scalar_setting`, `event_log`, `entity_type` | anon holds the default grant | every policy reads `auth.uid()` (null for anon) or `auth.role() = 'authenticated'`, so anon matches no row | the app's own tables since 0001; a policy is their door, and the design rewrites no policy (section 10 item 17) |
| `get_subscription_tier()`, `get_user_settings()` | PUBLIC execute (0037's default) | each reads `scalar_setting` for `auth.uid()` only | 0037 was never applied live; 0062 sets their search_path when present and never creates them |
| 44 of the 47 policies | n/a | each calls `auth.uid()` per row (the live advisor's finding); `item_change_select` and `item_link_select` use `(select auth.uid())`, `entity_type_select` reads `auth.role()` | the 45 per row policies are not rewritten in Phase 0 (section 10 item 17) |

## Sequences and the private schema

| object | anon | authenticated | service_role | closed by |
|---|---|---|---|---|
| `ai_tokens_id_seq` | none | none | all | 0062 |
| `client_error_id_seq` | none | none | all | 0053 |
| schema `jarvis_private` (usage) | none | none | usage | 0044 |
| `jarvis_private.agent_credential`, `agent_rate`, `context_snapshot`, `email_credential` | none | none | all | 0044 to 0047; PostgREST does not expose the schema |

## The inventories

Columns: **owner column** is the column every policy and `delete_owned` key on. **anon**, **authenticated**
and **service_role** list the verbs `has_table_privilege` answers true for (a verb with RLS on and no
matching policy still reaches no row). **policies** are `pg_policies` rows with their condition; `own`
is `owner_id = auth.uid()`; a policy with role `public` applies to every request role, which is why
anon's grant on `item` yields nothing. **server only columns** are what a browser session cannot write
even where it holds a verb: a table it may only read, or the columns a `jarvis_protect_columns` trigger
freezes on update (0044 rule 3), or an append only trigger. **delete_owned** says whether account
deletion (`delete_owned(p_uid)`, service_role only) deletes the table's rows for the person; the four
`no` rows with an owner column are `email_opens` and `google_tokens` (they cascade from `auth.users`,
0017 and 0018) and `feedback` (a message to us; its `user_id` is set null by the cascade, 0035);
`client_error` and `entity_type` have no owner; `outbox_command` rows are deleted with their action by
foreign key.

### Public tables (34)

| table | owner column | RLS | anon | authenticated | service_role | policies (role public = any request role) | server only columns | delete_owned |
|---|---|---|---|---|---|---|---|---|
| `action` | owner_id | on | none | select | select, insert, update, delete | select: own | every column (browser reads only) | yes |
| `agent_connection` | owner_id | on | none | select, insert, update, delete | select, insert, update, delete | delete: (owner_id = auth.uid()) AND (status = 'manual')<br>insert: (owner_id = auth.uid()) AND (status = 'manual') AND (transport = 'manual') AND (verified_capabilities = '{}') AND (capability_verified_at IS NULL) AND (remote_subject IS NULL) AND (auth_epoch = 1) AND (revoked_at IS NULL) AND (last_used_at IS NULL)<br>select: own<br>update: own | frozen on update by trigger agent_connection_protect: owner_id, provider_key, status, transport, verified_capabilities, capability_verified_at, remote_subject, auth_epoch, last_used_at, revoked_at, schema_version | yes |
| `ai_budget` | user_id | on | none | none | select, insert, update, delete | none (RLS on, no policy: no row for any browser role) | every column (no browser verb) | yes |
| `ai_budget_reservation` | user_id | on | none | none | select, insert, update, delete | none (RLS on, no policy: no row for any browser role) | every column (no browser verb) | yes |
| `ai_tokens` | user_id | on | none | none | select, insert, update, delete | none (RLS on, no policy: no row for any browser role) | every column (no browser verb) | yes |
| `ai_usage` | user_id | on | select, insert, update, delete | select, insert, update, delete | select, insert, update, delete | none (RLS on, no policy: no row for any browser role) | none beyond the policy | yes |
| `approval` | owner_id | on | none | select | select, insert, update, delete | select: own | every column (browser reads only) | yes |
| `client_error` | none | on | none | none | select, insert, update, delete | none (RLS on, no policy: no row for any browser role) | every column (no browser verb) | no |
| `context_package` | owner_id | on | none | select | select, insert, update, delete | select: own | every column (browser reads only) | yes |
| `decision_dependency` | owner_id | on | none | select | select, insert, update, delete | select: own | every column (browser reads only) | yes |
| `decision_version` | owner_id | on | none | select | select, insert, update, delete | select: own | every column (browser reads only) | yes |
| `device_token` | user_id | on | none | none | select, insert, update, delete | none (RLS on, no policy: no row for any browser role) | every column (no browser verb) | yes |
| `email_account` | owner_id | on | none | select | select, insert, update, delete | select: own | every column (browser reads only) | yes |
| `email_candidate` | owner_id | on | none | select, insert, update, delete | select, insert, update, delete | delete: (owner_id = auth.uid()) AND (status <> 'saved')<br>insert: (owner_id = auth.uid()) AND (origin = 'manual') AND (agent_id IS NULL) AND (status = any(array['proposed', 'needs_details'])) AND (destination_id IS NULL) AND (proposal_id IS NULL) AND (action_id IS NULL)<br>select: own<br>update: (owner_id = auth.uid()) AND (status = any(array['proposed', 'needs_details', 'dismissed'])) with check (owner_id = auth.uid()) AND (status = any(array['proposed', 'needs_details', 'dismissed'])) AND (destination_id IS NULL) | destination derived by trigger email_candidate_destination<br>frozen on update by trigger email_candidate_protect: owner_id, account_id, message_id, kind, origin, agent_id, destination_id, proposal_id, action_id, schema_version | yes |
| `email_draft` | owner_id | on | none | select, insert, update, delete | select, insert, update, delete | delete: (owner_id = auth.uid()) AND (send_state = any(array['draft', 'failed']))<br>insert: (owner_id = auth.uid()) AND (send_state = 'draft') AND (sent_action_id IS NULL) AND (provider_message_id IS NULL)<br>select: own<br>update: (owner_id = auth.uid()) AND (send_state = 'draft') | frozen on update by trigger email_draft_protect: owner_id, send_state, sent_action_id, provider_message_id, schema_version | yes |
| `email_message` | owner_id | on | none | select | select, insert, update, delete | select: own | every column (browser reads only) | yes |
| `email_message_body` | owner_id | on | none | select | select, insert, update, delete | select: own | every column (browser reads only) | yes |
| `email_opens` | user_id | on | none | none | select, insert, update, delete | none (RLS on, no policy: no row for any browser role) | every column (no browser verb) | no |
| `entity_type` | none | on | select, insert, update, delete | select, insert, update, delete | select, insert, update, delete | select: (auth.role() = 'authenticated') | none beyond the policy | no |
| `event_log` | owner_id | on | select, insert, update, delete | select, insert, update, delete | select, insert, update, delete | delete to authenticated: own<br>insert to authenticated: own<br>select to authenticated: own | none beyond the policy | yes |
| `feedback` | user_id | on | none | none | select, insert, update, delete | none (RLS on, no policy: no row for any browser role) | every column (no browser verb) | no |
| `google_reconnect_attempt` | user_id | on | none | none | select, insert, update, delete | none (RLS on, no policy: no row for any browser role) | every column (no browser verb) | yes |
| `google_tokens` | user_id | on | none | none | select, insert, update, delete | none (RLS on, no policy: no row for any browser role) | every column (no browser verb) | no |
| `item` | owner_id | on | select, insert, update, delete | select, insert, update, delete | select, insert, update, delete | delete: own<br>insert: own<br>select: own<br>update: own | none beyond the policy | yes |
| `item_change` | owner_id | on | none | select | select, insert, update, delete | select: own, (select auth.uid()) | every column (browser reads only)<br>append only by trigger item_change_append_only (server erases, server deletes) | yes |
| `item_link` | owner_id | on | none | select | select, insert, update, delete | select: own, (select auth.uid()) | every column (browser reads only) | yes |
| `job` | owner_id | on | none | select, insert, update | select, insert, update, delete | insert: (owner_id = auth.uid()) AND (created_by = auth.uid())<br>select: own<br>update: own | frozen on update by trigger job_protect: owner_id, agent_id, project_id, resource_ids, created_by, scope_revision, schema_version | yes |
| `outbox_command` | owner_id | on | none | select | select, insert, update, delete | select: own | every column (browser reads only) | no |
| `policy_suggestion` | owner_id | on | none | select, insert, update, delete | select, insert, update, delete | delete: own<br>insert: (owner_id = auth.uid()) AND (status = 'suggested') AND (agent_id IS NULL)<br>select: own<br>update: own | none beyond the policy | yes |
| `proposal` | owner_id | on | none | select | select, insert, update, delete | select: own | every column (browser reads only) | yes |
| `receipt_event` | owner_id | on | none | select | select, insert, update, delete | select: own | every column (browser reads only)<br>append only by trigger receipt_event_append_only (server erases, server deletes) | yes |
| `scalar_setting` | owner_id | on | select, insert, update, delete | select, insert, update, delete | select, insert, update, delete | delete: own<br>insert: own<br>select: own<br>update: own | none beyond the policy | yes |
| `scope_grant` | owner_id | on | none | select | select, insert, update, delete | select: own | every column (browser reads only) | yes |
| `source_evidence` | owner_id | on | none | select, insert | select, insert, update, delete | insert: (owner_id = auth.uid()) AND (type = 'manual') AND (encrypted_snapshot_ref IS NULL)<br>select: own | every column after insert (browser inserts only) | yes |

### Public functions (146)

| function | kind | security | volatility | language | search_path | who may execute |
|---|---|---|---|---|---|---|
| `access_denied_record(p_owner uuid, p_connection uuid, p_method text, p_code text)` | function | definer | volatile | plpgsql | public | service_role |
| `action_status(p_owner uuid, p_connection uuid, p_action uuid)` | function | definer | stable | plpgsql | public | service_role |
| `action_undo(p_action uuid, p_expected_item_updated_at timestamptz, p_idempotency_key text)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `activity_feed(p_limit integer, p_before timestamptz, p_scope text)` | function | invoker | stable | plpgsql | public | authenticated, service_role |
| `agent_capabilities(p_owner uuid, p_connection uuid)` | function | definer | stable | plpgsql | public | service_role |
| `agent_connection_verify(p_owner uuid, p_connection uuid, p_token_hash text, p_capabilities text[], p_remote_subject text)` | function | definer | volatile | plpgsql | public | service_role |
| `agent_rate_take(p_connection uuid, p_cost integer)` | function | definer | volatile | plpgsql | public | service_role |
| `agent_resolve_token(p_token_hash text)` | function | definer | volatile | plpgsql | public | service_role |
| `ai_budget_mark_dispatched(p_user uuid, p_request_id text)` | function | definer | volatile | plpgsql | public | service_role |
| `ai_budget_reconcile_stale(p_older_than interval)` | function | definer | volatile | plpgsql | public | service_role |
| `ai_budget_release(p_user uuid, p_request_id text, p_zero_charge boolean)` | function | definer | volatile | plpgsql | public | service_role |
| `ai_budget_reserve(p_user uuid, p_request_id text, p_hash text, p_model text, p_price_version text, p_max_cost bigint)` | function | definer | volatile | plpgsql | public | service_role |
| `ai_budget_set_limit(p_user uuid, p_limit bigint, p_expected_version integer)` | function | definer | volatile | plpgsql | public | service_role |
| `ai_budget_settle(p_user uuid, p_request_id text, p_actual bigint)` | function | definer | volatile | plpgsql | public | service_role |
| `ai_budget_status(p_user uuid)` | function | definer | volatile | plpgsql | public | service_role |
| `ai_default_off()` | trigger | definer | volatile | plpgsql | '' (empty) | service_role |
| `ai_try_consume(p_user uuid, p_user_cap integer, p_global_cap integer, p_kind text)` | function | definer | volatile | plpgsql | public | service_role |
| `approvals_sweep()` | function | definer | volatile | plpgsql | public | service_role |
| `candidate_dismiss(p_candidate uuid, p_expected_revision integer)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `candidate_edit(p_candidate uuid, p_expected_revision integer, p_payload jsonb, p_user_fields text[], p_missing text[])` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `candidate_propose(p_message uuid, p_kind text, p_payload jsonb, p_provenance jsonb, p_missing text[], p_fingerprint text, p_extractor_version text, p_source_hash text, p_origin text)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `candidate_restore(p_candidate uuid, p_expected_revision integer)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `candidate_review_count()` | function | definer | stable | sql | public | authenticated, service_role |
| `candidates_for(p_messages uuid[], p_include_dismissed boolean)` | function | invoker | stable | sql | public | authenticated, service_role |
| `capture_approve(p_candidate uuid, p_expected_revision integer, p_shown_payload_hash text, p_idempotency_key text, p_prepared jsonb)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `command_approve(p_review_nonce text, p_shown_payload_hash text, p_idempotency_key text)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `command_cancel(p_action uuid)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `command_review(p_kind text, p_payload jsonb, p_provider_account uuid, p_verb text, p_expected_revision integer)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `connection_add_manual(p_display_name text)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `connection_revoke(p_connection uuid)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `connection_set_mode(p_connection uuid, p_expected_revision integer, p_mode text)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `context_issue(p_job uuid, p_manifest_hash text, p_resources uuid[], p_fields text[], p_purpose text, p_owner uuid, p_connection uuid)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `context_packages_sweep()` | function | definer | volatile | plpgsql | public | service_role |
| `context_preview(p_job uuid, p_resources uuid[], p_fields text[], p_purpose text, p_owner uuid, p_connection uuid)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `context_snapshot_store(p_owner uuid, p_package uuid, p_cipher text)` | function | definer | volatile | plpgsql | public | service_role |
| `decision_dependencies_check()` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `decision_history(p_item uuid)` | function | definer | stable | plpgsql | public | authenticated, service_role |
| `decision_save(p_project uuid, p_title text, p_statement text, p_rationale text, p_alternatives text[], p_constraints jsonb, p_dependencies jsonb, p_evidence uuid[], p_source jsonb, p_proposal uuid, p_expected_proposal_revision integer, p_replace_item uuid, p_client_request_id text)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `decision_withdraw(p_version uuid, p_expected_revision timestamptz, p_reason text, p_client_request_id text)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `delete_owned(p_uid uuid)` | function | definer | volatile | plpgsql | '' (empty) | service_role |
| `draft_discard(p_draft uuid)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `draft_get(p_draft uuid)` | function | definer | stable | plpgsql | public | authenticated, service_role |
| `draft_list()` | function | definer | stable | sql | public | authenticated, service_role |
| `draft_outcome(p_action uuid, p_state text, p_provider_message_id text)` | function | definer | volatile | plpgsql | public | service_role |
| `draft_save(p_draft uuid, p_account uuid, p_fields jsonb, p_expected_revision integer)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `draft_submit(p_owner uuid, p_connection uuid, p_package uuid, p_draft jsonb)` | function | definer | volatile | plpgsql | public | service_role |
| `email_account_health_record(p_owner uuid, p_address text, p_health jsonb)` | function | definer | volatile | plpgsql | public | service_role |
| `email_account_state(p_owner uuid, p_account uuid, p_state text, p_error text)` | function | definer | volatile | plpgsql | public | service_role |
| `email_account_upsert(p_owner uuid, p_address text, p_scopes text[], p_capabilities jsonb)` | function | definer | volatile | plpgsql | public | service_role |
| `email_accounts()` | function | invoker | stable | sql | public | authenticated, service_role |
| `email_action_record(p_owner uuid, p_message uuid, p_kind text, p_verb text, p_idempotency text, p_provider_ack jsonb)` | function | definer | volatile | plpgsql | public | service_role |
| `email_body_store(p_owner uuid, p_message uuid, p_text text, p_html text, p_attachments jsonb, p_headers jsonb)` | function | definer | volatile | plpgsql | public | service_role |
| `email_inbox(p_accounts uuid[], p_before timestamptz, p_before_id text, p_limit integer)` | function | invoker | stable | plpgsql | public | authenticated, service_role |
| `email_labels_set(p_owner uuid, p_message uuid, p_labels text[])` | function | definer | volatile | plpgsql | public | service_role |
| `email_message_read(p_message uuid)` | function | invoker | stable | plpgsql | public | authenticated, service_role |
| `email_search_cached(p_q text, p_accounts uuid[], p_limit integer)` | function | invoker | stable | plpgsql | public | authenticated, service_role |
| `email_sync_apply(p_owner uuid, p_account uuid, p_messages jsonb, p_removed text[], p_cursor text, p_advance boolean)` | function | definer | volatile | plpgsql | public | service_role |
| `email_sync_failed(p_owner uuid, p_account uuid, p_error text, p_reauth boolean)` | function | definer | volatile | plpgsql | public | service_role |
| `evidence_read(p_evidence uuid)` | function | definer | stable | plpgsql | public | authenticated, service_role |
| `exploration_keep(p_project uuid, p_text text, p_evidence uuid[], p_proposal uuid, p_client_request_id text)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `get_subscription_tier()` | function | definer | stable | sql | public | PUBLIC, anon, authenticated, service_role |
| `get_user_settings()` | function | definer | stable | sql | public | PUBLIC, anon, authenticated, service_role |
| `google_grant_revoked(p_user uuid, p_email text, p_source text, p_code text, p_http integer, p_cause text)` | function | definer | volatile | plpgsql | public | service_role |
| `google_refresh_failed(p_user uuid, p_email text)` | function | definer | volatile | plpgsql | public | service_role |
| `google_refresh_lock(p_user uuid, p_email text, p_ttl integer)` | function | definer | volatile | plpgsql | public | service_role |
| `google_refresh_record(p_user uuid, p_email text, p_access_enc text, p_access_exp timestamptz, p_refresh_enc text, p_refresh_exp timestamptz, p_scope text)` | function | definer | volatile | plpgsql | public | service_role |
| `google_signin_forget(p_user uuid, p_email text)` | function | definer | volatile | plpgsql | public | service_role |
| `google_signin_keep(p_user uuid, p_email text, p_refresh_enc text, p_access_enc text, p_access_exp timestamptz, p_refresh_exp timestamptz, p_scope text)` | function | definer | volatile | plpgsql | public | service_role |
| `history_erase(p_item uuid)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `hub_overview()` | function | definer | stable | plpgsql | public | authenticated, service_role |
| `item_apply_patch(p_id uuid, p_patch jsonb, p_client_at timestamptz)` | function | invoker | volatile | plpgsql | public | authenticated, service_role |
| `item_apply_patch_if_older(p_id uuid, p_patch jsonb, p_client_at timestamptz)` | function | invoker | volatile | plpgsql | public | authenticated, service_role |
| `item_change_prune(p_older_than interval)` | function | definer | volatile | plpgsql | public | service_role |
| `item_why(p_item uuid)` | function | invoker | stable | plpgsql | public | authenticated, service_role |
| `jarvis_action_provisional_email(p_surface text, p_kind text, p_state text)` | function | invoker | immutable | sql | public | authenticated, service_role |
| `jarvis_action_replay(p_action action)` | function | invoker | stable | sql | public | service_role |
| `jarvis_address_norm(a text)` | function | invoker | immutable | sql | public | service_role |
| `jarvis_address_ok(a text)` | function | invoker | immutable | sql | public | service_role |
| `jarvis_ai_switch(p_owner uuid)` | function | definer | stable | plpgsql | public | service_role |
| `jarvis_candidate_destination_kind()` | trigger | invoker | volatile | plpgsql | public | service_role |
| `jarvis_capture_valid(p_kind text, p_entity_type text, p_data jsonb)` | function | invoker | immutable | plpgsql | public | service_role |
| `jarvis_context_fields(p_entity_type text)` | function | invoker | immutable | sql | public | service_role |
| `jarvis_context_rows(p_owner uuid, p_job uuid, p_resources uuid[], p_fields text[])` | function | definer | stable | plpgsql | public | service_role |
| `jarvis_context_shape(p_owner uuid, p_job uuid, p_resources uuid[], p_fields text[])` | function | definer | stable | plpgsql | public | service_role |
| `jarvis_decision_conflicts(p_owner uuid, p_project uuid, p_constraints jsonb, p_except_item uuid)` | function | definer | stable | sql | public | service_role |
| `jarvis_dependencies_write(p_owner uuid, p_version uuid, p_refs jsonb)` | function | definer | volatile | plpgsql | public | service_role |
| `jarvis_dependency_cycle(p_owner uuid, p_from_item uuid, p_refs jsonb)` | function | definer | stable | plpgsql | public | service_role |
| `jarvis_dependency_no_self_edge()` | trigger | invoker | volatile | plpgsql | public | service_role |
| `jarvis_draft_fields_bad(p jsonb)` | function | invoker | immutable | plpgsql | public | service_role |
| `jarvis_draft_json(d email_draft)` | function | invoker | stable | sql | public | service_role |
| `jarvis_is_server()` | function | invoker | stable | sql | public | anon, authenticated, service_role |
| `jarvis_is_service_request()` | function | invoker | stable | sql | public | anon, authenticated, service_role |
| `jarvis_item_change_append_only()` | trigger | invoker | volatile | plpgsql | public | service_role |
| `jarvis_item_memory()` | trigger | definer | volatile | plpgsql | public | service_role |
| `jarvis_link_paths()` | function | invoker | immutable | sql | public | service_role |
| `jarvis_link_project_all()` | function | definer | volatile | plpgsql | public | service_role |
| `jarvis_links_of(p_type text, p_data jsonb, p_self uuid)` | function | invoker | immutable | sql | public | service_role |
| `jarvis_payload_clean(p jsonb)` | function | invoker | immutable | sql | public | service_role |
| `jarvis_policy_rule_ok(rule jsonb)` | function | invoker | immutable | sql | public | anon, authenticated, service_role |
| `jarvis_protect_columns()` | trigger | invoker | volatile | plpgsql | public | service_role |
| `jarvis_receipt_append(p_owner uuid, p_action uuid, p_state text, p_verb text, p_actor_kind text, p_actor_id uuid, p_scope text, p_assurance text, p_evidence uuid[], p_before uuid, p_after uuid, p_diff jsonb, p_provider_ack jsonb, p_error text, p_reversal uuid)` | function | definer | volatile | plpgsql | public | service_role |
| `jarvis_receipt_append_only()` | trigger | invoker | volatile | plpgsql | public | service_role |
| `jarvis_record(p_owner uuid, p_kind text, p_actor_kind text, p_actor_id uuid, p_verb text, p_surface text, p_state text, p_payload_hash text, p_idempotency text, p_scope text, p_assurance text, p_evidence uuid[], p_destination uuid, p_proposal uuid)` | function | definer | volatile | plpgsql | public | service_role |
| `jarvis_records_ingest(p_owner uuid, p_connection uuid, p_source_app text, p_records jsonb, p_created_by text)` | function | definer | volatile | plpgsql | public | service_role |
| `jarvis_touch_revision()` | trigger | invoker | volatile | plpgsql | public | service_role |
| `jarvis_touch_updated_at()` | trigger | invoker | volatile | plpgsql | public | service_role |
| `jarvis_undo_block(p_owner uuid, p_item uuid, p_expected timestamptz)` | function | definer | stable | plpgsql | public | service_role |
| `jarvis_vyzn_apps()` | function | invoker | immutable | sql | public | anon, authenticated, service_role |
| `jarvis_waiting_write(p_item uuid, p_patch jsonb, p_drop text[], p_kind text, p_verb text, p_diff jsonb, p_idempotency_key text, p_expected_updated_at timestamptz)` | function | definer | volatile | plpgsql | public | service_role |
| `job_open(p_agent uuid, p_project uuid, p_purpose text)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `outbox_claim(p_worker text, p_lease interval)` | function | definer | volatile | plpgsql | public | service_role |
| `outbox_claim_action(p_worker text, p_action uuid, p_lease interval)` | function | definer | volatile | plpgsql | public | service_role |
| `outbox_dispatched(p_outbox uuid, p_claim_token uuid)` | function | definer | volatile | plpgsql | public | service_role |
| `outbox_reconcile(p_outbox uuid, p_state text, p_verb text, p_evidence jsonb)` | function | definer | volatile | plpgsql | public | service_role |
| `outbox_settle(p_outbox uuid, p_claim_token uuid, p_state text, p_verb text, p_provider_ack jsonb, p_error text)` | function | definer | volatile | plpgsql | public | service_role |
| `outbox_sweep()` | function | definer | volatile | plpgsql | public | service_role |
| `policy_suggestion_answer(p_suggestion uuid, p_answer text)` | function | invoker | volatile | plpgsql | public | authenticated, service_role |
| `policy_suggestion_offer(p_rule jsonb, p_evidence_tap_ids text[])` | function | invoker | volatile | plpgsql | public | authenticated, service_role |
| `proposal_classify(p_proposal uuid, p_expected_revision integer, p_segment text)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `proposal_dismiss(p_proposal uuid, p_expected_revision integer)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `proposal_submit(p_owner uuid, p_connection uuid, p_package uuid, p_surface text, p_type text, p_payload jsonb, p_evidence uuid[], p_idempotency text)` | function | definer | volatile | plpgsql | public | service_role |
| `proposals_import(p_job uuid, p_items jsonb, p_source text)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `receipt_detail(p_action uuid)` | function | invoker | stable | plpgsql | public | authenticated, service_role |
| `receipt_erase(p_action uuid)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `record_approve(p_proposal uuid, p_expected_revision integer, p_shown_payload_hash text, p_idempotency_key text, p_prepared jsonb)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `record_dismiss(p_proposal uuid, p_expected_revision integer)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `record_push(p_owner uuid, p_connection uuid, p_source_app text, p_records jsonb)` | function | definer | volatile | plpgsql | public | service_role |
| `records_import(p_source_app text, p_records jsonb)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `register_device_token(p_token text, p_environment text, p_build text)` | function | definer | volatile | plpgsql | '' (empty) | authenticated, service_role |
| `reported_external_record(p_owner uuid, p_connection uuid, p_verb text, p_idempotency text)` | function | definer | volatile | plpgsql | public | service_role |
| `review_link(p_owner uuid, p_connection uuid, p_proposal uuid)` | function | definer | stable | plpgsql | public | service_role |
| `scope_grant_create(p_job uuid, p_manifest_hash text, p_duration text, p_resources uuid[], p_fields text[], p_purpose text)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `send_approve(p_draft uuid, p_review_nonce text, p_shown_payload_hash text, p_idempotency_key text)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `send_approve_held(p_draft uuid, p_review_nonce text, p_shown_payload_hash text, p_idempotency_key text)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `send_hold_status(p_action uuid)` | function | definer | stable | plpgsql | public | authenticated, service_role |
| `send_review(p_draft uuid, p_expected_revision integer)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `set_monotonic_updated_at()` | trigger | invoker | volatile | plpgsql | public | service_role |
| `substrate_readiness()` | function | invoker | stable | sql | public | authenticated, service_role |
| `thread_messages(p_thread text, p_account uuid)` | function | definer | stable | sql | public | authenticated, service_role |
| `threads_latest(p_threads text[])` | function | definer | stable | sql | public | authenticated, service_role |
| `unregister_device_token(p_token text)` | function | definer | volatile | plpgsql | '' (empty) | authenticated, service_role |
| `vyzn_app_connect(p_owner uuid, p_app text, p_token_hash text)` | function | definer | volatile | plpgsql | public | service_role |
| `vyzn_inbox(p_limit integer)` | function | invoker | stable | plpgsql | public | authenticated, service_role |
| `waiting_follow_up(p_item uuid, p_date date, p_idempotency_key text, p_expected_updated_at timestamptz)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `waiting_reopen(p_item uuid, p_idempotency_key text, p_expected_updated_at timestamptz)` | function | definer | volatile | plpgsql | public | authenticated, service_role |
| `waiting_resolve(p_item uuid, p_note text, p_idempotency_key text, p_expected_updated_at timestamptz)` | function | definer | volatile | plpgsql | public | authenticated, service_role |

## Proof

`tests/posture.sh` (0062, 22 checks), `tests/memory.sh` (0060), `tests/inbox.sh` (0061), `tests/substrate.sh` (0044 and the RLS proof) and `tests/rehearsal.sh` (every migration forward, the Phase 0 and substrate migrations back and forward, the leakage inspection, then every proof) on the local Postgres (`tests/local_pg.sh`). Nothing on this page was read from the live project.
