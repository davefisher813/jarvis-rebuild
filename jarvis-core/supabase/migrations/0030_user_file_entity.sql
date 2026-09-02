-- Migration 0030: register user_file, the row about a file that belongs to
-- a page (a receipt on Money, 2026-09-02: "both pages need to have a
-- pic/file upload button (that's fully wired)"). The bytes live in the
-- user-files bucket from migration 0020; this row carries the name, the
-- storage path, the type, the size and which page it belongs to. A note's
-- own photos and files ride inside the note and need no row.
insert into entity_type (key) values ('user_file')
on conflict (key) do nothing;
