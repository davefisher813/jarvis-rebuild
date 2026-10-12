-- Migration 0068: two reads for Email v1 (2026-10-12, Dave's rulings 8 and the L2 change). Additive: two new
-- functions, no table, no column, no change to any existing body. Rollback: rollback/0068_email_review_and_paused_down.sql.
--
-- 1. candidates_to_review(p_limit)
--    Email's own review list. candidate_review_count (0051) counts every proposed or needs_details card on a
--    message that is still here, in a mailbox that is not disconnected; the review focus used to show only the
--    cards on the inbox pages the phone had loaded, and said "N more in older mail". This returns EVERY counted
--    card's message (the same where clause, so the count and the list are one set) in the inbox row's shape,
--    newest first, with the cards themselves in candidates_for's shape. Read only; security invoker, so the
--    tables' own owner policies apply exactly as they do for email_inbox and candidates_for.
--
-- 2. paused_sends()
--    The L2 combined card ("2 Replies Need Your Review", spec section 7, V10). A paused send is a send stopped
--    BEFORE it reached Gmail and now needing a fresh review:
--      - the draft's send failed (send_state 'failed');
--      - the draft is still marked 'sending' but its command never left: the worker refused it at claim
--        (outbox 'failed', e.g. PROVIDER_AUTH) or cancelled it (outbox 'cancelled');
--      - the draft came back as a draft because the worker cancelled the held command past its dispatch window
--        or its approval (HOLD_EXPIRED, APPROVAL_EXPIRED, NOT_APPROVED), and it has not been saved since.
--    It is NOT an ordinary draft, a held send, a sent message or an unknown outcome ('unknown' is its own
--    status, "A send needs checking"), and a person's own Undo (error_code CANCELLED) is not a pause.
--    Counted once per draft. A reply is a draft answering a thread (a thread id or an In-Reply-To).
--    security definer with the owner bound to auth.uid(), like candidate_review_count, so the outbox's
--    error codes are read without widening any grant; no body, subject or address leaves through the count.

create or replace function candidates_to_review(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  lim integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  ids uuid[];
  rows jsonb;
  total integer;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  select count(*) into total
    from email_candidate c
    join email_message m on m.id = c.message_id
    join email_account a on a.id = m.account_id
   where c.owner_id = owner and c.status in ('proposed', 'needs_details') and m.deleted_at is null and a.state <> 'disconnected';
  select coalesce(array_agg(x.id order by x.internal_date desc, x.provider_id desc), '{}'::uuid[]) into ids from (
    select distinct m.id, m.internal_date, m.provider_id
      from email_candidate c
      join email_message m on m.id = c.message_id
      join email_account a on a.id = m.account_id
     where c.owner_id = owner and c.status in ('proposed', 'needs_details') and m.deleted_at is null and a.state <> 'disconnected'
     order by m.internal_date desc, m.provider_id desc
     limit lim) x;
  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.internal_date desc, r.provider_id desc), '[]'::jsonb) into rows from (
    select m.id, m.account_id, a.address as account, m.provider_id, m.thread_id, m.internal_date, m.from_address, m.from_name, m.subject, m.snippet,
           m.has_body, m.attachment_metadata, m.provider_labels, m.source_hash,
           not ('UNREAD' = any (m.provider_labels)) as read
      from email_message m
      join email_account a on a.id = m.account_id
     where m.owner_id = owner and m.id = any (ids)) r;
  return jsonb_build_object('count', total, 'rows', rows, 'candidates', candidates_for(ids, false));
end;
$$;

create or replace function paused_sends()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with paused as (
    select d.*,
           (coalesce(nullif(btrim(d.reply_headers ->> 'in_reply_to'), ''), d.thread_id) is not null) as is_reply,
           coalesce(
             case when d.send_state = 'failed' then coalesce((select ob.error_code from outbox_command ob where ob.action_id = d.sent_action_id), 'FAILED') end,
             case when d.send_state = 'sending' then (select coalesce(ob.error_code, 'FAILED') from outbox_command ob where ob.action_id = d.sent_action_id and ob.state in ('failed', 'cancelled')) end,
             case when d.send_state = 'draft' then (
               select ob.error_code from outbox_command ob
                where ob.owner_id = d.owner_id and ob.kind = 'send_email' and ob.payload ->> 'draft_id' = d.id::text
                order by ob.created_at desc limit 1) end
           ) as reason,
           (select ob.updated_at from outbox_command ob
             where ob.owner_id = d.owner_id and ob.kind = 'send_email' and ob.payload ->> 'draft_id' = d.id::text
             order by ob.created_at desc limit 1) as stopped_at
      from email_draft d
     where d.owner_id = auth.uid() and d.send_state in ('failed', 'sending', 'draft')
  ), kept as (
    select * from paused p
     where p.reason is not null
       and (p.send_state <> 'draft' or (p.reason in ('HOLD_EXPIRED', 'APPROVAL_EXPIRED', 'NOT_APPROVED') and p.saved_at <= p.stopped_at))
  )
  select jsonb_build_object(
    'count', (select count(*) from kept),
    'replies', (select count(*) from kept where is_reply),
    'drafts', coalesce((select jsonb_agg(jarvis_draft_json(d) || jsonb_build_object('paused_reason', k.reason, 'is_reply', k.is_reply) order by k.stopped_at desc nulls last, k.id)
                          from kept k join email_draft d on d.id = k.id), '[]'::jsonb));
$$;

revoke all on function candidates_to_review(integer) from public, anon;
revoke all on function paused_sends() from public, anon;
grant execute on function candidates_to_review(integer) to authenticated;
grant execute on function paused_sends() to authenticated;
