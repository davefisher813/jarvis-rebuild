-- Register the entity type the Schedule feature uses, so item.entity_type's
-- foreign key accepts it. Run after 0002 on your Supabase project.
insert into entity_type (key) values ('event')
  on conflict (key) do nothing;
