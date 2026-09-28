-- Brain Manual v1 (Phase 1): register the "brain_memory" entity type for
-- manually filed memory rows (decision | philosophy | value | voice | fact,
-- state LEARNED; 'PROPOSED' reserved for the Phase 2 nightly job).
-- Mirrors 0006_person_entity.sql. Apply in the Supabase SQL editor.
insert into entity_type (key) values ('brain_memory')
  on conflict (key) do nothing;

-- Backfill: existing person rows (imported contacts) arrive unsorted. Any
-- person row whose data lacks a triageState gets "unsorted" so the
-- "Sort your contacts" triage screen picks it up. Rows that already carry
-- a triageState are left untouched.
update item
set data = data || '{"triageState":"unsorted"}'::jsonb
where entity_type = 'person'
  and (data ->> 'triageState') is null;
