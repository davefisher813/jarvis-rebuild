// Preload layer, part 3 (addendum locked principle 2): background draft
// pre-generation. At app open a consumer hands this module its top items;
// drafts are generated in the background, CAPPED at five per run, cached by
// source id AND a content hash, and regenerated only when the source
// actually changed. Cache-first: a warm entry costs zero calls.
//
// AI Control is enforced twice on this path: this module refuses to run at
// all unless the effective level allows background work, and every call it
// does make goes out with background: true, which the proxy refuses
// server-side below Draft Only. Off can never pre-generate, by construction
// and by law test.

import { aiCallAllowed, effectiveLevel, type AIPinKey } from "./aiGate";
import { getAIControl } from "./levelStore";

const KEY = "jarvis.pregen.v1";
export const PREGEN_CAP = 5;
const MAX_ENTRIES = 40;

export interface PregenRequest {
  // Draft namespace, e.g. "reply" or "plan". Part of the cache key.
  kind: string;
  // Id of the entity this draft is for.
  sourceId: string;
  // Cheap content hash of the source. Same hash = same draft, no call.
  hash: string;
  // The actual generation, typically an AIService call with background: true
  // and the feature's pin. Only invoked on a cache miss.
  build: () => Promise<string>;
  pin?: AIPinKey;
}

interface Entry { hash: string; text: string; ts: number }
type CacheShape = Record<string, Entry>;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readAll(): CacheShape {
  const s = storage();
  if (!s) return {};
  try {
    return (JSON.parse(s.getItem(KEY) || "{}") as CacheShape) || {};
  } catch {
    try { s.removeItem(KEY); } catch { /* already gone */ }
    return {};
  }
}

function writeAll(cache: CacheShape): void {
  const s = storage();
  if (!s) return;
  try {
    // Oldest entries fall off; the cache holds the near past, not history.
    const keys = Object.keys(cache);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => cache[a]!.ts - cache[b]!.ts);
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete cache[k];
    }
    s.setItem(KEY, JSON.stringify(cache));
  } catch { /* quota: pre-generation is a luxury, never an error */ }
}

const keyOf = (kind: string, sourceId: string) => kind + ":" + sourceId;

// The cache-first read every consuming surface uses at render time. A hit
// with a matching hash is a ready draft; anything else is a miss.
export function cachedDraft(kind: string, sourceId: string, hash: string): string | null {
  const e = readAll()[keyOf(kind, sourceId)];
  return e && e.hash === hash ? e.text : null;
}

// djb2. Cheap, stable, good enough to detect "the source changed".
export function contentHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Run one pre-generation pass. Returns how many calls were actually made.
// Misses beyond the cap are simply not generated this pass; they will be
// picked up next open. Failures skip the entry silently: pre-generation
// must never surface an error for work nobody asked for.
export async function pregenerate(requests: PregenRequest[]): Promise<number> {
  let made = 0;
  const cache = readAll();
  for (const r of requests) {
    if (made >= PREGEN_CAP) break;
    // The gate, per request so pins apply. Background by definition.
    if (!aiCallAllowed(effectiveLevel(getAIControl(), r.pin), true)) continue;
    const k = keyOf(r.kind, r.sourceId);
    const hit = cache[k];
    if (hit && hit.hash === r.hash) continue;
    try {
      const text = await r.build();
      cache[k] = { hash: r.hash, text, ts: Date.now() };
      made++;
    } catch { /* skipped; next open retries */ }
  }
  writeAll(cache);
  return made;
}
