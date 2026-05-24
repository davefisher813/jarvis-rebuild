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

export interface QueuedOp {
  ownerId: string;
  id: string;
  patch: ItemData;
  serverTime?: ServerTime;
}
