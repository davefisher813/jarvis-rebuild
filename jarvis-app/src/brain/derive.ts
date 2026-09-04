import type { WindowRow } from "./window";
import type { StrandCategory, StrandEvidence, DerivationKey } from "./strands/types";
import { capAfterNumber } from "../shared/casing";

// The launch derivations (Brain Layer 2). Pure functions over the windowed
// event rows; no I/O, fully testable. THE GOVERNING PRINCIPLE: accuracy
// outranks everything. Every gate here errs toward silence, and a derivation
// that speaks must be able to show its receipts.
//
// The fourth launch derivation (per-task timing) lives in
// src/today/planningPatterns.ts, already built and gated in Phase 2; its
// acceptance now lands as a strand like the rest (TodaySuggestions).

export interface Derived {
  derivation: DerivationKey;
  category: StrandCategory;
  // The being-known moment (Notice law: title + sub) and the strand line the
  // accept writes. Both plain sentences, no dashes, no guilt. Every sub is
  // built through capAfterNumber, because these lines lead with counts and
  // the leading-number casing law applies to them like any other copy.
  title: string;
  sub: string;
  strandText: string;
  evidence: StrandEvidence[];
}

const MIN_COMPLETIONS = 10;
const MIN_BAND_SHARE = 0.4; // the band must actually dominate the month
const MIN_SLIPS_LEADER = 5;
const SLIP_LEAD_RATIO = 2; // leader must double the runner-up
const MIN_PLAN_PICKS = 10;

function hour12(h: number): string {
  const ap = h < 12 ? "AM" : "PM";
  const x = h % 12 || 12;
  return `${x} ${ap}`;
}

function partOfDay(h: number): string {
  if (h < 12) return "in the morning";
  if (h < 17) return "in the afternoon";
  return "in the evening";
}

// 1. Completion window: the 3-hour band holding the most task completions in
// the window, spoken only with 10+ samples AND real dominance. Same band
// logic Time Sense uses, now on the durable log.
/** The dominant 3-hour completion band, shared by the derivation and the
 *  monthly seal: start hour + its count, or null when the evidence is thin
 *  or nothing dominates. One definition, two readers, no drift. */
export function completionBand(done: WindowRow[]): { start: number; count: number } | null {
  if (done.length < MIN_COMPLETIONS) return null;
  let best = 0;
  let bestCount = -1;
  for (let start = 0; start <= 21; start++) {
    const count = done.filter((r) => r.h >= start && r.h < start + 3).length;
    if (count > bestCount) { bestCount = count; best = start; }
  }
  if (bestCount / done.length < MIN_BAND_SHARE) return null;
  return { start: best, count: bestCount };
}

/** Task completions only: GymService emits task.completed with kind
 *  "workout" for a finished session, and a session is not a task. */
export function taskDone(rows: WindowRow[]): WindowRow[] {
  return rows.filter((r) => r.type === "task.completed" && r.kind !== "workout");
}

export function deriveCompletionWindow(rows: WindowRow[]): Derived | null {
  // Tasks only (see taskDone): a month of gym evenings must not become
  // "your tasks get done at 6 PM".
  const done = taskDone(rows);
  const band = completionBand(done);
  if (!band) return null;
  const { start: best, count: bestCount } = band;
  const from = hour12(best);
  const to = hour12(best + 3);
  const days = [...new Set(done.filter((r) => r.h >= best && r.h < best + 3).map((r) => r.day))].sort().reverse();
  return {
    derivation: "completion_window",
    category: "energy",
    title: `Your tasks get done between ${from} and ${to}`,
    // Worded so the leading count is followed by a noun, not a joining word:
    // "12 Finishes there" is the casing law's intended shape, where
    // "12 Of your last 16" is what it does to a sentence built the other way.
    sub: capAfterNumber(`${bestCount} finishes there, out of your last ${done.length}`),
    strandText: `Gets things done between ${from} and ${to} ${partOfDay(best)}`,
    evidence: days.slice(0, 6).map((day) => ({ day, a: best })),
  };
}

// 2. Slip by category: the category that keeps getting pushed, spoken only
// when it clearly leads (5+ pushes and double the runner-up). "Slips" is a
// fact about tasks, never a verdict about the person: the copy names the
// category, not a failing.
/** The clearly leading slipped category, shared by the derivation and the
 *  monthly seal: 5+ pushes and double the runner-up, or nothing. One
 *  definition, two readers, no drift. */
