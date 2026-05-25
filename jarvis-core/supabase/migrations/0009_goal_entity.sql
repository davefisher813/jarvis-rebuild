-- Register the "goal" entity (Active Goals). Mirrors prior migrations.
insert into entity_type (key) values ('goal') on conflict (key) do nothing;
