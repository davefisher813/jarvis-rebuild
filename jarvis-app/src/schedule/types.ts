export const ENTITY_EVENT = "event";

// A calendar event. date is the day (YYYY-MM-DD); start/end are 24h "HH:MM".
// category drives the dot color on the calendar and the pill on the timeline.
export type EventRecurrence = "none" | "daily" | "weekly" | "monthly";

export interface EventData {
  title: string;
  date: string;
  start: string;
  category: string;
  end?: string;
  location?: string;
  recurrence?: EventRecurrence; // repeats from `date` forward
  // N3 (2026-08-21): the last day the series runs, inclusive. Absent means
  // forever, which is what every repeating event used to be: "fall clinics
  // through November" could not be said, so it either ran into next year or
  // had to be deleted by hand. Stored as YYYY-MM-DD on the event itself, so
  // no migration and no second entity.
  until?: string;
  exdates?: string[]; // occurrence dates removed/overridden from the series
  gcalId?: string; // Google Calendar event id, when imported (dedupe key)
  sourceTaskId?: string; // task this block was generated from, via Plan my day
  taskIds?: string[]; // attached tasks (Session 4 connections). Links live on
  // the event and die with it; non-recurring events only.
  // Provenance (addendum item 8): set on every AUTO-created event, absent on
  // hand-made ones. Lives in JSONB, no migration needed.
  source?: import("../shared/provenance").Source;
  // THE TRAINING DOOR, D4-C (Training Catalog V2, approved 2026-08-31).
  // Dave: "Right now I have a daily block for the gym. It should have the
  // option to insert the lift for the day." Marked by the athlete's own hand
  // in the event sheet -- same doctrine as gameCategoryId: the calendar
  // never GUESSES which block is the gym, whatever the title says. A door
  // event's row names the day's pinned lift and starts the session; it is
  // still an ordinary event everywhere else.
  gym?: boolean;
  // The door's receipts: occurrence date -> real minutes, stamped when a
  // session that walked in through this block finishes ("the block stamps
  // itself done with the real minutes"). A per-date record on the event, NOT
  // a general completion concept -- the schedule still has no idea of "done"
  // for anything else, and this dies with the event like taskIds does.
  trained?: Record<string, number>;
}

export interface EventItem {
  id: string;
  data: EventData;
}
