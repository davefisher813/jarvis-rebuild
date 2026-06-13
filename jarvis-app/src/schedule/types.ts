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
}

export interface EventItem {
  id: string;
  data: EventData;
}
