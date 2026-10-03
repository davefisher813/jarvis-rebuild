-- Rollback for 0049 (candidates proposed and read).
-- Not a migration: lives outside supabase/migrations so nothing applies it by
-- accident. Removes the two functions; the candidate rows themselves are
-- 0044's and stay.

drop function if exists candidates_for(uuid[], boolean);
drop function if exists candidate_propose(uuid, text, jsonb, jsonb, text[], text, text, text, text);
