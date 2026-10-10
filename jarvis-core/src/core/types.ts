// Core data model types. The "spine" every Personal feature will sit on.
//
// ServerTime is an abstract, server-authoritative monotonic value. In the
// in-memory test adapter it is an integer counter. In the real database it is
// the row's updated_at timestamp, kept strictly increasing by a trigger. The
// only rule callers depend on: a write only wins if its ServerTime is greater
// than or equal to the current row's. This is the last-write-wins-by-server-time
// model approved in the harness (D7, D10).

export type ServerTime = number;

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

export type ItemData = Record<string, Json>;

// A stored record. owner_id is the per-user isolation key (D6). entity_type is
// the extensibility seam: the Personal types (org, workstream, project, meeting,
// contact) plug in here later without schema changes. None are seeded yet.
export interface Item {
  id: string;
  ownerId: string;
  entityType: string;
  data: ItemData;
  serverTime: ServerTime;
  // Phase 0 D8 (2026-10-10): WHEN THE RECORD WAS MADE, epoch ms. The row has
  // carried created_at since migration 0001 and no reader ever asked for it,
  // so the app has been dating a record by its last edit. Optional because a
  // test double or an older cached read may not carry one. For a create held
  // offline this is the queued moment, and the drain hands the server the
  // same number (D1 change 2), so the value never flips on reconnect.
  createdAt?: number;
}

// Result of an apply (update). true = applied, false = rejected (missing,
// not owner, or stale), "queued" = held offline for replay on reconnect.
export type ApplyResult = boolean | "queued";

// S3-Q14 (2026-09-04): "the core store... covers updates only." A queued
// write now carries its own kind, so a create or a delete made offline sits
// in the same FIFO as an update and replays in the order it was made.
// `queuedAt` on a create is a client-side timestamp, not a real server time
// -- Store shows it locally (see pendingCreates) until reconnect gets the
// real one from the adapter.
export interface QueuedCreate {
  op: "create";
  id: string;
  ownerId: string;
  entityType: string;
  data: ItemData;
  queuedAt: number;
}
export interface QueuedUpdate {
  op: "update";
  id: string;
  ownerId: string;
  patch: ItemData;
  serverTime?: ServerTime;
  // PLUMB-F-10 (2026-09-05): WHEN THE EDIT WAS MADE, client epoch ms. Without
  // it, "server-time-wins" (D7, D10) was only about arrival order at the
  // server: the phone offline at 9 AM, the laptop at noon, the phone
  // reconnecting at 5 PM, and the 9 AM name replaced the noon name because it
  // arrived last. The replay carries its own age now and the server refuses a
  // patch older than the row. Optional because a queue persisted by an
  // earlier build has none; those replay the old way, unconditionally.
  queuedAt?: number;
}
export interface QueuedDelete {
  op: "delete";
  id: string;
  ownerId: string;
  // Phase 0 D1 change 2 (2026-10-10): WHEN THE DELETE WAS MADE, client epoch
  // ms, so the history row the server writes for a replayed delete can carry
  // the moment he removed the record rather than the reconnect. Optional
  // because a queue persisted by an earlier build has none; those replay
  // without an age.
  queuedAt?: number;
}
export type QueuedOp = QueuedCreate | QueuedUpdate | QueuedDelete;
