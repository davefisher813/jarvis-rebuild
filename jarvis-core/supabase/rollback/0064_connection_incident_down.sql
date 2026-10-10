-- Rollback of 0064: the durable incident ledger and its four functions go. The in-app half is untouched (the status
-- route still finds, announces and sink-reports every incident; api/_incident.ts treats a missing function as a
-- logged non-event), so nothing the person sees changes. What is lost is the record of past incidents and their alert
-- outcomes. Unschedule the ticker first if ops/incident_worker_cron.sql was run:
--   select cron.unschedule('jarvis-incidents');
-- (its WHERE reads this table, so a tick after the drop errors inside pg_cron and calls nothing.)
drop function if exists connection_incident_record(uuid, text, text, text, timestamptz, text, text, text);
drop function if exists connection_incident_resolve(uuid, text, text);
drop function if exists connection_incident_claim(integer, interval);
drop function if exists connection_incident_alert_settle(uuid, uuid, text, text);
drop table if exists connection_incident;
