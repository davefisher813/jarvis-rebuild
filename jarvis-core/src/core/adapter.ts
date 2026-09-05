import type { Item, ItemData, ServerTime } from "./types.js";

// The storage backend. Two implementations exist and MUST behave identically:
//
//   InMemoryAdapter  - no network, used by the automated tests in this repo.
//   SupabaseAdapter   - the real database, used on device.
//
// The adapter represents the server's view of the data: it owns server time,
// enforces owner isolation (mirrors row-level security), does hard deletes
// (no tombstones), and resolves conflicts by last-write-wins on server time.
// The offline queue is NOT here; that is a client concern and lives in Store.
//
// Methods are async because the real backend is a network database. The
// in-memory adapter resolves immediately. The approved behavior is identical
// either way; only the await differs.
export interface DataAdapter {
  // Create a record for an owner. Assigns id and the initial server time,
  // unless `id` is given, in which case it is used as-is. Store passes one
  // when a create made offline replays on reconnect (S3-Q14, 2026-09-04):
  // the id was already handed to the caller and possibly to further queued
  // updates the moment it was made, so the record this creates has to land
  // under that SAME id rather than a fresh one nothing else knows about.
  create(ownerId: string, entityType: string, data: ItemData, id?: string): Promise<string>;

  // Create many records of one entity type in a single round trip, in order.
  // Exists for bulk flows (contact import); behavior per row is identical to
  // create(). Returns the new ids in input order.
  createMany(ownerId: string, entityType: string, datas: ItemData[]): Promise<string[]>;

  // Read one record. Resolves null if it does not exist OR is not owned by the
  // caller (per-user isolation, D6). Never leaks another user's row.
  read(ownerId: string, id: string): Promise<Item | null>;

  // Apply a patch to a record (merge into data).
  //  - Missing id or wrong owner: rejected, resolves false, no throw (D6, D9).
  //  - serverTime omitted: the server assigns the next monotonic time.
  //  - serverTime supplied: used as the write's time; the adapter advances its
  //    clock so it never falls behind an accepted time (monotonic). A write
  //    whose time is older than the current row is rejected (D7, D10).
  apply(
    ownerId: string,
    id: string,
    patch: ItemData,
    serverTime?: ServerTime
  ): Promise<boolean>;

  // PLUMB-F-10 (2026-09-05): apply a patch only if the row has not been
  // changed since `clientAt` (client epoch ms, the moment the edit was made).
  // This is what carries the AGE of an offline edit to the server: without
  // it, a patch made at 9 AM and replayed at 5 PM overwrote a noon edit from
  // another device, because last-write-wins was measured by arrival.
  //
  //   "applied"  the patch landed
  //   "stale"    the row is newer than the edit, so nothing was touched
  //   "missing"  no such row, or not the caller's (D6, D9)
  //
  // Only the offline queue's replay calls it; a live write is already the
  // newest thing there is. Optional: an adapter without it (a test double)
  // replays the old way, unconditionally, which is exactly what every
  // adapter did before this existed.
  applyIfOlder?(
    ownerId: string,
    id: string,
    patch: ItemData,
    clientAt: number
  ): Promise<"applied" | "stale" | "missing">;

  // Hard delete. Removes the row entirely (D4). A deleted row never returns on
  // reload because there is no tombstone (D5). Deleting a missing id or another
  // user's id is a safe no-op (D9, D6).
  del(ownerId: string, id: string): Promise<void>;

  // All records owned by this user. Never includes other users' rows (D6).
  // With entityType, only rows of that type, filtered AT THE BACKEND (SQL
  // eq on entity_type; the (owner_id, entity_type) index from migration 0001
  // covers it). Services pass their type so a list never becomes a full
  // table scan; omitting it is reserved for whole-account flows (backup).
  listForUser(ownerId: string, entityType?: string): Promise<Item[]>;
}
