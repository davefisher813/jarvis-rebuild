-- Migration 0062: private by default (Phase 0 design D7; PHASE0-DESIGN.md section 3, 2026-10-10).
--
-- Four tables the app's own files call "service role only" have been reachable by the browser roles
-- since the day they were made: Supabase hands every new table in public to anon, authenticated and
-- service_role by default privilege, and "no policies" only hides the rows behind row level security.
-- Row level security does not hide a table's existence, its columns, an insert that a policy later
-- refuses, or a sequence. This file closes that gap for the four tables that carry nothing of the
-- person's own (an open pixel, an encrypted refresh token, an accounting row, a message to us), sets
-- a search_path on every function that still ran with the caller's, and widens account deletion to
-- the four user_id tables that had been outside it.
--
-- What this file does:
--   1. email_opens (0017), google_tokens (0018), ai_tokens (0026), feedback (0035): revoke all from
--      PUBLIC, from anon and authenticated; grant all to service_role, stated. ai_tokens's identity
--      sequence is revoked with it (the 0053 precedent for client_error_id_seq: a browser role that
--      may call nextval on an accounting table's sequence learns its row count).
--   2. search_path = public on every public function that had none, guarded by to_regprocedure so a
--      function absent from the live project is never created by side effect (the two 0037 functions).
--   3. delete_owned: the 0060 body plus ai_budget, ai_budget_reservation (0043), device_token (0054) and
--      google_reconnect_attempt (0058), all by user_id, before the item line. client_error (0053) has no
--      owner column by design and cannot join.
--   4. substrate_readiness: the 0060 body with migration '0062' and the phase0.private probe widened
--      from one table and one role to the four tables and both browser roles.
--   The 45 per row policies are not rewritten (design section 10 item 17). No table, column or policy
--   is created or dropped. Forward twice is a no-op.
--
-- The api read (design D7: a table a route reaches with the anon key keeps exactly its policy's verbs).
-- Every path that names one of the four tables was read; every one carries the service role key:
--   email_opens     api/open.ts:77-85 (svcHeaders from SUPABASE_SERVICE_ROLE_KEY; the pixel GET, the
--                   POST register and the POST check all use it; the anon key is used only against
--                   /auth/v1/user to verify the caller's JWT)
--   google_tokens   api/_google.ts:239, 267, 289, 486, 533, 571 (svc(s) = s.service); api/_reconnect.ts:24
--                   (hdr); api/_incident.ts:21; api/_email.ts:121-123 (serviceSelect, used by
--                   api/connections/status.ts:97, api/email/accounts.ts:21, api/email/search.ts:56,
--                   api/cron/token-keepalive.ts:52); api/admin/connections.ts:23 (ctx.serviceKey);
--                   src/account/deleteAccount.ts:90-91, 162 (headers(ctx) = ctx.serviceKey, run by
--                   api/account/delete.ts)
--   ai_tokens       api/ai.ts:336-338 (serviceKey); api/ai-usage.ts:84, 101 (svc = serviceKey);
--                   api/admin/usage.ts:32 (ctx.serviceKey); src/account/deleteAccount.ts:57 (OWNED_TABLES,
--                   walked with the service ctx)
--   feedback        api/feedback.ts:72-77, 95-99 (svc = serviceKey); api/admin/feedback.ts:19 (ctx.serviceKey)
--   No file under jarvis-app/src or jarvis-core/src reaches any of the four through the browser client
--   (src/settings/FeedbackSheet.tsx posts to /api/feedback; src/ai/tokenLog.ts sums what /api/ai-usage
--   returned). So no table keeps a verb: the revoke is the full posture for all four.
--
-- The function list, derived on the local rehearsal database after 0001 to 0061 (stub_supabase.sql
-- mirrors the live default privileges) with:
--   select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
--    order by 1;
-- answers ten:
--   get_subscription_tier()                                             0037  sql stable definer   absent live
--   get_user_settings()                                                 0037  sql stable definer   absent live
--   jarvis_action_provisional_email(p_surface text, p_kind text, p_state text)  0046  sql immutable
--   jarvis_action_replay(p_action action)                               0046  sql stable
--   jarvis_address_norm(a text)                                         0048  sql immutable
--   jarvis_address_ok(a text)                                           0048  sql immutable
--   jarvis_context_fields(p_entity_type text)                           0045  sql immutable
--   jarvis_draft_fields_bad(p jsonb)                                    0050  plpgsql immutable
--   jarvis_payload_clean(p jsonb)                                       0044  sql immutable
--   jarvis_policy_rule_ok(rule jsonb)                                   0044  sql immutable
-- None of the ten is defined or redefined by 0060 or 0061, so this file never rewrites a Phase 0 object.
-- None of the ten names an object outside pg_catalog and public, so search_path = public changes what
-- none of them resolves. "Mutable" is the advisor's word (function_search_path_mutable: no search_path
-- in proconfig), not provolatile: the eight immutable helpers are on the advisor's list and are set here.
--
-- Compared with the live advisor's list of 2026-10-10T03:34Z (13 names, scratchpad map
-- follow-production-state-versus-the-repo-chain): the eight jarvis_ names above are on it;
-- set_monotonic_updated_at, item_apply_patch and item_apply_patch_if_older are fixed by 0060 and
-- jarvis_capture_valid by 0061 (excluded here); jarvis_legacy_account_state(text) is the stray
-- 0055_email_connection_truth, live only, and is left alone (design section 10 item 17: no action on the
-- stray 0055), so the live advisor keeps exactly that one finding after this file. The two 0037 names are
-- on the local list only because the repo chain applies 0037; live, where 0037 was never applied, the
-- guard skips them and nothing is created.
--
-- Deviations from PHASE0-DESIGN.md section 3 "0062_private_by_default.sql", each stated:
--   a. ai_tokens_id_seq is revoked beside the table (not in the design; the 0053 precedent, reason above).
--   b. substrate_readiness is redefined. The design says the readiness "gains phase0.private true"; 0060
--      already carried a probe (authenticated select on feedback alone) that flips true on the revoke, so
--      the gain needed no body change. The body changes anyway so the migration word reads '0062' and the
--      probe covers what this file actually closes (four tables, two roles, four verbs). The rollback
--      restores the 0060 body verbatim.
--   c. The grants are reissued to service_role on every forward, which is a no-op on a project where the
--      default privilege already granted them, and the stated posture where it did not.
--
-- Rollback: supabase/rollback/0062_private_by_default_down.sql (delete_owned and substrate_readiness back
-- to their 0060 bodies; search_path reset on the ten, guarded the same way; the four grants are NOT
-- restored, nor the sequence's: a rollback never reopens a table to a browser role).
-- Proof: supabase/tests/posture.sh on the local Postgres (forward twice, the checks, rollback, forward
-- again, then forward with the two 0037 functions absent). Rehearsed by supabase/tests/rehearsal.sh.

-- ---------------------------------------------------------------------------
-- 1. The four tables. Each: revoke from PUBLIC, revoke from the browser roles,
--    grant to the server. RLS stays on with no policies (0017, 0018, 0026,
--    0035), so a future grant by hand would still show no rows.
-- ---------------------------------------------------------------------------
revoke all on table email_opens from public;
revoke all on table email_opens from anon, authenticated;
grant all on table email_opens to service_role;

revoke all on table google_tokens from public;
revoke all on table google_tokens from anon, authenticated;
grant all on table google_tokens to service_role;

revoke all on table ai_tokens from public;
revoke all on table ai_tokens from anon, authenticated;
grant all on table ai_tokens to service_role;
revoke all on sequence ai_tokens_id_seq from public;
revoke all on sequence ai_tokens_id_seq from anon, authenticated;
grant all on sequence ai_tokens_id_seq to service_role;

revoke all on table feedback from public;
revoke all on table feedback from anon, authenticated;
grant all on table feedback to service_role;

-- ---------------------------------------------------------------------------
-- 2. A search_path for every function that had none. Guarded: a name the live
--    project does not have is skipped, never created. jarvis_action_replay's
--    argument is the composite type of the action table, written qualified.
-- ---------------------------------------------------------------------------
do $mig$
begin
  if to_regprocedure('public.get_subscription_tier()') is not null then
    alter function public.get_subscription_tier() set search_path = public;
  end if;
  if to_regprocedure('public.get_user_settings()') is not null then
    alter function public.get_user_settings() set search_path = public;
  end if;
  if to_regprocedure('public.jarvis_action_provisional_email(text, text, text)') is not null then
    alter function public.jarvis_action_provisional_email(text, text, text) set search_path = public;
  end if;
  if to_regprocedure('public.jarvis_action_replay(public.action)') is not null then
    alter function public.jarvis_action_replay(public.action) set search_path = public;
  end if;
  if to_regprocedure('public.jarvis_address_norm(text)') is not null then
    alter function public.jarvis_address_norm(text) set search_path = public;
  end if;
  if to_regprocedure('public.jarvis_address_ok(text)') is not null then
    alter function public.jarvis_address_ok(text) set search_path = public;
  end if;
  if to_regprocedure('public.jarvis_context_fields(text)') is not null then
    alter function public.jarvis_context_fields(text) set search_path = public;
  end if;
  if to_regprocedure('public.jarvis_draft_fields_bad(jsonb)') is not null then
    alter function public.jarvis_draft_fields_bad(jsonb) set search_path = public;
  end if;
  if to_regprocedure('public.jarvis_payload_clean(jsonb)') is not null then
    alter function public.jarvis_payload_clean(jsonb) set search_path = public;
  end if;
  if to_regprocedure('public.jarvis_policy_rule_ok(jsonb)') is not null then
    alter function public.jarvis_policy_rule_ok(jsonb) set search_path = public;
  end if;
end
$mig$;

-- ---------------------------------------------------------------------------
-- 3. Account deletion reaches the four user_id tables. The 0060 body with four
--    lines before the item line: the reservations before the budget row they
--    hang off, the phone's tokens, the reconnect attempts. item_change stays
--    last (deleting the items writes delete rows into it). feedback stays
--    absent (0035: a message to us, set null by the auth cascade). email_opens
--    and google_tokens stay absent (0017, 0018: they cascade from auth.users).
-- ---------------------------------------------------------------------------
create or replace function delete_owned(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.receipt_event where owner_id = p_uid;
  delete from public.approval where owner_id = p_uid;
  delete from public.email_candidate where owner_id = p_uid;
  delete from public.email_draft where owner_id = p_uid;
  delete from public.action where owner_id = p_uid;
  delete from public.proposal where owner_id = p_uid;
  delete from public.context_package where owner_id = p_uid;
  delete from public.job where owner_id = p_uid;
  delete from public.scope_grant where owner_id = p_uid;
  delete from public.policy_suggestion where owner_id = p_uid;
  delete from public.decision_dependency where owner_id = p_uid;
  delete from public.decision_version where owner_id = p_uid;
  delete from public.source_evidence where owner_id = p_uid;
  delete from public.email_message_body where owner_id = p_uid;
  delete from public.email_message where owner_id = p_uid;
  delete from public.email_account where owner_id = p_uid;
  delete from public.agent_connection where owner_id = p_uid;
  delete from public.ai_budget_reservation where user_id = p_uid;
  delete from public.ai_budget where user_id = p_uid;
  delete from public.device_token where user_id = p_uid;
  delete from public.google_reconnect_attempt where user_id = p_uid;
  delete from public.item_link where owner_id = p_uid;
  delete from public.item where owner_id = p_uid;
  delete from public.scalar_setting where owner_id = p_uid;
  delete from public.event_log where owner_id = p_uid;
  delete from public.ai_usage where user_id = p_uid;
  delete from public.ai_tokens where user_id = p_uid;
  delete from public.item_change where owner_id = p_uid;
end;
$$;
revoke all on function delete_owned(uuid) from public;
revoke all on function delete_owned(uuid) from anon, authenticated;
grant execute on function delete_owned(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Readiness: the 0060 body with the migration word and the private probe
--    over the four tables, both browser roles and the four verbs. `registered`,
--    `memory` and `inbox` are unchanged.
-- ---------------------------------------------------------------------------
create or replace function substrate_readiness()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'migration', '0062',
    'registered', (
      select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
      from entity_type
      where key in ('money_bill', 'money_receipt', 'task', 'event', 'waiting', 'exploration_note', 'decision_record')
    ),
    'phase0', jsonb_build_object(
      'memory', to_regclass('public.item_change') is not null and to_regprocedure('public.item_why(uuid)') is not null,
      'inbox', to_regprocedure('public.record_push(uuid, uuid, text, jsonb)') is not null,
      'private', (
        select count(*) = 8 and coalesce(bool_and(not has_table_privilege(r, 'public.' || t, 'select, insert, update, delete')), false)
          from unnest(array['email_opens', 'google_tokens', 'ai_tokens', 'feedback']) t
          cross join unnest(array['anon', 'authenticated']) r
         where to_regclass('public.' || t) is not null
      )
    )
  );
$$;
revoke all on function substrate_readiness() from public;
revoke all on function substrate_readiness() from anon, authenticated;
grant execute on function substrate_readiness() to authenticated, service_role;
