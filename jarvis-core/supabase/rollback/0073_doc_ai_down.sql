-- Rollback for 0073 (Doc AI). Not a migration: lives outside supabase/migrations so nothing applies it by accident.
-- Removes the queue, the read text and the proposals. The documents themselves (user_file items and their bytes) are untouched;
-- only their `doc` block is left behind as inert JSON the app ignores once the feature flag doc_ai_v1 is off.
-- Run ops/doc_worker_cron.sql's unschedule first: select cron.unschedule('jarvis-docs');

drop trigger if exists doc_forget_on_file_delete on item;
drop function if exists doc_forget_file();
drop function if exists doc_proposal_decide(uuid, text, jsonb, text);
drop function if exists doc_put_proposal(uuid, uuid, text, text, jsonb);
drop function if exists doc_put_text_user(uuid, text, jsonb, integer);
drop function if exists doc_put_text(uuid, uuid, text, text, jsonb, integer, integer[], integer[], integer);
drop function if exists doc_sweep();
drop function if exists doc_finish(uuid, uuid, text, text, text, interval, text);
drop function if exists doc_extend(uuid, uuid, interval);
drop function if exists doc_mark_dispatched(uuid, uuid, text, interval);
drop function if exists doc_claim(text, interval);
drop function if exists doc_enqueue(uuid, boolean, boolean);
drop function if exists doc_job_owner(uuid, uuid);
drop function if exists doc_patch_file(uuid, uuid, jsonb, boolean);
drop function if exists doc_cron_ok(text);
drop table if exists doc_proposal;
drop table if exists doc_text;
drop table if exists doc_job;
