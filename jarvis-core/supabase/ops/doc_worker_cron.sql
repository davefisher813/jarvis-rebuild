-- OPS SCRIPT, NOT A MIGRATION. Run once per project, by hand, after migration 0073 and after the deploy that carries
-- api/_docWorker.ts, reached as POST /api/ai with x-jarvis-worker: docs (Doc AI Phase 1). Kept out of migrations/ on purpose: the migration
-- chain runs on a plain Postgres in CI, which has no pg_cron, pg_net or vault.
--
-- What it makes: the clock that reads documents. Postgres calls POST /api/ai (x-jarvis-worker: docs) every ten seconds, but only while a
-- job is due or a dead tick needs sweeping, so an idle project makes no calls. The route proves the caller by asking the database
-- (doc_cron_ok); the secret lives in the vault, never in an env var, a log or the repo.
--
-- Safe to run twice. To stop the clock: select cron.unschedule('jarvis-docs');   (documents then wait as "Saved", unread.)

create extension if not exists pg_net;
create extension if not exists pg_cron;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'doc_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'doc_cron_secret', 'Bearer token for POST /api/ai (x-jarvis-worker: docs)');
  end if;
end $$;

create or replace function public.doc_cron_ok(p_token text)
returns boolean
language sql
stable
security definer
set search_path = public, vault
as $$
  select coalesce(
    nullif(p_token, '') is not null
    and p_token = (select decrypted_secret from vault.decrypted_secrets where name = 'doc_cron_secret' limit 1),
    false);
$$;
revoke all on function public.doc_cron_ok(text) from public, anon, authenticated;
grant execute on function public.doc_cron_ok(text) to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'jarvis-docs';
select cron.schedule('jarvis-docs', '10 seconds', $job$
  select net.http_post(
    url := 'https://jarvis-rebuild.vercel.app/api/ai',
    headers := jsonb_build_object('content-type', 'application/json', 'x-jarvis-worker', 'docs', 'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'doc_cron_secret' limit 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000)
  where exists (
    select 1 from public.doc_job
     where (state = 'pending' and run_after <= now()) or (state in ('claimed', 'dispatched') and claim_expires_at <= now()))
$job$);
