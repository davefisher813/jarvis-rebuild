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
}
export interface QueuedDelete {
  op: "delete";
  id: string;
  ownerId: string;
}
export type QueuedOp = QueuedCreate | QueuedUpdate | QueuedDelete;
