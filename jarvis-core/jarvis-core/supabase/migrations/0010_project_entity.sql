-- Register the "project" entity (Active Projects). Mirrors prior migrations.
insert into entity_type (key) values ('project') on conflict (key) do nothing;
