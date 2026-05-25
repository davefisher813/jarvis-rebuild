-- Register the "profile" entity type (one per-user onboarding profile record).
-- Mirrors 0002-0004. Apply in the Supabase SQL editor.
insert into entity_type (key) values ('profile')
  on conflict (key) do nothing;
