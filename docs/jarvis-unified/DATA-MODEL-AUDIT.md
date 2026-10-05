# JARVIS v1 data model audit

Date: 2026-10-05. Read-only. Production Supabase project `roonancpktqigdndrumo` ("Javris Project", ACTIVE_HEALTHY). Only SELECT, list_tables, list_migrations, get_advisors were used. No personal content was printed: counts, id shapes, entity types and booleans only. No repo file was edited and nothing was written to any database. The bridge-app project and SWING were not touched.

Dave's question: "confirm every v1 data type has one authoritative home in Supabase and migrated records are clean. Report anything you can't verify."

## Short answer

1. No, not every v1 data type has one authoritative home in Supabase. Three things stand out:
   - **Device-only data.** More than 100 `jarvis.*` localStorage keys; only 4 settings keys sync (`scalar_setting`). A large amount of real user decisions and held work lives on the phone alone and is not in the backup file.
   - **Registry gap.** 10 entity types that the app writes (including all the Money Tracker types, 52 live production rows) are missing from `ALL_ENTITY_TYPES`. A backup restore drops them, and the cache write-through ignores them.
   - **Booking's server home is a paused project.** The Track 3 Supabase project that stores booking links and bookings is INACTIVE.
2. Migrated records cannot be confirmed clean, because there is no evidence a Firebase migration ever ran into this database. The repo holds no migration script, doc or checksum. The only Firebase mention is a code comment in a test. The production data begins with the first user on 2026-05-27, 19 seconds before the first item.
3. The records that are in production are structurally clean: no orphan owners, no null or malformed data, no unregistered entity types, no duplicate singleton rows, RLS on every table. The exceptions are dangling references (34 + 24 + 5 rows) and a few duplicate-content groups, listed below.

## 1. Inventory: what the app persists

### 1a. Server: `item` table (entity types)

The registry is `src/backup/entityRegistry.ts` (`ALL_ENTITY_TYPES`, 35 entries). The app defines 44 `ENTITY_*` constants plus `BRAIN_MEMORY_ENTITY`. The production `entity_type` table has 46 keys (those 45 plus the unused seed key `item`), so every type the app writes is registered in the database.

Production item counts (1,059 items, 4 owners, 9 auth users):

| entity_type | rows | owners | in app registry |
|---|---|---|---|
| task | 399 | 3 | yes |
| person | 329 | 3 | yes |
| event | 105 | 1 | yes |
| money_tx | 31 | 1 | NO |
| category | 28 | 4 | yes |
| goal | 26 | 3 | yes |
| workout | 22 | 1 | yes |
| note | 19 | 1 | yes |
| project | 19 | 1 | yes |
| money_sub | 17 | 1 | NO |
| strand | 16 | 3 | yes |
| metric_def | 9 | 1 | yes |
| month_seal | 6 | 4 | yes |
| decision_record | 5 | 1 | yes |
| account | 4 | 1 | yes |
| money_account | 4 | 1 | NO |
| metric_log | 4 | 1 | yes |
| profile | 4 | 4 | yes |
| health_call_it | 3 | 1 | yes |
| routine | 3 | 3 | yes |
| chat_message, brain_doc, learned_rule, program, health_point_at_it | 2, 1, 1, 1, 1 | 1 each | yes |

Entity types with zero rows in production (structure only, so content could not be checked): life_area, user_file, waiting, exploration_note, brain_memory, health_checkin, health_meal, health_med_def, health_consent, health_lights_out, health_ate_before, health_took_it, health_bag_check, health_locker_doc, health_trusted_adult, health_age_rule_shown, money_bill, money_budget, money_receipt.

**No unregistered, legacy, Firebase-era or test-debris entity type exists in `item`.** Every production type is one the current app knows. The seed key `item` is registered and has 0 rows.

Not in `ALL_ENTITY_TYPES` (10): `health_checkin`, `health_meal`, `health_med_def`, `money_account`, `money_bill`, `money_budget`, `money_receipt`, `money_sub`, `money_tx`, `brain_memory`. See defect D1.

### 1b. Server: other tables (public, 29 tables, plus 4 in `jarvis_private`)

