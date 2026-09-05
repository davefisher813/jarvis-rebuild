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

// PLUMB-F-01 (2026-09-05): an offline create's id IS the row's primary key
// once it replays (`insert({ id, ... })`, and item.id is a uuid column).
// S3-Q14 prefixed it "offline_", Postgres rejected every replay with
// "invalid input syntax for type uuid", and the create sat at the head of
// the queue forever with every later write stuck behind it. So: a bare
// uuid, always. The fallback is uuid-shaped too (version 4, variant 8-b),
// and random rather than time-based so two captures in one millisecond
// cannot share an id.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  let s = "";
  for (let i = 0; i < 32; i++) s += i === 12 ? "4" : i === 16 ? (8 + Math.floor(Math.random() * 4)).toString(16) : hex();
  return s.slice(0, 8) + "-" + s.slice(8, 12) + "-" + s.slice(12, 16) + "-" + s.slice(16, 20) + "-" + s.slice(20);
}

// Postgres unique_violation. A replayed create that already landed (the
// first attempt's response was lost to the network, or a second drain got
// there first) comes back with this; the row exists under the id we asked
// for, which is exactly the outcome the queue wanted.
function isDuplicateKey(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "23505";
}

// PLUMB-F-09 (2026-09-05): "the queue only engages on the browser's offline
// event." navigator.onLine on iOS only flips when no interface is up at all,
// so one bar of signal, a captive portal or a Supabase blip left onLine true,
// the write threw straight through, the toast said "Couldn't save" and the
// change was gone. The queue armed the day before never saw it.
//
// So the failure itself, not the browser's opinion, is what says the signal
// dropped. THE LINE THIS DRAWS: an answer FROM the server is an answer, and
// the caller must still hear it (a 400, a 403 from row-level security, a
// duplicate key, a validation refusal are all real and retrying them is
// wrong). Only a write that never got an answer, or got a server-side
// failure, is treated as the connection dropping.
export function isNetworkError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const o = e as { name?: unknown; message?: unknown; status?: unknown; code?: unknown };
  // A status is the most reliable signal there is. 0 means the request never
  // completed; 5xx means the far end fell over, which a retry can fix; every
  // other status is the server answering.
  if (typeof o.status === "number") return o.status === 0 || o.status >= 500;
  // fetch rejects with a TypeError, whatever the platform calls the reason.
  if (o.name === "TypeError" || o.name === "NetworkError" || o.name === "AbortError") return true;
  // A Postgres or PostgREST code is the server speaking, so it is never the
  // network, however its message reads.
  if (typeof o.code === "string" && o.code !== "") return false;
  const msg = typeof o.message === "string" ? o.message.toLowerCase() : "";
  return /failed to fetch|network ?error|network request failed|load failed|fetch failed|connection|econnreset|econnrefused|etimedout|timed? ?out|offline/.test(msg);
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
      else {
        // PLUMB-F-08: an edit queued against a row created in the same
        // offline session was folded into the local copy when it was made;
        // fold it again on restore, or the relaunch shows the un-edited
        // capture. Edits to synced rows need no rebuilding: read() and
        // listForUser() fold them straight from the queue.
        const pending = this.pendingCreates.get(op.id);
        if (pending) pending.data = mergePatch(pending.data, op.patch);
      }
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

  // HMN-F-15 (2026-09-05): `id` lets a caller put a record back under the id
  // it had. The adapter has accepted one since the offline queue's replay
  // (S3-Q14); this exposes it for the one caller that needs it, Undo after a
  // delete, so what pointed at the record (a task's fromNote, the Where You
  // Were spot) points at something that opens again. Only ever pass an id
  // whose row is gone.
  async create(ownerId: string, entityType: string, data: ItemData, id?: string): Promise<string> {
    if (!this.online) {
      if (id && this.pendingDeletes.has(id)) {
        // Undo of a delete that has not left the phone yet: the row never
        // left the server, so there is nothing to create. Forget the delete
        // and the record is back, exactly as the snapshot read it (server
        // row plus the patches still queued ahead of where the delete was).
        this.pendingDeletes.delete(id);
        this.queue = this.queue.filter((op) => !(op.op === "delete" && op.id === id));
        this.saveQueue();
        this.invalidate(ownerId);
        return id;
      }
      const useId = id ?? genId();
      const op: QueuedOp = { op: "create", id: useId, ownerId, entityType, data, queuedAt: Date.now() };
      this.queue.push(op);
      this.pendingCreates.set(useId, this.itemFromCreate(op));
      this.saveQueue();
      this.invalidate(ownerId);
      return useId;
    }
    try {
      const newId = await this.adapter.create(ownerId, entityType, data, id);
      this.invalidate(ownerId);
      return newId;
    } catch (e) {
      // PLUMB-F-09: the signal dropped mid-write. Going offline and calling
      // ourselves again takes the branch above, which queues the create and
      // shows it locally, so the capture is held instead of lost.
      if (!this.dropSignal(e)) throw e;
      return this.create(ownerId, entityType, data, id);
    }
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
    const item = await this.adapter.read(ownerId, id);
    if (!item || this.queue.length === 0) return item;
    const patch = this.pendingPatches(ownerId).get(id);
    return patch ? { ...item, data: mergePatch(item.data, patch) } : item;
  }

  // PLUMB-F-08 (2026-09-05): "Offline edits vanish from view until
  // reconnect." The overlay covered creates and deletes (S3-Q14) but not
  // updates, so a task ticked offline animated done, then read as undone the
  // moment its list re-rendered, until the network came back. S3-Q14's own
  // rationale (a capture the list does not show has, for the user, been
  // lost) applies to an edit just as much. The queued patches for each row
  // are folded, in order, onto what the adapter returns; they are derived
  // from the queue itself rather than kept in a second map, so restore,
  // delete-while-queued and reconnect all stay correct with nothing to keep
  // in step. Fold with a spread, not mergePatch: a clear rides the queue as
  // null and must still be null when it meets the row.
  private pendingPatches(ownerId: string): Map<string, ItemData> {
    const out = new Map<string, ItemData>();
    for (const op of this.queue) {
      if (op.op !== "update" || op.ownerId !== ownerId) continue;
      out.set(op.id, { ...(out.get(op.id) ?? {}), ...op.patch });
    }
    return out;
  }

  // Update a record. Online: applied immediately, resolves true/false.
  // Offline: held in the queue, resolves "queued", and the edit is visible
  // at once (PLUMB-F-08: read() and listForUser() fold the queued patch onto
  // the row) until reconnect makes it real. If the target is itself still a
  // pending create the edit is folded straight into the local copy instead,
  // and still queued so the same patch replays once the create lands.
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
      try {
        const r = await this.adapter.apply(ownerId, id, patch, serverTime);
        this.invalidate(ownerId);
        return r;
      } catch (e) {
        // PLUMB-F-09: same seam as create. The edit rides the queue instead
        // of dying in a "Couldn't save" toast.
        if (!this.dropSignal(e)) throw e;
        return this.update(ownerId, id, rawPatch, serverTime);
      }
    }
    const pending = this.pendingCreates.get(id);
    if (pending) pending.data = mergePatch(pending.data, patch);
    // PLUMB-F-10: stamped with WHEN the edit was made, so its replay can be
    // refused by a row that has changed since.
    this.queue.push({ op: "update", id, ownerId, patch, serverTime, queuedAt: Date.now() });
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
    try {
      await this.adapter.del(ownerId, id);
      this.invalidate(ownerId);
    } catch (e) {
      // PLUMB-F-09: a delete that never reached the server is queued too, so
      // the row does not reappear on the next list.
      if (!this.dropSignal(e)) throw e;
      await this.delete(ownerId, id);
    }
  }

  private clonePending(item: Item): Item {
    return { ...item, data: structuredClone(item.data) };
  }

  async listForUser(ownerId: string, entityType?: string): Promise<Item[]> {
    const base = await this.listForUserCached(ownerId, entityType);
    if (this.pendingCreates.size === 0 && this.pendingDeletes.size === 0 && this.queue.length === 0) return base;
    const patches = this.pendingPatches(ownerId);
    const out = base
      .filter((it) => !this.pendingDeletes.has(it.id))
      .map((it) => { const p = patches.get(it.id); return p ? { ...it, data: mergePatch(it.data, p) } : it; });
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

  // PLUMB-F-09: told when a write discovers the signal is gone, so the app
  // can start trying to reconnect on a backoff rather than waiting for a
  // browser "online" event that may never come (the interface never went
  // down; the far end did). Kept as a callback rather than a timer in here:
  // the core spine owns no clock, and the app already owns the connectivity
  // wiring (data/offlineSync.ts).
  private dropped: (() => void) | null = null;

  onDropped(fn: (() => void) | null): void {
    this.dropped = fn;
  }

  // PLUMB-F-10: told, after a drain, how many replayed edits were refused
  // because the record had been changed more recently somewhere else. The
  // app turns it into "Kept the newer edit", so a change that did not survive
  // is said out loud rather than silently discarded.
  private keptNewer: ((count: number) => void) | null = null;

  onKeptNewer(fn: ((count: number) => void) | null): void {
    this.keptNewer = fn;
  }

  // True when `e` means the connection dropped, in which case the store is
  // now offline and the caller should queue. False means the server answered
  // and the error belongs to the caller.
  private dropSignal(e: unknown): boolean {
    if (!isNetworkError(e)) return false;
    this.online = false;
    try { this.dropped?.(); } catch { /* a listener must never break a write */ }
    return true;
  }

  // PLUMB-F-02 (2026-09-05): one drain at a time. Every "online" event calls
  // reconnect(), and WKWebView fires them in pairs on an interface change.
  // Two drains over one queue peek the same head op before either shifts
  // it: the same create inserted twice, the same patch applied twice, and
  // with uneven latency the OLDEST patch landing last, so an edit made three
  // times offline read as its first version again. A second caller now gets
  // the in-flight drain's own promise, exactly the `flushing` latch
  // ServerSink.flush() already has.
  private draining: Promise<void> | null = null;

  reconnect(): Promise<void> {
    this.online = true;
    if (this.draining) return this.draining;
    const run = this.drain().finally(() => { this.draining = null; });
    this.draining = run;
    return run;
  }

  // Drain the offline queue in order, dispatching each op by kind. Peek
  // before applying, shift only after it lands: the original shift-then-await
  // shape lost a queued op for good if the network dropped again mid-drain
  // (apply throws -> op was already gone). Now a failure here leaves the
  // rest of the queue exactly as it was, for the next reconnect to retry.
  private async drain(): Promise<void> {
    // Rows this drain has already written, and rows whose held edits lost to
    // a newer one somewhere else.
    //
    // PLUMB-F-10: the age check compares an edit against the row's last
    // write, and once this drain has written the row ITSELF, that last write
    // is seconds old. Without this set, a capture made offline would refuse
    // its own offline edits, and the second of three held edits to one task
    // would be refused by the first. Both are one held session replaying, and
    // a session cannot be newer than itself. Only writes that actually landed
    // count: an edit refused as stale leaves the row someone else's, so the
    // edits queued behind it are measured against that newer row too.
    const writtenHere = new Set<string>();
    const lostRows = new Set<string>();
    while (this.queue.length) {
      const op = this.queue[0]!;
      if (op.op === "create") {
        try {
          await this.adapter.create(op.ownerId, op.entityType, op.data, op.id);
        } catch (e) {
          // PLUMB-F-01: the row is already there under this id; that is
          // success, not a reason to wedge the queue on every online event.
          if (!isDuplicateKey(e)) throw e;
        }
        this.pendingCreates.delete(op.id);
        writtenHere.add(op.id);
      } else if (op.op === "update") {
        // toWire on replay too: update() normalizes before queueing, and this
        // keeps the adapter's contract (a clear is null, never undefined)
        // true for every op however it entered the queue.
        const wire = toWire(op.patch);
        if (op.queuedAt === undefined || !this.adapter.applyIfOlder || writtenHere.has(op.id)) {
          // A queue persisted by a build that did not stamp the age, or an
          // adapter that cannot ask the question. Replays the old way rather
          // than being thrown away.
          await this.adapter.apply(op.ownerId, op.id, wire, op.serverTime);
        } else {
          // PLUMB-F-10: the edit's own age decides, not its arrival.
          const outcome = await this.adapter.applyIfOlder(op.ownerId, op.id, wire, op.queuedAt);
          if (outcome === "stale") lostRows.add(op.id);
          else if (outcome === "applied") writtenHere.add(op.id);
        }
      } else {
        await this.adapter.del(op.ownerId, op.id);
        this.pendingDeletes.delete(op.id);
      }
      this.queue.shift();
      this.invalidate(op.ownerId);
      this.saveQueue();
    }
    // Once for the whole drain, and counted in RECORDS, not patches: three
    // held edits to one task that all lost to one newer edit is one thing
    // that happened to him, and he should be told once.
    if (lostRows.size > 0) {
      try { this.keptNewer?.(lostRows.size); } catch { /* a listener must never wedge the queue */ }
    }
  }

  queueLen(): number {
    return this.queue.length;
  }
}
