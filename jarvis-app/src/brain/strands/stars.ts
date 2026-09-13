import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { StrandsService } from "./StrandsService";

// THE STARS, IN ONE PLACE (C-50, Astra, 2026-09-12). A row's Remember star
// fills while a strand linked to that row's entity exists. Dozens of rows
// ask at once, so the answer is one list read shared by every star on
// screen, refreshed after a tap, rather than a strand read per row.
//
// Module state on purpose: the strand store is one per signed-in user and
// the cache is keyed by the service instance, so a sign-out that builds a
// new provider starts a new cache.

const key = (entityType: string, entityId: string) => entityType + ":" + entityId;

interface Cache { svc: StrandsService | null; byKey: Map<string, string>; loaded: boolean; loading: Promise<void> | null; version: number }
const cache: Cache = { svc: null, byKey: new Map(), loaded: false, loading: null, version: 0 };
const listeners = new Set<() => void>();
const bump = () => { cache.version += 1; listeners.forEach((l) => l()); };

async function load(svc: StrandsService): Promise<void> {
  if (cache.svc !== svc) { cache.svc = svc; cache.byKey = new Map(); cache.loaded = false; cache.loading = null; }
  if (cache.loaded) return;
  if (cache.loading) return cache.loading;
  cache.loading = (async () => {
    try {
      const all = await svc.list();
      const next = new Map<string, string>();
      for (const s of all) if (s.data.link) next.set(key(s.data.link.entityType, s.data.link.entityId), s.id);
      cache.byKey = next;
      cache.loaded = true;
    } catch {
      // A failed read leaves every star hollow; the next mount asks again.
      cache.loaded = false;
    } finally {
      cache.loading = null;
      bump();
    }
  })();
  return cache.loading;
}

/** Forget the cache (a test, or a store swap). */
export function resetStars(): void {
  cache.svc = null; cache.byKey = new Map(); cache.loaded = false; cache.loading = null; bump();
}

/**
 * Whether this entity has a linked strand, and the tap that writes or
 * removes one. `title` is what the strand says when written: the row's
 * title, verbatim, source told, type fact.
 */
export function useStarLink(svc: StrandsService | null, entityType: string, entityId: string, today: string): {
  on: boolean;
  toggle: (title: string) => Promise<"starred" | "unstarred" | "full" | "failed">;
} {
  const subscribe = useCallback((l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; }, []);
  useSyncExternalStore(subscribe, () => cache.version);
  useEffect(() => { if (svc) void load(svc); }, [svc]);
  const k = key(entityType, entityId);
  const strandId = cache.svc === svc ? cache.byKey.get(k) : undefined;
  const toggle = useCallback(async (title: string) => {
    if (!svc) return "failed" as const;
    const cur = cache.byKey.get(k);
    try {
      if (cur) {
        await svc.unstar(cur, entityType, entityId);
        cache.byKey.delete(k);
        bump();
        return "unstarred" as const;
      }
      const id = await svc.addLinked(title, entityType, entityId, today);
      if (!id) return "full" as const;
      cache.byKey.set(k, id);
      bump();
      return "starred" as const;
    } catch {
      return "failed" as const;
    }
  }, [svc, k, entityType, entityId, today]);
  return { on: !!strandId, toggle };
}
