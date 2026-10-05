-- Rollback of 0052: new accounts are no longer stamped ai_allowed = false.
-- Accounts already stamped keep the flag (it is data, not schema); clear one
-- with the Admin panel's AI Allowed switch.
--
-- DROP TRIGGER takes an ACCESS EXCLUSIVE lock on auth.users, which queues
-- behind GoTrue's reads on a live project and holds sign-ins behind it. On a
-- real project run it with `set lock_timeout = '3s'` and retry if it times out.
drop trigger if exists ai_default_off on auth.users;
drop function if exists public.ai_default_off();
