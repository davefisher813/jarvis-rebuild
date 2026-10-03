-- Test-only fixtures for supabase/tests/substrate.sh. Two users, A and B,
-- each with a little of everything the substrate holds, so the cross-user
-- checks have rows on both sides. Synthetic ids and addresses; never applied
-- to a real project. Runs as the database owner, so owner_id is explicit.

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test')
on conflict (id) do nothing;

-- Life records in item: a project and a task each; a bill and a decision for A.
insert into item (id, owner_id, entity_type, data) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'project', '{"title":"Summer travel","status":"active"}'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'project', '{"title":"Kitchen","status":"active"}'),
  ('20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'task', '{"text":"Review transcript","category":"","done":false}'),
  ('20000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'task', '{"text":"Order tiles","category":"","done":false}'),
  ('30000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'money_bill', '{"vendor":"Con Edison","amountCents":14230,"currency":"USD","dueDate":"2026-10-15","source":"manual","fingerprint":"bill|con edison|14230|2026-10-15|local","history":[]}'),
  ('40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'decision_record', '{"decision":"Cap the trip at $2,400","createdAt":"2026-10-01T00:00:00Z","updatedAt":"2026-10-01T00:00:00Z"}');

insert into agent_connection (id, owner_id, provider_key, display_name, status, transport, verified_capabilities, capability_verified_at, mode, remote_subject) values
  ('50000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'claude', 'Claude', 'connected', 'https', '{read_context,propose}', now(), 'help_me', 'sub-a'),
  ('50000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'manual', 'Pasted context', 'manual', 'manual', '{}', null, 'read_only', null);
insert into jarvis_private.agent_credential (connection_id, owner_id, token_hash) values
  ('50000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'hash-a');

insert into email_account (id, owner_id, provider, provider_subject, address) values
  ('60000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'gmail', 'g-a', 'a@example.test'),
  ('60000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'gmail', 'g-b', 'b@example.test');
insert into jarvis_private.email_credential (account_id, owner_id, credential_ref) values
  ('60000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'google_tokens:a@example.test'),
  ('60000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'google_tokens:b@example.test');

insert into email_message (id, owner_id, account_id, provider_id, thread_id, internal_date, from_address, from_name, subject, snippet, source_hash) values
  ('70000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-00000000000a', 'm-a1', 't-a1', '2026-10-02T14:00:00Z', 'billing@conedison.test', 'Con Edison', 'Your bill is ready', 'Amount due $142.30 by Oct 15', 'sh-a1'),
  ('70000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-00000000000a', 'm-a2', 't-a2', '2026-10-02T15:00:00Z', 'coach@example.test', 'Coach Miller', 'Transcript', 'Can you review the transcript by Oct 9', 'sh-a2'),
  ('70000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', '60000000-0000-0000-0000-00000000000b', 'm-b1', 't-b1', '2026-10-02T16:00:00Z', 'tiles@example.test', 'Tile Shop', 'Order', 'Confirm the order by Friday', 'sh-b1');
insert into email_message_body (message_id, owner_id, sanitized_text) values
  ('70000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'Amount due $142.30 by Oct 15.'),
  ('70000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'Confirm the order by Friday.');

insert into source_evidence (id, owner_id, type, account_id, message_id, provider_message_id, thread_id, source_hash, excerpt) values
  ('80000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'email', '60000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-00000000000a', 'm-a1', 't-a1', 'sh-a1', 'Amount due $142.30 by Oct 15'),
  ('80000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'email', '60000000-0000-0000-0000-00000000000b', '70000000-0000-0000-0000-00000000000b', 'm-b1', 't-b1', 'sh-b1', 'Confirm the order by Friday');

insert into email_candidate (id, owner_id, account_id, message_id, source_hash, extractor_version, kind, origin, payload, payload_hash, fingerprint, status) values
  ('90000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-00000000000a', 'sh-a1', 'rules-1', 'bill', 'rule', '{"kind":"bill","issuer":"Con Edison","amount":{"minor_units":14230,"currency":"USD"},"due_date":"2026-10-15","no_due_date_confirmed":false}', 'ph-a1', 'fp-a-bill', 'proposed'),
  ('90000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-0000000000a2', 'sh-a2', 'rules-1', 'task', 'rule', '{"kind":"task","title":"Review transcript","due_date":"2026-10-09","notes":""}', 'ph-a2', 'fp-a-task', 'proposed'),
  ('90000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', '60000000-0000-0000-0000-00000000000b', '70000000-0000-0000-0000-00000000000b', 'sh-b1', 'rules-1', 'task', 'rule', '{"kind":"task","title":"Confirm the order","due_date":null,"notes":""}', 'ph-b1', 'fp-b-task', 'proposed');

insert into job (id, owner_id, agent_id, project_id, purpose, created_by) values
  ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Plan the summer trip', '00000000-0000-0000-0000-00000000000a'),
  ('a0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', null, '10000000-0000-0000-0000-00000000000b', 'Kitchen budget', '00000000-0000-0000-0000-00000000000b');

insert into scope_grant (id, owner_id, agent_id, project_id, fields, purposes, manifest_hash, approved_by) values
  ('b0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '{title,status}', '{planning}', 'mh-a', '00000000-0000-0000-0000-00000000000a');

insert into context_package (id, owner_id, job_id, agent_id, manifest, expires_at, auth_epoch, package_hash, record_count) values
  ('c0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', '[{"resource_id":"10000000-0000-0000-0000-00000000000a","revision":1,"fields":["title"],"redactions":[],"evidence_refs":[]}]', now() + interval '15 minutes', 1, 'pkh-a', 1);
insert into jarvis_private.context_snapshot (package_id, owner_id, snapshot_enc, purge_after) values
  ('c0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'enc', now() + interval '1 day');

insert into proposal (id, owner_id, job_id, agent_id, surface, type, payload, payload_hash, created_by) values
  ('d0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', 'project', 'decision', '{"statement":"Fly on the 12th"}', 'pph-a', 'agent'),
  ('d0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000b', null, 'project', 'decision', '{"statement":"White tiles"}', 'pph-b', 'user');

insert into action (id, owner_id, kind, actor_kind, initiated_by_user_id, verb, surface, state, payload_hash, idempotency_key, destination_id) values
  ('e0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'capture_task', 'user', '00000000-0000-0000-0000-00000000000a', 'Added transcript review to Tasks', 'email', 'confirmed', 'ph-a2', 'idem-a-1', '20000000-0000-0000-0000-00000000000a'),
  ('e0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'capture_task', 'user', '00000000-0000-0000-0000-00000000000b', 'Added order confirmation to Tasks', 'email', 'confirmed', 'ph-b1', 'idem-b-1', '20000000-0000-0000-0000-00000000000b');
insert into receipt_event (id, owner_id, action_id, sequence, state, exact_verb, actor_kind, initiated_by_user_id, scope_summary, after_ref, assurance) values
  ('f0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-00000000000a', 1, 'confirmed', 'Added transcript review to Tasks', 'user', '00000000-0000-0000-0000-00000000000a', 'Email · a@example.test', '20000000-0000-0000-0000-00000000000a', 'verified_jarvis'),
  ('f0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-00000000000b', 1, 'confirmed', 'Added order confirmation to Tasks', 'user', '00000000-0000-0000-0000-00000000000b', 'Email · b@example.test', '20000000-0000-0000-0000-00000000000b', 'verified_jarvis');
insert into approval (id, owner_id, action_id, payload_hash, source_revision, expires_at, consumed_at, nonce) values
  ('f1000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-00000000000a', 'ph-a2', 1, now() + interval '5 minutes', now(), 'nonce-a-1'),
  ('f1000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-00000000000b', 'ph-b1', 1, now() + interval '5 minutes', now(), 'nonce-b-1');

insert into email_draft (id, owner_id, account_id, to_addresses, subject, body_text) values
  ('f2000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-00000000000a', '["coach@example.test"]', 'Re: Transcript', 'On it.'),
  ('f2000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', '60000000-0000-0000-0000-00000000000b', '["tiles@example.test"]', 'Re: Order', 'Confirmed.');

insert into decision_version (id, owner_id, item_id, version, title, statement, rationale, committed_by) values
  ('f3000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 1, 'Trip budget', 'Cap the trip at $2,400', 'That is what is saved', '00000000-0000-0000-0000-00000000000a');
insert into decision_dependency (id, owner_id, from_version_id, to_item_id, expected_item_updated_at, kind) values
  ('f4000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'f3000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', now(), 'informed_by');

insert into policy_suggestion (id, owner_id, rule, evidence_tap_ids) values
  ('f5000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', '{"sender_exact":"billing@conedison.test","account_id":"60000000-0000-0000-0000-00000000000a","category_id":"money"}', '{tap1,tap2,tap3}'),
  ('f5000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', '{"sender_exact":"tiles@example.test","account_id":"60000000-0000-0000-0000-00000000000b","category_id":"personal"}', '{tap1,tap2,tap3}');
