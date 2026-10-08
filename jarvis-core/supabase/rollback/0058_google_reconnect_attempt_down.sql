-- Rollback of 0058: the attempt records go. The reconnect flow keeps working (its state is signed, so it still verifies and expires);
-- it just stops being single-use and stops recording progress.
drop table if exists public.google_reconnect_attempt;
