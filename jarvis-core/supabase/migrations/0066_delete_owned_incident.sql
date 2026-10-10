-- Migration 0066: account deletion reaches connection_incident (2026-10-10, Email v1).
--
-- connection_incident (0064) holds one row per connection problem, keyed by owner_id with the
-- mailbox's address on it, and declares no foreign key to auth.users, so neither the auth delete
-- nor delete_owned (0062, the one transaction account deletion and the tester wipe both run)
-- removed it: a deleted or wiped account kept its incidents, address included. This is the 0062
-- body with one line, before the mail rows. Nothing else changes; no table, no grant beyond the
-- three 0062 states again.
--
-- Rollback: rollback/0066_delete_owned_incident_down.sql restores the 0062 body. Roll 0066 back
-- before 0064: this body names connection_incident, which 0064's rollback removes.

create or replace function delete_owned(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.receipt_event where owner_id = p_uid;
  delete from public.approval where owner_id = p_uid;
  delete from public.email_candidate where owner_id = p_uid;
  delete from public.email_draft where owner_id = p_uid;
  delete from public.action where owner_id = p_uid;
  delete from public.proposal where owner_id = p_uid;
  delete from public.context_package where owner_id = p_uid;
  delete from public.job where owner_id = p_uid;
  delete from public.scope_grant where owner_id = p_uid;
  delete from public.policy_suggestion where owner_id = p_uid;
  delete from public.decision_dependency where owner_id = p_uid;
  delete from public.decision_version where owner_id = p_uid;
  delete from public.source_evidence where owner_id = p_uid;
  delete from public.connection_incident where owner_id = p_uid;
  delete from public.email_message_body where owner_id = p_uid;
  delete from public.email_message where owner_id = p_uid;
  delete from public.email_account where owner_id = p_uid;
  delete from public.agent_connection where owner_id = p_uid;
  delete from public.ai_budget_reservation where user_id = p_uid;
  delete from public.ai_budget where user_id = p_uid;
  delete from public.device_token where user_id = p_uid;
  delete from public.google_reconnect_attempt where user_id = p_uid;
  delete from public.item_link where owner_id = p_uid;
  delete from public.item where owner_id = p_uid;
  delete from public.scalar_setting where owner_id = p_uid;
  delete from public.event_log where owner_id = p_uid;
  delete from public.ai_usage where user_id = p_uid;
  delete from public.ai_tokens where user_id = p_uid;
  delete from public.item_change where owner_id = p_uid;
end;
$$;
revoke all on function delete_owned(uuid) from public;
revoke all on function delete_owned(uuid) from anon, authenticated;
grant execute on function delete_owned(uuid) to service_role;
