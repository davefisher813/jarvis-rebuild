-- Migration 0073: Doc AI (build order 2026-10-23, "JARVIS Doc AI (full document intelligence)", Phase 1).
-- Additive only; rollback in rollback/0073_doc_ai_down.sql. The ops clock is ops/doc_worker_cron.sql (not a migration).
--
-- What this is. A document Dave uploads or photographs is a user_file item (migration 0030). Doc AI reads it, works out what it is,
-- and PROPOSES the records it holds. Nothing files itself (law 1): a proposal waits here until Dave decides, and filing is done by
-- the app through the ordinary doors (Money, the calendar, Notes). This migration holds the three things that need a server:
--
--   doc_job       the outbox-shaped queue. One active job per file. Claim before work; a lease on every claim; the row is stamped
--                 'dispatched' BEFORE any model call, so a tick that dies mid-call is found by doc_sweep as OUTCOME_UNKNOWN and
--                 is never retried on its own (the call may have been billed and may have answered; running it twice would be
--                 a second, silent spend). Deterministic failures retry with backoff up to max_attempts, then 'failed', and
--                 only Dave's tap retries a failed or unknown job. A refusal by the AI gate, caps or budget goes back to
--                 'pending' without using an attempt (waiting is not failing).
--   doc_text      what was read (law 3: reading is not an AI call; the PDF text layer and device OCR land here at AI Off).
--                 Page boundaries ride along so a quote finds its page by code, not by the model's word.
--   doc_proposal  what JARVIS proposes, one row per extraction (fingerprint). 'dismissed' is remembered: the same fingerprint is
--                 never proposed again (build order, never build: "re-proposing a dismissed proposal").
--
-- The file row's own `doc` block (FileData.doc on item.data) carries the lifecycle the screens read. It is patched here by
-- doc_patch_file, which writes ONLY item.data->'doc'. No item_link path is added (the registry is locked at 42 rows) and the
-- link projection is untouched.
--
-- Access. doc_job, doc_text and doc_proposal are readable by their owner and writable by no browser: every write is a function.
-- Functions that move a job or write a read/proposal are granted to service_role alone and check jarvis_is_server() (0044).
-- The three the app calls (doc_enqueue, doc_put_text_user, doc_proposal_decide) check auth.uid() and the row's owner.
--
-- Phase 3 adds doc_chunk (full text search) in its own migration; nothing here anticipates it beyond doc_text.

