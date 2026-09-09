-- Migration 0034: delete_owned(p_uid) (UP-LAUNCH-06, 2026-09-05).
--
-- Account deletion walked five tables with five separate REST calls, in
-- order, throwing on the first failure. That is honest but not atomic: a
-- network drop between the third and the fourth leaves an account whose
-- notes are gone and whose event log is not. The endpoint retries safely
-- (every step is idempotent), but a person who tapped Delete Account and got
-- an error has no idea which half happened.
--
-- One function, one transaction, all five tables or none of them.
--
-- SECURITY DEFINER so the function can delete past row level security, and a
-- pinned empty search_path so nothing on the caller's path can be resolved
-- instead of the intended table. EXECUTE is granted to service_role only:
-- the endpoint that calls this has already verified the caller's own JWT and
-- passes the id Supabase returned for that token, so a client can never
-- reach this with somebody else's uid. Revoking from public and authenticated
-- is the load-bearing half of that sentence.
--
-- feedback is deliberately absent: a bug report is a message to us, not the
-- user's data, and migration 0033 sets its user_id to null when the auth user
-- goes. email_opens and google_tokens are absent too, for the opposite
-- reason: both cascade from auth.users already (0017, 0018).
create or replace function delete_owned(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.item where owner_id = p_uid;
  delete from public.scalar_setting where owner_id = p_uid;
  delete from public.event_log where owner_id = p_uid;
  delete from public.ai_usage where user_id = p_uid;
  delete from public.ai_tokens where user_id = p_uid;
end;
$$;

revoke all on function delete_owned(uuid) from public;
revoke all on function delete_owned(uuid) from anon;
revoke all on function delete_owned(uuid) from authenticated;
grant execute on function delete_owned(uuid) to service_role;
