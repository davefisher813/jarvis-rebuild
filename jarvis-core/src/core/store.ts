import type { DataAdapter } from "./adapter.js";
import { mergePatch, toWire } from "./patch.js";
import type { ApplyResult, Item, ItemData, QueuedCreate, QueuedOp, ServerTime } from "./types.js";

// Loads and saves the raw queue across a process boundary (app kill, tab
// close). Store owns the queue's shape and behavior; this is just the
// storage seam, so the core spine stays free of any browser global -- the
// app supplies a real one (localStorage-backed, S3-Q14) and every test
// simply omits it, exactly like every other optional-storage module in
// this codebase.
export interface StorePersistence {
  load(): QueuedOp[];
  save(queue: QueuedOp[]): void;
}

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return "offline_" + crypto.randomUUID();
  return "offline_" + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// The typed client layer the app talks to. It wraps any DataAdapter and adds
// the one client-side concern the adapter does not have: the offline queue.
//
// S3-Q14 (2026-09-04): "Nothing is held when the signal drops." Updates,
// creates and deletes all queue offline now, and the queue survives a kill
// when the app supplies persistence. Creates and deletes made offline also
// have to be VISIBLE offline -- a capture app whose own list does not show
// the note you just wrote until you reconnect has, for the user's purposes,
// still lost it -- so a pending create is held in `pendingCreates` and
// overlaid onto every read and list until reconnect makes it real, and a
// pending delete is hidden the same way via `pendingDeletes`.
export class Store {
  private online = true;
  private queue: QueuedOp[] = [];
  private pendingCreates = new Map<string, Item>();
  private pendingDeletes = new Set<string>();
  // Short-lived read cache for listForUser. Every app service reads through
  // listForUser, so a cold app start used to issue 10+ identical full fetches
  // back to back. Concurrent calls now share one in-flight request, and the
  // result stays warm for a few seconds. Any write through this Store
  // invalidates immediately, so reads-after-writes always see fresh data.
  // External writes (another device) can be up to LIST_TTL_MS stale, which is
  // within the app's existing sync expectations.
  // Keyed by owner + entity type ("*" for the untyped whole-account read),
  // so typed lists cache independently. Any write for an owner invalidates
  // every cached list for that owner: cheaper than tracking which type a
  // patch touched, and writes are rare next to reads.
  private listCache = new Map<string, { at: number; items: Promise<Item[]> }>();
  private static readonly LIST_TTL_MS = 3000;

  constructor(private readonly adapter: DataAdapter, private readonly persistence?: StorePersistence) {
    if (!persistence) return;
    // A kill mid-offline-session left these behind; rebuild the same local
    // overlay a live offline session would have, so a restart shows exactly
    // what it showed before the kill, not an empty list.
    for (const op of persistence.load()) {
      this.queue.push(op);
      if (op.op === "create") this.pendingCreates.set(op.id, this.itemFromCreate(op));
      else if (op.op === "delete") this.pendingDeletes.add(op.id);
    }
  }

  private itemFromCreate(op: QueuedCreate): Item {
    return { id: op.id, ownerId: op.ownerId, entityType: op.entityType, data: op.data, serverTime: op.queuedAt };
  }

  private saveQueue(): void {
    this.persistence?.save(this.queue);
  }

  private invalidate(ownerId: string): void {
    for (const key of this.listCache.keys()) {
      if (key.startsWith(ownerId + "|")) this.listCache.delete(key);
    }
  }

  async create(ownerId: string, entityType: string, data: ItemData): Promise<string> {
    if (!this.online) {
      const id = genId();
      const op: QueuedOp = { op: "create", id, ownerId, entityType, data, queuedAt: Date.now() };
      this.queue.push(op);
      this.pendingCreates.set(id, this.itemFromCreate(op));
      this.saveQueue();
      this.invalidate(ownerId);
      return id;
    }
    const id = await this.adapter.create(ownerId, entityType, data);
    this.invalidate(ownerId);
    return id;
  }

  // Bulk create in one round trip (contact import). Same cache semantics as
  // create: one invalidation for the whole batch. Not offered offline -- an
  // import needs the network for its source data anyway, so there is no
  // real case of one starting mid-outage; this stays a thin passthrough,
  // matching the pre-existing behavior.
  async createMany(ownerId: string, entityType: string, datas: ItemData[]): Promise<string[]> {
    if (datas.length === 0) return [];
    const ids = await this.adapter.createMany(ownerId, entityType, datas);
    this.invalidate(ownerId);
    return ids;
  }

