import type { MeetingCandidate, MeetingMissing } from "./mailContracts";
import { pendingHour } from "./meetingRead";

// WHAT THE FINISH CARD OFFERS, FROM WHAT THE THREAD SAID (2026-09-29).
//
// A thread does not say one thing about an appointment, it says a sequence:
// "Tuesday at 3 PM", then "can we move to Wednesday at 4", then "confirmed", or
// "I have to cancel". The brief reads each sentence as a candidate; this is the
// pass that decides which of them are STILL LIVE and what, if anything, to
// offer for it. Pure: no calendar, no clock but the `today` it is handed.
//
// Rules, in the order they bite:
//   - ONLY AN AGREED TIME IS OFFERED. A proposed or requested one is a maybe,
//     and stays with the proposed-time flow (meetingTimes.ts), which already
//     checks it against the real calendar and drafts the reply. Two alternatives
//     in one message never become two calendar offers.
//   - THE SAME TIME SAID TWICE IS ONE APPOINTMENT. "See you Tuesday at 3" and
//     later "Confirmed, Tuesday at 3" fold into the FIRST, so the id the
//     calendar entry was keyed by never changes as the thread grows.
//   - A RESCHEDULE SUPERSEDES. A later agreed time for the same appointment
//     (same subject, or worded as a change, or the only one there was) replaces
//     the earlier one. If the earlier one is already on the calendar the offer
//     becomes REVIEW CHANGE: the person looks at the new time and applies it to
//     that event. It is never applied on its own and never added as a second one.
//   - A CANCELLATION REMOVES THE OFFER, AND DELETES NOTHING. An appointment that
//     was on the calendar is reported as cancelled and left there, with a door
//     to review it. Removing it is the person's tap.
//   - A DAY THAT HAS PASSED IS NOT OFFERED.

export type AskFor = "date" | "meridiem" | "time" | "timezone";

export interface MeetingOffer {
  /**
   * add: complete, unfiled, one tap. ask: the sentence did not settle it.
   * filed: already on the calendar. review_change: the sender moved a filed
   * appointment. cancelled_filed: the sender cancelled a filed appointment.
   */
  kind: "add" | "ask" | "filed" | "review_change" | "cancelled_filed";
  candidate: MeetingCandidate;
  /** The calendar event this concerns, for filed, review_change and cancelled_filed. */
  eventId?: string;
  /** For review_change: the earlier detection whose event is on the calendar. */
  from?: MeetingCandidate;
  /** For ask: the one thing to ask first. */
  ask?: AskFor;
  /** For ask meridiem: the hour the sender named, so the card can offer it as 3 AM or 3 PM. */
  hour?: { hour: number; minute: number };
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "on", "at", "in", "with", "for", "our", "your", "my", "we", "you", "it", "is",
  "meeting", "appointment", "appt", "call", "visit", "chat", "sync", "session", "time", "again", "new", "next", "this",
]);
const tokens = (t: string): string[] => t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));

/**
 * How alike two appointments' subjects are. Specific: they share a real word
 * ("photo", "dentist"). Generic: one of them has none ("Meeting", "Call"), so
 * the title cannot tell them apart and something else has to. None: they name
 * different things.
 */
function overlap(a: MeetingCandidate, b: MeetingCandidate): "specific" | "generic" | "none" {
  const ta = tokens(a.title), tb = tokens(b.title);
  if (ta.length === 0 || tb.length === 0) return "generic";
  return ta.some((w) => tb.includes(w)) ? "specific" : "none";
}

const CHANGE_CUE = /\b(re-?schedul\w*|mov(?:e|ed|es|ing)|push(?:ed|ing)?|chang(?:e|ed|es|ing)|switch\w*|instead|new time|postpon\w*|bump\w*|shift\w*)\b/i;
const sameSlot = (a: MeetingCandidate, b: MeetingCandidate) => !!a.date && a.date === b.date && (a.start ?? "") === (b.start ?? "");

