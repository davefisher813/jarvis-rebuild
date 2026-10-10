-- OPS SCRIPT, NOT A MIGRATION. Run once per project, by hand, after migration 0064 and after the deploy that carries
-- api/_incidentWorker.ts, reached as POST /api/connections/status with x-jarvis-worker: incidents (Email v1 spec
-- section 10, Dave's locked decision L1). It is kept out of migrations/ on purpose: the migration chain runs on a plain
-- Postgres in CI, which has no pg_cron, pg_net or vault.
--
-- What it makes: the 15-minute clock for connection incidents. Postgres calls the route once a minute, but only while
-- an alert is actually due (an open incident, its alert still pending, past alert_due_at, not leased by a tick in
-- flight), so an idle project makes no calls at all. The route rechecks each due incident against the same truth the
-- status route uses, suppresses the alert when the account has recovered, and otherwise asks for a user-scoped push
-- transport. There is none yet (no APNs key; the backend's web push broadcasts to every device), so it records the
-- alert as 'unavailable' and sends nothing. The in-app status is shown either way.
--
-- The route proves the caller by asking the database (incident_cron_ok), so the secret never lives in an env var, a
-- log or the repo: it is generated here, in the vault, and read by the job and the check inside Postgres only. It is
-- its own secret, not the outbox's, so either clock can be stopped or rotated alone.
--
-- Safe to run twice. To stop the clock: select cron.unschedule('jarvis-incidents');   (due alerts then stay pending
-- and the in-app status is unaffected; the next run of this script picks them up.)

create extension if not exists pg_net;
create extension if not exists pg_cron;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'incident_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'incident_cron_secret', 'Bearer token for POST /api/connections/status (x-jarvis-worker: incidents)');
  end if;
end $$;

create or replace function public.incident_cron_ok(p_token text)
returns boolean
language sql
stable
security definer
set search_path = public, vault
as $$
  select coalesce(
    nullif(p_token, '') is not null
    and p_token = (select decrypted_secret from vault.decrypted_secrets where name = 'incident_cron_secret' limit 1),
    false);
$$;
revoke all on function public.incident_cron_ok(text) from public, anon, authenticated;
grant execute on function public.incident_cron_ok(text) to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'jarvis-incidents';
-- Every minute. pg_cron's interval form takes seconds only ('[1-59] seconds'), so a minute is the cron expression.
select cron.schedule('jarvis-incidents', '* * * * *', $job$
  select net.http_post(
    url := 'https://jarvis-rebuild.vercel.app/api/connections/status',
    headers := jsonb_build_object('content-type', 'application/json', 'x-jarvis-worker', 'incidents', 'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'incident_cron_secret' limit 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000)
  where exists (
    select 1 from public.connection_incident
     where state = 'open' and alert_status = 'pending' and alert_due_at <= now()
       and (alert_lease_until is null or alert_lease_until <= now()))
$job$);
