-- MONEY TRACKER (PASSOFF 2026-09-19). The Tracker screen on the Money page
-- stores four kinds of record. Each one is its own entity_type rather than a
-- single 'money' type carrying a kind field, because every list this screen
-- draws wants one kind at a time and listForUser already filters by type
-- server side.
--
-- Registering them is not optional: item.entity_type references this table,
-- so an unregistered type rejects every insert and the app swallows the
-- rejection as a dead button (laws/entityRegistry.test.ts enforces the pair).
insert into entity_type (key) values
  ('money_account'), ('money_tx'), ('money_budget'), ('money_sub')
on conflict (key) do nothing;
