-- Migration 0032: an offline edit carries its own age.
--
-- PLUMB-F-10 (2026-09-05): "a replayed offline patch overwrites a newer edit
-- made on another device." The phone is offline at 9 AM and he renames a
-- task. At noon he renames it again on the laptop. At 5 PM the phone
-- reconnects and the 9 AM name replaced the noon name, because
-- last-write-wins (D7, D10) was only ever about ARRIVAL order at the server:
-- item_apply_patch merges unconditionally, and a queued write's age was never
-- carried anywhere.
--
-- This is item_apply_patch with one extra question asked first: is the row
-- already newer than the moment this edit was made? If it is, nothing is
-- touched and the caller is told, so the app can say it kept the newer edit
-- instead of silently losing one. Live writes keep using item_apply_patch:
-- a write happening now is the newest thing there is and has nothing to
-- compare itself against.
--
-- Three answers, so "there is no such row" cannot be mistaken for "your edit
-- was too old":
--   applied  the patch landed
--   stale    the row has been changed since the edit was made
--   missing  no such row, or not this caller's (RLS, so D6 and D9 hold)
--
-- security invoker, so row-level security applies exactly as it does to
-- item_apply_patch; the trigger from 0001 still stamps the monotonic
-- updated_at, and jsonb_strip_nulls (0031) still removes a cleared key.
create or replace function item_apply_patch_if_older(p_id uuid, p_patch jsonb, p_client_at timestamptz)
returns text
language plpgsql
security invoker
as $$
declare
  cur timestamptz;
  n int;
begin
  select updated_at into cur from item where id = p_id;
  if cur is null then
    return 'missing';
  end if;
  -- Strictly newer only. A row written in the same instant is not newer, so
  -- a replay can never be refused by its own earlier attempt.
  if cur > p_client_at then
    return 'stale';
  end if;
  update item
     set data = jsonb_strip_nulls(data || p_patch)
   where id = p_id;
  get diagnostics n = row_count;
  if n = 0 then
    return 'missing';
  end if;
  return 'applied';
end;
$$;
