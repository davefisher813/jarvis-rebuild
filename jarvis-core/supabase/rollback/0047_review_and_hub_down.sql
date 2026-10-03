-- Rollback for 0047 (durable decision review and the Hub's reads).
-- Not a migration: lives outside supabase/migrations so nothing applies it by
-- accident. Removes the functions 0047 added and puts the proposal author
-- check back as 0044 wrote it. Decision versions, dependencies, notes and
-- receipts the functions wrote are the person's records and stay.

drop function if exists decision_history(uuid);
drop function if exists hub_overview();
drop function if exists job_open(uuid, uuid, text);
drop function if exists connection_add_manual(text);
drop function if exists connection_set_mode(uuid, integer, text);
drop function if exists decision_dependencies_check();
drop function if exists proposal_dismiss(uuid, integer);
drop function if exists proposal_classify(uuid, integer, text);
drop function if exists exploration_keep(uuid, text, uuid[], uuid, text);
drop function if exists decision_withdraw(uuid, timestamptz, text, text);
drop function if exists decision_save(uuid, text, text, text, text[], jsonb, jsonb, uuid[], jsonb, uuid, integer, uuid, text);
drop function if exists jarvis_dependencies_write(uuid, uuid, jsonb);
drop function if exists jarvis_dependency_cycle(uuid, uuid, jsonb);
drop function if exists jarvis_decision_conflicts(uuid, uuid, jsonb, uuid);

-- A system-authored proposal row, if any exists, blocks the narrower check;
-- it is the person's record, so the check is narrowed only when it can be.
do $$
begin
  if not exists (select 1 from proposal where created_by = 'system') then
    alter table proposal drop constraint if exists proposal_created_by_check;
    alter table proposal add constraint proposal_created_by_check check (created_by in ('agent', 'import', 'user'));
  end if;
end;
$$;
