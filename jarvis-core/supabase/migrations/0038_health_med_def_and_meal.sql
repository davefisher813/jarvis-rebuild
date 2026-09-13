-- Migration 0038: register the two entity types Health Push D writes
-- (JARVIS_HEALTH_BUILD_MASTER_2026_09_12.md, section 5).
--
-- item.entity_type references this registry, and an unregistered type
-- rejects every insert (migration 0029 learned this the hard way). A
-- medication is a name and an amount the person typed, with no schedule;
-- a meal is a line of text. Nothing else about either reaches the database.
insert into entity_type (key) values
  ('health_med_def'), ('health_meal')
on conflict (key) do nothing;
