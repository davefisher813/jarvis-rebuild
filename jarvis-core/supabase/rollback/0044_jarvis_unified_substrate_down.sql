-- Rollback for 0044 (the unified substrate, slice 01). Not a migration: it
-- lives outside supabase/migrations so nothing applies it by accident.
--
-- What it does: removes every table, function, trigger and index 0044 added,
-- puts delete_owned back to its 0036 body, and removes the two entity kinds
-- only where no item of that kind exists (an item is the person's record and
-- is never deleted by a rollback). What it does not do: touch item rows,
-- scalar_setting, google_tokens or anything from an earlier migration.
--
-- Rehearsed forward -> back -> forward by supabase/tests/substrate.sh.

drop table if exists jarvis_private.context_snapshot;
drop table if exists jarvis_private.email_credential;
drop table if exists jarvis_private.agent_credential;
drop schema if exists jarvis_private;

drop table if exists email_draft;
drop table if exists email_candidate;
drop table if exists decision_dependency;
drop table if exists decision_version;
drop table if exists source_evidence;
drop table if exists email_message_body;
drop table if exists email_message;
drop table if exists email_account;
drop table if exists approval;
drop table if exists receipt_event;
drop table if exists action;
drop table if exists proposal;
drop table if exists context_package;
drop table if exists job;
drop table if exists policy_suggestion;
drop table if exists scope_grant;
drop table if exists agent_connection;

drop function if exists substrate_readiness();
drop function if exists jarvis_dependency_no_self_edge();
drop function if exists jarvis_policy_rule_ok(jsonb);
drop function if exists jarvis_candidate_destination_kind();
drop function if exists jarvis_receipt_append_only();
drop function if exists jarvis_protect_columns();
drop function if exists jarvis_touch_revision();
drop function if exists jarvis_touch_updated_at();
drop function if exists jarvis_is_server();

drop index if exists item_id_owner_idx;

-- delete_owned, exactly as 0036 left it.
create or replace function delete_owned(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.item where owner_id = p_uid;
  delete from public.scalar_setting where owner_id = p_uid;
  delete from public.event_log where owner_id = p_uid;
  delete from public.ai_usage where user_id = p_uid;
  delete from public.ai_tokens where user_id = p_uid;
end;
$$;
revoke all on function delete_owned(uuid) from public;
revoke all on function delete_owned(uuid) from anon;
revoke all on function delete_owned(uuid) from authenticated;
grant execute on function delete_owned(uuid) to service_role;

delete from entity_type
 where key in ('waiting', 'exploration_note')
   and not exists (select 1 from item where item.entity_type = entity_type.key);
