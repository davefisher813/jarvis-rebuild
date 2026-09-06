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
  // LEAVE BY (UP-CORE-07, 2026-09-05). The minutes it takes to GET to this
  // place, as the person typed them, plus whatever slack they asked for. Not
  // a route and not a GPS read: see schedule/leaveBy.ts for what this
  // deliberately is not. Only meaningful alongside a location.
  travelMin?: number;
  bufferMin?: number;
  // UP-CORE-10 (2026-09-05): the video link, the description and the guest
  // list an imported Google event carries. url and notes are editable here
  // (and settable on a hand-made event); attendees are Google's own list and
  // refresh with the import, since there is nothing here that writes them.
  url?: string;
  notes?: string;
  attendees?: { email: string; name?: string }[];
  recurrence?: EventRecurrence; // repeats from `date` forward
  // N3 (2026-08-21): the last day the series runs, inclusive. Absent means
  // forever, which is what every repeating event used to be: "fall clinics
  // through November" could not be said, so it either ran into next year or
  // had to be deleted by hand. Stored as YYYY-MM-DD on the event itself, so
  // no migration and no second entity.
  until?: string;
  exdates?: string[]; // occurrence dates removed/overridden from the series
  gcalId?: string; // Google Calendar event id, when imported (dedupe key)
  // PLUMB-F-07 (2026-09-05): WHAT GOOGLE LAST SAID, on the day this event was
  // imported or last refreshed. Not a digest despite the name: the five
  // Google-owned values themselves, JSON-encoded in the order title, date,
  // start, end, location. The import compares field by field against it, so
  // "Google moved the meeting" (row still matches the record) can be told
  // apart from "he retitled it here" (row differs), and a field he changed is
  // never clobbered. Absent on events imported before that, and on every
  // event he made himself.
  gcalHash?: string;
  sourceTaskId?: string; // task this block was generated from, via Plan my day
  // SCHED-F-04 (2026-09-05): WHICH SITTING OF THAT TASK this block is, 1-based,
  // absent when the task was placed as one block. Split It (P13, 2026-08-20)
  // says a three-hour task is not a three-hour sitting and commits two blocks;
  // the one-block-per-task sweep (hotfix 2026-08-21) then read the second as a
  // duplicate and deleted it on the next reload, with no toast and no undo.
  // The unit both rules argue about is (task, sitting), so the event says
  // which sitting it is. A JSONB field: no migration, and the sweep stays
  // honest instead of being switched off.
  sitting?: number;
  taskIds?: string[]; // attached tasks (Session 4 connections). Links live on
  // the event and die with it; non-recurring events only.
  // Provenance (addendum item 8): set on every AUTO-created event, absent on
  // hand-made ones. Lives in JSONB, no migration needed.
  source?: import("../shared/provenance").Source;
  // UP-CORE-05 (2026-09-05): the automated move, when there was one today.
  // Re-flow re-times a slipped plan block without asking; the row says so
  // for the day rather than leaving him to wonder why 2 PM says 4 PM now.
  // Cleared by the next time he moves it himself (ScheduleService.editTime).
  moved?: import("../shared/provenance").Source;
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
