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

  constructor(private readonly adapter: DataAdapter) {}

  create(ownerId: string, entityType: string, data: ItemData): Promise<string> {
    return this.adapter.create(ownerId, entityType, data);
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
    if (this.online) return this.adapter.apply(ownerId, id, patch, serverTime);
    this.queue.push({ ownerId, id, patch, serverTime });
    return "queued";
  }

  delete(ownerId: string, id: string): Promise<void> {
    return this.adapter.del(ownerId, id);
  }

  listForUser(ownerId: string): Promise<Item[]> {
    return this.adapter.listForUser(ownerId);
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
    }
  }

  queueLen(): number {
    return this.queue.length;
  }
}
