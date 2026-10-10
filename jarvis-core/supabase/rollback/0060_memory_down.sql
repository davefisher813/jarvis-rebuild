-- Rollback of 0060 (memory: item_change, item_link, the item trigger and item_why).
-- Not a migration: it lives outside supabase/migrations so nothing applies it by accident.
--
-- What it does: drops the trigger on item and the one on item_change, the eight functions 0060
-- added (in reverse order), the two tables (derived records, the 0044 down's reasoning: history and
-- the projection are rebuilt from item by a forward; both drops are required so 0044's own down
-- still runs when substrate.sh rolls back every down newest first), then puts the five replaced
-- functions back to their 0031, 0032, 0001, 0044 and 0044 bodies verbatim. item_apply_patch goes
-- back to its two argument signature. Columns elsewhere are untouched, so substrate.sh's byte
-- identity check on information_schema.columns passes.
--
-- Operator note: the history is data the forward cannot recreate. If it is wanted, run
--   copy item_change to '/tmp/item_change_0060.csv' csv header;
--   copy item_link   to '/tmp/item_link_0060.csv' csv header;
-- first. DROP TRIGGER on item takes an ACCESS EXCLUSIVE lock on the table the app runs on; on a
-- live project run this with `set lock_timeout = '3s'` and retry if it times out.
--
-- Rehearsed forward -> back -> forward by supabase/tests/memory.sh and supabase/tests/rehearsal.sh.

drop trigger if exists item_memory on item;
drop trigger if exists item_change_append_only on item_change;

drop function if exists item_why(uuid);
drop function if exists item_change_prune(interval);
drop function if exists history_erase(uuid);
drop function if exists jarvis_item_change_append_only();
drop function if exists jarvis_item_memory();
drop function if exists jarvis_link_project_all();
drop function if exists jarvis_links_of(text, jsonb, uuid);
drop function if exists jarvis_link_paths();

drop table if exists item_link;
drop table if exists item_change;

-- item_apply_patch, exactly as 0031 left it (two arguments; default privileges).
drop function if exists item_apply_patch(uuid, jsonb, timestamptz);
create or replace function item_apply_patch(p_id uuid, p_patch jsonb)
returns boolean
language plpgsql
security invoker
as $$
declare
  n int;
begin
  update item
     set data = jsonb_strip_nulls(data || p_patch)
   where id = p_id;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- item_apply_patch_if_older, exactly as 0032 left it.
create or replace function item_apply_patch_if_older(p_id uuid, p_patch jsonb, p_client_at timestamptz)
returns text
language plpgsql
security invoker
as $$
declare
  cur timestamptz;
  n int;
begin
  select updated_at into cur from item where id = p_id;
  if cur is null then
    return 'missing';
  end if;
  -- Strictly newer only. A row written in the same instant is not newer, so
  -- a replay can never be refused by its own earlier attempt.
  if cur > p_client_at then
    return 'stale';
  end if;
  update item
     set data = jsonb_strip_nulls(data || p_patch)
   where id = p_id;
  get diagnostics n = row_count;
  if n = 0 then
    return 'missing';
  end if;
  return 'applied';
end;
$$;
alter function item_apply_patch_if_older(uuid, jsonb, timestamptz) reset search_path;
-- create or replace keeps a function's ACL, so the posture 0032 left (default privileges, no
-- revoke) is put back by hand.
grant execute on function item_apply_patch_if_older(uuid, jsonb, timestamptz) to public, anon, authenticated, service_role;

-- set_monotonic_updated_at, exactly as 0001 left it.
create or replace function set_monotonic_updated_at()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT') then
    new.updated_at := now();
  else
    new.updated_at := greatest(now(), old.updated_at + interval '1 microsecond');
  end if;
  return new;
end;
$$;
alter function set_monotonic_updated_at() reset search_path;
grant execute on function set_monotonic_updated_at() to public, anon, authenticated, service_role;

-- substrate_readiness, exactly as 0044 left it.
create or replace function substrate_readiness()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'migration', '0044',
    'registered', (
      select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
      from entity_type
      where key in ('money_bill', 'money_receipt', 'task', 'event', 'waiting', 'exploration_note', 'decision_record')
    )
  );
$$;
revoke all on function substrate_readiness() from public, anon, authenticated;
grant execute on function substrate_readiness() to authenticated, service_role;

-- delete_owned, exactly as 0044 left it.
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
  delete from public.item where owner_id = p_uid;
  delete from public.scalar_setting where owner_id = p_uid;
  delete from public.event_log where owner_id = p_uid;
  delete from public.ai_usage where user_id = p_uid;
  delete from public.ai_tokens where user_id = p_uid;
end;
$$;
revoke all on function delete_owned(uuid) from public, anon, authenticated;
grant execute on function delete_owned(uuid) to service_role;
