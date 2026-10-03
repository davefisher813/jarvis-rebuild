-- Rollback for 0048 (the Email cache's writers and readers).
-- Not a migration: lives outside supabase/migrations so nothing applies it by
-- accident. Removes the functions, the index and the html column 0048 added.
-- Cached mail rows and bodies stay in 0044's tables; the html column's
-- content goes with the column (it is a copy of what Gmail holds).

drop function if exists policy_suggestion_answer(uuid, text);
drop function if exists policy_suggestion_offer(jsonb, text[]);
drop function if exists email_search_cached(text, uuid[], integer);
drop function if exists email_message_read(uuid);
drop function if exists email_inbox(uuid[], timestamptz, text, integer);
drop function if exists email_accounts();
drop function if exists email_action_record(uuid, uuid, text, text, text, jsonb);
drop function if exists email_labels_set(uuid, uuid, text[]);
drop function if exists email_body_store(uuid, uuid, text, text, jsonb);
drop function if exists email_sync_failed(uuid, uuid, text, boolean);
drop function if exists email_sync_apply(uuid, uuid, jsonb, text[], text, boolean);
drop function if exists email_account_state(uuid, uuid, text, text);
drop function if exists email_account_upsert(uuid, text, text[], jsonb);
drop index if exists email_message_owner_inbox_idx;
alter table email_message_body drop column if exists html;
