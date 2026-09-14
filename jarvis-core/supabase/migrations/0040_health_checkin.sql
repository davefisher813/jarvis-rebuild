-- Migration 0040: register the check-in entity type (the Health page to the
-- reference, 2026-09-14).
--
-- item.entity_type references this registry, and an unregistered type
-- rejects every insert (migration 0029). A check-in is two words a person
-- picked, energy and mood, and an optional note, at a moment. Nothing is
-- scored and nothing else about it reaches the database.
insert into entity_type (key) values
  ('health_checkin')
on conflict (key) do nothing;
