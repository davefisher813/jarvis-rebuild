-- RENUMBERED 2026-10-06 from 0042_money_ledger.sql to 0055 (Foundation Fix
-- Spec 5): it collided with 0042_brain_memory.sql. Filename only; the body
-- below is unchanged and was already applied to production under the old name.
--
-- MONEY LEDGER (build spec 2026-10-02). Bills and receipts are their own
-- entity types, the repo's convention of one type per kind (see 0041 for why):
-- every list the Money screen draws wants one kind at a time and listForUser
-- filters by type server side.
--
-- Registering them is not optional: item.entity_type references this table, so
-- an unregistered type rejects every insert and the app swallows the rejection
-- as a dead button (laws/entityRegistry.test.ts enforces the pair). THIS
-- MIGRATION MUST BE APPLIED BEFORE THE APP BUILD THAT WRITES THESE TYPES IS
-- DEPLOYED.
--
-- Transactions and budgets reuse money_tx and money_budget from 0041; the
-- ledger only adds optional fields inside their jsonb, so no change here.
insert into entity_type (key) values
  ('money_bill'), ('money_receipt')
on conflict (key) do nothing;
