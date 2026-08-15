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
  exdates?: string[]; // occurrence dates removed/overridden from the series
  gcalId?: string; // Google Calendar event id, when imported (dedupe key)
  sourceTaskId?: string; // task this block was generated from, via Plan my day
  taskIds?: string[]; // attached tasks (Session 4 connections). Links live on
  // the event and die with it; non-recurring events only.
  // Provenance (addendum item 8): set on every AUTO-created event, absent on
  // hand-made ones. Lives in JSONB, no migration needed.
  source?: import("../shared/provenance").Source;
}

export interface EventItem {
  id: string;
  data: EventData;
}
