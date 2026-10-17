// IS THIS CARD ALREADY ON THE SCHEDULE? (2026-10-17, Alfred's sweep.) The rules read every message on its own, and an
// interview reaches the inbox three ways (the invite, the company's confirmation, the scheduling service's mail), so the one
// meeting Dave had already saved for Friday 6:00 to 6:30 was proposed again as "Video Interview for David Fisher" and as
// "Booking at Jason Shenloogian". Nothing asked the calendar. This asks it, loosely on purpose: a saved event is this card's
// twin when it is the same day and starts within a quarter hour, AND one more thing ties them: the titles are alike (the
// Schedule's own twin rule, eventTwins.titlesAlike), the event came from this thread, or the sender's name is in the
// event's title or notes. The end is left out, as the Schedule's twin rule leaves it out: the email's hour-long default
// and the saved half hour are still one interview. Pure.
import type { EventItem } from "../schedule/types";
import { titlesAlike, norm } from "../schedule/eventTwins";
import type { EventPayload } from "../substrate/contracts";
import { wallClock } from "../substrate/destinations/schedule";

const toMin = (hhmm: string): number => { const p = hhmm.split(":"); return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0); };

/** Words that say nothing about WHICH meeting: dropped before titles are compared. */
const NOISE = /\b(invitation|invite|updated|accepted|reminder|re|fwd|fw|confirmation|confirmed|booking|meeting|call|video|phone|interview|appointment|for|with|at|the|a|an)\b/gi;
const words = (t: string): Set<string> => new Set(norm(t.replace(/@.*$/, "")).replace(NOISE, " ").split(/[^a-z0-9]+/).filter((w) => w.length > 2));

/** Jaccard overlap of the two titles' meaningful words. */
export function titleOverlap(a: string, b: string): number {
  const wa = words(a), wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let both = 0;
  for (const w of wa) if (wb.has(w)) both++;
  return both / (wa.size + wb.size - both);
}

export function savedEventTwin(
  p: EventPayload,
  events: readonly EventItem[],
  ctx: { threadId: string | null; sender: string; zone: string },
): EventItem | null {
  if (p.time.all_day) {
    const date = p.time.start_date;
    return events.find((e) => e.data.date === date && !e.data.recurrence && (titlesAlike(e.data.title, p.title) || titleOverlap(e.data.title, p.title) >= 0.4)) ?? null;
  }
  const at = wallClock(p.time.start_at, p.time.timezone || ctx.zone) ?? wallClock(p.time.start_at, ctx.zone);
  if (!at) return null;
  const start = toMin(at.time);
  const senderWords = [...words(ctx.sender)];
  for (const e of events) {
    const d = e.data;
    if (d.date !== at.date || d.recurrence) continue;
    if (Math.abs(toMin(d.start) - start) > 15) continue;
    const alike = titlesAlike(d.title, p.title) || titleOverlap(d.title, p.title) >= 0.4;
    const sameThread = !!ctx.threadId && d.source?.type === "email" && d.source.ref === ctx.threadId;
    const hay = norm(d.title + " " + (d.notes ?? ""));
    const senderNamed = senderWords.length > 0 && senderWords.some((w) => hay.includes(w));
    if (alike || sameThread || senderNamed) return e;
  }
  return null;
}
