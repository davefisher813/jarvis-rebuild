import type { ItemData, Json } from "./types.js";

// SCHED-F-01 (2026-09-05): "Clearing a field never saves on the real backend."
//
// Every service in the app expressed "remove this field" as `undefined`
// (`{ recurrence: undefined }`, `{ payday: undefined }`, `{ supersededById:
// undefined }`). A patch crosses the wire as JSON, and JSON has no undefined:
// `JSON.stringify({ recurrence: undefined })` is `{}`. The server then runs
// `data || p_patch`, a shallow jsonb merge that cannot see a key it was
// never sent, so the old value stayed and came back on the next refresh.
// The in-memory adapter spread the JS object instead, where undefined DOES
// overwrite, which is why every test passed while the phone could not clear
// anything. These three helpers are the one seam that fixes the whole class:
//
//   toWire      what Store hands the adapter: every top-level undefined
//               becomes null, the one value JSON can carry that means
//               "gone". Fixes every current and future clear in one place.
//   mergePatch  what the server does with it, ported exactly: the JSON round
//               trip (undefined keys vanish), the `||` merge (null
//               overwrites, a missing key leaves the old value), then
//               jsonb_strip_nulls (migration 0031) so a cleared key is
//               absent from the row rather than present as null.
//
// The in-memory adapter, the Store's local overlays and the app's preload
// cache all merge through mergePatch, so what a test sees, what an offline
// read shows, and what the server row holds are the same shape.

export function toWire(patch: ItemData): ItemData {
  let changed = false;
  const out: ItemData = {};
  for (const k of Object.keys(patch)) {
    const v = (patch as Record<string, Json | undefined>)[k];
    if (v === undefined) { out[k] = null; changed = true; }
    else out[k] = v;
  }
  return changed ? out : patch;
}

// Postgres jsonb_strip_nulls: every object field whose value is null is
// removed, at every depth. Nulls that are not object fields (array elements)
// are left alone.
export function stripNulls(v: Json): Json {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v !== null && typeof v === "object") {
    const out: { [key: string]: Json } = {};
    for (const [k, val] of Object.entries(v)) if (val !== null) out[k] = stripNulls(val);
    return out;
  }
  return v;
}

export function mergePatch(data: ItemData, patch: ItemData): ItemData {
  const wire = JSON.parse(JSON.stringify(patch)) as ItemData;
  return stripNulls({ ...data, ...wire }) as ItemData;
}
