-- Rollback for 0066: delete_owned back to its 0062 body (connection_incident rows are no longer
-- removed by account deletion). Rows already deleted stay deleted.

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
