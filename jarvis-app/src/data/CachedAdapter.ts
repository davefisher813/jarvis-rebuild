// Preload layer, part 2 (addendum locked principle 2): the stale-while-
// revalidate adapter. Wraps the real adapter so that a typed list call at
// app open answers instantly from the persisted cache while a background
// refresh runs; when the refresh finds real changes it updates the cache
// and tells the app (onFresh), so a subscribed surface can repaint.
//
// READ-YOUR-WRITES, the rule that makes SWR safe here: every mutation this
// adapter performs is written through into the cached copy synchronously
// (create inserts, apply merges, del removes). A flow that writes and then
// re-lists sees its own write even when the list answers from cache. Without
// this the cache would show a just-deleted row for one repaint, which is the
// tombstone-resurrection feel this rebuild exists to kill.
//
// The cache is per entity type; untyped (whole-account) lists bypass the
// cache entirely, so backup always reads the truth.

import type { DataAdapter, Item, ItemData, ServerTime } from "@core";
import { listSignature, readPreload, writePreload } from "./preloadCache";

export type FreshListener = (entityType: string) => void;

export class CachedAdapter implements DataAdapter {
  constructor(private inner: DataAdapter, private onFresh?: FreshListener) {}

  async create(ownerId: string, entityType: string, data: ItemData): Promise<string> {
    const id = await this.inner.create(ownerId, entityType, data);
    const cached = readPreload(ownerId, entityType);
    if (cached) {
      writePreload(ownerId, entityType, [...cached, { id, ownerId, entityType, data, serverTime: Date.now() }]);
    }
    return id;
  }

  async createMany(ownerId: string, entityType: string, datas: ItemData[]): Promise<string[]> {
    const ids = await this.inner.createMany(ownerId, entityType, datas);
    const cached = readPreload(ownerId, entityType);
    if (cached) {
      const now = Date.now();
      writePreload(ownerId, entityType, [
        ...cached,
        ...ids.map((id, i) => ({ id, ownerId, entityType, data: datas[i]!, serverTime: now })),
      ]);
    }
    return ids;
  }

  async read(ownerId: string, id: string): Promise<Item | null> {
    return this.inner.read(ownerId, id);
  }

  async apply(ownerId: string, id: string, patch: ItemData, serverTime?: ServerTime): Promise<boolean> {
    const ok = await this.inner.apply(ownerId, id, patch, serverTime);
    if (ok) this.patchCaches(ownerId, id, patch);
    return ok;
  }

  async del(ownerId: string, id: string): Promise<void> {
    await this.inner.del(ownerId, id);
    this.dropFromCaches(ownerId, id);
  }

  async listForUser(ownerId: string, entityType?: string): Promise<Item[]> {
    // Whole-account reads (backup) never touch the cache.
    if (!entityType) return this.inner.listForUser(ownerId);

    const cached = readPreload(ownerId, entityType);
    if (cached) {
      // Answer stale, refresh in background. Errors are swallowed: the user
      // is looking at yesterday's list, which is exactly what SWR promises
      // when the network is down.
      void this.inner
        .listForUser(ownerId, entityType)
        .then((fresh) => {
          const changed = listSignature(fresh) !== listSignature(cached);
          writePreload(ownerId, entityType, fresh);
          if (changed) this.onFresh?.(entityType);
        })
        .catch(() => { /* stale stands until the network returns */ });
      return cached;
    }

    const fresh = await this.inner.listForUser(ownerId, entityType);
    writePreload(ownerId, entityType, fresh);
    return fresh;
  }

  // The write-through maintenance. Cache keys are per type and we do not
  // know the type of an id, so patch/delete walk the types we have cached.
  private patchCaches(ownerId: string, id: string, patch: ItemData): void {
    this.eachCachedType(ownerId, (entityType, items) => {
      const idx = items.findIndex((i) => i.id === id);
      if (idx < 0) return null;
      const cur = items[idx]!;
      const next = [...items];
      next[idx] = { ...cur, data: { ...cur.data, ...patch }, serverTime: Date.now() };
      return next;
    });
  }

  private dropFromCaches(ownerId: string, id: string): void {
    this.eachCachedType(ownerId, (entityType, items) =>
      items.some((i) => i.id === id) ? items.filter((i) => i.id !== id) : null,
    );
  }

  private eachCachedType(ownerId: string, fn: (entityType: string, items: Item[]) => Item[] | null): void {
    for (const t of KNOWN_TYPES) {
      const items = readPreload(ownerId, t);
      if (!items) continue;
      const next = fn(t, items);
      if (next) writePreload(ownerId, t, next);
    }
  }
}

// Every registered entity type (mirror of the entity_type registry). A type
// missing here still works; it just skips write-through and relies on the
// background refresh, so the failure mode is a late repaint, not wrong data.
export const KNOWN_TYPES = [
  "note",
  "task",
  "event",
  "category",
  "profile",
  "person",
  "brain_doc",
  "life_area",
  "goal",
  "project",
  "account",
  "routine",
  "program",
  "workout",
] as const;
