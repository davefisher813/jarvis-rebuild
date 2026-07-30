-- Register the "routine" entity type (one per-user routine record: active
-- hours, work hours, protected time). Root cause of "Save doesn't work" on
-- Your Routine: item.entity_type references this registry, and 'routine' was
-- never added, so every insert was rejected (audit 2026-07-30). Mirrors
-- 0002-0011. Apply in the Supabase SQL editor.
insert into entity_type (key) values ('routine')
  on conflict (key) do nothing;
