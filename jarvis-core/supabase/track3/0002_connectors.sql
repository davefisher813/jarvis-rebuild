-- Track 3, migration 0002: connectors (build master section 2). Tokens live
-- in Supabase Vault; these tables hold only the reference to the secret.
-- Tier 1 is the user-level OAuth connector; Tier 2 the org-level MCP server
-- list the backend assembles into mcp_servers per request. Only a SECURITY
-- DEFINER function may read vault.decrypted_secrets, never the app role.
--
-- Blocked until: a Track 3 project exists, Vault is enabled on it, and the
-- MCP rate limiter (a token bucket per org, checked before each Anthropic
-- call) has its own spec. Neither table should take live rows before that.

create table user_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null,
  provider text not null check (provider in
    ('google_calendar','gmail','microsoft365','apple_caldav','notion','slack')),
  account_email text,
  vault_secret_id uuid not null,
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active','expired','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id, provider, account_email)
);

create table org_mcp_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid,
  provider text not null,
  server_url text not null,
  vault_secret_id uuid not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table user_connections enable row level security;
alter table org_mcp_connections enable row level security;
create policy "org read" on user_connections for select using (org_id = current_org_id());
create policy "own write" on user_connections for all using (org_id = current_org_id() and user_id = auth.uid()) with check (org_id = current_org_id() and user_id = auth.uid());
create policy "org read" on org_mcp_connections for select using (org_id = current_org_id());
create policy "org write" on org_mcp_connections for all using (org_id = current_org_id()) with check (org_id = current_org_id());
