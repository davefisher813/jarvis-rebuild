-- Track 3, migration 0006: what the security advisor found after 0001 to
-- 0005 ran on the project (2026-09-14). The two org tables had no row
-- security at all, so the anon key could read every org. Reads are scoped
-- to the caller's own org or memberships; there is no client write policy
-- on either table on purpose (an org and its first member are created
-- server side with the service role at sign up).

alter table orgs enable row level security;
alter table org_members enable row level security;

create policy "member read" on orgs for select
  using (id = current_org_id()
    or exists (select 1 from org_members m where m.org_id = orgs.id and m.user_id = auth.uid()));
create policy "member read" on org_members for select
  using (org_id = current_org_id() or user_id = auth.uid());

-- A function with a mutable search_path can be pointed at a look-alike
-- table by a caller who controls the path; pin every helper to public.
alter function current_org_id() set search_path = public;
alter function can_view_shared_project(uuid) set search_path = public;
alter function can_edit_shared_project(uuid) set search_path = public;
alter function check_shared_projects_scope() set search_path = public;

-- Extensions live in the extensions schema on Supabase, not public.
alter extension btree_gist set schema extensions;
