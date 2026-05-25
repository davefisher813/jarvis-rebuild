-- Register the "brain_doc" entity (Brain: Life Philosophy / How You Write / Values).
-- Mirrors 0002-0006. Apply in the Supabase SQL editor.
insert into entity_type (key) values ('brain_doc')
  on conflict (key) do nothing;
