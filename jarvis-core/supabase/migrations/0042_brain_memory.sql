-- Brain Manual v1 (Phase 1): register the "brain_memory" entity type for
-- manually filed memory rows (decision | philosophy | value | voice | fact,
-- state LEARNED; 'PROPOSED' reserved for the Phase 2 nightly job).
-- Mirrors 0006_person_entity.sql. Apply in the Supabase SQL editor.
--
-- No person backfill: the app reads a person with no triageState as sorted
-- when it was added by hand and unsorted when it came from an import, so no
-- row needs rewriting (Dave 2026-09-28).
insert into entity_type (key) values ('brain_memory')
  on conflict (key) do nothing;
