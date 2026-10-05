-- Migration 0052: a new account starts with AI OFF (Dave, 2026-10-05).
--
-- Until now an account with no `ai_allowed` in its app_metadata was ALLOWED:
-- absent meant on, and only an explicit false blocked (src/ai/aiGate.ts,
-- adminAiAllowed). Every tester who signed up therefore had AI the moment
-- they arrived, which is the opposite of the demo-week rule that testers
-- start with it off and the admin turns it on (Settings > Admin > AI Allowed,
-- api/admin/users.ts, which writes app_metadata.ai_allowed with the service
-- key).
--
-- This stamps the flag at the one place every signup passes through: a BEFORE
-- INSERT trigger on auth.users. It covers an email sign-up, a magic link, Sign
-- in with Apple and an admin invite alike, and it needs no change to the app
-- or the proxy: api/ai.ts already refuses an explicit false with a 403 and the
-- app already says "Turned off by admin".
--
--   * Only a row that carries NO ai_allowed key is stamped. An insert that
--     names the key (an admin creating an account with it on) keeps its value.
--   * It merges into raw_app_meta_data, never replaces it: GoTrue writes the
--     provider and providers there on the same insert.
--   * It does NOT touch an existing account. Accounts created before this
--     migration keep behaving as they did (absent = allowed); which of them
--     to switch off is the admin's call, one switch each in the Admin panel.
--   * The function is not reachable from the API: execute is revoked from
--     everyone, and a trigger function needs no grant to fire.
--
-- Forward twice is a no-op. Rollback: rollback/0052_ai_default_off_down.sql.

create or replace function public.ai_default_off()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.raw_app_meta_data is null then
    new.raw_app_meta_data := '{}'::jsonb;
  end if;
  if not (new.raw_app_meta_data ? 'ai_allowed') then
    new.raw_app_meta_data := new.raw_app_meta_data || jsonb_build_object('ai_allowed', false);
  end if;
  return new;
end;
$$;

revoke all on function public.ai_default_off() from public, anon, authenticated;

-- Not "drop trigger if exists ... create trigger": DROP TRIGGER takes an ACCESS
-- EXCLUSIVE lock on auth.users even when there is nothing to drop, and on a
-- live project that request queues behind GoTrue's own reads and holds every
-- sign-in behind it (found applying this to production, 2026-10-05: the
-- statement sat for over a minute). CREATE TRIGGER takes SHARE ROW EXCLUSIVE,
-- which waits for no read, so the migration asks only for that and skips the
-- create when the trigger is already there.
do $mig$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'auth.users'::regclass and tgname = 'ai_default_off' and not tgisinternal
  ) then
    create trigger ai_default_off
      before insert on auth.users
      for each row execute function public.ai_default_off();
  end if;
end
$mig$;
