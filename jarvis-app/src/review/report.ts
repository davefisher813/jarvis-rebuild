import type { MonthSealData } from "./seal";
import type { Goal } from "../life/types";
import type { Project } from "../projects/types";
import type { Workout } from "../gym/types";
import { capAfterNumber } from "../shared/casing";
import { hoursRows, hoursLabel } from "./hours";
import { stillTrueGoals } from "./stillTrue";

// THE MONTHLY REPORT'S MODEL (2026-08-25). Pure functions from a sealed
// month (plus its predecessor, plus the Store's own dated series) to the
// cards the page renders. The laws of this surface, from the approved
// catalog: reassurance leads; no score, rank, or comparison to another
// human; every sentence must be capable of being false and carries its
// receipts; setbacks never get a win's visual weight; exactly one proposed
// change; nothing counted that the app decided not to count; it ends in a
// setting, not a feeling. Every gate errs toward silence.

export interface ReportWin { name: string; value: string; tone: number }
export interface ReportTile {
  num: string;
  label: string;
  tint: "good" | "blue" | "sky" | "warn";
  delta: { text: string; up: boolean } | null;
}
export interface ReportSegment { id: string; name: string; color: string; n: number }
// WHERE THE HOURS WENT (handoff item 13, Dave's option A: one more section of
// the report you already get). A row per area, plus the areas a live goal
// reaches into that got no scheduled time at all. Facts, in both directions,
// with no target between them: the report says where the hours went and what
// had none, and never which of those is the right answer.
export interface TimeRow { id: string; name: string; color: string; label: string; pct: number }
export interface TimeSection {
  rows: TimeRow[];
  /** Total scheduled time, already formatted. */
  total: string;
  /** Live-goal areas with nothing on the calendar. Named, never scored. */
  quiet: { id: string; name: string }[];
}
export interface CarriedTask { id: string; text: string; n: number }
export interface WorthCard {
  id: "carried" | "quiet" | "cut" | "stillTrue";
  title: string;
  sub: string | null;
  carried?: CarriedTask[];
  receipts: string[];
}
export interface PatternRow {
  id: string;
  title: string;
  sub: string | null;
  chip: { text: string; tone: "good" | "warn" } | null;
  receipts: string[];
}
export interface ReportCloser {
  n: number;
  question: string;
  sub: string;
  foot: string;
}
export interface MonthReport {
  month: string;
  monthName: string;
  hero: { big: string; label: string; anchor: string | null; wins: ReportWin[] };
  tiles: ReportTile[];
  hours: { label: string; byHour: number[]; bandStart: number } | null;
  went: ReportSegment[] | null;
  /** WHERE THE HOURS WENT (item 13). Null below the floor, or on any seal
   *  written before this shipped. */
  time: TimeSection | null;
  worth: WorthCard[];
  patterns: PatternRow[];
  learned: { title: string; sub: string | null } | null;
  did: { title: string; sub: string | null } | null;
  closer: ReportCloser | null;
  sealed: { title: string; sub: string };
}

