-- Register the "person" entity type (Brain: Contacts / Inner Circle / Adversarial).
-- Mirrors 0002-0005. Apply in the Supabase SQL editor.
insert into entity_type (key) values ('person')
  on conflict (key) do nothing;
