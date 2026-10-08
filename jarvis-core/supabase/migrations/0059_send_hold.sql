-- Migration 0059: the 30-second send hold (Email v1 spec 2026-10-08, section 9,
-- Dave's locked decision 4). Additive; rollback in rollback/0059_send_hold_down.sql.
--
-- The rule. An approved send is held ON THE SERVER for 30 seconds before it can
-- be claimed. Undo inside that window is a compare-and-set on the outbox row
-- (command_cancel already does it: a queued command is cancelled and the draft
-- comes back; a claimed or dispatched one answers "already handed to Gmail").
-- If a worker cannot claim the command by dispatch_deadline (hold_until plus
-- 30 seconds) it is NOT sent late: it is cancelled as HOLD_EXPIRED and the
-- draft comes back for a fresh review. A held command is closed-browser safe:
-- nothing here depends on the page staying open.
--
--   hold_until         approved_at + 30 seconds. No claim before this.
--   dispatch_deadline  hold_until + 30 seconds. No claim after this.
--
-- Both are set by send_approve_held(), which wraps send_approve() (unchanged)
-- and stamps the hold once, on the first approval; a replay (same idempotency
-- key) returns the original timestamps and never extends the hold. A command
-- with no hold (the older inline path, a label change) keeps both null and
-- is claimable at once, exactly as before.
--
-- outbox_claim and outbox_claim_action are the production bodies with two
-- changes: a queued command inside its hold is skipped, and one past its
-- deadline is cancelled (draft freed, receipt written) instead of claimed.
-- The generic claim (the scheduled worker's) takes HELD commands only: a stray
-- unheld command, whose inline request died, is never sent by a later tick.
-- The by-action claim (the older inline path) is unchanged for those.

alter table outbox_command add column if not exists hold_until timestamptz;
alter table outbox_command add column if not exists dispatch_deadline timestamptz;
create index if not exists outbox_command_hold_idx on outbox_command (hold_until) where state = 'queued' and hold_until is not null;

create or replace function send_approve_held(p_draft uuid, p_review_nonce text, p_shown_payload_hash text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  r jsonb;
  aid uuid;
  ob outbox_command%rowtype;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  r := send_approve(p_draft, p_review_nonce, p_shown_payload_hash, p_idempotency_key);
  if r ? 'error' then return r; end if;
  aid := nullif(r ->> 'action_id', '')::uuid;
  if aid is null then return r; end if;
  select * into ob from outbox_command where action_id = aid and owner_id = owner for update;
  if not found then return r; end if;
  -- Stamp once. Everything between send_approve's writes and this one is a single transaction, so no worker can see
  -- the command queued without its hold.
  if ob.state = 'queued' and ob.hold_until is null then
    update outbox_command set hold_until = now() + interval '30 seconds', dispatch_deadline = now() + interval '60 seconds'
     where id = ob.id returning * into ob;
  end if;
  return r || jsonb_build_object('hold_until', ob.hold_until, 'dispatch_deadline', ob.dispatch_deadline, 'server_now', now(), 'outbox_state', ob.state);
end;
$$;

-- What the person's screen asks while a send is held: the command's state, the two timestamps and the server's clock
-- (the countdown is derived from server time, never from the device's clock), and what became of the draft.
create or replace function send_hold_status(p_action uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  ob outbox_command%rowtype;
  d email_draft%rowtype;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  select * into ob from outbox_command where action_id = p_action and owner_id = owner;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  select * into d from email_draft where owner_id = owner and (sent_action_id = p_action or id = (ob.payload ->> 'draft_id')::uuid) limit 1;
  return jsonb_build_object(
    'action_id', p_action, 'state', ob.state, 'error_code', ob.error_code,
    'hold_until', ob.hold_until, 'dispatch_deadline', ob.dispatch_deadline, 'server_now', now(),
    'draft_id', d.id, 'draft_state', d.send_state,
    'provider_message_id', case when ob.state = 'confirmed' then ob.provider_ack ->> 'message_id' else null end);
end;
$$;

create or replace function outbox_claim(p_worker text, p_lease interval default interval '2 minutes')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ob outbox_command%rowtype;
  a action%rowtype;
  tok uuid := gen_random_uuid();
  approved_at timestamptz;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  select * into ob from outbox_command
   where hold_until is not null and ((state = 'queued' and hold_until <= now()) or (state = 'claimed' and claim_expires_at <= now()))
   order by created_at
   for update skip locked
   limit 1;
  if not found then return null; end if;
  select * into a from action where id = ob.action_id for update;
  select consumed_at into approved_at from approval where action_id = a.id order by consumed_at desc nulls last limit 1;
  -- Recheck just before dispatch: the person approved it (a user action, the
  -- approval consumed), within the last five minutes, nothing cancelled, the
  -- account still connected.
  if a.state not in ('approved', 'running') or a.actor_kind <> 'user' or approved_at is null then
    update outbox_command set state = 'cancelled', error_code = 'NOT_APPROVED' where id = ob.id;
    perform jarvis_receipt_append(ob.owner_id, a.id, 'cancelled', left('Cancelled · ' || a.verb, 200), 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'NOT_APPROVED');
    return jsonb_build_object('skipped', ob.id, 'reason', 'NOT_APPROVED');
  end if;
  -- A held send that no worker reached by its deadline is never sent late: it comes back as a draft for a fresh look.
  if ob.state = 'queued' and ob.dispatch_deadline is not null and now() > ob.dispatch_deadline then
    update outbox_command set state = 'cancelled', error_code = 'HOLD_EXPIRED' where id = ob.id;
    update email_draft set send_state = 'draft', sent_action_id = null where owner_id = ob.owner_id and sent_action_id = a.id and send_state = 'sending';
    perform jarvis_receipt_append(ob.owner_id, a.id, 'cancelled', 'Not Sent · Held Too Long · Review It Again', 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'HOLD_EXPIRED');
    return jsonb_build_object('skipped', ob.id, 'reason', 'HOLD_EXPIRED');
  end if;
  if ob.state = 'queued' and ob.hold_until is null and approved_at + interval '5 minutes' <= now() then
    update outbox_command set state = 'cancelled', error_code = 'APPROVAL_EXPIRED' where id = ob.id;
    perform jarvis_receipt_append(ob.owner_id, a.id, 'cancelled', 'Not Sent · Approval Expired · Review It Again', 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'APPROVAL_EXPIRED');
    return jsonb_build_object('skipped', ob.id, 'reason', 'APPROVAL_EXPIRED');
  end if;
  if not exists (select 1 from email_account where id = ob.provider_account_id and owner_id = ob.owner_id and state = 'connected') then
    update outbox_command set state = 'failed', error_code = 'PROVIDER_AUTH' where id = ob.id;
    perform jarvis_receipt_append(ob.owner_id, a.id, 'failed', 'Not Sent · Reconnect Gmail', 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'PROVIDER_AUTH');
    return jsonb_build_object('skipped', ob.id, 'reason', 'PROVIDER_AUTH');
  end if;
  update outbox_command
     set state = 'claimed', claim_token = tok, claimed_by = left(coalesce(p_worker, ''), 100), claimed_at = now(), claim_expires_at = now() + p_lease, attempt = attempt + 1
   where id = ob.id;
  update action set state = 'running', attempt = ob.attempt + 1 where id = a.id;
  return jsonb_build_object('outbox_id', ob.id, 'action_id', a.id, 'owner_id', ob.owner_id, 'kind', ob.kind, 'payload', ob.payload,
                            'payload_hash', ob.payload_hash, 'provider_account_id', ob.provider_account_id, 'claim_token', tok, 'attempt', ob.attempt + 1,
                            'lease_until', now() + p_lease);
end;
$$;

create or replace function outbox_claim_action(p_worker text, p_action uuid, p_lease interval default interval '2 minutes')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ob outbox_command%rowtype;
  a action%rowtype;
  tok uuid := gen_random_uuid();
  approved_at timestamptz;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  select * into ob from outbox_command
   where action_id = p_action and ((state = 'queued' and (hold_until is null or hold_until <= now())) or (state = 'claimed' and claim_expires_at <= now()))
   for update skip locked;
  if not found then return null; end if;
  select * into a from action where id = ob.action_id for update;
  select consumed_at into approved_at from approval where action_id = a.id order by consumed_at desc nulls last limit 1;
  if a.state not in ('approved', 'running') or a.actor_kind <> 'user' or approved_at is null then
    update outbox_command set state = 'cancelled', error_code = 'NOT_APPROVED' where id = ob.id;
    perform jarvis_receipt_append(ob.owner_id, a.id, 'cancelled', left('Cancelled · ' || a.verb, 200), 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'NOT_APPROVED');
    return jsonb_build_object('skipped', ob.id, 'reason', 'NOT_APPROVED');
  end if;
  if ob.state = 'queued' and ob.dispatch_deadline is not null and now() > ob.dispatch_deadline then
    update outbox_command set state = 'cancelled', error_code = 'HOLD_EXPIRED' where id = ob.id;
    update email_draft set send_state = 'draft', sent_action_id = null where owner_id = ob.owner_id and sent_action_id = a.id and send_state = 'sending';
    perform jarvis_receipt_append(ob.owner_id, a.id, 'cancelled', 'Not Sent · Held Too Long · Review It Again', 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'HOLD_EXPIRED');
    return jsonb_build_object('skipped', ob.id, 'reason', 'HOLD_EXPIRED');
  end if;
  if ob.state = 'queued' and ob.hold_until is null and approved_at + interval '5 minutes' <= now() then
    update outbox_command set state = 'cancelled', error_code = 'APPROVAL_EXPIRED' where id = ob.id;
    perform jarvis_receipt_append(ob.owner_id, a.id, 'cancelled', 'Not Sent · Approval Expired · Review It Again', 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'APPROVAL_EXPIRED');
    return jsonb_build_object('skipped', ob.id, 'reason', 'APPROVAL_EXPIRED');
  end if;
  if not exists (select 1 from email_account where id = ob.provider_account_id and owner_id = ob.owner_id and state = 'connected') then
    update outbox_command set state = 'failed', error_code = 'PROVIDER_AUTH' where id = ob.id;
    perform jarvis_receipt_append(ob.owner_id, a.id, 'failed', 'Not Sent · Reconnect Gmail', 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'PROVIDER_AUTH');
    return jsonb_build_object('skipped', ob.id, 'reason', 'PROVIDER_AUTH');
  end if;
  update outbox_command
     set state = 'claimed', claim_token = tok, claimed_by = left(coalesce(p_worker, ''), 100), claimed_at = now(), claim_expires_at = now() + p_lease, attempt = attempt + 1
   where id = ob.id;
  update action set state = 'running', attempt = ob.attempt + 1 where id = a.id;
  return jsonb_build_object('outbox_id', ob.id, 'action_id', a.id, 'owner_id', ob.owner_id, 'kind', ob.kind, 'payload', ob.payload,
                            'payload_hash', ob.payload_hash, 'provider_account_id', ob.provider_account_id, 'claim_token', tok, 'attempt', ob.attempt + 1,
                            'lease_until', now() + p_lease);
end;
$$;

revoke all on function send_approve_held(uuid, text, text, text) from public, anon;
revoke all on function send_hold_status(uuid) from public, anon;
revoke all on function outbox_claim(text, interval) from public, anon, authenticated;
revoke all on function outbox_claim_action(text, uuid, interval) from public, anon, authenticated;
grant execute on function send_approve_held(uuid, text, text, text) to authenticated;
grant execute on function send_hold_status(uuid) to authenticated;
grant execute on function outbox_claim(text, interval) to service_role;
grant execute on function outbox_claim_action(text, uuid, interval) to service_role;