export interface ReportInputs {
  seal: MonthSealData;
  prev: MonthSealData | null;
  categories: { id: string; name: string; color: string }[];
  goals: Goal[];
  projects: Project[];
  workouts: Workout[];
  /** Open tasks by id, for resolving the carried list. */
  openTaskText: (id: string) => string | null;
  /** True when a chosen plan cap is already set; the closer stays quiet. */
  alreadyCapped: boolean;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthName(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
}
function nextMonthName(month: string): string {
  const m = Number(month.slice(5, 7));
  return MONTH_NAMES[m % 12] ?? month;
}
function hour12(h: number): string {
  const ap = h % 24 < 12 ? "AM" : "PM";
  const x = h % 12 || 12;
  return `${x} ${ap}`;
}
function daysInMonth(month: string): number {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(y, m, 0).getDate();
}
const MINUS = "−";

/** A delta chip. Up wears good; down is a muted fact, never a red one. */
export function deltaOf(now: number, prev: number | null, vs: string | null): { text: string; up: boolean } | null {
  if (prev == null) return null;
  const d = now - prev;
  if (d === 0) return { text: "Same", up: false };
  if (d > 0) return { text: vs ? `+${d} vs ${vs}` : `+${d}`, up: true };
  return { text: `${MINUS}${Math.abs(d)}`, up: false };
}

/** Goals achieved and projects closed inside the month, by their stamps. */
export function movedIn(month: string, goals: Goal[], projects: Project[]): { name: string; kind: "goal" | "project" }[] {
  const out: { name: string; kind: "goal" | "project" }[] = [];
  for (const g of goals) if (g.data.achievedOn?.startsWith(month)) out.push({ name: g.data.title, kind: "goal" });
  for (const p of projects) if (p.data.closedOn?.startsWith(month)) out.push({ name: p.data.title, kind: "project" });
  return out;
}

/** Best training week inside the month: most sessions Monday to Sunday. */
export function bestWeek(workouts: Workout[], month: string): number {
  const byWeek = new Map<string, number>();
  for (const w of workouts) {
    if (!w.data.date.startsWith(month)) continue;
    const d = new Date(w.data.date + "T00:00:00");
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const key = d.toISOString().slice(0, 10);
    byWeek.set(key, (byWeek.get(key) ?? 0) + 1);
  }
  return Math.max(0, ...byWeek.values());
}

// ---- pattern gates -------------------------------------------------------

const PICK_MIN_OUTCOMES = 10;
const PICK_FIRST_RATE = 0.55;
const PICK_LATE_RATE = 0.4;
const PICK_LATE_MIN = 4;
const OVERRUN_MIN_BLOCKS = 6;
const OVERRUN_MIN_AVG = 10;
const JOIN_MIN_DAYS = 3;
const MIRROR_MIN = 6;
const QUIET_MIN_PREV = 6;

export interface PickFacts {
  firstRate: number;
  lateRate: number;
  firstDone: number;
  firstPicked: number;
  latePicked: number;
  outcomes: number;
}

export function pickFacts(byPick: MonthSealData["byPick"]): PickFacts | null {
  const first = byPick.find((b) => b.n === 1);
  const late = byPick.filter((b) => b.n >= 4);
  const latePicked = late.reduce((a, b) => a + b.picked, 0);
  const lateDone = late.reduce((a, b) => a + b.done, 0);
  const outcomes = byPick.reduce((a, b) => a + b.picked, 0);
  if (!first || first.picked === 0 || outcomes < PICK_MIN_OUTCOMES) return null;
  return {
    firstRate: first.done / first.picked,
    lateRate: latePicked > 0 ? lateDone / latePicked : 0,
    firstDone: first.done,
    firstPicked: first.picked,
    latePicked,
    outcomes,
  };
}

/** Done-per-day on training days versus the rest. Null until both sides
 *  have enough days to mean anything. */
export function trainJoin(doneByDay: Record<string, number>, workouts: Workout[], month: string): { on: number; off: number } | null {
  const trained = new Set(workouts.filter((w) => w.data.date.startsWith(month)).map((w) => w.data.date));
  let onSum = 0, onDays = 0, offSum = 0, offDays = 0;
  const days = new Set([...Object.keys(doneByDay), ...trained]);
  for (const day of days) {
    const n = doneByDay[day] ?? 0;
    if (trained.has(day)) { onSum += n; onDays++; }
    else { offSum += n; offDays++; }
  }
  if (onDays < JOIN_MIN_DAYS || offDays < JOIN_MIN_DAYS) return null;
  return { on: onSum / onDays, off: offSum / offDays };
}

// ---- the report ----------------------------------------------------------

export function buildReport(inp: ReportInputs): MonthReport {
  const { seal, prev } = inp;
  const month = seal.month;
  const name = monthName(month);
  const prevName = prev ? monthName(prev.month) : null;
  const catById = new Map(inp.categories.map((c) => [c.id, c] as const));

  // HERO. Named crossings lead; a month with none leads with its done count,
  // which is still true and still yours. Anchor is your own last month only.
  const moved = movedIn(month, inp.goals, inp.projects);
  const wins: ReportWin[] = moved.slice(0, 3).map((m, i) => ({
    name: m.name,
    value: m.kind === "goal" ? "Achieved ✓" : "Closed ✓",
    tone: i,
  }));
  if (seal.saved > 0 && wins.length < 4) {
    wins.push({ name: "Put Away", value: `$${seal.saved.toLocaleString()}`, tone: 3 });
  }
  const movedCount = moved.length + (seal.saved > 0 ? 1 : 0);
  const prevMoved = prev ? movedIn(prev.month, inp.goals, inp.projects).length + (prev.saved > 0 ? 1 : 0) : null;
  const hero = movedCount > 0
    ? {
        big: String(movedCount),
        label: movedCount === 1 ? "Thing moved" : "Things moved",
        anchor: prev && prevMoved != null ? `${prevName}: ${prevMoved}` : null,
        wins,
      }
    : {
        big: String(seal.done),
        label: seal.done === 1 ? "Thing done" : "Things done",
        anchor: prev ? `${prevName}: ${prev.done}` : null,
        wins: [],
      };

  // TILES. Zeros never render; deltas only against a real predecessor.
  const tiles: ReportTile[] = [];
  if (seal.done > 0) tiles.push({ num: String(seal.done), label: "Done", tint: "good", delta: deltaOf(seal.done, prev?.done ?? null, prevName) });
  if (seal.sessions > 0) tiles.push({ num: String(seal.sessions), label: seal.sessions === 1 ? "Session" : "Sessions", tint: "blue", delta: deltaOf(seal.sessions, prev?.sessions ?? null, null) });
  if (seal.daysIn > 0) tiles.push({ num: `${seal.daysIn}/${daysInMonth(month)}`, label: "Days In", tint: "sky", delta: deltaOf(seal.daysIn, prev?.daysIn ?? null, null) });
  if (seal.deposits > 0) tiles.push({ num: String(seal.deposits), label: seal.deposits === 1 ? "Deposit" : "Deposits", tint: "warn", delta: deltaOf(seal.deposits, prev?.deposits ?? null, null) });

  const hours = seal.bandStart != null
    ? { label: `${hour12(seal.bandStart)} to ${hour12(seal.bandStart + 3)}`, byHour: seal.byHour, bandStart: seal.bandStart }
    : null;

  const segments = Object.entries(seal.byCategory)
    .map(([id, n]) => ({ id, n, cat: catById.get(id) }))
    .filter((s) => !!s.cat)
    .sort((a, b) => b.n - a.n)
    .slice(0, 4)
    .map((s) => ({ id: s.id, name: s.cat!.name, color: s.cat!.color, n: s.n }));
  const went = segments.length >= 2 ? segments : null;

  // WHERE THE HOURS WENT (item 13). Calendar-mined, entirely passive, and
  // silent below the floor. The uncategorised bucket ("" ) is rendered as
  // "Everything else" rather than dropped, so the percentages the reader adds
  // up in their head actually reach a hundred.
  const timeRows = hoursRows(seal.hours ?? {});
  const time: TimeSection | null = timeRows.length === 0 ? null : {
    rows: timeRows.map((r) => {
      const cat = r.category ? catById.get(r.category) : undefined;
      return {
        id: r.category,
        name: cat?.name ?? "Everything else",
        color: cat?.color ?? "graphite",
        label: hoursLabel(r.minutes),
        pct: r.pct,
      };
    }),
    total: hoursLabel(timeRows.reduce((a, r) => a + r.minutes, 0)),
    // Only areas that still exist and still have a name. A goal tagged with a
    // deleted category is not a fact worth reporting.
    quiet: (seal.goalAreasUnscheduled ?? [])
      .map((id) => ({ id, name: catById.get(id)?.name ?? "" }))
      .filter((q) => !!q.name)
      .slice(0, 3),
  };

  // WORTH A LOOK. Every card that names a gap keeps an exit, and the copy
  // states facts about work, never verdicts about the person.
  const worth: WorthCard[] = [];
  const carried = seal.carried
    .map((c) => ({ id: c.id, n: c.n, text: inp.openTaskText(c.id) }))
    .filter((c): c is { id: string; n: number; text: string } => c.text != null)
    .map((c) => ({ id: c.id, text: c.text, n: c.n }));
  if (carried.length > 0) {
    worth.push({
      id: "carried",
      title: carried.length === 1 ? "1 Followed you all month" : `${carried.length} Followed you all month`,
      sub: null,
      carried,
      receipts: carried.map((c) => capAfterNumber(`${c.text} · ${c.n} pushes`)),
    });
  }
  if (prev) {
    const quiet = Object.entries(prev.byCategory)
      .map(([id, was]) => ({ id, was, now: seal.byCategory[id] ?? 0, cat: catById.get(id) }))
      .filter((q) => !!q.cat && q.was >= QUIET_MIN_PREV && q.now <= q.was / 3)
      .sort((a, b) => (b.was - b.now) - (a.was - a.now))[0];
    if (quiet) {
      worth.push({
        id: "quiet",
        title: `${quiet.cat!.name} went quiet`,
        sub: capAfterNumber(`${quiet.now} this month · ${quiet.was} in ${prevName}`),
        receipts: [capAfterNumber(`${quiet.was} finishes in ${prevName}, ${quiet.now} in ${name}`), "A quiet month can be on purpose", "Leave It means exactly that"],
      });
    }
  }
  // "STILL TRUE?" (handoff item 10, the remnant Dave kept). Only ever asked
  // about a goal that WAS moving last month and moved in no way at all this
  // one; see stillTrue.ts for why that standard, and not "no activity", is
  // the only one that makes this a question rather than a nag. It changes
  // nothing on its own: cutting a goal is a decision with a record, and that
  // path is elsewhere.
  const still = stillTrueGoals(seal, prev, inp.goals);
  if (still.length > 0) {
    worth.push({
      id: "stillTrue",
      title: still.length === 1 ? `${still[0]!.title}: still true?` : capAfterNumber(`${still.length} goals went still`),
      sub: "Nothing finished and nothing scheduled this month",
      receipts: [
        ...still.map((g) => capAfterNumber(`${g.title}: ${g.wasDone} finished in ${prevName}, none in ${name}`)),
        "A month off a goal is not the same as dropping it",
        "Yes is a complete answer",
      ],
    });
  }

  const cut = inp.goals.filter((g) => g.data.dropped?.on.startsWith(month));
  if (cut.length > 0) {
    worth.push({
      id: "cut",
      title: capAfterNumber(`${cut.length} ${cut.length === 1 ? "goal" : "goals"} cut`),
      sub: "Cutting is a decision, and it counts",
      receipts: cut.map((g) => g.data.title),
    });
  }

  // PATTERNS. One line, one number, receipts behind the tap.
  const patterns: PatternRow[] = [];
  const picks = pickFacts(seal.byPick);
  if (picks && picks.firstRate >= PICK_FIRST_RATE && picks.latePicked >= PICK_LATE_MIN && picks.lateRate <= PICK_LATE_RATE) {
    patterns.push({
      id: "picks",
      title: "First picks finish",
      sub: `Firsts ${Math.round(picks.firstRate * 100)}% · Later picks ${Math.round(picks.lateRate * 100)}%`,
      chip: null,
      receipts: [
        capAfterNumber(`${picks.firstDone} of ${picks.firstPicked} first picks done that day`),
        capAfterNumber(`${picks.latePicked} picks landed fourth or later`),
      ],
    });
  }
  const overrun = Object.entries(seal.overrunByCategory)
    .map(([id, o]) => ({ id, avg: o.min / o.n, n: o.n, cat: catById.get(id) }))
    .filter((o) => !!o.cat && o.n >= OVERRUN_MIN_BLOCKS && Math.abs(o.avg) >= OVERRUN_MIN_AVG)
    .sort((a, b) => Math.abs(b.avg) - Math.abs(a.avg))[0];
  if (overrun) {
    const mins = Math.round(Math.abs(overrun.avg));
    patterns.push({
      id: "overrun",
      title: overrun.avg > 0 ? `${overrun.cat!.name} runs ${mins}m over` : `${overrun.cat!.name} runs ${mins}m under`,
      sub: capAfterNumber(`Across ${overrun.n} corrections`),
      chip: null,
      receipts: ["Plan lengths already learn from this; new blocks pre-fill from your history"],
    });
  }
  const join = trainJoin(seal.doneByDay, inp.workouts, month);
  if (join && join.on > join.off * 1.3 && join.on - join.off >= 1) {
    const pct = Math.round(((join.on - join.off) / Math.max(0.1, join.off)) * 100);
    patterns.push({
      id: "train",
      title: "Train days win",
      sub: `${join.on.toFixed(1)} Done vs ${join.off.toFixed(1)}`,
      chip: { text: `+${pct}%`, tone: "good" },
      receipts: ["A pattern in your data, not a cause"],
    });
  }
  const mirror = Object.entries(seal.suggestions)
    .map(([kind, v]) => ({ kind, ...v, total: v.acc + v.dis }))
    .filter((m) => m.total >= MIRROR_MIN);
  const taken = mirror.filter((m) => m.acc / m.total >= 0.7).sort((a, b) => b.total - a.total)[0];
  const skipped = mirror.filter((m) => m.acc / m.total <= 0.25).sort((a, b) => b.total - a.total)[0];
  const KIND_TAKEN: Record<string, string> = { first_step: "You take first steps", pattern: "You take the patterns", ai: "You take the AI's offers", routine: "You take the routine blocks", proj_step: "You take project steps", link: "You take the links" };
  const KIND_SKIP: Record<string, string> = { link: "Links get skipped", ai: "AI offers get skipped", pattern: "Patterns get skipped", first_step: "First steps get skipped", routine: "Routine blocks get skipped", proj_step: "Project steps get skipped" };
  if (taken) {
    patterns.push({
      id: "mirror-taken",
      title: KIND_TAKEN[taken.kind] ?? "You take the suggestions",
      sub: capAfterNumber(`${taken.acc} of ${taken.total} accepted`),
      chip: null,
      receipts: [capAfterNumber(`${taken.acc} accepted · ${taken.dis} dismissed`)],
    });
  }
  if (skipped) {
    patterns.push({
      id: "mirror-skipped",
      title: KIND_SKIP[skipped.kind] ?? "Some suggestions get skipped",
      sub: capAfterNumber(`${skipped.acc} of ${skipped.total} taken`),
      chip: null,
      receipts: [capAfterNumber(`${skipped.dis} dismissed this month`)],
    });
  }
  if (seal.slip) {
    const cat = catById.get(seal.slip.category);
    if (cat) {
      patterns.push({
        id: "slip",
        title: `${cat.name} slips most`,
        sub: null,
        chip: { text: capAfterNumber(`${seal.slip.n} pushes`), tone: "warn" },
        receipts: [capAfterNumber(`${seal.slip.n} pushes in ${name}, the most of any category`), "A fact about tasks, never a verdict"],
      });
    }
  }

  // JARVIS. The learned line's second half is the anti-horoscope device:
  // a system that shows its own retractions is one whose claims can be false.
  const fixes = seal.strands.corrected + seal.strands.deleted;
  const learned = seal.strands.created > 0
    ? {
        title: capAfterNumber(`Learned ${seal.strands.created} ${seal.strands.created === 1 ? "thing" : "things"} about you`),
        sub: fixes > 0 ? capAfterNumber(`You fixed ${fixes} · ${fixes === 1 ? "It is" : "They are"} gone`) : null,
      }
    : null;
  const didCount = seal.remindersTicked + seal.deck.sent;
  const didParts: string[] = [];
  if (seal.remindersTicked > 0) didParts.push(`${seal.remindersTicked} ${seal.remindersTicked === 1 ? "reminder" : "reminders"}`);
  if (seal.deck.sent > 0) didParts.push(`${seal.deck.asWritten} of ${seal.deck.sent} drafts sent as written`);
  const did = didCount > 0
    ? { title: capAfterNumber(`Kept ${didCount} ${didCount === 1 ? "thing" : "things"} moving`), sub: didParts.length ? capAfterNumber(didParts.join(" · ")) : null }
    : null;

  // THE ONE CHANGE. Exactly one, and only when the evidence carries it.
  const closer = !inp.alreadyCapped && picks && picks.firstRate >= 0.6 && picks.lateRate <= 0.35 && picks.latePicked >= PICK_LATE_MIN
    ? {
        n: 3,
        question: "Cap the day at three?",
        sub: "Your first three get done · The later picks mostly do not",
        foot: "Starting tomorrow · Change it any time",
      }
    : null;

  return {
    month,
    monthName: name,
    hero,
    tiles,
    hours,
    went,
    time,
    worth,
    patterns,
    learned,
    did,
    closer,
    sealed: { title: `${name} sealed`, sub: `${nextMonthName(month)} compares to this` },
  };
}
