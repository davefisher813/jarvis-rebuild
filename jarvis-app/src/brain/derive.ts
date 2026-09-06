import type { WindowRow } from "./window";
import type { StrandCategory, StrandEvidence, DerivationKey } from "./strands/types";
import { capAfterNumber } from "../shared/casing";
import { catName } from "../shared/categories";

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
  // UP-MIND-16 (2026-09-05): a write the accept performs BESIDES the strand.
  // Contacts is the one place where the fact and the record are different
  // things: "you deal with Marco constantly" is a strand, and the label on
  // his card is a field. One tap should do both, and neither happens
  // without it.
  apply?: { kind: "person_label"; personId: string; label: string };
}

// UP-MIND-16: who the people derivations are allowed to talk about. Names
// come from Contacts because the log carries ids and nothing else; a
// derivation with no name has nothing showable to say and stays silent.
export interface DerivePerson {
  id: string;
  name: string;
  /** The relationship label already on their card, when there is one. */
  label?: string;
  /** A thread with them is linked to a live project. */
  onProject?: boolean;
  /** Epoch ms of the last message either way, from the cached lookup the
   *  person card already runs. Absent means unknown, which is not quiet. */
  lastMs?: number;
}

// THE GATES. Exported since 2026-09-06 because brain/readiness.ts reports
// them on What JARVIS Knows, and a panel that says "10 needed" while this
// file requires twelve is worse than no panel at all. One definition, two
// readers: the detector that enforces the gate and the row that explains it.
export const MIN_COMPLETIONS = 10;
export const MIN_BAND_SHARE = 0.4; // the band must actually dominate the month
export const MIN_SLIPS_LEADER = 5;
export const SLIP_LEAD_RATIO = 2; // leader must double the runner-up
export const MIN_PLAN_PICKS = 10;

// BRAIN-F-18 (2026-09-05): the band's end is bandStart + 3, so a late band
// hands 24 in and `h < 12` called midnight PM: "Your tasks get done between
// 9 PM and 12 PM". report.ts:100 and seal.ts already wrap with % 24; this is
// the same wrap, so the hour that comes back is the hour on the clock.
function hour12(h: number): string {
  const ap = h % 24 < 12 ? "AM" : "PM";
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
/** Pushes per category in the window, most first, ties alphabetical. Split
 *  out of slipLeader 2026-09-06 so brain/readiness.ts can say HOW FAR the
 *  leader is from the gate; slipLeader itself only ever speaks once both
 *  conditions are already met, and a readiness row that re-implemented this
 *  grouping is the exact drift the panel exists to prevent. */
export function slipCounts(rows: WindowRow[]): { category: string; n: number }[] {
  const pushed = rows.filter((r) => r.type === "task.pushed" && r.category);
  const counts = new Map<string, number>();
  for (const r of pushed) counts.set(r.category!, (counts.get(r.category!) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category, n]) => ({ category, n }));
}

export function slipLeader(rows: WindowRow[]): { category: string; n: number } | null {
  const ranked = slipCounts(rows);
  const leader = ranked[0];
  if (!leader || leader.n < MIN_SLIPS_LEADER) return null;
  const runnerUp = ranked[1]?.n ?? 0;
  if (runnerUp > 0 && leader.n < runnerUp * SLIP_LEAD_RATIO) return null;
  return leader;
}

export function deriveSlipCategory(rows: WindowRow[]): Derived | null {
  const pushed = rows.filter((r) => r.type === "task.pushed" && r.category);
  const lead = slipLeader(rows);
  if (!lead) return null;
  const { category: cat, n } = lead;
  // BRAIN-F-05 (2026-09-05): task.pushed carries the category ID (TasksService
  // emits t.category; the seal resolves it through catById). This copy used to
  // print the id itself, so the Noticed card and the accepted strand read
  // "3fa85f64-... tasks are the ones that slip", and the strand fed that uuid
  // to the AI on every prompt. Resolve to the user's name; a category that no
  // longer exists gets no derivation at all, because a sentence about an area
  // nobody can see is not a fact anyone can check.
  const name = catName(cat);
  if (!name) return null;
  const days = [...new Set(pushed.filter((r) => r.category === cat).map((r) => r.day))].sort().reverse();
  return {
    derivation: "slip_category",
    category: "work_style",
    title: `${name} tasks are the ones that slip`,
    sub: capAfterNumber(`Pushed ${n} times in 30 days, the most of any category`),
    strandText: `${name} tasks tend to slip and need extra room`,
    evidence: days.slice(0, 6).map((day) => ({ day, a: 1 })),
  };
}

// 3. Plan-vs-done rate. Locked definition rides the flag: plan.outcome
// flag=true means completed by end of THAT local day, and nothing else
// counts. Speaks in both directions with the same honesty: a strong rate is
// a being-known win; a weak one is said plainly, as a fact about plan size,
// never as guilt.
/** The resolved plan picks in the window: the flag is the whole definition
 *  (see above), so an outcome row without one is not evidence. Named
 *  2026-09-06 alongside taskDone / workoutDone / emailHandled so the
 *  readiness panel counts the same rows the gate counts. */
