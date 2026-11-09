-- Alfred service account: cross-user grant (dedicated-auth-user path)
-- Applied BY HAND in the JARVIS project (ref roonancpktqigdndrumo), not a migration, never auto-run in CI.
--
-- Precondition done elsewhere (dashboard / Auth Admin API, not here, not in chat):
--   1. Create one auth user for Alfred, e.g. alfred-svc@<domain>. Set a strong password out of band.
--   2. Note its user id (auth.users.id). That is :service_uid below.
--   3. :dave_uid is Dave's own auth.users.id (the owner of the rows the CLI must reach).
--
-- Scope: read, insert, update. NO delete (assumed; Alfred left scope unanswered).
-- What this does: for every table that has an owner_id column, add four policies that let
-- ONLY the service account act on ONLY Dave's rows. Nothing else changes; existing per-user
-- policies are untouched. Drop block at the bottom reverts it completely.
--
-- Scope note for the reviewer: this grants one account full read/write over Dave's entire
-- JARVIS dataset. That is the blast radius. Rotate/disable by running the DROP block.

do $$
declare
  service_uid constant uuid := '00000000-0000-0000-0000-000000000000';  -- REPLACE: Alfred service account auth.users.id
  dave_uid    constant uuid := '00000000-0000-0000-0000-000000000000';  -- REPLACE: Dave's auth.users.id
  t record;
begin
  if service_uid = dave_uid then
    raise exception 'Fill in service_uid and dave_uid before running';
  end if;
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'owner_id'
      and tb.table_type = 'BASE TABLE'
    order by c.table_name
  loop
    execute format('drop policy if exists svc_alfred_select on public.%I', t.table_name);
    execute format('drop policy if exists svc_alfred_insert on public.%I', t.table_name);
    execute format('drop policy if exists svc_alfred_update on public.%I', t.table_name);
    execute format('drop policy if exists svc_alfred_delete on public.%I', t.table_name);
    execute format(
      'create policy svc_alfred_select on public.%I for select using (owner_id = %L and auth.uid() = %L)',
      t.table_name, dave_uid, service_uid);
    execute format(
      'create policy svc_alfred_insert on public.%I for insert with check (owner_id = %L and auth.uid() = %L)',
      t.table_name, dave_uid, service_uid);
    execute format(
      'create policy svc_alfred_update on public.%I for update using (owner_id = %L and auth.uid() = %L) with check (owner_id = %L and auth.uid() = %L)',
      t.table_name, dave_uid, service_uid, dave_uid, service_uid);
    -- No delete policy by design: deletion stays Dave's. Add one only on his word.
    raise notice 'granted svc_alfred on %', t.table_name;
  end loop;
end $$;

-- Proof (run as the signed-in service account, not as a migration):
--   select count(*) from item;                         -- a real read: should see Dave's rows
--   insert into scalar_setting (owner_id, key, value)   -- a real write
--     values ('<dave_uid>', 'alfred.connectivity.check', to_jsonb(now()::text));
--   (the check row stays; Dave or the app removes it, the account cannot delete)

-- REVERT (removes Alfred's access entirely):
-- do $$
-- declare t record;
-- begin
--   for t in select table_name from information_schema.columns
--            where table_schema='public' and column_name='owner_id' loop
--     execute format('drop policy if exists svc_alfred_select on public.%I', t.table_name);
--     execute format('drop policy if exists svc_alfred_insert on public.%I', t.table_name);
--     execute format('drop policy if exists svc_alfred_update on public.%I', t.table_name);
--     execute format('drop policy if exists svc_alfred_delete on public.%I', t.table_name);
--   end loop;
-- end $$;
