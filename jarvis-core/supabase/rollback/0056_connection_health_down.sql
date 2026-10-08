-- Rollback of 0056: the recorded proofs are derived, and the next status call
-- makes a fresh one, so nothing is lost for good.
drop function if exists public.email_account_health_record(uuid, text, jsonb);
alter table email_account drop column if exists connection_health_at;
alter table email_account drop column if exists connection_health;
