-- Rollback of 0053: the crash report table goes, and with it every stored
-- report. The receiver treats a failed insert as a logged non-event (it still
-- answers 204), so rolling back this table first is safe; the one-line
-- console.error log keeps working. Drop the Errors section's endpoint with it
-- or the Admin panel will say "Errors Are Not Loaded".
drop table if exists public.client_error;
