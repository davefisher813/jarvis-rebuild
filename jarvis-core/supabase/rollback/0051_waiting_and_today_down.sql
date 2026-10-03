-- Rollback for 0051 (Waiting doors and the Today reads).
-- Not a migration: lives outside supabase/migrations so nothing applies it by
-- accident. Removes the eight functions; waiting records, actions and
-- receipts already written stay (receipts are append-only by design).

drop function if exists candidate_review_count();
drop function if exists evidence_read(uuid);
drop function if exists threads_latest(text[]);
drop function if exists thread_messages(text, uuid);
drop function if exists waiting_follow_up(uuid, date, text, timestamptz);
drop function if exists waiting_reopen(uuid, text, timestamptz);
drop function if exists waiting_resolve(uuid, text, text, timestamptz);
drop function if exists jarvis_waiting_write(uuid, jsonb, text[], text, text, jsonb, text, timestamptz);