export function slipLeader(rows: WindowRow[]): { category: string; n: number } | null {
  const pushed = rows.filter((r) => r.type === "task.pushed" && r.category);
  const counts = new Map<string, number>();
  for (const r of pushed) counts.set(r.category!, (counts.get(r.category!) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const leader = ranked[0];
  if (!leader || leader[1] < MIN_SLIPS_LEADER) return null;
  const runnerUp = ranked[1]?.[1] ?? 0;
  if (runnerUp > 0 && leader[1] < runnerUp * SLIP_LEAD_RATIO) return null;
  return { category: leader[0], n: leader[1] };
}

export function deriveSlipCategory(rows: WindowRow[]): Derived | null {
  const pushed = rows.filter((r) => r.type === "task.pushed" && r.category);
  const lead = slipLeader(rows);
  if (!lead) return null;
  const { category: cat, n } = lead;
  const days = [...new Set(pushed.filter((r) => r.category === cat).map((r) => r.day))].sort().reverse();
  return {
    derivation: "slip_category",
    category: "work_style",
    title: `${cat} tasks are the ones that slip`,
    sub: capAfterNumber(`Pushed ${n} times in 30 days, the most of any category`),
    strandText: `${cat} tasks tend to slip and need extra room`,
    evidence: days.slice(0, 6).map((day) => ({ day, a: 1 })),
  };
}

// 3. Plan-vs-done rate. Locked definition rides the flag: plan.outcome
// flag=true means completed by end of THAT local day, and nothing else
// counts. Speaks in both directions with the same honesty: a strong rate is
// a being-known win; a weak one is said plainly, as a fact about plan size,
// never as guilt.
export function derivePlanRate(rows: WindowRow[]): Derived | null {
  const outcomes = rows.filter((r) => r.type === "plan.outcome" && typeof r.flag === "boolean");
  if (outcomes.length < MIN_PLAN_PICKS) return null;
  const done = outcomes.filter((r) => r.flag === true).length;
  const rate = done / outcomes.length;
  const days = [...new Set(outcomes.map((r) => r.day))].sort().reverse();
  const evidence = days.slice(0, 6).map((day) => {
    const dayRows = outcomes.filter((r) => r.day === day);
    return { day, a: dayRows.filter((r) => r.flag === true).length, b: dayRows.length };
  });
  if (rate >= 0.7) {
    return {
      derivation: "plan_rate",
      category: "work_style",
      title: "What you plan, you finish",
      sub: capAfterNumber(`${done} of ${outcomes.length} picks done by that night`),
      strandText: "Finishes what lands on the plan; a planned task is a done task",
      evidence,
    };
  }
  if (rate <= 0.4) {
    return {
      derivation: "plan_rate",
      category: "work_style",
      title: "Shorter plans fit your real days better",
      sub: capAfterNumber(`${done} of ${outcomes.length} picks got done by that night`),
      strandText: "Does best with short plans; three picks beat six",
      evidence,
    };
  }
  return null; // the middle is not a pattern, it is a normal life
}

// 4. Training window: WHEN the sessions actually happen. Same band, same
// gate, different rows.
//
// This one is not new instrumentation. GymService has emitted
// task.completed with kind "workout" for every finished session since the
// gym shipped, the sink persists it, and window.ts reads it. Then every
// derivation dropped it: taskDone filters kind "workout" out on purpose (a
// session is not a task, and a month of gym evenings must not become "your
// tasks get done at 6 PM"), and nothing else looked at it. So the rows were
// captured, durable, correct, and read by nobody -- which is the "starved,
// not badly designed" verdict from the build handoff, in one function.
export function workoutDone(rows: WindowRow[]): WindowRow[] {
  return rows.filter((r) => r.type === "task.completed" && r.kind === "workout");
}

export function deriveTrainingWindow(rows: WindowRow[]): Derived | null {
  const done = workoutDone(rows);
  const band = completionBand(done);
  if (!band) return null;
  const { start: best, count: bestCount } = band;
  const from = hour12(best);
  const to = hour12(best + 3);
  const days = [...new Set(done.filter((r) => r.h >= best && r.h < best + 3).map((r) => r.day))].sort().reverse();
  return {
    derivation: "training_window",
    category: "routine",
    title: `You train between ${from} and ${to}`,
    sub: capAfterNumber(`${bestCount} sessions there, out of your last ${done.length}`),
    strandText: `Trains between ${from} and ${to} ${partOfDay(best)}`,
    evidence: days.slice(0, 6).map((day) => ({ day, a: best })),
  };
}

// 5. Email window: when the inbox actually gets dealt with. Reads
// email.handled, the semantic act instrumented for this (MessagesFlow emits
// it on a reply, an archive and a sweep). Same band, same gate.
//
// It says WHEN, never how much: a count of mail handled is a productivity
// score, and this app does not keep those. The band is a fact about the
// shape of a day, which is what the Brain is for.
export function emailHandled(rows: WindowRow[]): WindowRow[] {
  return rows.filter((r) => r.type === "email.handled");
}

export function deriveEmailWindow(rows: WindowRow[]): Derived | null {
  const done = emailHandled(rows);
  const band = completionBand(done);
  if (!band) return null;
  const { start: best, count: bestCount } = band;
  const from = hour12(best);
  const to = hour12(best + 3);
  const days = [...new Set(done.filter((r) => r.h >= best && r.h < best + 3).map((r) => r.day))].sort().reverse();
  return {
    derivation: "email_window",
    category: "work_style",
    title: `Email gets dealt with between ${from} and ${to}`,
    sub: capAfterNumber(`${bestCount} of your last ${done.length} were handled in that stretch`),
    strandText: `Deals with email between ${from} and ${to} ${partOfDay(best)}`,
    evidence: days.slice(0, 6).map((day) => ({ day, a: best })),
  };
}

// All derivations, in the order they surface. One at a time is the moments
// layer's job; this just says everything the data supports.
export function deriveAll(rows: WindowRow[]): Derived[] {
  return [
    deriveCompletionWindow(rows),
    deriveSlipCategory(rows),
    derivePlanRate(rows),
    deriveTrainingWindow(rows),
    deriveEmailWindow(rows),
  ].filter((d): d is Derived => d !== null);
}
