-- Rollback of 0063 (private by default: the four revokes, the search_path on ten functions, delete_owned
-- over the four user_id tables, the readiness word). Not a migration: it lives outside supabase/migrations
-- so nothing applies it by accident.
--
-- What it does: puts delete_owned and substrate_readiness back to their 0060 bodies verbatim (0062 touched
-- neither: its closing note says so, and inbox.sh check 29 reads the 0060 word), and resets search_path on
-- each of the ten functions 0063 set it on, guarded by to_regprocedure the same way, so a name the project
-- does not have is skipped and never created.
--
-- What it does NOT do, on purpose: the four grants are not restored, nor the sequence's. A rollback never
-- reopens a table to a browser role. email_opens, google_tokens, ai_tokens and feedback were "service role
-- only" in their own files from the day they were made (0017, 0018, 0026, 0035); the default privilege
-- that had the browser roles on them was the accident, and undoing 0063 does not mean restoring an
-- accident. Every reader of the four carries the service key (the 0063 header lists each file and line),
-- so nothing in the app changes with the grants absent. If a browser grant is ever wanted it is a new
-- migration with a policy, not this file.
--
-- After this file the live advisor's function_search_path_mutable count goes back up by the number of the
-- ten that exist (eight live, ten on a chain that applied 0037).
--
-- Rehearsed forward -> back -> forward by supabase/tests/posture.sh and supabase/tests/rehearsal.sh.

do $down$
begin
  if to_regprocedure('public.get_subscription_tier()') is not null then
    alter function public.get_subscription_tier() reset search_path;
  end if;
  if to_regprocedure('public.get_user_settings()') is not null then
    alter function public.get_user_settings() reset search_path;
  end if;
  if to_regprocedure('public.jarvis_action_provisional_email(text, text, text)') is not null then
    alter function public.jarvis_action_provisional_email(text, text, text) reset search_path;
  end if;
  if to_regprocedure('public.jarvis_action_replay(public.action)') is not null then
    alter function public.jarvis_action_replay(public.action) reset search_path;
  end if;
  if to_regprocedure('public.jarvis_address_norm(text)') is not null then
    alter function public.jarvis_address_norm(text) reset search_path;
  end if;
  if to_regprocedure('public.jarvis_address_ok(text)') is not null then
    alter function public.jarvis_address_ok(text) reset search_path;
  end if;
  if to_regprocedure('public.jarvis_context_fields(text)') is not null then
    alter function public.jarvis_context_fields(text) reset search_path;
  end if;
  if to_regprocedure('public.jarvis_draft_fields_bad(jsonb)') is not null then
    alter function public.jarvis_draft_fields_bad(jsonb) reset search_path;
  end if;
  if to_regprocedure('public.jarvis_payload_clean(jsonb)') is not null then
    alter function public.jarvis_payload_clean(jsonb) reset search_path;
  end if;
  if to_regprocedure('public.jarvis_policy_rule_ok(jsonb)') is not null then
    alter function public.jarvis_policy_rule_ok(jsonb) reset search_path;
  end if;
end
$down$;

-- delete_owned, exactly as 0060 left it.
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
  delete from public.item_link where owner_id = p_uid;
  delete from public.item where owner_id = p_uid;
  delete from public.scalar_setting where owner_id = p_uid;
  delete from public.event_log where owner_id = p_uid;
  delete from public.ai_usage where user_id = p_uid;
  delete from public.ai_tokens where user_id = p_uid;
  delete from public.item_change where owner_id = p_uid;
end;
$$;
revoke all on function delete_owned(uuid) from public, anon, authenticated;
grant execute on function delete_owned(uuid) to service_role;

-- substrate_readiness, exactly as 0060 left it.
create or replace function substrate_readiness()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'migration', '0060',
    'registered', (
      select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
      from entity_type
      where key in ('money_bill', 'money_receipt', 'task', 'event', 'waiting', 'exploration_note', 'decision_record')
    ),
    'phase0', jsonb_build_object(
      'memory', to_regclass('public.item_change') is not null and to_regprocedure('public.item_why(uuid)') is not null,
      'inbox', to_regprocedure('public.record_push(uuid, uuid, text, jsonb)') is not null,
      'private', case when to_regclass('public.feedback') is null then false
                      else not has_table_privilege('authenticated', 'public.feedback', 'select') end
    )
  );
$$;
revoke all on function substrate_readiness() from public, anon, authenticated;
grant execute on function substrate_readiness() to authenticated, service_role;