| table | rows | purpose | authoritative for |
|---|---|---|---|
| scalar_setting | 3 | synced settings | appearance, doneClearing, emailTasks (feedbackStyle has no row yet) |
| event_log | 3,784 | analytics/behavior log | event history (also queued locally first) |
| ai_usage, ai_tokens | 3,155 / 610 | AI admission ledger / token cost | server-only, no client policy |
| ai_budget, ai_budget_reservation | 0 / 0 | AI spend caps | server-only |
| google_tokens | 2 | Google refresh tokens (encrypted by app key) | server-only |
| email_opens | 0 | open-tracking pixel hits | server-only |
| feedback | 0 | in-app feedback | server-only |
| email_account, email_message, email_message_body, email_draft, email_candidate, outbox_command | 2, 92, 1, 1, 5, 0 | unified-substrate email | server |
| agent_connection, job, scope_grant, context_package, proposal, action, receipt_event, approval, policy_suggestion, source_evidence, decision_version, decision_dependency | 1, 1, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0 | unified-substrate control plane | server |
| jarvis_private.agent_credential, agent_rate, context_snapshot, email_credential | not counted (no client access) | secrets and snapshots | server |
| storage bucket `user-files` | 0 objects | chat/note attachments | server |

### 1c. Server, but in a different place: Track 3 project

Booking links, availability rules and bookings are written by `api/booking-link.ts`, `api/book.ts` and `api/bookings.ts` through `api/_track3.ts` to a **second** Supabase project, `zxszpuyhwvalfpfqgutq` ("Jarvis Track 3"). Its status is **INACTIVE** (paused) and a read-only query timed out. It could not be inspected. See defect D3.

### 1d. Server, but outside Supabase

- Web push subscriptions are posted to `/api/push`, which proxies to `JARVIS_BACKEND_URL` (an external backend). That store is not in Supabase and was not inspected. The browser also keeps `jarvis.webpush.v1` (endpoint and token) locally.
- The `wt/ios` branch adds native push registration. Where that token will be stored was not audited.

### 1e. DEVICE ONLY (localStorage, no sync)

