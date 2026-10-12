-- Rollback of 0067: the two reads go. Nothing else was created or changed; no row is touched.
drop function if exists paused_sends();
drop function if exists candidates_to_review(integer);
