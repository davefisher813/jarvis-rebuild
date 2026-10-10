-- Rollback of 0065: the coverage functions go, and email_accounts() goes back to 0063's body.
--
-- sync_epoch and coverage_crawl are dropped: they are this migration's own working state (a crawl's
-- page tokens and epoch) and hold no mail and no record. sync_state, coverage_start and
-- verified_through_at STAY: production carried them before this migration (a production-only
-- migration added them), so dropping them here would remove columns this file never owned.
-- No message, draft or saved record is touched.
drop function if exists email_coverage_checked(uuid, uuid, integer, boolean);
drop function if exists email_coverage_complete(uuid, uuid, integer, jsonb, text[], text);
drop function if exists email_coverage_page(uuid, uuid, integer, text, text, text, jsonb, text[]);
drop function if exists email_coverage_begin(uuid, uuid, text, text[], integer);
drop function if exists email_coverage_state(uuid, uuid);
drop function if exists jarvis_coverage_json(email_account);

create or replace function email_accounts()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'address', a.address, 'state', a.state, 'last_sync_at', a.last_sync_at, 'sync_error', a.sync_error,
    'capabilities', a.capabilities, 'connected_at', a.connected_at, 'scopes', a.scopes,
    'signature_text', a.signature_text, 'signature_revision', a.signature_revision,
    'cached', (select count(*) from email_message m where m.account_id = a.id and m.deleted_at is null)) order by a.connected_at), '[]'::jsonb)
  from email_account a where a.owner_id = auth.uid();
$$;

alter table email_account drop column if exists coverage_crawl;
alter table email_account drop column if exists sync_epoch;