  async read(ownerId: string, id: string): Promise<Item | null> {
    if (this.pendingDeletes.has(id)) return null;
    const pending = this.pendingCreates.get(id);
    if (pending) return pending.ownerId === ownerId ? this.clonePending(pending) : null;
    return this.adapter.read(ownerId, id);
  }

  // Update a record. Online: applied immediately, resolves true/false.
  // Offline: held in the queue, resolves "queued", and the read stays
  // whatever it was before the edit (D8's approved behavior, unchanged) --
  // UNLESS the target is itself still a pending create, in which case there
  // is no "before": the edit is folded straight into the local copy so it is
  // visible, same as any other local capture, and still queued so the same
  // patch replays once the create lands on reconnect.
  async update(
    ownerId: string,
    id: string,
    rawPatch: ItemData,
    serverTime?: ServerTime
  ): Promise<ApplyResult> {
    // SCHED-F-01 (2026-09-05): a cleared field leaves the phone as null,
    // never undefined. Undefined does not survive JSON, so the server never
    // saw the key and the old value came back on the next refresh. This is
    // the one seam every service writes through, so it is the one fix.
    const patch = toWire(rawPatch);
    if (this.online) {
      const r = await this.adapter.apply(ownerId, id, patch, serverTime);
      this.invalidate(ownerId);
      return r;
    }
    const pending = this.pendingCreates.get(id);
    if (pending) pending.data = mergePatch(pending.data, patch);
    this.queue.push({ op: "update", id, ownerId, patch, serverTime });
    this.saveQueue();
    this.invalidate(ownerId);
    return "queued";
  }

  async delete(ownerId: string, id: string): Promise<void> {
    if (!this.online) {
      if (this.pendingCreates.delete(id)) {
        // Created and destroyed within the same offline session: drop every
        // queued op for it. The server never needs to hear about a record
        // that never existed anywhere it can see.
        this.queue = this.queue.filter((op) => op.id !== id);
      } else {
        this.pendingDeletes.add(id);
        this.queue.push({ op: "delete", id, ownerId });
      }
      this.saveQueue();
      this.invalidate(ownerId);
      return;
    }
    await this.adapter.del(ownerId, id);
    this.invalidate(ownerId);
  }

  private clonePending(item: Item): Item {
    return { ...item, data: structuredClone(item.data) };
  }

  async listForUser(ownerId: string, entityType?: string): Promise<Item[]> {
    const base = await this.listForUserCached(ownerId, entityType);
    if (this.pendingCreates.size === 0 && this.pendingDeletes.size === 0) return base;
    const out = base.filter((it) => !this.pendingDeletes.has(it.id));
    for (const p of this.pendingCreates.values()) {
      if (p.ownerId === ownerId && (entityType === undefined || p.entityType === entityType)) out.push(this.clonePending(p));
    }
    return out;
  }

  private listForUserCached(ownerId: string, entityType?: string): Promise<Item[]> {
    const key = ownerId + "|" + (entityType ?? "*");
    const hit = this.listCache.get(key);
    const now = Date.now();
    if (hit && now - hit.at < Store.LIST_TTL_MS) return hit.items;
    const items = this.adapter.listForUser(ownerId, entityType).catch((e: unknown) => {
      // a failed fetch must not poison the cache window
      this.listCache.delete(key);
      throw e;
    });
    this.listCache.set(key, { at: now, items });
    return items;
  }

  goOffline(): void {
    this.online = false;
  }

  // Drain the offline queue in order, dispatching each op by kind. Peek
  // before applying, shift only after it lands: the original shift-then-await
  // shape lost a queued op for good if the network dropped again mid-drain
  // (apply throws -> op was already gone). Now a failure here leaves the
  // rest of the queue exactly as it was, for the next reconnect to retry.
  async reconnect(): Promise<void> {
    this.online = true;
    while (this.queue.length) {
      const op = this.queue[0]!;
      if (op.op === "create") {
        await this.adapter.create(op.ownerId, op.entityType, op.data, op.id);
        this.pendingCreates.delete(op.id);
      } else if (op.op === "update") {
        // toWire on replay too: update() normalizes before queueing, and this
        // keeps the adapter's contract (a clear is null, never undefined)
        // true for every op however it entered the queue.
        await this.adapter.apply(op.ownerId, op.id, toWire(op.patch), op.serverTime);
      } else {
        await this.adapter.del(op.ownerId, op.id);
        this.pendingDeletes.delete(op.id);
      }
      this.queue.shift();
      this.invalidate(op.ownerId);
      this.saveQueue();
    }
  }

  queueLen(): number {
    return this.queue.length;
  }
}
