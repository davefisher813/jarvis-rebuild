import type { WindowRow } from "../brain/window";
import type { EventItem } from "../schedule/types";
import type { Workout } from "../gym/types";
import type { Goal } from "../life/types";
import type { Project } from "../projects/types";
import { computeSeal, type MonthSealData } from "./seal";
import { hoursRows, hoursLabel } from "./hours";
import { goalTags, liveGoals } from "../bigger/reach";
import { capAfterNumber } from "../shared/casing";

// THIS WEEK (C-64, Astra, 2026-09-12). The first card on Insights: three
// tiles (done, goals moved, flexible hours), where the hours went as a
// stacked bar with a facts legend, then five lines keyed Worked, Slipped,
// Changed, Learned, Next, each one facts line. Built by running the same
// computeSeal the month runs, over a 7-day window, so a week and a month
// can never disagree about what a completion or a push is. Sentences come
// from the same helpers the report uses. Next carries the One Change offer
// (Move Two Blocks primary, No Thanks quiet); accepting writes a plan.cap
// style learned rule, the way the month report's cap does.
//
// Percent is allowed inside this card only where C-65 allows it in a
// report: an area line may say "26% vs usual 35%" beside its hours. Every
// other number here is a count.

export type LineKey = "Worked" | "Slipped" | "Changed" | "Learned" | "Next";
export type FactTone = "good" | "warn" | "sky" | "cat" | undefined;
export interface WeekFact { text: string; tone?: FactTone; color?: string }
// A line's key word takes a colour only when the word is a meaning; "quiet"
// is the caps grey (Learned). Purple is not in the Colour Key (§AM).
export interface WeekLine { key: LineKey; tone: "good" | "warn" | "sky" | "quiet" | "red"; facts: WeekFact[] }
export interface WeekSegment { id: string; name: string; color: string; minutes: number; pct: number }

export interface WeekInputs {
  today: string;
  rows: WindowRow[];
  events: EventItem[];
  workouts: Workout[];
  goals: Goal[];
  projects: Project[];
  categories: { id: string; name: string; color: string }[];
  /** Working minutes per weekday, for the flexible tile; default 8 hours. */
  workMinutesPerDay?: number;
  /** The seven days before this one, for "vs usual". Optional. */
  prevRows?: WindowRow[];
  /** True when the Move Two Blocks rule is already set; the offer stays quiet. */
  alreadyOffered?: boolean;
}

export interface WeekReport {
  days: string[];
  seal: MonthSealData;
  tiles: { done: number; moved: number; flexible: string };
  stack: WeekSegment[] | null;
  lines: WeekLine[];
  /** The area the One Change would move blocks toward, when there is one. */
  next: { id: string; name: string; color: string } | null;
  offer: boolean;
}

