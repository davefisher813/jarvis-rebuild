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

  // THE REFRESH THAT ARRIVED LATE (Dave 2026-08-30: "things aren't clearing.
  // There's bugs with tasks and reminders. They eventually did but it took a
  // couple of tries").
  //
  // Read-your-writes above is only true while no refresh is open. A refresh
  // is a network round trip, and the one fired by the render he is looking at
  // is still in flight when he ticks something a second later. That refresh
  // captured the server's list BEFORE the tick; on arrival it called
  // writePreload unconditionally and overwrote the write-through that had
  // just marked the task done. The next reload read the clobbered cache and
  // the task came back undone. Ticking again usually worked, because the
  // second tick landed with nothing in flight -- "a couple of tries" is the
  // signature of this exact race.
  //
  // Every mutation bumps this counter. A refresh notes it on the way out and
  // checks it on the way back: if it moved, a write landed mid-flight and the
  // fresh list is by definition older than what the cache now holds, so it is
  // dropped. The write always wins; the next list call opens a new refresh
  // that will include it, so nothing from another device is lost for longer
  // than one round trip.
  //
  // One counter for all types rather than one per type, because patchCaches
  // and dropFromCaches genuinely do not know an id's type (see below) and so
  // cannot say which type they touched. The cost of the coarser signal is a
  // redundant refresh; the cost of a finer one that guessed wrong is losing
  // the user's write. Err toward the write.
  private writes = 0;

  async create(ownerId: string, entityType: string, data: ItemData): Promise<string> {
    const id = await this.inner.create(ownerId, entityType, data);
    this.writes++;
    const cached = readPreload(ownerId, entityType);
    if (cached) {
      writePreload(ownerId, entityType, [...cached, { id, ownerId, entityType, data, serverTime: Date.now() }]);
    }
    return id;
  }

  async createMany(ownerId: string, entityType: string, datas: ItemData[]): Promise<string[]> {
    const ids = await this.inner.createMany(ownerId, entityType, datas);
    this.writes++;
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
    if (ok) { this.writes++; this.patchCaches(ownerId, id, patch); }
    return ok;
  }

  async del(ownerId: string, id: string): Promise<void> {
    await this.inner.del(ownerId, id);
    this.writes++;
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
      const sentAt = this.writes;
      void this.inner
        .listForUser(ownerId, entityType)
        .then((fresh) => {
          // A write landed while this was in flight. The fresh list predates
          // it, so writing it back would undo the user's own action.
          if (this.writes !== sentAt) return;
          const changed = listSignature(fresh) !== listSignature(cached);
          writePreload(ownerId, entityType, fresh);
          if (changed) this.onFresh?.(entityType);
        })
        .catch(() => { /* stale stands until the network returns */ });
      return cached;
    }

    // A cold read has no cached copy to protect, but it can still be
    // overtaken: a write can land between the request going out and the
    // answer coming back. Same rule, same reason -- and the counter must be
    // read BEFORE the await, or it is comparing a value to itself.
    const coldSentAt = this.writes;
    const fresh = await this.inner.listForUser(ownerId, entityType);
    if (this.writes === coldSentAt) writePreload(ownerId, entityType, fresh);
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
  "month_seal",
] as const;
