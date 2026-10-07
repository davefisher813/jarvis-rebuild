-- Migration 0056: the last proof of each mailbox (Foundation Fix Spec 1,
-- 2026-10-06). Additive; rollback in rollback/0056_connection_health_down.sql.
--
-- api/connections/status.ts proves an account by refreshing its token and
-- making one named read against Gmail. This keeps the sanitized result on the
-- account row so the next status call inside five minutes does not go back to
-- Google, and so a receipt survives the request that made it. The jsonb holds
-- the status record only: a state, a machine error code, timestamps, the name
-- of the operation tested. Never a token, never mail, never provider text.
--
-- Written by the server alone (service role). The person's own session reads
-- the row through email_accounts() exactly as before; this adds no read path.
alter table email_account add column if not exists connection_health jsonb;
alter table email_account add column if not exists connection_health_at timestamptz;

create or replace function email_account_health_record(p_owner uuid, p_address text, p_health jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  if p_owner is null or coalesce(length(p_address), 0) = 0 or p_health is null then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  update email_account set connection_health = p_health, connection_health_at = now()
   where owner_id = p_owner and address = lower(p_address);
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  return jsonb_build_object('recorded', true);
end;
$$;

revoke all on function email_account_health_record(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function email_account_health_record(uuid, text, jsonb) to service_role;
