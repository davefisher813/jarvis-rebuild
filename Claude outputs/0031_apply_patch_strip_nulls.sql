-- Migration 0031: item_apply_patch strips nulls after the merge.
--
-- SCHED-F-01 (2026-09-05): "Clearing a field never saves on the real
-- backend." The app now sends a cleared field as an explicit null (the only
-- value JSON can carry that means "gone"; undefined never reached the wire,
-- so `data || p_patch` never saw the key and the old value came back on the
-- next refresh). A null merged into the row is a correct clear, but it
-- leaves `"recurrence": null` sitting in data forever. jsonb_strip_nulls
-- removes every null object field after the merge, so a cleared key is
-- simply absent, the same shape a row had before the field was ever set.
-- Everything else about the function is unchanged: security invoker, RLS
-- scoped, returns whether a row the caller owns was updated (D6, D9), and
-- the trigger from 0001 still stamps the monotonic updated_at.
create or replace function item_apply_patch(p_id uuid, p_patch jsonb)
returns boolean
language plpgsql
security invoker
as $$
declare
  n int;
begin
  update item
     set data = jsonb_strip_nulls(data || p_patch)
   where id = p_id;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
