-- Migration 0027: register the strand entity type (Brain Layer 2, queue item
-- 04). Strands are the genome: low-volume, so they ride the item table, per
-- the standing registry rule. Same commit as the type's code.
insert into entity_type (key) values ('strand') on conflict (key) do nothing;
