import type { EventItem } from "./types";
import { occursOn, addDays, fmtTime } from "./calendar";

// EVENTS ARE FIRST-CLASS (Dave 2026-09-09: "events are also not tied to task
// modals"). The one place that turns a calendar into a PICKER, so every sheet
// that can file a task to an event offers the same list in the same order and
// with the same words.
//
// Three decisions, all of them the same decision: a picker is not a calendar.
//
//   It looks FORWARD. A task cannot be filed to a practice that already
//   happened, so yesterday is not an option. Today counts in full: something
//   that starts at 7 PM is still ahead of a task written at noon, and the
//   whole point of the row is the thing coming up.
//
//   It walks days rather than filtering dates, because a repeating event
//   carries one anchor date and every occurrence after it. A date filter finds
//   the anchor or nothing, which is the exact bug BRAIN-F-07 fixed on the area
//   page: a weekly practice anchored three weeks back is not "in the past", it
//   is on Thursday.
//
//   It names the DAY beside the title. Two events called "Practice" are not
//   the same practice, and a picker that cannot tell them apart is a picker
//   that files the task to the wrong one.

export interface SheetEvent {
  id: string;
  title: string;
  /** A rendered day, for the menu. Never an ISO string: a picker is read. */
  when: string;
  /** The event's own area, so the sheet can answer the Area question for him
   *  when he files a task to this event (Dave 2026-09-09: "if someone selects
   *  a project or event connected to a goal or category it should autofill
   *  when it can"). Blank when the event has no area, which fills nothing. */
  category?: string;
}

/** Human day for the picker: Today, Tomorrow, then the weekday and date. */
function dayWord(iso: string, today: string): string {
  if (iso === today) return "Today";
  if (iso === addDays(today, 1)) return "Tomorrow";
  const d = new Date(iso + "T00:00:00");
  const near = iso <= addDays(today, 6);
  return near
    ? d.toLocaleDateString([], { weekday: "long" })
    : d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/**
 * The events a task sheet can file to: every occurrence from today forward,
 * soonest first, capped.
 *
 * `days` is how far ahead to look and `max` how many rows the menu can hold.
 * Both are caps rather than promises: a menu is a thumb's worth of choices,
 * and a picker holding a year of a weekly practice is a scroll, not a choice.
 * A repeating event contributes only its NEXT occurrence, for the same reason:
 * offering the same practice six times is offering nothing six times.
 */
export function sheetEvents(events: EventItem[], today: string, days = 30, max = 20): SheetEvent[] {
  const out: SheetEvent[] = [];
  const seen = new Set<string>();
  for (let i = 0; i <= days && out.length < max; i++) {
    const iso = addDays(today, i);
    const onDay = events
      .filter((e) => !seen.has(e.id) && occursOn(e.data, iso))
      .sort((a, b) => a.data.start.localeCompare(b.data.start));
    for (const e of onDay) {
      if (out.length >= max) break;
      seen.add(e.id);
      const t = fmtTime(e.data.start);
      out.push({ id: e.id, title: e.data.title, when: `${dayWord(iso, today)} ${t.time}${t.ap}`, category: e.data.category || undefined });
    }
  }
  return out;
}
