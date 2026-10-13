// A THING THAT CAME FROM AN EMAIL IS ON TODAY ONCE (issue 112, ruling 18, Dave 2026-10-13: "An email-derived task or event
// appears on Today exactly once, as a normal task or event. Email adds no second, email-flavored copy of the same item on
// Today. Implement deduplication by item identity so nothing shows twice, and nothing Dave approved from an email
// disappears from Today either."; Email Build Spec 2026-10-08 section 7 and AC48: confirmed Tasks and Schedule events are
// shown by their owning modules, deduplicated by destination ID, and Email does not render them again).
//
// The Email band used to draw a row of its own for every task and event a capture had made, so one approved item showed
// in the band and again in the Today stream, the Next-event card and the TV guide. The band no longer draws them
// (email/waiting.ts emailTodayRows keeps the paused-replies card and the due Waiting rows, nothing else). This file is the
// other half: the surfaces that already own a task or an event take it, and take it once.
//
// IDENTITY IS THE DESTINATION'S ID (spec 3.3), never mail text: a task id, an event id. onceById is the seal on every
// list Today builds from the services, so a future surface that concatenates two lists cannot draw an id twice.
//
// THE ONE PAIR THAT HAS TWO IDS. The same appointment can reach the calendar through two doors that do not know each
// other: the Google import (gcalId) and the card an email offered (clientId, an email source). "Phone Interview with
// Equinox" from Google and "Phone Interview" from the email are two records, so id alone cannot see they are one
// interview, and schedule/eventTwins.ts hides only strict twins (equal titles) at its read boundary. On Today the pair is
// drawn once: exactly one email-made event against exactly one event from the other door, same day, same start, one-off,
// titles alike (eventTwins.titlesAlike: equal, or one contains the other and is at least 8 characters). It is deliberately
// narrow, after eventTwins.ts's own warning that swallowing a distinct event is worse than showing a twin: it never
// pairs two Google events, never two email events, never a recurring series, never a different start. The Schedule tab
// still lists both rows; this is Today's list only.
//
// Pure. No React, no storage, no timers, no clock.

import type { EventData, EventItem } from "../schedule/types";
import { titlesAlike, userWork } from "../schedule/eventTwins";

/** The first occurrence of each id, in the order given. */
export function onceById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

/** Made by an email: a capture the person approved, or an offer on a message. */
const madeByEmail = (d: EventData): boolean => d.source?.type === "email" || (d.emailIds?.length ?? 0) > 0;
/** Made by the calendar's other doors: the Google import, a public booking, Apple Calendar. */
const madeByOtherDoor = (d: EventData): boolean => !!d.gcalId || !!d.bookingId || d.source?.type === "google_calendar" || d.source?.type === "apple_calendar";
const oneOff = (d: EventData): boolean => !d.recurrence || d.recurrence === "none";

/**
 * The events Today draws: each id once, and an appointment that arrived through the email door and the calendar's other
 * door drawn once. Of such a pair the copy carrying more of the person's own work survives; on a tie the approved email
 * copy does (the one Dave tapped Add on). The order of the survivors is the order given.
 */
export function eventsOnceOnToday(events: readonly EventItem[]): EventItem[] {
  const unique = onceById(events);
  const byStart = new Map<string, EventItem[]>();
  for (const e of unique) {
    if (!oneOff(e.data) || !e.data.date || !e.data.start) continue;
    const key = e.data.date + "|" + e.data.start;
    const group = byStart.get(key);
    if (group) group.push(e);
    else byStart.set(key, [e]);
  }
  const hide = new Set<string>();
  for (const group of byStart.values()) {
    if (group.length < 2) continue;
    const mail = group.filter((e) => madeByEmail(e.data) && !madeByOtherDoor(e.data));
    const other = group.filter((e) => madeByOtherDoor(e.data) && !madeByEmail(e.data));
    for (const m of mail) {
      const twin = other.find((o) => !hide.has(o.id) && titlesAlike(o.data.title, m.data.title));
      if (!twin) continue;
      hide.add(userWork(twin.data) > userWork(m.data) ? m.id : twin.id);
    }
  }
  return hide.size ? unique.filter((e) => !hide.has(e.id)) : unique;
}
