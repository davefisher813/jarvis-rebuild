// Preload layer, part 1 (addendum locked principle 2): the persisted list
// cache that makes every list render instantly at app open. Stored per
// entity type in localStorage under a VERSIONED key (laws: stored shapes are
// versioned). The cache is a convenience copy, never the truth: a miss or an
// eviction just means the normal network path, and a corrupt entry clears
// itself. Gated on the adapter query fix (0019-era item 4) having landed,
// which it has: typed lists mean each type caches small and independently.

import type { Item } from "@core";

// Versioned base (laws: stored shapes are versioned); the entity type rides
// after the version so one type's cache can be dropped without touching the rest.
const BASE = "jarvis.preload.v1";
const PREFIX = BASE + ".";

// Bounds. A type over the item cap or the byte cap simply is not cached:
// silent truncation would lie to the first paint, so it is all or nothing
// per type. localStorage itself is ~5MB; these caps keep total well under.
const MAX_ITEMS_PER_TYPE = 500;
const MAX_BYTES_PER_TYPE = 300_000;

interface CacheEnvelope {
  owner: string;
  items: Item[];
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readPreload(owner: string, entityType: string): Item[] | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(PREFIX + entityType);
    if (!raw) return null;
    const env = JSON.parse(raw) as CacheEnvelope;
    // A different signed-in user's cache is worse than no cache.
    if (env.owner !== owner || !Array.isArray(env.items)) return null;
    return env.items;
  } catch {
    try { s.removeItem(PREFIX + entityType); } catch { /* already gone */ }
    return null;
  }
}

export function writePreload(owner: string, entityType: string, items: Item[]): void {
  const s = storage();
  if (!s) return;
  try {
    if (items.length > MAX_ITEMS_PER_TYPE) { s.removeItem(PREFIX + entityType); return; }
    const raw = JSON.stringify({ owner, items } satisfies CacheEnvelope);
    if (raw.length > MAX_BYTES_PER_TYPE) { s.removeItem(PREFIX + entityType); return; }
    s.setItem(PREFIX + entityType, raw);
  } catch {
    // Quota or serialization trouble: drop this entry, never throw into a
    // data path.
    try { s.removeItem(PREFIX + entityType); } catch { /* already gone */ }
  }
}

export function clearPreload(): void {
  const s = storage();
  if (!s) return;
  const doomed: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k && k.startsWith(PREFIX)) doomed.push(k);
  }
  for (const k of doomed) s.removeItem(k);
}

// A cheap change signature: ids plus each row's server time. Enough to know
// whether a background refresh actually changed anything worth repainting.
export function listSignature(items: Item[]): string {
  return items.map((i) => i.id + ":" + i.serverTime).sort().join("|");
}
