-- Migration 0022: ai_usage rows record WHAT ran, not just that something ran.
--
-- 0019 added the kind column but nothing wrote it; ai_try_consume inserted
-- only user_id, so What Ran (AI Control, addendum item 20) would have had
-- nothing to show. This replaces ai_try_consume with a four-argument version
-- whose admission insert carries the call's kind slug.
--
-- The old three-argument overload is DROPPED, not kept: two overloads would
-- make PostgREST's function resolution ambiguous. Until this migration runs,
-- the proxy's four-argument call 404s and api/ai.ts falls back to its legacy
-- two-step path (still capped, still records kind on its own insert), so the
-- window between deploy and paste is safe.
--
-- Called only by the server (service role) from api/ai.ts. Not callable by
-- app users.

drop function if exists ai_try_consume(uuid, int, int);

create or replace function ai_try_consume(
  p_user uuid,
  p_user_cap int,
  p_global_cap int,
  p_kind text default ''
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

  insert into ai_usage (user_id, kind) values (p_user, coalesce(p_kind, ''));
  return jsonb_build_object('allowed', true);
end;
$$;

revoke all on function ai_try_consume(uuid, int, int, text) from public;
revoke all on function ai_try_consume(uuid, int, int, text) from anon;
revoke all on function ai_try_consume(uuid, int, int, text) from authenticated;
