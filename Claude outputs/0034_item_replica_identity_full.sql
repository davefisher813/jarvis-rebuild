-- Migration 0034: deletes made on another device arrive live too
-- (UP-PLAT-06, 2026-09-06).
--
-- The app now subscribes to postgres_changes on `item`, filtered to the
-- signed-in user's own rows, so a change made on the laptop repaints the
-- phone while both are open. Postgres sends the OLD row for a DELETE only
-- when the table's replica identity carries it; by default it carries the
-- primary key alone, and Supabase Realtime therefore cannot evaluate a
-- filter like owner_id=eq.<uid> against a delete and drops the event.
--
-- Without this, inserts and updates converge live and deletes do not: a note
-- deleted on the laptop stays on the phone's screen until the next foreground
-- or list. With it, the delete arrives with enough of the row to route.
--
-- Cost: the write-ahead log carries the whole old row for updates and deletes
-- on this table rather than just its key. `item` rows are small JSONB
-- documents, and this is the table the whole app is built on, so the trade is
-- worth it. Safe to run at any time and safe to run twice.
--
-- The subscription itself also needs `item` in the realtime publication; the
-- second statement adds it if it is not already there.

alter table item replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'item'
  ) then
    alter publication supabase_realtime add table item;
  end if;
end $$;
