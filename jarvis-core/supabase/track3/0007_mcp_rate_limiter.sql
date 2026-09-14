-- Track 3, migration 0007: the MCP rate limiter (build master section 2,
-- "a token bucket per org, checked before each Anthropic call"). One row per
-- org holds the bucket; one function takes from it atomically under a row
-- lock, refilling by elapsed time first. Only the backend (service role)
-- may call it: the app role has no execute grant, so a client cannot spend
-- or inspect another org's budget. A false return means the call waits.

create table org_mcp_rate (
  org_id uuid primary key references orgs(id) on delete cascade,
  tokens numeric not null,
  capacity int not null default 60 check (capacity > 0),
  refill_per_min numeric not null default 60 check (refill_per_min > 0),
  updated_at timestamptz not null default now()
);

alter table org_mcp_rate enable row level security;
create policy "org read" on org_mcp_rate for select using (org_id = current_org_id());

create or replace function mcp_take_token(p_org uuid, p_cost int default 1) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  r org_mcp_rate%rowtype;
  t timestamptz := clock_timestamp();
  avail numeric;
begin
  if p_cost < 1 then raise exception 'cost must be at least 1'; end if;
  insert into org_mcp_rate (org_id, tokens) values (p_org, 60) on conflict (org_id) do nothing;
  select * into r from org_mcp_rate where org_id = p_org for update;
  avail := least(r.capacity, r.tokens + extract(epoch from t - r.updated_at) / 60 * r.refill_per_min);
  if avail < p_cost then
    update org_mcp_rate set tokens = avail, updated_at = t where org_id = p_org;
    return false;
  end if;
  update org_mcp_rate set tokens = avail - p_cost, updated_at = t where org_id = p_org;
  return true;
end $$;

revoke all on function mcp_take_token(uuid, int) from public, anon, authenticated;
grant execute on function mcp_take_token(uuid, int) to service_role;
