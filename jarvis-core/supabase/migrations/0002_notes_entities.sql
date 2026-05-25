-- Register the entity types the Notes feature uses, so item.entity_type's
-- foreign key accepts them. Run after 0001 on your Supabase project.
insert into entity_type (key) values ('note'), ('task')
  on conflict (key) do nothing;
