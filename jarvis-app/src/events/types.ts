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
  | "app.foregrounded" // reserved: no emitter yet (audit 2026-08-07)
  | "auth.signed_in"
  | "auth.signed_out"
  // navigation
  | "screen.viewed" // reserved: no emitter yet (audit 2026-08-07)
  // generic entity lifecycle (the data engine's CRUD)
  | "entity.created"
  | "entity.updated"
  | "entity.deleted"
  // gaming-relevant actions (features arrive later; types reserved now)
  | "task.completed"
  | "focus.started"
  | "focus.completed"
  // Brain rebuild layer 1 (Session 6.5): the semantic acts the durable log
  // persists and the launch derivations read
  | "task.pushed"
  | "plan.picked"
  | "plan.outcome"
  | "suggestion.accepted"
  | "suggestion.dismissed"
  // Brain Personalization Phase 2 (2026-08-06): the AI's Plan My Day duration
  // estimate vs. what the user actually committed, category + signed minutes
  // (positive = ran longer than estimated). Feeds a Phase-2-only pattern
  // observation; carries no free text, same discipline as the rest of this log.
  | "plan.duration_corrected"
  // A reminder enacted (2026-08-25, insights build). NOT task.completed on
  // purpose: the reminder doctrine says ticks never count toward the day's
  // numbers, and the durable log keeps that promise by giving the act its
  // own type. The monthly report reads it as adherence evidence.
  | "reminder.ticked"
  // The deck's voice metric (promoted from a free-form "action" 2026-08-07):
  // an AI-drafted reply that went out. flag = edited first (true means the
  // draft was NOT good enough to send as written, which is the number that
  // says whether the voice work is landing). Durable because losing a phone
  // must not zero the one measure of draft quality.
  | "email.deck_sent"
  // A thread was DEALT WITH (Brain build handoff item 1, 2026-09-04: "only
  // the task loop is instrumented... a month of heavy use in any of those
  // teaches the Brain nothing, because nothing is listening"). Email is the
  // module doing the most daily work and emitting the least meaning, so it
  // gets the first new write points.
  //
  // props.kind is the closed vocabulary the sink already regex-gates:
  // reply | archive | sweep. What is deliberately NOT here: who it was
  // from, what it said, what it was about. The row carries an hour and a
  // day, which is all the band derivation reads, and nothing about the mail
  // itself can leave the device through this path.
  | "email.handled"
  // What a plan block actually committed at (category, n = minutes), so the
  // sheet can pre-fill lengths from the user's own history instead of a flat
  // 30 (2026-08-09). Durable for the same reason durations were worth
  // correcting at all: the learning must survive the device.
  | "plan.duration_committed"
  // Brain Layer 2 (queue item 04): the strand lifecycle. kind carries the
  // derivation key, which is what makes the nod test operational: correction
  // and deletion rates per derivation are computed from these rows, and a
  // derivation that keeps being wrong stops surfacing (moments.ts).
  | "strand.created"
  | "strand.corrected"
  | "strand.deleted"
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