create table if not exists doc_job (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  file_id uuid not null,
  state text not null default 'pending' check (state in ('pending', 'claimed', 'dispatched', 'done', 'failed', 'outcome_unknown', 'cancelled')),
  -- 'read' = Lane 1 only (text layer); 'extract' = read if needed, then the AI step if the gate allows.
  stage text not null default 'extract' check (stage in ('read', 'extract')),
  -- True when Dave asked for the review himself (a tap on "Review This"). At AI level On Request only a requested job may spend; an
  -- automatic one after an upload reads the document and stops at "Read, Not Reviewed Yet".
  requested boolean not null default false,
  attempt integer not null default 0 check (attempt >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  run_after timestamptz not null default now(),
  claim_token uuid,
  claimed_by text check (claimed_by is null or length(claimed_by) <= 100),
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  -- The id the AI budget knows this call by (api/_aiBudget.ts), set when the call is stamped in flight.
  request_id text check (request_id is null or length(request_id) <= 100),
  waiting_reason text check (waiting_reason is null or length(waiting_reason) <= 40),
  error_code text check (error_code is null or length(error_code) <= 40),
  error_text text check (error_text is null or length(error_text) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One ACTIVE job per file: a double tap, a retry race or a second tab makes no second job.
create unique index if not exists doc_job_one_active on doc_job (owner_id, file_id) where state in ('pending', 'claimed', 'dispatched');
create index if not exists doc_job_due_idx on doc_job (run_after) where state = 'pending';
create index if not exists doc_job_lease_idx on doc_job (claim_expires_at) where state in ('claimed', 'dispatched');
create index if not exists doc_job_file_idx on doc_job (owner_id, file_id, created_at desc);

create table if not exists doc_text (
  owner_id uuid not null,
  file_id uuid not null,
  lane text not null check (lane in ('text-layer', 'device-ocr', 'ai-read')),
  text text not null check (length(text) <= 2000000),
  -- [{ "page": 1, "start": 0, "end": 812 }, ...] offsets into `text`.
  pages jsonb not null default '[]'::jsonb,
  total_pages integer check (total_pages is null or total_pages >= 0),
  failed_pages integer[] not null default '{}',
  skipped_pages integer[] not null default '{}',
  words integer not null default 0 check (words >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, file_id)
);

create table if not exists doc_proposal (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  file_id uuid not null,
  fingerprint text not null check (length(fingerprint) between 8 and 64),
  status text not null default 'open' check (status in ('open', 'filed', 'dismissed')),
  kind text not null check (kind in ('bill', 'schedule', 'task-list', 'letter', 'receipt', 'general')),
  -- The proposal exactly as the sheet shows it (src/docai/proposal.ts DocProposal).
  body jsonb not null,
  -- What Dave decided and where it went: the decision record that proves provenance (field, value, quote, page, decision, who).
  decisions jsonb,
  filed_to text check (filed_to is null or length(filed_to) <= 80),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, file_id, fingerprint),
  check ((status = 'open') = (decided_at is null))
);

create index if not exists doc_proposal_file_idx on doc_proposal (owner_id, file_id, created_at desc);
create index if not exists doc_proposal_open_idx on doc_proposal (owner_id) where status = 'open';

create or replace trigger doc_job_touch before insert or update on doc_job for each row execute function jarvis_touch_updated_at();
create or replace trigger doc_text_touch before insert or update on doc_text for each row execute function jarvis_touch_updated_at();
create or replace trigger doc_proposal_touch before insert or update on doc_proposal for each row execute function jarvis_touch_updated_at();

alter table doc_job enable row level security;
alter table doc_text enable row level security;
alter table doc_proposal enable row level security;

revoke all on table doc_job, doc_text, doc_proposal from public, anon, authenticated;
grant select on table doc_job, doc_text, doc_proposal to authenticated;
grant all on table doc_job, doc_text, doc_proposal to service_role;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'doc_job' and policyname = 'doc_job_owner_read') then
    create policy doc_job_owner_read on doc_job for select to authenticated using (owner_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'doc_text' and policyname = 'doc_text_owner_read') then
    create policy doc_text_owner_read on doc_text for select to authenticated using (owner_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'doc_proposal' and policyname = 'doc_proposal_owner_read') then
    create policy doc_proposal_owner_read on doc_proposal for select to authenticated using (owner_id = auth.uid());
  end if;
end $$;

-- ---- A deleted document takes everything read from it with it ----
-- The text of a document is the document. When the file row goes (a swipe, an account erase, any path), its read text, its queue rows and its
-- proposals go in the same statement; nothing is left readable that the person deleted. An Undo brings the row back and the app queues a fresh read.
create or replace function doc_forget_file()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from doc_text where owner_id = old.owner_id and file_id = old.id;
  delete from doc_proposal where owner_id = old.owner_id and file_id = old.id;
  delete from doc_job where owner_id = old.owner_id and file_id = old.id;
  return old;
end;
$$;
revoke all on function doc_forget_file() from public, anon, authenticated;

create or replace trigger doc_forget_on_file_delete after delete on item
  for each row when (old.entity_type = 'user_file') execute function doc_forget_file();

-- ---- doc_patch_file: write the file row's `doc` block, and nothing else on the row ----
-- Merges p_doc over the existing block. `null` values remove a key (so a cleared error really clears). The lifecycle state is forward
-- only except for an explicit manual retry, which the caller states with p_allow_back.
create or replace function doc_patch_file(p_owner uuid, p_file uuid, p_doc jsonb, p_allow_back boolean default false)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  cur jsonb;
  merged jsonb;
  k text;
  order_ text[] := array['uploading', 'stored', 'reading', 'read', 'read-partial', 'unreadable', 'extracting', 'proposed', 'filed', 'failed'];
  n integer;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  if p_owner is null or p_file is null or jsonb_typeof(p_doc) is distinct from 'object' then return false; end if;
  select coalesce(data -> 'doc', '{}'::jsonb) into cur from item where id = p_file and owner_id = p_owner and entity_type = 'user_file' for update;
  if not found then return false; end if;
  -- A finished document is not dragged back by a late worker tick.
  if not p_allow_back and cur ->> 'state' = 'filed' then return false; end if;
  merged := cur;
  for k in select jsonb_object_keys(p_doc) loop
    if jsonb_typeof(p_doc -> k) = 'null' then merged := merged - k; else merged := jsonb_set(merged, array[k], p_doc -> k, true); end if;
  end loop;
  update item set data = jsonb_set(data, '{doc}', merged, true) where id = p_file and owner_id = p_owner;
  get diagnostics n = row_count;
  return n = 1;
end;
$$;

-- ---- doc_enqueue: the app asks for a document to be read (or read again) ----
create or replace function doc_enqueue(p_file uuid, p_retry boolean default false, p_requested boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  jid uuid;
  cur jsonb;
  last_state text;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  select data -> 'doc' into cur from item where id = p_file and owner_id = owner and entity_type = 'user_file';
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  select state into last_state from doc_job where owner_id = owner and file_id = p_file order by created_at desc limit 1;
  -- A document already read is not read again unless Dave taps retry. A finished job with no retry is a no-op.
  if not p_retry and last_state in ('done', 'failed', 'outcome_unknown', 'cancelled') then
    return jsonb_build_object('job_id', null, 'state', last_state, 'enqueued', false);
  end if;
  insert into doc_job (owner_id, file_id, requested) values (owner, p_file, coalesce(p_requested, false))
  on conflict (owner_id, file_id) where state in ('pending', 'claimed', 'dispatched') do nothing
  returning id into jid;
  if jid is null then
    select id into jid from doc_job where owner_id = owner and file_id = p_file and state in ('pending', 'claimed', 'dispatched') limit 1;
    return jsonb_build_object('job_id', jid, 'state', 'pending', 'enqueued', false);
  end if;
  update item
     set data = jsonb_set(data, '{doc}', (coalesce(data -> 'doc', '{}'::jsonb) - 'error' - 'errorCode' - 'notReviewed' - 'waiting') || jsonb_build_object('state', case when p_requested then coalesce(nullif(data -> 'doc' ->> 'state', ''), 'stored') else 'stored' end), true)
   where id = p_file and owner_id = owner;
  return jsonb_build_object('job_id', jid, 'state', 'pending', 'enqueued', true);
end;
$$;

-- ---- doc_claim: take the next due job, or one whose lease ran out before any model call ----
-- A 'claimed' job whose lease expired never reached a model call (it is stamped 'dispatched' before one), so taking it again is safe.
-- A 'dispatched' job whose lease expired is NOT taken: doc_sweep marks it outcome_unknown.
create or replace function doc_claim(p_worker text, p_lease interval default interval '2 minutes')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  j doc_job%rowtype;
  tok uuid := gen_random_uuid();
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  select * into j from doc_job
   where (state = 'pending' and run_after <= now()) or (state = 'claimed' and claim_expires_at <= now())
   order by run_after, created_at
   for update skip locked
   limit 1;
  if not found then return null; end if;
  update doc_job
     set state = 'claimed', claim_token = tok, claimed_by = left(coalesce(p_worker, ''), 100), claimed_at = now(),
         claim_expires_at = now() + p_lease, attempt = attempt + 1, waiting_reason = null
   where id = j.id;
  return jsonb_build_object('job_id', j.id, 'owner_id', j.owner_id, 'file_id', j.file_id, 'stage', j.stage, 'requested', j.requested, 'claim_token', tok,
                            'attempt', j.attempt + 1, 'max_attempts', j.max_attempts, 'lease_until', now() + p_lease);
end;
$$;

-- ---- doc_mark_dispatched: stamp "a model call is about to happen" BEFORE it happens ----
-- Compare-and-set on the claim token. True only for the single caller that wins. After this, a death is OUTCOME_UNKNOWN, never a retry.
create or replace function doc_mark_dispatched(p_job uuid, p_token uuid, p_request text, p_lease interval default interval '3 minutes')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  update doc_job set state = 'dispatched', request_id = left(coalesce(p_request, ''), 100), claim_expires_at = now() + p_lease
   where id = p_job and claim_token = p_token and state = 'claimed' and claim_expires_at > now();
  get diagnostics n = row_count;
  return n = 1;
end;
$$;

-- ---- doc_extend: a long job keeps its claim alive between slices ----
create or replace function doc_extend(p_job uuid, p_token uuid, p_lease interval default interval '2 minutes')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  update doc_job set claim_expires_at = now() + p_lease where id = p_job and claim_token = p_token and state in ('claimed', 'dispatched');
  get diagnostics n = row_count;
  return n = 1;
end;
$$;

-- ---- doc_job_owner: who a live claim belongs to ----
-- The AI door (api/ai.ts) answers an internal docs call only for a job that is claimed or dispatched RIGHT NOW under the token the
-- claim returned. The cron secret alone is not enough to spend as anyone: it takes a live claim, which only doc_claim hands out.
create or replace function doc_job_owner(p_job uuid, p_token uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare o uuid;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  select owner_id into o from doc_job where id = p_job and claim_token = p_token and state in ('claimed', 'dispatched') and claim_expires_at > now();
  return o;
end;
$$;

-- ---- doc_finish: close a job. The outcomes are the outbox rules in one place ----
--   done      read and (if allowed) extracted; nothing more to do.
--   wait      the gate, caps or budget refused: back to pending, run later, NO attempt used ("Waiting, AI is busy right now").
--   retry     a deterministic failure: back to pending with backoff while attempts remain, else 'failed'.
--   failed    a failure no retry can fix (credit, schema after attempts, parser). Manual retry only.
--   unknown   the call may or may not have happened. Never automatic.
create or replace function doc_finish(p_job uuid, p_token uuid, p_outcome text, p_code text default null, p_text text default null, p_delay interval default interval '30 seconds', p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  j doc_job%rowtype;
  next_state text;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  select * into j from doc_job where id = p_job and claim_token = p_token and state in ('claimed', 'dispatched') for update;
  if not found then return jsonb_build_object('error', 'NOT_CLAIMED'); end if;
  if p_outcome = 'done' then
    update doc_job set state = 'done', error_code = null, error_text = null, waiting_reason = null, claim_expires_at = null where id = j.id;
    return jsonb_build_object('state', 'done');
  elsif p_outcome = 'wait' then
    update doc_job set state = 'pending', attempt = greatest(attempt - 1, 0), run_after = now() + least(greatest(p_delay, interval '10 seconds'), interval '1 hour'),
           waiting_reason = left(coalesce(p_reason, p_code, 'busy'), 40), claim_token = null, claim_expires_at = null where id = j.id;
    return jsonb_build_object('state', 'pending', 'waiting', true);
  elsif p_outcome = 'retry' then
    next_state := case when j.attempt >= j.max_attempts then 'failed' else 'pending' end;
    update doc_job set state = next_state, error_code = left(p_code, 40), error_text = left(p_text, 300),
           run_after = now() + least(p_delay * power(2, greatest(j.attempt - 1, 0)), interval '1 hour'), claim_token = null, claim_expires_at = null where id = j.id;
    return jsonb_build_object('state', next_state);
  elsif p_outcome = 'failed' then
    update doc_job set state = 'failed', error_code = left(p_code, 40), error_text = left(p_text, 300), claim_token = null, claim_expires_at = null where id = j.id;
    return jsonb_build_object('state', 'failed');
  elsif p_outcome = 'unknown' then
    update doc_job set state = 'outcome_unknown', error_code = 'OUTCOME_UNKNOWN', error_text = left(p_text, 300), claim_token = null, claim_expires_at = null where id = j.id;
    return jsonb_build_object('state', 'outcome_unknown');
  end if;
  return jsonb_build_object('error', 'BAD_OUTCOME');
end;
$$;

-- ---- doc_sweep: close what a dead tick left behind ----
-- An expired 'dispatched' job becomes outcome_unknown and its file row says so. An expired 'claimed' job is returned to pending by
-- doc_claim itself; the sweep only counts it.
create or replace function doc_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  unknown_n integer := 0;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  for r in select id, owner_id, file_id from doc_job where state = 'dispatched' and claim_expires_at <= now() for update skip locked loop
    update doc_job set state = 'outcome_unknown', error_code = 'OUTCOME_UNKNOWN', error_text = 'The worker stopped during a model call', claim_token = null, claim_expires_at = null where id = r.id;
    perform doc_patch_file(r.owner_id, r.file_id, jsonb_build_object('state', 'failed', 'errorCode', 'OUTCOME_UNKNOWN'));
    unknown_n := unknown_n + 1;
  end loop;
  return jsonb_build_object('outcome_unknown', unknown_n, 'stale_claims', (select count(*) from doc_job where state = 'claimed' and claim_expires_at <= now()));
end;
$$;

-- ---- doc_put_text: the server stores what Lane 1 read ----
create or replace function doc_put_text(p_owner uuid, p_file uuid, p_lane text, p_text text, p_pages jsonb, p_total integer, p_failed integer[], p_skipped integer[], p_words integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  if not exists (select 1 from item where id = p_file and owner_id = p_owner and entity_type = 'user_file') then return false; end if;
  insert into doc_text (owner_id, file_id, lane, text, pages, total_pages, failed_pages, skipped_pages, words)
  values (p_owner, p_file, p_lane, coalesce(p_text, ''), coalesce(p_pages, '[]'::jsonb), p_total, coalesce(p_failed, '{}'), coalesce(p_skipped, '{}'), greatest(coalesce(p_words, 0), 0))
  on conflict (owner_id, file_id) do update
    set lane = excluded.lane, text = excluded.text, pages = excluded.pages, total_pages = excluded.total_pages,
        failed_pages = excluded.failed_pages, skipped_pages = excluded.skipped_pages, words = excluded.words;
  return true;
end;
$$;

-- ---- doc_put_text_user: device OCR. The phone read a photo on the device; it says what it read (lane is fixed, never the caller's word) ----
create or replace function doc_put_text_user(p_file uuid, p_text text, p_pages jsonb, p_words integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare owner uuid := auth.uid();
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if not exists (select 1 from item where id = p_file and owner_id = owner and entity_type = 'user_file') then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if length(coalesce(p_text, '')) > 2000000 then return jsonb_build_object('error', 'TOO_LARGE'); end if;
  insert into doc_text (owner_id, file_id, lane, text, pages, total_pages, words)
  values (owner, p_file, 'device-ocr', coalesce(p_text, ''), coalesce(p_pages, '[]'::jsonb), jsonb_array_length(coalesce(p_pages, '[]'::jsonb)), greatest(coalesce(p_words, 0), 0))
  on conflict (owner_id, file_id) do update
    set lane = 'device-ocr', text = excluded.text, pages = excluded.pages, total_pages = excluded.total_pages, words = excluded.words
    -- Never replace a text-layer read with a device guess.
    where doc_text.lane = 'device-ocr';
  return jsonb_build_object('stored', true);
end;
$$;

-- ---- doc_put_proposal: store an extraction as a proposal, unless this exact extraction was dismissed before ----
create or replace function doc_put_proposal(p_owner uuid, p_file uuid, p_fingerprint text, p_kind text, p_body jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing doc_proposal%rowtype;
  pid uuid;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  if not exists (select 1 from item where id = p_file and owner_id = p_owner and entity_type = 'user_file') then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  select * into existing from doc_proposal where owner_id = p_owner and file_id = p_file and fingerprint = p_fingerprint;
  if found then
    -- Same facts again: whatever Dave decided before stands. A dismissed one is never reopened and a filed one never re-offered.
    return jsonb_build_object('proposal_id', existing.id, 'status', existing.status, 'suppressed', existing.status <> 'open', 'created', false);
  end if;
  -- A new extraction replaces a still-open older one for the file (a re-read), never a decided one.
  -- (An undecided proposal carries no decision to remember, so it is removed rather than recorded as a dismissal.)
  delete from doc_proposal where owner_id = p_owner and file_id = p_file and status = 'open';
  insert into doc_proposal (owner_id, file_id, fingerprint, kind, body) values (p_owner, p_file, p_fingerprint, p_kind, p_body) returning id into pid;
  return jsonb_build_object('proposal_id', pid, 'status', 'open', 'suppressed', false, 'created', true);
end;
$$;

-- ---- doc_proposal_decide: Dave filed it (records say where) or dismissed it ----
-- The row keeps the decision record: for every field, what was shown, what he chose and who wrote the value (provenance, law 4).
create or replace function doc_proposal_decide(p_id uuid, p_status text, p_decisions jsonb default null, p_filed_to text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  p doc_proposal%rowtype;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if p_status not in ('filed', 'dismissed') then return jsonb_build_object('error', 'BAD_STATUS'); end if;
  select * into p from doc_proposal where id = p_id and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if p.status <> 'open' then return jsonb_build_object('status', p.status, 'changed', false); end if;
  update doc_proposal set status = p_status, decisions = p_decisions, filed_to = left(p_filed_to, 80), decided_at = now() where id = p.id;
  update item
     set data = jsonb_set(data, '{doc}', (coalesce(data -> 'doc', '{}'::jsonb) - 'error' - 'errorCode')
           || case when p_status = 'filed' then jsonb_build_object('state', 'filed', 'filedTo', left(p_filed_to, 80), 'proposalId', p.id)
                   else jsonb_build_object('state', 'read', 'proposalId', p.id) end, true)
   where id = p.file_id and owner_id = owner;
  return jsonb_build_object('status', p_status, 'changed', true);
end;
$$;

revoke all on function doc_patch_file(uuid, uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function doc_enqueue(uuid, boolean, boolean) from public, anon;
revoke all on function doc_job_owner(uuid, uuid) from public, anon, authenticated;
revoke all on function doc_claim(text, interval) from public, anon, authenticated;
revoke all on function doc_mark_dispatched(uuid, uuid, text, interval) from public, anon, authenticated;
revoke all on function doc_extend(uuid, uuid, interval) from public, anon, authenticated;
revoke all on function doc_finish(uuid, uuid, text, text, text, interval, text) from public, anon, authenticated;
revoke all on function doc_sweep() from public, anon, authenticated;
revoke all on function doc_put_text(uuid, uuid, text, text, jsonb, integer, integer[], integer[], integer) from public, anon, authenticated;
revoke all on function doc_put_text_user(uuid, text, jsonb, integer) from public, anon;
revoke all on function doc_put_proposal(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function doc_proposal_decide(uuid, text, jsonb, text) from public, anon;

grant execute on function doc_enqueue(uuid, boolean, boolean) to authenticated;
grant execute on function doc_job_owner(uuid, uuid) to service_role;
grant execute on function doc_put_text_user(uuid, text, jsonb, integer) to authenticated;
grant execute on function doc_proposal_decide(uuid, text, jsonb, text) to authenticated;
grant execute on function doc_patch_file(uuid, uuid, jsonb, boolean) to service_role;
grant execute on function doc_claim(text, interval) to service_role;
grant execute on function doc_mark_dispatched(uuid, uuid, text, interval) to service_role;
grant execute on function doc_extend(uuid, uuid, interval) to service_role;
grant execute on function doc_finish(uuid, uuid, text, text, text, interval, text) to service_role;
grant execute on function doc_sweep() to service_role;
grant execute on function doc_put_text(uuid, uuid, text, text, jsonb, integer, integer[], integer[], integer) to service_role;
grant execute on function doc_put_proposal(uuid, uuid, text, text, jsonb) to service_role;
