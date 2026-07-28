-- Migration 0013: airtight AI rate limiting.
--
-- The proxy previously counted usage and then inserted a row in two separate
-- requests, leaving a small window where simultaneous calls could each pass
-- the check. This function does check-and-record inside one transaction under
-- an advisory lock, so the caps are exact under any concurrency.
--
-- Called only by the server (service role) from api/ai.ts. Not callable by
-- app users.

create or replace function ai_try_consume(
  p_user uuid,
  p_user_cap int,
  p_global_cap int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_count int;
  v_global_count int;
begin
  -- Serialize all AI admissions. At this scale the lock is held for
  -- microseconds and makes the caps mathematically exact.
  perform pg_advisory_xact_lock(779001);

  select count(*) into v_global_count
    from ai_usage where created_at >= now() - interval '24 hours';
  if p_global_cap >= 0 and v_global_count >= p_global_cap then
    return jsonb_build_object('allowed', false, 'reason', 'global');
  end if;

  select count(*) into v_user_count
    from ai_usage where user_id = p_user and created_at >= now() - interval '1 hour';
  if p_user_cap > 0 and v_user_count >= p_user_cap then
    return jsonb_build_object('allowed', false, 'reason', 'user');
  end if;

  insert into ai_usage (user_id) values (p_user);
  return jsonb_build_object('allowed', true);
end;
$$;

revoke all on function ai_try_consume(uuid, int, int) from public;
revoke all on function ai_try_consume(uuid, int, int) from anon;
revoke all on function ai_try_consume(uuid, int, int) from authenticated;
