-- Register the gym entities (Gym track session 1, 2026-08-04).
--   program: the user's training program (days -> exercises, all free text).
--   workout: one finished session, including its set logs.
-- Set logs are CONTENT and live here in item data; the behavioural event_log
-- records only the FACT that a session completed, so a year of training never
-- bloats the log. Mirrors 0002-0014. Apply in the Supabase SQL editor.
insert into entity_type (key) values ('program') on conflict (key) do nothing;
insert into entity_type (key) values ('workout') on conflict (key) do nothing;