export function planOutcomes(rows: WindowRow[]): WindowRow[] {
  return rows.filter((r) => r.type === "plan.outcome" && typeof r.flag === "boolean");
}

export function derivePlanRate(rows: WindowRow[]): Derived | null {
  const outcomes = planOutcomes(rows);
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

// 6. People rhythm (UP-MIND-16, Email 5.14 and Brain build order 6).
//
// A person card that reads NO LABEL YET for everyone is a Brain that cannot
// rank a sister above a stranger, and the app has been watching the mail all
// along: since UP-MIND-10 every email.handled row carries the person it was
// with. Steady traffic with one contact is a real, showable fact, and the
// label it proposes is the weakest true one: "Work" only when the threads
// are linked to a live project, "Frequent" otherwise. It never infers a
// relationship, and nothing is written without the tap.
//
// The gate is ten handled rows for ONE person inside the window. The record
// asked for ten in sixty days; brain/window.ts reads thirty (WINDOW_DAYS),
// so ten in thirty is the same bar applied to the data that exists, and it
// errs toward silence, which is this file's governing principle.
export const MIN_PERSON_HANDLED = 10;

export function personHandled(rows: WindowRow[]): Map<string, WindowRow[]> {
  const out = new Map<string, WindowRow[]>();
  for (const r of rows) {
    if (r.type !== "email.handled") continue;
    const id = r.entity_id;
    if (!id) continue;
    const cur = out.get(id);
    if (cur) cur.push(r); else out.set(id, [r]);
  }
  return out;
}

export function derivePeopleRhythm(rows: WindowRow[], people: DerivePerson[]): Derived | null {
  const byPerson = personHandled(rows);
  let best: { p: DerivePerson; rows: WindowRow[] } | null = null;
  for (const p of people) {
    // Somebody the user has already labelled needs no proposal.
    if (p.label?.trim()) continue;
    const hits = byPerson.get(p.id) ?? [];
    if (hits.length < MIN_PERSON_HANDLED) continue;
    if (!best || hits.length > best.rows.length) best = { p, rows: hits };
  }
  if (!best) return null;
  const { p, rows: hits } = best;
  const days = [...new Set(hits.map((r) => r.day))].sort();
  const weeks = Math.max(1, Math.round(days.length / 7) || 1);
  const label = p.onProject ? "Work" : "Frequent";
  return {
    derivation: "people_rhythm",
    category: "people",
    title: `${p.name} is someone you deal with constantly`,
    sub: capAfterNumber(`${hits.length} emails handled with them, across ${days.length} ${days.length === 1 ? "day" : "days"}`),
    strandText: `Deals with ${p.name} regularly`,
    evidence: days.slice(-6).map((day) => ({ day, a: weeks })),
    apply: { kind: "person_label", personId: p.id, label },
  };
}

// 7. Gone quiet (UP-MIND-16, second half).
//
// Someone the user said matters, who they have not talked to in a month.
// Read off the cached last-contact lookup rather than the event log, because
// a person who has gone quiet has no rows in a thirty-day window BY
// DEFINITION: the absence is the whole signal, and an absence cannot be
// counted in a window that only holds the present.
//
// Gated on a label, which is the user's own statement that this person
// matters. Never a guess about a stranger, and never a reproach: the copy
// states the gap and offers the check-in, and the draft is the one the
// person card already writes (people/lastContact.ts checkinPrompt).
export const QUIET_MS = 30 * 86400000;

export function deriveGoneQuiet(people: DerivePerson[], nowMs: number): Derived | null {
  let best: { p: DerivePerson; gapDays: number } | null = null;
  for (const p of people) {
    if (!p.label?.trim()) continue;
    if (typeof p.lastMs !== "number" || p.lastMs <= 0) continue;
    const gap = nowMs - p.lastMs;
    if (gap < QUIET_MS) continue;
    const gapDays = Math.floor(gap / 86400000);
    if (!best || gapDays > best.gapDays) best = { p, gapDays };
  }
  if (!best) return null;
  const { p, gapDays } = best;
  const weeks = Math.round(gapDays / 7);
  return {
    derivation: "gone_quiet",
    category: "people",
    title: `${p.name} has gone quiet`,
    sub: capAfterNumber(`${weeks} ${weeks === 1 ? "week" : "weeks"} since either of you wrote`),
    strandText: `Checks in with ${p.name} when it has been a while`,
    evidence: [],
  };
}

// All derivations, in the order they surface. One at a time is the moments
// layer's job; this just says everything the data supports.
//
// UP-MIND-16 (2026-09-05): `people` is optional and empty by default, so
// every existing caller and test keeps working and the two people
// derivations simply stay silent without Contacts in hand.
export function deriveAll(rows: WindowRow[], people: DerivePerson[] = [], nowMs = Date.now()): Derived[] {
  return [
    deriveCompletionWindow(rows),
    deriveSlipCategory(rows),
    derivePlanRate(rows),
    deriveTrainingWindow(rows),
    deriveEmailWindow(rows),
    derivePeopleRhythm(rows, people),
    deriveGoneQuiet(people, nowMs),
  ].filter((d): d is Derived => d !== null);
}
