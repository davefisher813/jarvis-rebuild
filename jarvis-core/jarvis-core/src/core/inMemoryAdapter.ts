import type { DataAdapter } from "./adapter.js";
import type { Item, ItemData, ServerTime } from "./types.js";

// Faithful port of the approved harness `makeCore` storage semantics.
// This is the substrate the automated tests run against, since the sandbox
// cannot reach a live database. Every rule here must match both the harness
// and the SupabaseAdapter / SQL. Methods are async only to satisfy the shared
// interface; the logic is the synchronous core that Dave approved.
export class InMemoryAdapter implements DataAdapter {
  private seq = 0;
  private clock: ServerTime = 0; // server-authoritative monotonic time
  private db = new Map<string, Item>();

  private tick(): ServerTime {
    return ++this.clock;
  }

  private clone(item: Item): Item {
    // Deep copy so callers cannot mutate stored state by reference.
    return {
      id: item.id,
      ownerId: item.ownerId,
      entityType: item.entityType,
      data: structuredClone(item.data),
      serverTime: item.serverTime,
    };
  }

  async create(ownerId: string, entityType: string, data: ItemData): Promise<string> {
    const id = "r" + ++this.seq; // real adapter uses gen_random_uuid()
    this.db.set(id, {
      id,
      ownerId,
      entityType,
      data: structuredClone(data),
      serverTime: this.tick(),
    });
    return id;
  }

  async read(ownerId: string, id: string): Promise<Item | null> {
    const r = this.db.get(id);
    return r && r.ownerId === ownerId ? this.clone(r) : null;
  }

  async apply(
    ownerId: string,
    id: string,
    patch: ItemData,
    serverTime?: ServerTime
  ): Promise<boolean> {
    const r = this.db.get(id);
    if (!r || r.ownerId !== ownerId) return false; // D6 isolation, D9 missing id

    let t: ServerTime;
    if (serverTime == null) {
      t = this.tick(); // server assigns next monotonic time
    } else {
      t = serverTime;
      if (serverTime > this.clock) this.clock = serverTime; // monotonic clamp
    }

    if (t < r.serverTime) return false; // D7 / D10 last-write-wins by server time

    r.data = { ...r.data, ...patch };
    r.serverTime = t;
    return true;
  }

  async del(ownerId: string, id: string): Promise<void> {
    const r = this.db.get(id);
    if (r && r.ownerId === ownerId) this.db.delete(id); // hard delete, no tombstone
  }

  async listForUser(ownerId: string): Promise<Item[]> {
    const out: Item[] = [];
    for (const r of this.db.values()) {
      if (r.ownerId === ownerId) out.push(this.clone(r));
    }
    return out;
  }

  // Test helper: total rows across all owners. A deleted record cannot reappear
  // here (D5) because delete is hard and no tombstone table exists.
  snapshotCount(): number {
    return this.db.size;
  }
}