The app writes no IndexedDB and uses no Capacitor Preferences or secure storage (only `@capacitor/filesystem` for exports and the service worker's HTML/asset caches). All device state is localStorage plus a few sessionStorage keys. Only four keys are synced (via `SettingsService` to `scalar_setting`): `appearance`, `doneClearing`, `emailTasks`, `feedbackStyle`. `BackupBundle` contains only `item` rows, so none of the below is in a backup file.

Held work (loss means lost user input; highest impact):

| key | what it holds | lost on new phone / reinstall |
|---|---|---|
| `jarvis.store.queue.<uid>.v1` | core Store offline write queue (held edits) | any edit made offline and not yet flushed |
| `jarvis.gym.live.v1`, `jarvis.gym.pending.v1` | in-progress workout and finished workouts not yet flushed | the live session and any unflushed workout |
| `jarvis.health.pending.v1` | health taps not yet flushed | unflushed Took It, meal, check-in, etc. |
| `jarvis.mail.outbox.v1`, `jarvis.today.outbox.v1` | undo-send and scheduled sends | scheduled sends (also only fire while the app runs; the unified substrate has a server `outbox_command`, so this is a second home for "mail to send") |
| `jarvis.eventlog.queue.v1`, `jarvis.events` | event log not yet sent | unsent log lines |
| `jarvis.notes.draft.v1.*`, `jarvis.chat.compose.v1`, `jarvis.mail.composeDraft.v1` | unsent drafts | the drafts |

Settings and decisions (loss means the person re-sets them; no second copy):

| key | what it holds |
|---|---|
| `jarvis.booking.settings.v1` | Your Times (available, days, duration). Code comment says "stored locally ... booking tables have no project to live in yet" |
| `jarvis.health.settings.v1` | health shortcuts, rest timer, PR celebration, weekly volume band |
| `jarvis.gym.settings.v1`, `jarvis.gym.activeProgram.v1` | bar weight, plates, rack unit, hidden/favorite lifts, aliases, muscles-by-lift map, active program |
| `jarvis.ai.resumeLevel` | the AI level to resume to after "Off" (the level itself is on the profile) |
| `jarvis.mail.rules.v1`, `vip`, `muted`, `letgo`, `links`, `desk`, `windows.*` | mirrored into `profile.mail` (see duplicate homes) |
| `jarvis.mail.categoryRules.v1`, `categoryTaps.v1`, `autoreply.*`, `unsub.v2`, `voice.v1`, `nudges.v1`, `chase.v1`, `promised.v1`, `cleared.v1`, `tossed.v1`, `netted.v1`, `snooze.v1`, `notify.v1`, `staledraft.v1`, `sweep.*`, `home.*`, `close.*`, `mail.peek.v1`, `autonoise.v1` | mail behavior memory, commitments, follow-ups, unsubscribe records, auto-reply |
| `jarvis.mail.tracks.v1` | the open-tracking uuid to thread map. The server `email_opens` rows cannot be tied back to a thread on another device |
| `jarvis.money.notMatch.v1`, `money.recurring.dismissed.v1` | "not a match" and dismissed recurring suggestions |
| `jarvis.money.envelopes.v1` | legacy envelopes. Now lifted onto `profile.envelopes`; the device copy is cleared after the lift |
| `jarvis.brain.principle.answers.v1`, `brain.triage.cursor.v1` | values-detector answers, triage position |
| `jarvis.music.v1` | remembered music deep links |
| `jarvis.reminders.morning.v1`, `schedule.blend.v1`, `dayloop.v1`, `timesense.v1`, `plan.pending.v1`, `plan.leanedOn.v1`, `focus.open.v1`, `start.session.v1`, `setaside.last` | scheduling and planning preferences/state |
| `jarvis.gcal.imported.v1` | marker that Google Calendar import ran. On a second device it is absent, so the first sync there takes the "never imported" path |
| `jarvis.auth.recovery.v1` (session) | password-recovery flag |

Caches and dismissals (safe to lose, listed for completeness): `jarvis.preload.v1.*` (per-type list cache, BOTH), `jarvis.setting.v1.*` (mirror of scalar_setting, BOTH), `jarvis.mail.acct/reads/rows` (mail cache), `jarvis.mail.brief.*`, `jarvis.mail.triage.*`, `jarvis.weather.*`, `jarvis.location.v1`, `jarvis.recent-searches`, `jarvis.captures.v1`, `jarvis.paste.dedupe.v1`, `jarvis.people.lastcontact.v1`, `jarvis.whereyouwere.*`, `jarvis.pregen.v1`, `jarvis.brain.nightly.v1`, and about 25 `*.dismissed` / `*.seen` / `*.asked` markers. `settings/clearLocalData.ts` holds an allowlist of the safe-to-clear ones, and refuses to touch the rest.

**Does the app tell the person?** Searching the UI strings found: the Clear Local Data row ("This device only, no undo"), a Readiness panel line ("This device only, not everything you have done"), and the doc comments. I did not find a screen, onboarding step or Backup page line that tells the person gym settings, booking times, health settings, mail rules beyond the mirrored five, held sends, or the offline queue will not follow them to a new phone or survive a reinstall. This is a search result, not proof of absence.

### 1f. BOTH (server record, device cache)

- All `item` lists through `CachedAdapter` and `preloadCache` (per type, owner-checked, capped at 500 items / 300 KB per type; over the cap it silently stops caching that type).
- `scalar_setting` and its `jarvis.setting.v1.*` mirror (newer server stamp wins).
- `profile.mail` (vips, rules, muted, letGo, links, desk, windows) and its localStorage originals (reads always come from localStorage; the profile is only for hydrating another device).
- `event_log` and its local queue.

## 2. Duplicate homes

| data | homes | assessment |
|---|---|---|
| Bank/money accounts | `item` type `account` (Money page, whole dollars, 4 rows) AND `money_account` (Tracker, integer cents, 4 rows) | **Two authoritative homes**, same owner has both. Not verified whether they describe the same accounts. Defect D5 |
| AI control | `profile.data.ai.level` (4 levels, default "draft", enforced by `api/ai.ts`) AND `auth.users.raw_app_meta_data.ai_allowed` (admin switch) AND `jarvis.ai.resumeLevel` (device) | Two server homes by design (person's choice vs admin switch). Default semantics differ: absent profile level = Draft Only; absent `ai_allowed` = allowed (reader is `!== false`) |
| Mail learned state | localStorage keys AND `profile.data.mail` | Documented mirror. The mirror only carries 7 of about 40 mail keys |
| Envelopes / budget | `profile.envelopes` (0 profiles have it) AND legacy `jarvis.money.envelopes.v1` AND `money_budget` item (0 rows) AND ledger budgets | Three budget-shaped homes; the lift from device to profile is in code, no profile has run it yet |
| Check-ins | `profile.data.checkin` (per-day one/mood/skip) AND `health_checkin` entity | Two homes for "a check-in". 0 `health_checkin` rows; whether any profile carries `checkin` was not checked |
| Decisions | `item` type `decision_record` (5 rows) AND substrate `decision_version` (0 rows) | By design `decision_save` writes both; the 5 existing records have no version row, so they predate the substrate. Hub behavior for them not verified |
| Mail to send | `jarvis.mail.outbox.v1` (device) AND substrate `email_draft` / `outbox_command` (server) | Two homes for outgoing mail |
| Booking | `jarvis.booking.settings.v1` (device) AND Track 3 `booking_links` / `availability_rules` (paused project) | Settings are device-only; the server side is written on Save. If the project stays paused, Save fails |
| Appearance / text size | `scalar_setting.appearance` AND `jarvis.appearance` AND mirror | Documented mirror; text size moved off the profile |
| Tabs | `profile.data.tabs` only (4 of 4 profiles have it) | One home. VERIFIED |
| Notification prefs | `profile.data.notify` (1 of 4 profiles) plus `jarvis.notifications.dismissed.v1` (device dismissals) plus push subscription in an external backend | Prefs one home (profile); subscription is outside Supabase |
| Health settings, Gym settings | localStorage only | One home, but it is the device. Defect D2 |
| Person phone/email fields | `phone` AND `phones[]`, `email` AND `emails[]` inside one person record (309 rows carry both phone fields) | Legacy field plus new field kept side by side. Low |
| AI accounting | `ai_usage` (admission) and `ai_tokens` (cost) | Different jobs, by design (migration 0026). Not a duplicate |

## 3. Production database

### 3a. Tables and migrations

- Production has 29 public tables and 4 `jarvis_private` tables. **Every one is created by a repo migration** (`jarvis-core/supabase/migrations`). No table exists in production that no migration creates. **No table from `migrations/` is missing from production.**
- The Track 3 tables (orgs, persons, areas, goals, projects, tasks, booking_*, connections, ...) are intentionally NOT in production; they are in `jarvis-core/supabase/track3/` for the other project.
- `list_migrations` (36 entries) versus the repo (52 files, `0001` to `0051`, with two files numbered `0042`):
  - Production history does **not** record 0001 to 0040 or `0042_brain_memory`. Their effects are present (tables, entity_type keys, functions `item_apply_patch`, `delete_owned`), so they were applied outside the recorded history (SQL editor or earlier project setup).
  - Production records 0044 to 0051 split into lettered parts (`0044a` ... `0050c`) plus nine `repair_main_safe_1..9` migrations. These repair migrations exist only in the production history; `docs/jarvis-unified/RELEASE-EVIDENCE.md` (deviation 55) explains them and records a fingerprint (md5 `24c80ab6...` over 127 objects) showing production equalled `main` on 2026-10-04.
  - `0052_ai_default_off` is recorded in production (applied 2026-10-05 by statement; the file lives on the `wt/backend` branch, not in this tree). The fingerprint above predates it.
  - `0053_client_error.sql` exists on `wt/backend` and is **not** applied (no `client_error` table in production). Expected, since crash reporting is still in progress.
  - Consequence: production's migration list cannot be used to rebuild a staging database. Staging must be built from the repo files plus the repair SQL, and fingerprinted.

### 3b. Orphans and integrity (SELECT only)

| check | result |
|---|---|
| items whose owner is not in `auth.users` | 0 |
| `scalar_setting`, `google_tokens`, `ai_usage`, `ai_tokens`, `event_log`, `email_account`, `email_message`, `agent_connection`, `job`, `action` rows with missing owner | 0 each |
| items with unregistered entity_type | 0 |
| items with null or non-object `data` | 0 |
| items with empty `{}` data | 0 |
| items where `updated_at < created_at` | 0 |
| items whose `data` carries row columns (`id`, `owner_id`, `entityType`) | 0 |
| duplicate singleton rows per owner (profile, routine, brain_doc) | 0 |
| duplicate category names per owner | 0 |
| tasks with neither title nor text, notes with no title, events with no title, profiles with no name | 0 |
| profile `data` size | max 1,371 bytes |
| users with items | 4 of 9 (5 users have no item at all) |
| soft-delete markers | 13 items, all `note` with numeric `deletedAt` (the Notes "Recently Deleted" feature; 30-day purge; the oldest was updated 2026-09-15 so none is past 30 days). Not an error, but a deliberate exception to the "native DELETE, no tombstone" rule of the core model |
| dangling references (same-owner lookup) | `task.category` 28 rows and `event.category` 6 rows all point to ONE category id that no longer exists (rows created 2026-06-10 to 2026-08-05, 28 of them done); `task.fromNote` 24 rows (all created in one batch on 2026-06-25) point to ONE note that no longer exists; `event.sourceTaskId` 5 rows point to 4 tasks that no longer exist. Zero cross-owner leakage (none of the missing ids exists under another owner). Excluded as by design: 36 rows with `category = ""` (unfiled, Law 11) |
| references that resolve cleanly | task.projectId (135), project.goalId (16), project.category (18), workout.programId (22), metric_log.metricId (4), decision.linkedId (5) |
| duplicate content | 5 person groups with the same name for one owner (10 rows); 2 task-title groups; 3 note-title groups; 1 `month_seal` month duplicated (the reader dedupes by month). Could be legitimate; not judged |

Bulk write events visible in `created_at` (what an import would look like): 24 tasks on 2026-06-25 (task batch from a note), 321 people on 2026-07-30 (contacts import), 31 `money_tx` on 2026-09-20 (the in-app "Import September Data" seed, which the code says is real data). These are in-app imports, not a data migration.

### 3c. RLS and policies

- RLS is enabled on **all 29 public tables and all 4 `jarvis_private` tables**. Public tables with policies: 22. Tables with RLS on and **no policy** (deny-all for client roles, intended as server-only): `ai_budget`, `ai_budget_reservation`, `ai_tokens`, `ai_usage`, `email_opens`, `feedback`, `google_tokens`, and the four `jarvis_private` tables.
- `item` and `scalar_setting` have four owner-scoped policies each (`owner_id = auth.uid()`). `entity_type` is read-only to authenticated users.
- `anon` and `authenticated` hold the default full table grants (including TRUNCATE) on the no-policy tables (`ai_usage`, `ai_tokens`, `email_opens`, `feedback`, `google_tokens`). RLS and PostgREST make this unreachable today; revoking the grants is defence in depth.

### 3d. Advisors, every warning

Security (get_advisors):
- WARN `auth_leaked_password_protection`: leaked password protection is disabled in Supabase Auth.
- WARN `function_search_path_mutable` (12): `set_monotonic_updated_at`, `item_apply_patch`, `item_apply_patch_if_older`, `jarvis_policy_rule_ok`, `jarvis_context_fields`, `jarvis_payload_clean`, `jarvis_capture_valid`, `jarvis_action_replay`, `jarvis_action_provisional_email`, `jarvis_address_ok`, `jarvis_address_norm`, `jarvis_draft_fields_bad`.
- WARN `authenticated_security_definer_function_executable` (39 findings): `action_undo`, `candidate_dismiss`, `candidate_edit`, `candidate_propose`, `candidate_restore`, `candidate_review_count`, `capture_approve`, `command_approve`, `command_cancel`, `command_review`, `connection_add_manual`, `connection_revoke`, `connection_set_mode`, `context_issue`, `context_preview`, `decision_dependencies_check`, `decision_history`, `decision_save`, `decision_withdraw`, `draft_discard`, `draft_get`, `draft_list`, `draft_save`, `evidence_read`, `exploration_keep`, `hub_overview`, `job_open`, `proposal_classify`, `proposal_dismiss`, `proposals_import`, `receipt_erase`, `scope_grant_create`, `send_approve`, `send_review`, `thread_messages`, `threads_latest`, `waiting_follow_up`, `waiting_reopen`, `waiting_resolve`. These are the substrate's RPC surface and are callable by signed-in users by design. Whether each one enforces `auth.uid()` ownership is covered by the substrate test scripts (`jarvis-core/supabase/tests/*.sh`), which I did not re-run.
- INFO `rls_enabled_no_policy` (11): listed in 3c.

Performance:
- WARN `auth_rls_initplan` (45): policies on `item`, `scalar_setting`, `entity_type`, `event_log`, `agent_connection`, `scope_grant`, `policy_suggestion`, `email_message`, `email_account`, `job`, `context_package`, `proposal`, `action`, `receipt_event`, `approval`, `email_message_body`, `source_evidence`, `decision_version`, `decision_dependency`, `email_candidate`, `email_draft`, `outbox_command` call `auth.uid()` per row; wrap in `(select auth.uid())`.
- INFO `unindexed_foreign_keys` (37), including `item_entity_type_fkey` and the `(x_id, owner_id)` composite keys of the substrate tables.
- INFO `unused_index` (14): on `ai_budget_reservation`, `email_opens`, `context_snapshot`, `feedback`, `action`, `receipt_event`, `agent_connection`, `approval`, `policy_suggestion`, `source_evidence`, `context_package`, `email_candidate`, `outbox_command` (2).

### 3e. AI default

All 9 users have **no** `ai_allowed` flag (0 true, 0 false, 9 unset). The reader treats unset as allowed (`ai_allowed !== false` in `src/ai/aiGate.ts`;  the SQL gate in migration 0045 reads `= 'false'`). Migration 0052 (a before-insert trigger on `auth.users`) stamps `false` on new signups only. The 9 existing accounts are not backfilled, so they stay allowed.

### 3f. Account deletion coverage

`delete_owned(uuid)` (called by `/api/account/delete`) removes rows from 22 tables. Not listed in it: `ai_budget`, `ai_budget_reservation` (have a `user_id`, no FK, no cleanup; both empty today). Covered by FK cascade from a parent that is deleted: `outbox_command`, the three `jarvis_private` credential/snapshot tables, `email_opens`, `google_tokens`. `feedback` is SET NULL by design. Storage objects are handled by `deleteAccountEverywhere`. `item.owner_id`, `event_log`, `ai_tokens` and every substrate table have no FK to `auth.users`, so deleting an auth user without calling `delete_owned` leaves their rows behind.

## 4. Migrated records (the Firebase to Supabase move)

What the repo contains: `grep -i firebase|firestore` over `docs`, `Claude outputs`, `_to_delete`, `jarvis-core/docs|README|STATE.md|supabase|src|tests`, `jarvis-app/src|api|tools`, `qa` finds only (a) a test comment "the old Firebase build" (`src/data/storageStress.test.ts`), (b) a decision record fixture, (c) a secret-scanner regex in `qa/publish.js`. `git log --all` has no commit mentioning Firebase. No migration script, export file, mapping doc, row-count reconciliation or checksum exists. `_to_delete` holds only lock files, `0031` to `0036` SQL copies and old handoff/paste scripts.

What the database shows:
- The production project was created 2026-05-22. `jarvis-core/STATE.md` records schema `0001` applied to a fresh project and the RLS test passing on 2026-05-22.
- The first auth user was created 2026-05-27 06:05:24 and the first item 19 seconds later. No rows pre-date that, and no bulk load carries older `created_at` values.
- No legacy entity type, no Firebase-shaped id (all ids are uuids) and no `data` blob carrying Firebase fields was found.
- The only bulk writes are the in-app imports listed in 3b.

Conclusion: **there is no evidence that records were migrated from Firebase into this database, and therefore none that they are complete or clean.** Either the data was re-entered or re-created in the new app, or a migration ran and left no trace and no record. The source data is not in the repo. I cannot verify row counts, field mapping, id mapping or timestamps against a source. What I can say is that the records now present are well-formed (3b), with the dangling references as the only integrity gap. The one candidate for "pre-existing data" is the 34 task/event rows from 2026-06 to 2026-08 that reference a vanished category, and the cause (a deleted category versus an import that dropped it) cannot be told apart from the data.

I did not inspect the other Supabase project in this account named "Bffsa Project" (created 2026-03-30): it is not identified as JARVIS in any repo file.

## 5. Verdict per data type

| data type | verdict | note |
|---|---|---|
| task | VERIFIED with a DEFECT | 399 rows clean; 28 point at a missing category, 24 at a missing note (D4) |
| event | VERIFIED with a DEFECT | 105 rows; 6 missing category, 5 missing sourceTask (D4) |
| note | VERIFIED | 19 rows; 13 in the trash by design |
| category | VERIFIED | 28 rows, no duplicates |
| person | VERIFIED with minor DEFECT | 329 rows; legacy phone/email fields duplicated; 5 duplicate-name groups (D8) |
| goal, project, routine, strand, brain_doc, learned_rule, chat_message, program, workout, metric_def, metric_log, month_seal, profile, health_call_it, health_point_at_it | VERIFIED | structure and references clean; `month_seal` has one duplicated month (reader dedupes) |
| decision_record | NOT VERIFIED | 5 rows; no `decision_version` rows behind them; Hub reading of pre-substrate decisions not tested |
| account (Money page) | DEFECT | second home with `money_account` (D5) |
| money_account, money_tx, money_sub | DEFECT | rows are real, but not in the backup registry or the cache write-through (D1) |
| money_bill, money_budget, money_receipt | NOT VERIFIED | 0 rows; also missing from the registry (D1) |
| health_checkin, health_meal, health_med_def | NOT VERIFIED | 0 rows; missing from the registry (D1) |
| the other health types (consent, lights_out, ate_before, took_it, bag_check, locker_doc, trusted_adult, age_rule_shown) | NOT VERIFIED | 0 rows, registered, in the registry |
| life_area, user_file, waiting, exploration_note | NOT VERIFIED | 0 rows; in the registry |
| brain_memory | DEFECT (registry) / NOT VERIFIED (content) | 0 rows; app writes it, registry omits it |
| profile fields (tabs, notify, ai, mail, envelopes, travel, checkin, avatar) | VERIFIED as one home each, except as listed in section 2 | `tabs` 4/4, `ai` 3/4, `notify` 1/4, `mail` 1/4, `envelopes` 0/4 |
| scalar settings (appearance, doneClearing, emailTasks, feedbackStyle) | VERIFIED | 3 rows, no nulls; mirror semantics in code |
| event_log, ai_usage, ai_tokens, google_tokens, feedback, email_opens | VERIFIED | server-only, RLS on, no orphans |
| unified substrate tables (email_*, job, action, ...) | VERIFIED structurally | RLS on, owner FKs composite; fingerprint of 2026-10-04 predates 0052 |
| booking links, availability, bookings | NOT VERIFIED | Track 3 project is paused (D3) |
| booking settings, health settings, gym settings, mail behavior, held sends, offline queues | DEFECT | device-only, not in backup (D2) |
| web push subscription | NOT VERIFIED | external backend, not Supabase |
| Google tokens | VERIFIED as present and owned | 2 rows, no orphan; encryption not checked (values not read) |
| migrated (Firebase-era) records | NOT VERIFIED | no evidence a migration ran (section 4) |

## Defects

| # | severity | defect |
|---|---|---|
| D1 | HIGH | The registry (`ALL_ENTITY_TYPES`) omits 10 types the app writes: `money_account`, `money_tx`, `money_sub`, `money_bill`, `money_budget`, `money_receipt`, `health_checkin`, `health_meal`, `health_med_def`, `brain_memory`. Effects: (a) Export includes them (it lists the whole account) but `importBundle` skips any type not in the registry, so a backup restore drops all Money Tracker data (52 production rows today) and reports it only as "unsupported types"; (b) `CachedAdapter` patch/delete write-through only walks `KNOWN_TYPES`, so an edit or delete of these types is not reflected in the cached list until a refresh wins, the exact resurrection bug PLUMB-F-03 fixed for the others; (c) `realtimeSync` iterates the same list. The law test `laws/entityRegistry.test.ts` only checks migrations and the `ENTITY_` naming, so it neither catches the omission nor sees `BRAIN_MEMORY_ENTITY` |
| D2 | HIGH | Device-only data with no backup and, as far as I could find, no warning: gym rack/lifts/muscle map, health settings, booking times, mail rules and memory beyond the 7 mirrored, held sends, the offline write queue, unflushed workouts and health taps |
| D3 | MEDIUM | Booking's server home (Track 3 project `zxszpuyhwvalfpfqgutq`) is INACTIVE and unreachable, so `/api/booking-link`, `/api/book`, `/api/bookings` cannot work against it; its `owner_id` is a bare uuid with no FK and Clerk auth is unwired; booking settings are device-only. Cannot verify any booking data |
| D4 | MEDIUM | Dangling references: 34 task/event rows point to one missing category; 24 tasks to one missing note; 5 events to 4 missing tasks. No cross-owner leak. The app's tolerance for these was not tested |
| D5 | MEDIUM | Two homes for money accounts: `account` (dollars) and `money_account` (cents), 4 rows each for the same owner |
| D6 | MEDIUM | AI default: the 9 existing accounts have no `ai_allowed` flag and are treated as allowed; 0052 covers new signups only; the reader's default (`!== false`) still means "allowed" if the trigger ever fails to stamp. The profile's own level defaults to Draft Only, so "unset" means two different things in two places |
| D7 | LOW | `ai_budget` and `ai_budget_reservation` are not cleaned by `delete_owned` and have no FK to `auth.users` (both empty today) |
| D8 | LOW | Duplicate content: 309 person records carry both `phone` and `phones` (and `email`/`emails`); 5 duplicate-name person groups; 1 duplicated `month_seal` month |
| D9 | LOW | Migration history: production does not record 0001 to 0040 or 0042_brain_memory, names differ from the repo, 9 `repair_main_safe` migrations have no repo file, and the repo has two `0042_*` files. A fresh environment cannot be built from the production list |
| D10 | LOW | Advisors: leaked-password protection off; 12 functions with a mutable search_path; 45 RLS policies re-evaluating `auth.uid()` per row; 37 unindexed FKs; 14 unused indexes; full table grants (incl. TRUNCATE) to `anon`/`authenticated` on the no-policy token tables |
| D11 | INFO | The Notes trash purge (`purgeTrash`) runs client-side; with 13 of 19 notes already in the trash, whether purge runs without the app being opened is unverified |

## Recommended fix list, most important first

1. Add the 10 missing types to `ALL_ENTITY_TYPES` (`src/backup/entityRegistry.ts`), add `BRAIN_MEMORY_ENTITY`'s import, and extend `laws/entityRegistry.test.ts` to fail when any `ENTITY_*` or `*_ENTITY` constant is absent from the registry. Add a backup round-trip test for `money_*`. Check `REFERENCE_FIELDS` for any money link fields before enabling restore.
2. Decide what must follow the person to a new phone and move it to the account: gym settings, health settings, booking settings, and the held-write queues' loss window. At minimum, extend `SettingsService` to these keys and include scalar settings in the backup bundle, and add a plain line on Backup and in onboarding saying what is device-only.
3. Un-pause or retire the Track 3 project, or move booking to the live project. Until then, treat booking as not working and say so in the app.
4. Backfill `ai_allowed` for the 9 existing users to match whatever Dave chooses (false per the order for new users; existing users are his decision), and change the reader default to "not allowed when unset" so an unstamped account is safe.
5. Decide the fate of `account` versus `money_account` and merge to one home, with a one-time copy and a test.
6. Re-point or clear the dangling references (D4): after confirming with Dave whether the missing category and note were deliberately deleted. Make category/note delete re-point or clear referencing rows.
7. Add `ai_budget` and `ai_budget_reservation` to `delete_owned` (new migration), and add FKs or a guard so every owner-scoped table is covered.
8. Reconcile migration history: commit the `repair_main_safe` SQL and the 0052 file, give one of the two `0042_*` files a unique number, and record the fingerprint query so it can be re-run (production again after 0052/0053, and on the new staging database).
9. Enable leaked-password protection; set `search_path` on the 12 functions; wrap `auth.uid()` in `(select auth.uid())` in the 45 policies; index the hot FKs (`item.entity_type`, `(item_id, owner_id)` keys); revoke table grants on the server-only tables from `anon` and `authenticated`.
10. Clean the person records (`phone` into `phones`, drop duplicates) with a one-time script, and run a duplicate review for names.
11. If Firebase-era data matters, find the original export; without it, state to Dave that no migration evidence exists. If it never existed, drop the question.

## Not verified, and why

- Firebase migration completeness: no source data, script, mapping or checksum in the repo or the database (section 4).
- Track 3 project: INACTIVE, query timed out; booking tables, row counts and RLS there unchecked.
- Web push subscription store and the native push token store: outside Supabase / not on this tree.
- Cross-device behavior (second device, reinstall): not tested; derived from code.
- Whether the app tolerates the dangling references; whether Hub shows the 5 pre-substrate decisions.
- Content correctness of any record (names, amounts, dates): not read, by instruction.
- Whether the 5 users with no items are test accounts: not identifiable without emails.
- Encryption of `google_tokens` and the values in `jarvis_private`: not read.
- Each SECURITY DEFINER RPC's ownership check: not re-run (the substrate test scripts own that).
- Staging: no staging database exists yet; all checks were against production.
