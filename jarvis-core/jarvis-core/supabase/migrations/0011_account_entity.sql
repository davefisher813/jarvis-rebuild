-- Register the "account" entity (Money/finance). Mirrors prior migrations.
insert into entity_type (key) values ('account') on conflict (key) do nothing;
