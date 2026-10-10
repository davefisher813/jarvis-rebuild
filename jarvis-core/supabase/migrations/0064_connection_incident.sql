-- Migration 0064: the durable connection incident (Email v1 spec 2026-10-08, section 10,
-- "Notifications and incident policy"; Dave's locked decisions L1 and L5; AC22 to AC24).
-- Additive; rollback in rollback/0064_connection_incident_down.sql.
--
-- NUMBERED 0064 (2026-10-10): 0060 to 0062 belong to the Phase 0 branch and 0063 is the
-- signature migration. Checked against origin/claude/phase0-foundation before writing.
--
-- What it is. The in-app half of an incident already works: the status route
-- (api/connections/status.ts) finds it, gives it a deterministic ID
-- (src/connections/incident.ts: a hash of the address, the kind and the anchor
-- instant) and the app announces it at once. The spec also asks for a DURABLE
-- server record, so that "unresolved for 15 minutes" can be decided on the server
-- whether or not the app is open: incident_id, account, first_detected_at, reasons,
-- state and the external alert's status. This table is that record. One row per
-- incident per person, written by every path that finds one (api/_incident.ts,
-- reportIncident), resolved by the status route when a fresh proof says the
-- account is healthy again, and read by the 15-minute ticker (api/_incidentWorker.ts,
-- reached as POST /api/connections/status with x-jarvis-worker: incidents).
--
--   opened_at          the incident's anchor (the instant the loss began). It is what the ID is computed from.
--   first_detected_at  when a server check first established it (this database's clock, at the first record).
--                      Not the anchor: a degraded incident anchors on the last good sync, which can be a day old,
--                      and the 15 minutes the spec gives the in-app status to be seen run from DETECTION.
--   alert_due_at       first_detected_at + 15 minutes.
--   alert_status       pending | suppressed | unavailable | submitted | failed | unknown. One way only:
--                        pending -> suppressed     the incident resolved first ("a short refresh recovery cancels it")
--                        pending -> unavailable    no user-scoped transport (today: there is none; nothing is sent)
--                        pending -> failed         a transport refused before anything left
--                        pending -> unknown        marked BEFORE a transport is called; a crash after this is never resent
--                        unknown -> submitted      the provider accepted it ("Submitted", never "Delivered")
--                        unknown -> failed         the provider refused it
--                      Nothing ever goes back to pending, so a logical alert is attempted at most once.
--
-- EXACTLY ONCE. Unique (owner_id, incident_id): a second finder of the same incident
-- (the sync route, the keep-alive worker, a status check) inserts nothing. Unique
-- (owner_id, incident_id, alert_type): the spec's logical alert key. A resolved incident
-- never reopens, because a new loss has a new anchor and so a new ID; and flapping
-- before a real recovery keeps the same anchor, so it is the same row and no new alert.
--
-- PRIVATE. The row holds the account's address because the ticker must recheck that
-- account; nothing here is ever a notification payload. The only alert text is the
-- spec's default ("JARVIS needs your attention"), kept in api/_incidentWorker.ts.
--
-- Server only: RLS on with no policy and every privilege revoked from the API roles; the
-- four functions are granted to service_role alone and check the request's verified role
-- (jarvis_is_service_request, 0044) because a security definer body cannot trust
-- current_user.

create table if not exists connection_incident (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  account_address text not null check (account_address = lower(account_address) and length(account_address) between 3 and 320),
  account_id uuid,
  incident_id text not null check (incident_id ~ '^JC-[0-9A-F]{8}$'),
  kind text not null check (kind in ('auth', 'degraded')),
  opened_at timestamptz not null,
  first_detected_at timestamptz not null default now(),
  cause text check (cause is null or length(cause) <= 80),
  code text check (code is null or length(code) <= 80),
  source text check (source is null or length(source) <= 40),
  state text not null default 'open' check (state in ('open', 'resolved')),
  resolved_at timestamptz,
  alert_type text not null default 'connection' check (alert_type in ('connection')),
  alert_due_at timestamptz not null,
  alert_status text not null default 'pending' check (alert_status in ('pending', 'suppressed', 'unavailable', 'submitted', 'failed', 'unknown')),
  alert_reason text check (alert_reason is null or length(alert_reason) <= 80),
  alert_attempted_at timestamptz,
  alert_lease_until timestamptz,
  alert_claim_token uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, incident_id),
  check ((state = 'resolved') = (resolved_at is not null))
);

create unique index if not exists connection_incident_alert_key on connection_incident (owner_id, incident_id, alert_type);
create index if not exists connection_incident_due_idx on connection_incident (alert_due_at) where state = 'open' and alert_status = 'pending';
create index if not exists connection_incident_open_idx on connection_incident (owner_id, account_address) where state = 'open';

drop trigger if exists connection_incident_touch on connection_incident;
create trigger connection_incident_touch before insert or update on connection_incident
  for each row execute function jarvis_touch_updated_at();

alter table connection_incident enable row level security;
revoke all on table connection_incident from public;
revoke all on table connection_incident from anon, authenticated;
grant all on table connection_incident to service_role;

-- ---- connection_incident_record: open an incident, idempotently ----
-- The first finder writes the row; every later finder (same deterministic ID) writes nothing.
create or replace function connection_incident_record(
  p_owner uuid, p_address text, p_incident text, p_kind text, p_opened_at timestamptz,
  p_cause text default null, p_code text default null, p_source text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  addr text := lower(trim(coalesce(p_address, '')));
  acct uuid;
  n integer;
begin
  if not jarvis_is_service_request() then raise exception 'server only' using errcode = '42501'; end if;
  if p_owner is null or length(addr) < 3 or length(addr) > 320 or p_opened_at is null
     or coalesce(p_incident, '') !~ '^JC-[0-9A-F]{8}$' or coalesce(p_kind, '') not in ('auth', 'degraded') then
    return jsonb_build_object('error', 'INVALID_PAYLOAD');
  end if;
  select id into acct from email_account where owner_id = p_owner and address = addr limit 1;
  insert into connection_incident (owner_id, account_address, account_id, incident_id, kind, opened_at, first_detected_at,
                                   cause, code, source, alert_due_at)
  values (p_owner, addr, acct, p_incident, p_kind, p_opened_at, now(),
          left(p_cause, 80), left(p_code, 80), left(p_source, 40), now() + interval '15 minutes')
  on conflict (owner_id, incident_id) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('recorded', n = 1, 'incident_id', p_incident);
end;
$$;

-- ---- connection_incident_resolve: an account proved healthy again ----
-- Every open incident on the account ends, and an alert still pending is suppressed (never sent). An alert already past
-- pending keeps its status: it was attempted once, and that stays the record.
create or replace function connection_incident_resolve(p_owner uuid, p_address text, p_reason text default 'recovered')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  addr text := lower(trim(coalesce(p_address, '')));
  resolved integer;
  suppressed integer;
begin
  if not jarvis_is_service_request() then raise exception 'server only' using errcode = '42501'; end if;
  if p_owner is null or addr = '' then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  with ended as (
    update connection_incident
       set state = 'resolved', resolved_at = now(),
           alert_status = case when alert_status = 'pending' then 'suppressed' else alert_status end,
           alert_reason = case when alert_status = 'pending' then left(coalesce(p_reason, 'recovered'), 80) else alert_reason end,
           alert_lease_until = case when alert_status = 'pending' then null else alert_lease_until end
     where owner_id = p_owner and account_address = addr and state = 'open'
    returning (alert_status = 'suppressed') as was_pending
  )
  select count(*), count(*) filter (where was_pending) into resolved, suppressed from ended;
  return jsonb_build_object('resolved', resolved, 'suppressed', suppressed);
end;
$$;

-- ---- connection_incident_claim: the ticker takes the alerts that are due ----
-- Due, still open, still pending, and not leased by another tick. Locked with skip locked and leased for p_lease, so two
-- ticks in the same instant never take the same row, and a tick that dies lets the row come back after the lease.
create or replace function connection_incident_claim(p_limit integer default 10, p_lease interval default interval '2 minutes')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  out jsonb;
begin
  if not jarvis_is_service_request() then raise exception 'server only' using errcode = '42501'; end if;
  with due as (
    select id from connection_incident
     where state = 'open' and alert_status = 'pending' and alert_due_at <= now()
       and (alert_lease_until is null or alert_lease_until <= now())
     order by alert_due_at
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 10), 50))
  ), taken as (
    update connection_incident c
       set alert_lease_until = now() + coalesce(p_lease, interval '2 minutes'), alert_claim_token = gen_random_uuid()
      from due where c.id = due.id
    returning c.id, c.owner_id, c.account_address, c.account_id, c.incident_id, c.kind, c.opened_at, c.first_detected_at, c.alert_due_at, c.alert_claim_token
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'owner_id', owner_id, 'account_address', account_address, 'account_id', account_id, 'incident_id', incident_id,
    'kind', kind, 'opened_at', opened_at, 'first_detected_at', first_detected_at, 'alert_due_at', alert_due_at,
    'claim_token', alert_claim_token) order by alert_due_at), '[]'::jsonb)
    into out from taken;
  return out;
