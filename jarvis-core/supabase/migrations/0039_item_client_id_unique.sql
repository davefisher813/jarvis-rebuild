-- Migration 0039: one row per queued write (Health Push F, H-51, Build
-- Master 2026-09-12 section 4.8).
--
-- A health log or a finished workout is queued on the phone with a clientId
-- inside its data, and replayed when a flush's answer was lost to the
-- network. This partial unique index makes the second arrival a duplicate
-- key (23505) instead of a second row; the adapter then reads the row that
-- already landed. Partial, so every row written before this (and every
-- entity that never queues) is untouched. Additive; nothing else changes.
create unique index if not exists item_owner_client_id_idx
  on item (owner_id, (data->>'clientId'))
  where data ? 'clientId';
