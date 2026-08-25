-- Migration 0028: register the month_seal entity type (insights groundwork,
-- 2026-08-25). One small record per closed month, written silently at the
-- boundary, because past state cannot be reconstructed: the durable window is
-- 30 days, mood trims to 14, Time Sense caps at 1000 samples, routine keeps
-- no history. Month over month must compare two sealed records. Same commit
-- as the type's code, per the standing rule: an unregistered type rejects
-- every insert.
insert into entity_type (key) values ('month_seal') on conflict (key) do nothing;
