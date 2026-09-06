// Group B, time-blindness (addendum items 10-12): the pure math. ADHD time
// blindness is not knowing what NOW means; these functions turn the clock
// into three facts: what you are inside, how much open time you actually
// have, and what is bearing down on you. Short-copy grammar throughout.

import type { EventItem } from "../schedule/types";
import type { LockedRange } from "./YourDay";
import { leaveByOf } from "../schedule/leaveBy";

export interface NowContext {
  // "Free until 6:00 PM" / "In: Elite Squad Practice" / "Clear from here"
  line: string;
  // Open minutes until the next commitment, when free. Null inside an event
  // or when nothing is left today.
  gapMin: number | null;
  // The next commitment's start (HH:MM) when one exists.
  nextStart: string | null;
  nextTitle: string | null;
  // LEAVE BY (UP-CORE-07, 2026-09-05): the next commitment that has to be
  // TRAVELLED to, and the time to stand up for it. Null when nothing ahead
  // has a travel time, which is most of the time and says nothing.
  nextLeave: { at: string; title: string } | null;
}

const toMin = (hhmm: string): number => {
  const p = hhmm.split(":");
  return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
};

const fmt12 = (min: number): string => {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${ap}` : `${h12}:${String(m).padStart(2, "0")} ${ap}`;
};

// "2 hr 40 min" / "45 min" / "6 hr"
export function fmtSpan(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

// The one self-updating line atop Today (item 10). Derived from the day's
// events and the routine's protected ranges; never a guess, never advice.
export function nowContext(events: EventItem[], locked: LockedRange[], nowHHMM: string): NowContext {
  const now = toMin(nowHHMM);
  // The soonest leave time still ahead. Its own read, not tied to whichever
  // slot is next: the thing you have to drive to may be the second event of
  // the afternoon, and the leaving is what has to be said out loud.
  const nextLeave = events
    .map((ev) => ({ at: leaveByOf(ev.data), title: ev.data.title }))
    .filter((x): x is { at: string; title: string } => !!x.at && toMin(x.at) > now)
    .sort((a, b) => toMin(a.at) - toMin(b.at))[0] ?? null;
  type Slot = { s: number; e: number; title: string };
  const slots: Slot[] = [
    ...events.map((ev) => ({
      s: toMin(ev.data.start),
      e: ev.data.end ? toMin(ev.data.end) : toMin(ev.data.start) + 60,
      title: ev.data.title,
    })),
    ...locked.map((l) => ({ s: l.s, e: l.e, title: l.label })),
  ].sort((a, b) => a.s - b.s);

  const inside = slots.find((s) => s.s <= now && now < s.e);
  if (inside) {
    return {
      line: `In: ${inside.title} until ${fmt12(inside.e)}`,
      gapMin: null,
      nextLeave,
      nextStart: null,
      nextTitle: inside.title,
    };
  }

  const next = slots.find((s) => s.s > now);
  if (!next) {
    return { line: "Clear from here", gapMin: null, nextStart: null, nextTitle: null, nextLeave };
  }
  const gap = next.s - now;
  // UP-CORE-07: when the next thing has to be travelled to, the free window
  // ends at the LEAVE time, not at the start time. That is the whole point:
  // "free until 6" is a lie when the drive starts at 5:20.
  if (nextLeave && toMin(nextLeave.at) < next.s) {
    const leaveMin = toMin(nextLeave.at);
    return {
      line: `Free until ${fmt12(leaveMin)} · then leave for ${nextLeave.title}`,
      gapMin: Math.max(0, leaveMin - now),
      nextStart: nextLeave.at,
      nextTitle: nextLeave.title,
      nextLeave,
    };
  }
  return {
    line: `Free until ${fmt12(next.s)} · ${fmtSpan(gap)} open`,
    gapMin: gap,
    nextStart: `${String(Math.floor(next.s / 60)).padStart(2, "0")}:${String(next.s % 60).padStart(2, "0")}`,
    nextTitle: next.title,
    nextLeave,
  };
}

// Gap Fill (item 11): the one task that fits the gap, or silence. Fitting
// means the estimate plus a 10 minute buffer fits the open time, and gaps
// under 25 minutes stay quiet (offering work for a sliver is nagging).
export const GAP_MIN_MINUTES = 25;
export const GAP_BUFFER = 10;

export interface GapCandidate {
  id: string;
  text: string;
  estimateMin: number;
}

export function gapFill(
  tasks: { id: string; text: string; category: string; done: boolean; due?: string | null; bill?: unknown; reminder?: unknown; estimateMin?: number }[],
  gapMin: number | null,
  today: string,
  estimateFor: (category: string) => number,
  // TODAY-F-20 (2026-09-05): categories paused for the season. The planner
  // has refused to offer their tasks since candidatesFor learned the rule,
  // but the pause lived in that one caller instead of here, and this is the
  // other place a task becomes work: a paused category's task could be dealt
  // by the Now card with a Start pill. Bills need no exemption here (unlike
  // candidatesFor, where pausing Money must never silence rent) because a
  // bill never reaches the gap offer at all, see the filter below.
  paused: ReadonlySet<string> = new Set<string>(),
): GapCandidate | null {
  if (gapMin === null || gapMin < GAP_MIN_MINUTES) return null;
  // B6-5 (2026-09-04): "The Now card can offer a reminder as work." Every
  // other chokepoint that turns tasks into a work queue (filters.ts,
  // upnext.ts) excludes reminders; this one did not, so a 50-minute gap
  // could deal Morning Meds a Start button and a ritual sheet.
  const open = tasks.filter((t) => !t.done && !t.bill && !t.reminder && !paused.has(t.category));
  if (open.length === 0) return null;
  const fits = open
    // UP-CORE-02 (2026-09-05): the task's own length before the category's
    // median. This is the whole point of the gap offer: a ten minute call
    // fits a twenty minute gap, and it never did while every task in a
    // category was the same size.
    .map((t) => ({ t, est: t.estimateMin ?? estimateFor(t.category) }))
    .filter((x) => x.est + GAP_BUFFER <= gapMin);
  if (fits.length === 0) return null;
  // Due today first, then overdue, then anything; nearest due inside a tier.
  const rank = (due?: string | null): [number, string] => {
    if (!due) return [2, "9999"];
    if (due === today) return [0, due];
    if (due < today) return [1, due];
    return [2, due];
  };
  fits.sort((a, b) => {
    const [ra, da] = rank(a.t.due);
    const [rb, db] = rank(b.t.due);
    return ra - rb || da.localeCompare(db) || a.t.text.localeCompare(b.t.text);
  });
  const pick = fits[0]!;
  return { id: pick.t.id, text: pick.t.text, estimateMin: pick.est };
}

// Hyperfocus Guard (item 12): the fact line for a focus surface. Inside the
// warn window it flips tone (the surface renders it in warn color); it is
// NEVER a modal and never stops anything.
export const GUARD_WARN_MIN = 10;

export interface GuardLine {
  text: string;
  warn: boolean;
}

export function hyperfocusGuard(events: EventItem[], nowHHMM: string): GuardLine | null {
  const now = toMin(nowHHMM);
  // UP-CORE-07 (2026-09-05): what bears down on you is LEAVING, not
  // starting. An event you have to drive to arrives at its leave time, so
  // that is the moment the guard counts to; an event with no travel time is
  // exactly the guard it has always been.
  const next = events
    .map((ev) => {
      const leave = leaveByOf(ev.data);
      return leave
        ? { s: toMin(leave), title: ev.data.title, leaving: true }
        : { s: toMin(ev.data.start), title: ev.data.title, leaving: false };
    })
    .filter((x) => x.s > now)
    .sort((a, b) => a.s - b.s)[0];
  if (!next) return null;
  const mins = next.s - now;
  if (mins <= GUARD_WARN_MIN) {
    return { text: next.leaving ? `Leave for ${next.title} in ${mins} min` : `${next.title} in ${mins} min`, warn: true };
  }
  return { text: next.leaving ? `Leave for ${next.title} at ${fmt12(next.s)}` : `${next.title} at ${fmt12(next.s)}`, warn: false };
}
