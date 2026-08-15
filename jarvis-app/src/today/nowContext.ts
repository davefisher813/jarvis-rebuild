// Group B, time-blindness (addendum items 10-12): the pure math. ADHD time
// blindness is not knowing what NOW means; these functions turn the clock
// into three facts: what you are inside, how much open time you actually
// have, and what is bearing down on you. Short-copy grammar throughout.

import type { EventItem } from "../schedule/types";
import type { LockedRange } from "./YourDay";

export interface NowContext {
  // "Free until 6:00 PM" / "In: Elite Squad Practice" / "Clear from here"
  line: string;
  // Open minutes until the next commitment, when free. Null inside an event
  // or when nothing is left today.
  gapMin: number | null;
  // The next commitment's start (HH:MM) when one exists.
  nextStart: string | null;
  nextTitle: string | null;
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
      nextStart: null,
      nextTitle: inside.title,
    };
  }

  const next = slots.find((s) => s.s > now);
  if (!next) {
    return { line: "Clear from here", gapMin: null, nextStart: null, nextTitle: null };
  }
  const gap = next.s - now;
  return {
    line: `Free until ${fmt12(next.s)} · ${fmtSpan(gap)} open`,
    gapMin: gap,
    nextStart: `${String(Math.floor(next.s / 60)).padStart(2, "0")}:${String(next.s % 60).padStart(2, "0")}`,
    nextTitle: next.title,
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
  tasks: { id: string; text: string; category: string; done: boolean; due?: string | null; bill?: unknown }[],
  gapMin: number | null,
  today: string,
  estimateFor: (category: string) => number,
): GapCandidate | null {
  if (gapMin === null || gapMin < GAP_MIN_MINUTES) return null;
  const open = tasks.filter((t) => !t.done && !t.bill);
  if (open.length === 0) return null;
  const fits = open
    .map((t) => ({ t, est: estimateFor(t.category) }))
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
  const next = events
    .map((ev) => ({ s: toMin(ev.data.start), title: ev.data.title }))
    .filter((x) => x.s > now)
    .sort((a, b) => a.s - b.s)[0];
  if (!next) return null;
  const mins = next.s - now;
  if (mins <= GUARD_WARN_MIN) return { text: `${next.title} in ${mins} min`, warn: true };
  return { text: `${next.title} at ${fmt12(next.s)}`, warn: false };
}
