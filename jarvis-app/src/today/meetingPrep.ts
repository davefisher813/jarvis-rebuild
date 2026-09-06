import { namePatterns, openWith, type MentionItem } from "../people/mentions";
import { agoLabel } from "../people/lastContact";
import { capAfterNumber } from "../shared/casing";

// BEFORE THE MEETING: WHO IT IS, WHAT IS OPEN, WHAT YOU SAID
// (UP-MIND-24, 2026-09-05).
//
// Walking into a call already knowing the two open items and the last thing
// you wrote is the thing an assistant does, and it is the one line that
// needs the calendar, tasks, mail and Contacts at the same time. All four
// have been in the app for months; nothing joined them.
//
// FACTS ONLY. It says what is open and when you last wrote, and it stops.
// No advice, no "you should follow up", no score of a relationship. The two
// taps it offers are the two the user would otherwise make by hand.
//
// Nothing here costs an AI call. The counts are a matcher over rows already
// loaded, the last-talked time is the cached lookup the person card runs,
// and the sent-mail question only runs when the chip is tapped.

/** How far ahead this looks. A meeting after lunch is not something to
 *  prepare for at nine, and a line about it all morning is a nag. */
export const PREP_WINDOW_MIN = 3 * 60;

export interface PrepPerson { id: string; name: string; email?: string }

export interface PrepEvent {
  id: string;
  title: string;
  date: string;
  start: string;
  location?: string;
  // Merge (2026-09-06): UP-CORE-10 landed the same guest list on EventData
  // first, as address plus optional display name, so this reads that one
  // shape rather than a second. Only the address is matched on: a display
  // name is Google's word for who somebody is, and matching one against
  // Contacts is the wrong-link problem people/mentions.ts exists to avoid.
  attendees?: { email: string; name?: string }[];
}

export interface MeetingPrep {
  eventId: string;
  person: PrepPerson;
  /** What is still open with them: tasks and upcoming time. */
  open: MentionItem[];
  /** The line under the event. Facts, joined with the middle dot. */
  line: string;
}

const toMin = (hhmm: string) => Number(hhmm.split(":")[0] ?? 0) * 60 + Number(hhmm.split(":")[1] ?? 0);

/** The person an event is with, by attendee address first and by the title
 *  second. Address equality is the link that is not a guess; the title
 *  matcher is the same narrow one the person card uses. */
export function personOfEvent(e: PrepEvent, people: PrepPerson[]): PrepPerson | null {
  const emails = new Set((e.attendees ?? []).map((a) => a.email.trim().toLowerCase()).filter(Boolean));
  if (emails.size > 0) {
    const byEmail = people.find((p) => p.email && emails.has(p.email.trim().toLowerCase()));
    if (byEmail) return byEmail;
  }
  // Exactly one, or nobody: "Call with Marco and Marco" is not a meeting
  // with a person this can name.
  const named = people.filter((p) => namePatterns(p.name).some((re) => re.test(e.title)));
  return named.length === 1 ? named[0]! : null;
}

/** The next event within the window that involves somebody in Contacts, with
 *  what is open with them. Null is the normal case and renders nothing. */
export function meetingPrep(
  events: PrepEvent[],
  people: PrepPerson[],
  tasks: { id: string; text: string; done?: boolean; due?: string | null; personId?: string }[],
  today: string,
  nowMin: number,
  lastMs?: (personId: string) => number | null,
  nowMsecs = Date.now(),
): MeetingPrep | null {
  const soon = events
    .filter((e) => e.date === today && toMin(e.start) >= nowMin && toMin(e.start) - nowMin <= PREP_WINDOW_MIN)
    .sort((a, b) => toMin(a.start) - toMin(b.start));
  for (const e of soon) {
    const person = personOfEvent(e, people);
    if (!person) continue;
    const open = openWith(
      { name: person.name, id: person.id },
      tasks,
      // Time with them is what the event itself is; listing the calendar
      // back at the user under their own calendar entry says nothing.
      [],
      today,
      4,
    );
    const parts: string[] = [person.name];
    if (open.length > 0) parts.push(capAfterNumber(`${open.length} open with them`));
    const ms = lastMs ? lastMs(person.id) : null;
    if (ms) parts.push("Last mail " + agoLabel(ms, nowMsecs).toLowerCase());
    return { eventId: e.id, person, open, line: parts.join(" · ") };
  }
  return null;
}
