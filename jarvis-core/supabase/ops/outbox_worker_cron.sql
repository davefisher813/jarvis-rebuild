-- OPS SCRIPT, NOT A MIGRATION. Run once per project, by hand, after migration 0059 and after the deploy that carries
-- api/cron/outbox.ts (Email v1, the 30-second send hold). It is kept out of migrations/ on purpose: the migration chain
-- runs on a plain Postgres in CI, which has no pg_cron, pg_net or vault.
--
-- What it makes: the clock that sends held messages. Postgres calls POST /api/cron/outbox every ten seconds, but only
-- while there is something due, so an idle project makes no calls at all. The route proves the caller by asking the
-- database (outbox_cron_ok), so the secret never lives in an env var, a log or the repo: it is generated here, in the
-- vault, and read by the job and the check inside Postgres only.
--
-- Safe to run twice. To stop the clock: select cron.unschedule('jarvis-outbox');   (held sends then wait, and past
-- their deadline are cancelled as HOLD_EXPIRED rather than sent late.)

create extension if not exists pg_net;
create extension if not exists pg_cron;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'outbox_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'outbox_cron_secret', 'Bearer token for POST /api/cron/outbox');
  end if;
end $$;

create or replace function public.outbox_cron_ok(p_token text)
returns boolean
language sql
stable
security definer
set search_path = public, vault
as $$
  select coalesce(
    nullif(p_token, '') is not null
    and p_token = (select decrypted_secret from vault.decrypted_secrets where name = 'outbox_cron_secret' limit 1),
    false);
$$;
revoke all on function public.outbox_cron_ok(text) from public, anon, authenticated;
grant execute on function public.outbox_cron_ok(text) to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'jarvis-outbox';
select cron.schedule('jarvis-outbox', '10 seconds', $job$
  select net.http_post(
    url := 'https://jarvis-rebuild.vercel.app/api/cron/outbox',
    headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'outbox_cron_secret' limit 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000)
  where exists (
    select 1 from public.outbox_command
     where hold_until is not null
       and ((state = 'queued' and hold_until <= now()) or (state in ('claimed', 'dispatched') and claim_expires_at <= now())))
$job$);