/** The seven local days ending on `today`, oldest first. */
export function weekDays(today: string, back = 7): string[] {
  const [y, m, d] = today.split("-").map(Number);
  const out: string[] = [];
  for (let i = back - 1; i >= 0; i--) {
    const dt = new Date(y!, m! - 1, d! - i);
    out.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`);
  }
  return out;
}

const isWeekday = (iso: string): boolean => {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(y!, m! - 1, d!).getDay();
  return dow >= 1 && dow <= 5;
};

/** C-65: the warn fact for an area whose share moved against its usual. */
export function vsUsual(pct: number, prevPct: number | null, minDelta = 5): string | null {
  if (prevPct === null) return null;
  if (Math.abs(pct - prevPct) < minDelta) return null;
  return `${pct}% vs usual ${prevPct}%`;
}

export function buildWeek(inp: WeekInputs): WeekReport {
  const days = weekDays(inp.today);
  const month = inp.today.slice(0, 7);
  const seal = computeSeal(month, { rows: inp.rows, workouts: inp.workouts, goals: inp.goals, sealedAt: Date.now(), events: inp.events, days });
  const catById = new Map(inp.categories.map((c) => [c.id, c] as const));
  const inWeek = new Set(days);
  const rows = inp.rows.filter((r) => inWeek.has(r.day));

  // Tiles.
  const moved = inp.goals.filter((g) => g.data.achievedOn && inWeek.has(g.data.achievedOn.slice(0, 10))).length
    + inp.projects.filter((p) => p.data.closedOn && inWeek.has(p.data.closedOn.slice(0, 10))).length;
  const scheduled = Object.values(seal.hours ?? {}).reduce((a, b) => a + b, 0);
  const workdays = days.filter(isWeekday).length;
  const flexibleMin = Math.max(0, workdays * (inp.workMinutesPerDay ?? 8 * 60) - scheduled);
  const tiles = { done: seal.done, moved, flexible: hoursLabel(flexibleMin) };

  // The stack: the biggest areas, then Open. Below the hours floor the
  // report's own hoursRows says nothing, and so does this.
  const hr = hoursRows(seal.hours ?? {});
  const total = scheduled + flexibleMin;
  const stack: WeekSegment[] | null = hr.length === 0 ? null : [
    ...hr.slice(0, 3).map((r) => ({
      id: r.category, name: catById.get(r.category)?.name ?? "Everything else", color: catById.get(r.category)?.color ?? "graphite",
      minutes: r.minutes, pct: total > 0 ? Math.round((r.minutes / total) * 100) : 0,
    })),
    { id: "open", name: "Open", color: "graphite", minutes: flexibleMin, pct: total > 0 ? Math.round((flexibleMin / total) * 100) : 0 },
  ];

  // The five lines. At most one coloured fact per line (K.3); a category
  // fact carries its own colour by rule and does not count.
  const lines: WeekLine[] = [];
  const picked = seal.byPick.reduce((a, p) => a + p.picked, 0);
  const landed = seal.byPick.reduce((a, p) => a + p.done, 0);
  const focusDays = new Set(rows.filter((r) => r.type === "focus.completed").map((r) => r.day)).size;
  const worked: WeekFact[] = [];
  if (picked > 0) worked.push({ text: capAfterNumber(`${landed} of ${picked} plans landed`), tone: "good" });
  if (focusDays > 0) worked.push({ text: capAfterNumber(`Focus held ${focusDays} ${focusDays === 1 ? "day" : "days"}`), tone: worked.length ? undefined : "good" });
  if (worked.length) lines.push({ key: "Worked", tone: "good", facts: worked });

  const slipTop = Object.entries(seal.pushedByCategory).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (slipTop && slipTop[1] > 0) {
    const name = catById.get(slipTop[0])?.name ?? "Unfiled";
    lines.push({ key: "Slipped", tone: "warn", facts: [{ text: `${name} · ${capAfterNumber(`${slipTop[1]} ${slipTop[1] === 1 ? "task" : "tasks"} pushed`)}`, tone: "warn" }] });
  }

  const overrides = rows.filter((r) => r.type === "schedule.override").length;
  const checkins = rows.filter((r) => r.type === "goal.checkin").length;
  const changed: WeekFact[] = [];
  if (overrides > 0) changed.push({ text: capAfterNumber(`${overrides} ${overrides === 1 ? "block" : "blocks"} moved`), tone: "sky" });
  if (checkins > 0) changed.push({ text: capAfterNumber(`${checkins} ${checkins === 1 ? "check-in" : "check-ins"}`) });
  if (changed.length) lines.push({ key: "Changed", tone: "sky", facts: changed });

  const learnedN = seal.strands.created;
  const starred = rows.filter((r) => r.type === "strand.starred").length;
  const learned: WeekFact[] = [];
  // Purple is not in the Colour Key (§AM, 2026-09-26): what JARVIS learned
  // is the line's one grey, and what he chose to keep (starred) is logged,
  // so green. One grey and at most one coloured fact, in either order.
  if (learnedN > 0) learned.push({ text: capAfterNumber(`${learnedN} new ${learnedN === 1 ? "fact" : "facts"}`) });
  if (starred > 0) learned.push({ text: capAfterNumber(`${starred} remembered`), tone: "good" });
  if (learned.length) lines.push({ key: "Learned", tone: "quiet", facts: learned });

  // Next: the live-goal area with the least of the week's hours, said as a
  // count of hours against the scheduled total, with C-65's vs-usual beside
  // it when last week can say what usual is.
  const goalAreas = [...new Set(liveGoals(inp.goals).flatMap((g) => goalTags(g)))].filter((id) => catById.has(id));
  let next: WeekReport["next"] = null;
  const nextFacts: WeekFact[] = [];
  if (goalAreas.length > 0 && scheduled > 0) {
    const minutesOf = (id: string) => seal.hours?.[id] ?? 0;
    const least = [...goalAreas].sort((a, b) => minutesOf(a) - minutesOf(b) || a.localeCompare(b))[0]!;
    const cat = catById.get(least)!;
    next = { id: least, name: cat.name, color: cat.color };
    nextFacts.push({ text: `${cat.name} ${hoursLabel(minutesOf(least))} of ${hoursLabel(scheduled)}`, tone: "cat", color: cat.color });
    if (inp.prevRows) {
      const prevDays = weekDays(days[0]!, 8).slice(0, 7);
      const prevSeal = computeSeal(month, { rows: inp.prevRows, workouts: [], goals: inp.goals, sealedAt: Date.now(), events: inp.events, days: prevDays });
      const prevScheduled = Object.values(prevSeal.hours ?? {}).reduce((a, b) => a + b, 0);
      const pct = Math.round((minutesOf(least) / scheduled) * 100);
      const prevPct = prevScheduled > 0 ? Math.round(((prevSeal.hours?.[least] ?? 0) / prevScheduled) * 100) : null;
      const vs = vsUsual(pct, prevPct);
      if (vs) nextFacts.push({ text: vs, tone: "warn" });
    }
  }
  if (nextFacts.length) lines.push({ key: "Next", tone: "red", facts: nextFacts });

  return { days, seal, tiles, stack, lines, next, offer: !!next && !inp.alreadyOffered };
}
