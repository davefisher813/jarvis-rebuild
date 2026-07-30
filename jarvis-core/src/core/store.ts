import type { DataAdapter } from "./adapter.js";
import type { ApplyResult, Item, ItemData, QueuedOp, ServerTime } from "./types.js";

// The typed client layer the app talks to. It wraps any DataAdapter and adds
// the one client-side concern the adapter does not have: the offline queue.
//
// Per the approved core behavior, only updates queue when offline. Creates and
// deletes apply immediately (matches the harness). A fuller offline model that
// also queues creates and deletes is deliberately out of scope for the core
// spine; it can be added later behind the same gate.
export class Store {
  private online = true;
  private queue: QueuedOp[] = [];
  // Short-lived read cache for listForUser. Every app service reads through
  // listForUser, so a cold app start used to issue 10+ identical full fetches
  // back to back. Concurrent calls now share one in-flight request, and the
  // result stays warm for a few seconds. Any write through this Store
  // invalidates immediately, so reads-after-writes always see fresh data.
  // External writes (another device) can be up to LIST_TTL_MS stale, which is
  // within the app's existing sync expectations.
  private listCache = new Map<string, { at: number; items: Promise<Item[]> }>();
  private static readonly LIST_TTL_MS = 3000;

  constructor(private readonly adapter: DataAdapter) {}

  private invalidate(ownerId: string): void {
    this.listCache.delete(ownerId);
  }

  async create(ownerId: string, entityType: string, data: ItemData): Promise<string> {
    const id = await this.adapter.create(ownerId, entityType, data);
    this.invalidate(ownerId);
    return id;
  }

  // Bulk create in one round trip (contact import). Same cache semantics as
  // create: one invalidation for the whole batch.
  async createMany(ownerId: string, entityType: string, datas: ItemData[]): Promise<string[]> {
    if (datas.length === 0) return [];
    const ids = await this.adapter.createMany(ownerId, entityType, datas);
    this.invalidate(ownerId);
    return ids;
  }

  read(ownerId: string, id: string): Promise<Item | null> {
    return this.adapter.read(ownerId, id);
  }

  // Update a record. Online: applied immediately, resolves true/false. Offline:
  // held in the queue, resolves "queued". On reconnect the queue replays in
  // order with no loss (D8).
  async update(
    ownerId: string,
    id: string,
    patch: ItemData,
    serverTime?: ServerTime
  ): Promise<ApplyResult> {
    if (this.online) {
      const r = await this.adapter.apply(ownerId, id, patch, serverTime);
      this.invalidate(ownerId);
      return r;
    }
    this.queue.push({ ownerId, id, patch, serverTime });
    this.invalidate(ownerId);
    return "queued";
  }

  async delete(ownerId: string, id: string): Promise<void> {
    await this.adapter.del(ownerId, id);
    this.invalidate(ownerId);
  }

  listForUser(ownerId: string): Promise<Item[]> {
    const hit = this.listCache.get(ownerId);
    const now = Date.now();
    if (hit && now - hit.at < Store.LIST_TTL_MS) return hit.items;
    const items = this.adapter.listForUser(ownerId).catch((e: unknown) => {
      // a failed fetch must not poison the cache window
      this.invalidate(ownerId);
      throw e;
    });
    this.listCache.set(ownerId, { at: now, items });
    return items;
  }

  goOffline(): void {
    this.online = false;
  }

  // Drain the offline queue in order. Each queued update is applied with its
  // captured server time, or a fresh server time if it had none, so a
  // reconnecting edit always carries the latest time and wins over prior state.
  async reconnect(): Promise<void> {
    this.online = true;
    while (this.queue.length) {
      const op = this.queue.shift() as QueuedOp;
      await this.adapter.apply(op.ownerId, op.id, op.patch, op.serverTime);
      this.invalidate(op.ownerId);
    }
  }

  queueLen(): number {
    return this.queue.length;
  }
}
