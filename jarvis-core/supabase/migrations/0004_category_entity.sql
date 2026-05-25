-- Register the "category" entity type so user-defined categories can be stored.
-- Mirrors 0002/0003. Apply in the Supabase SQL editor before categories sync.
insert into entity_type (key) values ('category')
on conflict (key) do nothing;
