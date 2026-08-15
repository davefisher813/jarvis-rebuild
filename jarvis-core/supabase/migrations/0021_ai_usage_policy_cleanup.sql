-- 0021_ai_usage_policy_cleanup.sql
-- The 2026-08-15 audit found one policy still attached to ai_usage in prod
-- (created manually before 0019; its name did not match anything 0019 dropped).
-- ai_usage is service-role only: RLS enabled, ZERO policies. This drops every
-- policy on the table regardless of name, idempotently. Dave ran this exact
-- block in the SQL editor on 2026-08-15; committed here so repo and prod agree.
do $$
declare r record;
begin
  for r in select policyname from pg_policies where tablename = 'ai_usage'
  loop
    execute format('drop policy %I on public.ai_usage', r.policyname);
  end loop;
end $$;
