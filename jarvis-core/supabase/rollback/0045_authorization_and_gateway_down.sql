-- Rollback for 0045 (authorization, scoped context and the agent gateway).
-- Not a migration: lives outside supabase/migrations so nothing applies it by
-- accident. Removes the functions and the private rate table 0045 added and
-- the token index. Rows the functions wrote (packages, proposals, receipts,
-- grants) are the person's records and are left where they are; 0044's tables
-- hold them without these functions.

drop function if exists proposals_import(uuid, jsonb, text);
drop function if exists connection_revoke(uuid);
drop function if exists action_status(uuid, uuid, uuid);
drop function if exists review_link(uuid, uuid, uuid);
drop function if exists draft_submit(uuid, uuid, uuid, jsonb);
drop function if exists proposal_submit(uuid, uuid, uuid, text, text, jsonb, uuid[], text);
drop function if exists jarvis_payload_clean(jsonb);
drop function if exists context_packages_sweep();
drop function if exists context_snapshot_store(uuid, uuid, text);
drop function if exists context_issue(uuid, text, uuid[], text[], text, uuid, uuid);
drop function if exists scope_grant_create(uuid, text, text, uuid[], text[], text);
drop function if exists context_preview(uuid, uuid[], text[], text, uuid, uuid);
drop function if exists agent_capabilities(uuid, uuid);
drop function if exists agent_rate_take(uuid, integer);
drop function if exists agent_resolve_token(text);
drop function if exists agent_connection_verify(uuid, uuid, text, text[], text);
drop function if exists jarvis_context_shape(uuid, uuid, uuid[], text[]);
drop function if exists jarvis_context_rows(uuid, uuid, uuid[], text[]);
drop function if exists jarvis_context_fields(text);
drop function if exists jarvis_record(uuid, text, text, uuid, text, text, text, text, text, text, text, uuid[], uuid, uuid);
drop function if exists jarvis_ai_switch(uuid);
drop index if exists jarvis_private.agent_credential_token_hash_idx;
drop table if exists jarvis_private.agent_rate;
