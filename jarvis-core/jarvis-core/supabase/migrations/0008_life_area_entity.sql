-- Register the "life_area" entity (Life Map). Mirrors prior migrations.
insert into entity_type (key) values ('life_area') on conflict (key) do nothing;