export function meetingOffers(input: {
  candidates: readonly MeetingCandidate[];
  /** Chronological message ids, oldest first, to order candidates by when they were said. */
  order?: readonly string[];
  /** Candidate id to the calendar event that answers for it. */
  filed: Readonly<Record<string, string>>;
  today: string;
}): MeetingOffer[] {
  const rank = (c: MeetingCandidate) => { const i = input.order?.indexOf(c.sourceMessageId) ?? -1; return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  const sorted = input.candidates
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.status === "agreed" || c.status === "cancelled")
    .sort((x, y) => rank(x.c) - rank(y.c) || x.i - y.i)
    .map(({ c }) => c);

  // ancestors[j]: the earlier candidates j replaces, transitively.
  const superseded = new Set<string>();
  const folded = new Set<string>();
  const ancestors = new Map<string, MeetingCandidate[]>();

  for (let j = 0; j < sorted.length; j++) {
    const cj = sorted[j]!;
    if (folded.has(cj.id)) continue;
    const live = sorted.slice(0, j).filter((x) => !superseded.has(x.id) && !folded.has(x.id));
    const replaced: MeetingCandidate[] = [];
    const liveAgreed = live.filter((x) => x.status === "agreed");
    for (const ci of live) {
      let takes = false;
      const alike = overlap(ci, cj);
      if (cj.status === "cancelled") {
        // A cancellation names the day, or the subject, or is the only thing there is to cancel.
        takes = (!!cj.date && cj.date === ci.date) || alike === "specific" || ((alike === "generic" || !cj.date) && liveAgreed.length === 1 && ci.status === "agreed");
      } else if (ci.status === "cancelled") {
        // A new agreed time after a cancellation for the same appointment is a rebooking; the cancellation is old news.
        takes = alike === "specific" || (live.length === 1 && (alike === "generic" || CHANGE_CUE.test(cj.sourceQuote)));
      } else if (sameSlot(ci, cj)) {
        // The same time said twice: the LATER statement folds into the earlier one.
        folded.add(cj.id);
        break;
      } else {
        // A different time for the same appointment: the same subject, or worded as a change to the only one there is.
        takes = alike === "specific" || (CHANGE_CUE.test(cj.sourceQuote) && (alike === "generic" || liveAgreed.length === 1));
      }
      if (takes) replaced.push(ci);
    }
    if (folded.has(cj.id)) continue;
    for (const r of replaced) {
      superseded.add(r.id);
      // What the replaced one replaced comes along, so a filed event two changes back is still found.
      for (const older of ancestors.get(r.id) ?? []) replaced.push(older);
    }
    if (replaced.length) ancestors.set(cj.id, replaced);
  }

  const out: MeetingOffer[] = [];
  for (const c of sorted) {
    if (superseded.has(c.id) || folded.has(c.id)) continue;
    const back = ancestors.get(c.id) ?? [];
    const filedAncestor = back.find((a) => input.filed[a.id] !== undefined);
    if (c.status === "cancelled") {
      const own = input.filed[c.id];
      const id = own ?? (filedAncestor ? input.filed[filedAncestor.id] : undefined);
      if (id) out.push({ kind: "cancelled_filed", candidate: c, eventId: id, ...(filedAncestor ? { from: filedAncestor } : {}) });
      continue;
    }
    const own = input.filed[c.id];
    if (own) { out.push({ kind: "filed", candidate: c, eventId: own }); continue; }
    if (c.date && c.date < input.today) continue;
    if (filedAncestor) {
      out.push({ kind: "review_change", candidate: c, eventId: input.filed[filedAncestor.id]!, from: filedAncestor });
      continue;
    }
    const ask = firstAsk(c.missing, c);
    if (ask) {
      const hour = ask === "meridiem" ? pendingHour(c.sourceQuote) : null;
      out.push({ kind: "ask", candidate: c, ask, ...(hour ? { hour } : {}) });
    } else {
      out.push({ kind: "add", candidate: c });
    }
  }
  return out;
}

const ORDER: AskFor[] = ["date", "meridiem", "time", "timezone"];
function firstAsk(missing: readonly MeetingMissing[], c: MeetingCandidate): AskFor | null {
  const gaps = [...missing];
  if (!c.date && !gaps.includes("date")) gaps.push("date");
  if (!c.start && !gaps.includes("time") && !gaps.includes("meridiem")) gaps.push("time");
  return ORDER.find((k) => gaps.includes(k)) ?? null;
}

/**
 * A proposed or requested time, as the existing proposed-time flow reads it,
 * from what the brief already said: no second model call. Only a candidate with
 * a whole day, start and end qualifies; anything the sentence left open is not
 * a slot to check against the calendar.
 */
export function proposedFromBrief(candidates: readonly MeetingCandidate[]): { label: string; date: string; start: string; end: string }[] {
  return candidates
    .filter((c) => (c.status === "proposed" || c.status === "requested") && c.date && c.start && c.end && c.missing.length === 0)
    .map((c) => ({ label: c.sourceQuote, date: c.date!, start: c.start!, end: c.end! }));
}