end;
$$;

-- ---- connection_incident_alert_settle: the one attempt's outcome ----
-- Only the claim's holder (the token) may settle, and only forward along the one-way path in the header. Marking
-- 'unknown' (the pre-dispatch mark) also requires the incident to be open, so an incident resolved between the claim and
-- the send is never sent.
create or replace function connection_incident_alert_settle(p_id uuid, p_token uuid, p_status text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c connection_incident%rowtype;
begin
  if not jarvis_is_service_request() then raise exception 'server only' using errcode = '42501'; end if;
  if p_id is null or p_token is null or coalesce(p_status, '') not in ('unavailable', 'failed', 'unknown', 'submitted') then
    return jsonb_build_object('error', 'INVALID_PAYLOAD');
  end if;
  select * into c from connection_incident where id = p_id for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if c.alert_claim_token is distinct from p_token then return jsonb_build_object('settled', false, 'alert_status', c.alert_status); end if;
  if not (
       (c.alert_status = 'pending' and p_status in ('unavailable', 'failed') )
    or (c.alert_status = 'pending' and p_status = 'unknown' and c.state = 'open')
    or (c.alert_status = 'unknown' and p_status in ('submitted', 'failed'))
  ) then
    return jsonb_build_object('settled', false, 'alert_status', c.alert_status);
  end if;
  update connection_incident
     set alert_status = p_status,
         alert_reason = left(coalesce(p_reason, alert_reason), 80),
         alert_attempted_at = coalesce(alert_attempted_at, now()),
         alert_lease_until = null
   where id = c.id
  returning * into c;
  return jsonb_build_object('settled', true, 'alert_status', c.alert_status);
end;
$$;

revoke all on function connection_incident_record(uuid, text, text, text, timestamptz, text, text, text) from public, anon, authenticated;
revoke all on function connection_incident_resolve(uuid, text, text) from public, anon, authenticated;
revoke all on function connection_incident_claim(integer, interval) from public, anon, authenticated;
revoke all on function connection_incident_alert_settle(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function connection_incident_record(uuid, text, text, text, timestamptz, text, text, text) to service_role;
grant execute on function connection_incident_resolve(uuid, text, text) to service_role;
grant execute on function connection_incident_claim(integer, interval) to service_role;
grant execute on function connection_incident_alert_settle(uuid, uuid, text, text) to service_role;
