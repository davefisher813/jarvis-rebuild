// JARVIS event schema. This is the PERMANENT part: events are captured from
// Milestone A onward and interpreted by the gaming system at Milestone C, so the
// envelope and type taxonomy must stay stable. Mechanics (points, XP, levels,
// achievements) are derived from this log later, never computed here.
//
// Extending safely: add a new EventType string and emit it. The envelope does
// not change. For ad hoc or fast-moving cases, use type "action" with a name in
// props, so no schema bump is needed. Bump EVENT_SCHEMA_VERSION only if the
// envelope shape itself changes, and migrate on read.

export const EVENT_SCHEMA_VERSION = 1;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type EventType =
  // app + session lifecycle
  | "app.opened"
  | "app.foregrounded"
  | "auth.signed_in"
  | "auth.signed_out"
  // navigation
  | "screen.viewed"
  // generic entity lifecycle (the data engine's CRUD)
  | "entity.created"
  | "entity.updated"
  | "entity.deleted"
  // gaming-relevant actions (features arrive later; types reserved now)
  | "task.completed"
  | "focus.started"
  | "focus.completed"
  // escape hatch: props.name carries the specific action, no schema bump needed
  | "action";

export interface JarvisEvent {
  id: string; // unique per event
  type: EventType;
  ts: number; // epoch ms, client time of emission
  v: number; // schema version
  entityType?: string; // e.g. "task", "note" when the event concerns an entity
  entityId?: string;
  props?: Record<string, JsonValue>; // type-specific extra data
}

// What a caller provides; id/ts/v are stamped by the bus.
export type EventInput = Omit<JarvisEvent, "id" | "ts" | "v">;
