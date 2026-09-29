-- Migration 0043: ai_spend_budget. A hard, per-user AI dollar cap.
--
-- Money is integer micro-USD ($1 = 1,000,000; the $5 default is 5,000,000).
-- The cap is a NON-RESETTING "since period_start" balance: no period has been
-- chosen yet, so nothing here ever resets automatically. Changing the limit
-- never touches spent.
--
-- The invariant every function below protects:
--     spent + held <= limit        at the moment any call is admitted
-- where held is the sum of maximum costs of admitted, unsettled calls. A call
-- is admitted only if spent + held + its own maximum cost fits, so cumulative
-- dispatch can never exceed the cap even with any number of concurrent
-- handlers. All budget mutations serialise on the user's budget row.
--
-- A reservation walks reserved -> dispatched -> settled, or reserved ->
-- released. A dispatched call may have been billed whether or not an answer
-- came back, so its hold is NEVER released on a timeout; it stays held until
-- settled with the real usage or conservatively settled at its reserved
-- amount by ai_budget_reconcile_stale.
--
-- Server only. Every table and function is revoked from PUBLIC, anon and
-- authenticated; the API authenticates the caller and passes the verified id.

create table if not exists ai_budget (
  user_id uuid primary key,
  limit_microusd bigint not null default 5000000 check (limit_microusd >= 0),
  period text not null default 'since_activation',
  period_start timestamptz not null default now(),
  spent_microusd bigint not null default 0 check (spent_microusd >= 0),
  held_microusd bigint not null default 0 check (held_microusd >= 0),
  -- Set when a settled call cost more than its hold. The truth is recorded
  -- and further calls stop until the owner re-saves a limit (set_limit).
  paused boolean not null default false,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists ai_budget_reservation (
  user_id uuid not null,
  request_id text not null,
  request_hash text not null,
  model text not null,
  price_version text not null,
  reserved_microusd bigint not null check (reserved_microusd >= 0),
  actual_microusd bigint check (actual_microusd is null or actual_microusd >= 0),
  state text not null check (state in ('reserved', 'dispatched', 'settled', 'released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, request_id)
);

-- Reconciliation reads only what is still unsettled.
create index if not exists ai_budget_reservation_open_idx
  on ai_budget_reservation (state, created_at)
  where state in ('reserved', 'dispatched');

alter table ai_budget enable row level security;
alter table ai_budget_reservation enable row level security;
-- No policies on purpose: the service role bypasses RLS; everyone else is out.
revoke all on table ai_budget from public, anon, authenticated;
revoke all on table ai_budget_reservation from public, anon, authenticated;

-- ai_budget_status(user): the numbers a settings screen shows. Creates the
-- row on first sight so a new user starts at the default limit.
create or replace function ai_budget_status(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b ai_budget%rowtype;
begin
  insert into ai_budget (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into b from ai_budget where user_id = p_user;
  return jsonb_build_object(
    'limit', b.limit_microusd,
    'spent', b.spent_microusd,
    'held', b.held_microusd,
    'remaining', greatest(b.limit_microusd - b.spent_microusd - b.held_microusd, 0),
    'period', b.period,
    'periodStart', b.period_start,
    'version', b.version,
    'paused', b.paused
  );
end;
$$;

-- ai_budget_reserve: admit a call or refuse it, atomically.
-- Returns { status, ... } where status is one of:
--   reserved       hold placed (or an undispatched hold re-found): proceed
--   replay         this request id was already dispatched or settled: do NOT
--                  dispatch again (state says which)
--   hash_mismatch  same id, different request body: refused
--   over_limit     spent + held + maxCost would exceed the limit
--   paused         a prior overrun or a zero limit has paused paid AI
create or replace function ai_budget_reserve(
  p_user uuid,
  p_request_id text,
  p_hash text,
  p_model text,
  p_price_version text,
  p_max_cost bigint
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b ai_budget%rowtype;
  r ai_budget_reservation%rowtype;
begin
  if p_max_cost is null or p_max_cost < 0 then
    return jsonb_build_object('status', 'invalid');
  end if;

  insert into ai_budget (user_id) values (p_user) on conflict (user_id) do nothing;
  -- The serialisation point: every reserve for this user queues here.
  select * into b from ai_budget where user_id = p_user for update;

  select * into r from ai_budget_reservation
    where user_id = p_user and request_id = p_request_id;
  if found then
    if r.request_hash <> p_hash then
      return jsonb_build_object('status', 'hash_mismatch');
    end if;
    if r.state = 'reserved' then
      return jsonb_build_object('status', 'reserved', 'reservedMicrousd', r.reserved_microusd);
    end if;
    return jsonb_build_object('status', 'replay', 'state', r.state);
  end if;

  if b.paused or b.limit_microusd = 0 then
    return jsonb_build_object('status', 'paused',
      'remaining', greatest(b.limit_microusd - b.spent_microusd - b.held_microusd, 0));
  end if;
  if b.spent_microusd + b.held_microusd + p_max_cost > b.limit_microusd then
    return jsonb_build_object('status', 'over_limit',
      'remaining', greatest(b.limit_microusd - b.spent_microusd - b.held_microusd, 0),
      'needed', p_max_cost);
  end if;

  insert into ai_budget_reservation
    (user_id, request_id, request_hash, model, price_version, reserved_microusd, state)
    values (p_user, p_request_id, p_hash, p_model, p_price_version, p_max_cost, 'reserved');
  update ai_budget
    set held_microusd = held_microusd + p_max_cost, updated_at = now()
    where user_id = p_user;
  return jsonb_build_object('status', 'reserved', 'reservedMicrousd', p_max_cost);
end;
$$;

-- ai_budget_mark_dispatched: the one-way step taken immediately before the
-- provider request. Exactly one caller can win it for a given request id, so
-- a duplicate can never dispatch twice.
create or replace function ai_budget_mark_dispatched(p_user uuid, p_request_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update ai_budget_reservation
    set state = 'dispatched', updated_at = now()
    where user_id = p_user and request_id = p_request_id and state = 'reserved';
  get diagnostics n = row_count;
  return n = 1;
end;
$$;

-- ai_budget_settle: release the hold and record the real cost, exactly once.
-- Actual above the hold is recorded truthfully and pauses further calls.
create or replace function ai_budget_settle(p_user uuid, p_request_id text, p_actual bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b ai_budget%rowtype;
  r ai_budget_reservation%rowtype;
begin
  if p_actual is null or p_actual < 0 then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into b from ai_budget where user_id = p_user for update;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  select * into r from ai_budget_reservation
    where user_id = p_user and request_id = p_request_id for update;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  if r.state = 'settled' then
    return jsonb_build_object('status', 'already_settled');
  end if;
  if r.state = 'released' then
    return jsonb_build_object('status', 'released');
  end if;

  update ai_budget_reservation
    set state = 'settled', actual_microusd = p_actual, updated_at = now()
    where user_id = p_user and request_id = p_request_id;
  update ai_budget
    set held_microusd = greatest(held_microusd - r.reserved_microusd, 0),
        spent_microusd = spent_microusd + p_actual,
        paused = paused or (p_actual > r.reserved_microusd),
        updated_at = now()
    where user_id = p_user;
  return jsonb_build_object('status', 'settled', 'overrun', p_actual > r.reserved_microusd);
end;
$$;

-- ai_budget_release: give the hold back. Only for a call that never reached
-- the provider (state reserved), or a dispatched call the caller KNOWS cost
-- nothing (p_zero_charge, e.g. a definitive 4xx refusal). Anything else must
-- be settled, not released.
create or replace function ai_budget_release(
  p_user uuid,
  p_request_id text,
  p_zero_charge boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r ai_budget_reservation%rowtype;
begin
  perform 1 from ai_budget where user_id = p_user for update;
  select * into r from ai_budget_reservation
    where user_id = p_user and request_id = p_request_id for update;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  if r.state = 'released' then
    return jsonb_build_object('status', 'already_released');
  end if;
  if r.state = 'settled' then
    return jsonb_build_object('status', 'settled');
  end if;
  if r.state = 'dispatched' and not coalesce(p_zero_charge, false) then
    return jsonb_build_object('status', 'dispatched');
  end if;
  update ai_budget_reservation
    set state = 'released', actual_microusd = 0, updated_at = now()
    where user_id = p_user and request_id = p_request_id;
  update ai_budget
    set held_microusd = greatest(held_microusd - r.reserved_microusd, 0), updated_at = now()
    where user_id = p_user;
  return jsonb_build_object('status', 'released');
end;
$$;

-- ai_budget_set_limit: optimistic-version write of the cap. Never resets
-- spent. Lowering below spent + held simply leaves no room, which refuses
-- new calls in ai_budget_reserve. An explicit save also clears an overrun
-- pause when the new limit covers what is already spent and held.
create or replace function ai_budget_set_limit(
  p_user uuid,
  p_limit bigint,
  p_expected_version integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b ai_budget%rowtype;
begin
  if p_limit is null or p_limit < 0 then
    return jsonb_build_object('status', 'invalid');
  end if;
  insert into ai_budget (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into b from ai_budget where user_id = p_user for update;
  if b.version <> p_expected_version then
    return jsonb_build_object('status', 'version_conflict', 'version', b.version);
  end if;
  update ai_budget
    set limit_microusd = p_limit,
        version = version + 1,
        paused = case when p_limit >= spent_microusd + held_microusd then false else paused end,
        updated_at = now()
    where user_id = p_user;
  return jsonb_build_object('status', 'ok', 'version', b.version + 1);
end;
$$;

-- ai_budget_reconcile_stale: an operator step, not an automatic one. A hold
-- older than p_older_than that never dispatched is released; one that did
-- dispatch is conservatively settled at its reserved (maximum) cost, because
-- the provider may have billed it. Returns how many of each.
create or replace function ai_budget_reconcile_stale(p_older_than interval default interval '1 hour')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r ai_budget_reservation%rowtype;
  released int := 0;
  settled int := 0;
begin
  for r in
    select * from ai_budget_reservation
    where state in ('reserved', 'dispatched') and updated_at < now() - p_older_than
    order by created_at
  loop
    perform 1 from ai_budget where user_id = r.user_id for update;
    if r.state = 'reserved' then
      update ai_budget_reservation set state = 'released', actual_microusd = 0, updated_at = now()
        where user_id = r.user_id and request_id = r.request_id and state = 'reserved';
      if found then
        update ai_budget set held_microusd = greatest(held_microusd - r.reserved_microusd, 0), updated_at = now()
          where user_id = r.user_id;
        released := released + 1;
      end if;
    else
      update ai_budget_reservation set state = 'settled', actual_microusd = r.reserved_microusd, updated_at = now()
        where user_id = r.user_id and request_id = r.request_id and state = 'dispatched';
      if found then
        update ai_budget
          set held_microusd = greatest(held_microusd - r.reserved_microusd, 0),
              spent_microusd = spent_microusd + r.reserved_microusd,
              updated_at = now()
          where user_id = r.user_id;
        settled := settled + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('released', released, 'settled', settled);
end;
$$;

revoke all on function ai_budget_status(uuid) from public, anon, authenticated;
revoke all on function ai_budget_reserve(uuid, text, text, text, text, bigint) from public, anon, authenticated;
revoke all on function ai_budget_mark_dispatched(uuid, text) from public, anon, authenticated;
revoke all on function ai_budget_settle(uuid, text, bigint) from public, anon, authenticated;
revoke all on function ai_budget_release(uuid, text, boolean) from public, anon, authenticated;
revoke all on function ai_budget_set_limit(uuid, bigint, integer) from public, anon, authenticated;
revoke all on function ai_budget_reconcile_stale(interval) from public, anon, authenticated;
