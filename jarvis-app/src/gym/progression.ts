import type { Exercise, SetEntry, SetLog, Workout } from "./types";
import { fieldsFor, inUnit } from "./measures";
import { liftRef, sameLift } from "./identity";
import { lineCase } from "../shared/casing";
import type { OverloadTargets } from "./settings";

// THE PROGRESSION ENGINE (D6-A, Training Catalog V2, approved 2026-08-31;
// REWRITTEN 2026-10-17, section 10, PROGRESSIVE OVERLOAD).
//
// The old engine took the heaviest set of the last session and bumped it, so
// a 275 x 5 prescription opened at 255 x 1 and suggested 300 x 1. It is ONE
// published rule now, autoregulated double progression, and every suggestion
// says which of the lifter's own sets it read:
//
//   1. WORK INSIDE THE PLAN'S REP RANGE. Low to high from the plan's set
//      prescription; a single rep target is the top and top minus two the
//      bottom (never under one). Hold the load and add reps while any work
//      set at that load is below the top.
//   2. STEP WHEN EVERY SET IS AT THE TOP. About 2.5 percent, capped at 5,
//      rounded to the smallest jump the equipment can make (two of the
//      smallest plate on a bar, the stack's step on a machine, 2.5 by
//      default), and the target reps reset to the bottom of the range. When
//      the smallest jump is more than 7 percent of the load, the range top
//      grows by three reps instead. With the Each Set on Its Own setting
//      (gym/settings.ts overloadTargets, twelve sessions in), a set position
//      at the top steps for that position only.
//   3. TWO STRIKES. One missed session (a work set under the range bottom)
//      repeats the same prescription; two in a row cut the load 5 percent
//      (10 with fewer than about twelve sessions of the lift); a stall at
//      the same load again asks for a different rep range before anyone
//      swaps the exercise.
//   4. A LIGHTER WEEK. On a back-off week, after five accumulation sessions
//      in a row, or when the week's own picture says so (two in five of the
//      week's lifts missed, or the week's tonnage down a tenth on the week
//      before): half the sets at about 10 percent less, nothing to failure.
//   5. SETS CHANGE AT BLOCK LEVEL. At most one set more per exercise per
//      week, never in the week of a load step, and only after a week with no
//      misses; the app has no recovery reading of the lifter and never will
//      (types.ts, CallItData), so the reason says the rest is his call.
//      Offered as a field, never written.
//   6. HIS MARKS, IF HE MADE THEM. All Clean is easy and lets the step
//      through; a grind is right and leaves the reps to decide; a miss is
//      hard and holds. Never required.
//   7. INSIDE A SESSION (inSessionAdjust). Set one two or more reps short of
//      its target, or marked hard, drops the rest of the sets 5 percent; set
//      one at the top of the range and marked easy offers 2.5 percent more
//      for the rest, never under twelve sessions. The marks stand in for a
//      reps-in-reserve number the app does not ask for.
//
// PREFILL (Dave, 2026-10-17): the session screen fills the step into the
// first set's fields; logging them untouched is the accept. A changed weight
// is recorded on that set (SetEntry.declined), and the same step next time is
// offered, never filled in again (Suggestion.declined): the app never argues
// twice.
//
// Two rules from the first engine stand: NOTHING IS WRITTEN until the lifter
// logs the suggested numbers (applySuggestion is the only writer), and a
// suggestion the evidence cannot support is silence, not a guess. Never
// called AI anywhere it is drawn. The rule is published in the app
// (HowSuggestionsSheet.tsx), in the same words as this file.

export type SuggestionKind = "bump" | "hold" | "back" | "extend" | "scheme" | "lighter" | "drop" | "up";

export interface Suggestion {
  kind: SuggestionKind;
  /** What to open the first set at, or plan next time. Only the fields this
   *  exercise's kind uses. */
  next: SetLog;
  /** What it is moving from: last session's load and its top reps. */
  from: SetLog;
  /** The one line, as its parts: what he did, what that meant, what to do.
   *  Drawn as facts so the dots between them are the stylesheet's. */
  reason: string[];
  /** The same line as one string, for the Why row and a receipt. */
  why: string;
  /** The reps to expect after a load step ("Expect 6 to 7"). */
  expect?: string;
  /** The rep range the suggestion worked inside, extended when rule 2 says. */
  range: { low: number; high: number };
  /** Rule 5: a set could be added this week (the load did not step, last
   *  week had no misses, and no set was added this week already). */
  addSet?: boolean;
  /** Rule 5's conditions, as facts beside the offer. */
  addSetWhy?: string[];
  /** A lighter week's set count (half the plan's). */
  sets?: number;
  /** Each Set on Its Own (rule 2): the target for every working set
   *  position, in order. `next` is the first of them. */
  perSet?: SetLog[];
  /** The basis on tap: the lift, the session read, which sets counted, the
   *  rep range, the increment, and the marks. */
  basis?: SuggestionBasis;
  /** NEVER ARGUES TWICE (2026-10-17): last session he changed this same step
   *  when it was filled in (SetEntry.declined). The session screen then opens
   *  on his own numbers and offers the step with Use instead of filling it
   *  in again. */
  declined?: boolean;
}

export interface SuggestionBasis {
  variant: string;
  source: string;
  role: string;
  range: string;
  increment: string;
  marks: string;
}

// Two modes (2026-10-04): a third, Program, offered "the plan as written" but
// returned nothing exactly as Manual does, so it was taken off the menu and a
// stored "program" reads as Manual (health/settings.ts).
export type ProgressionMode = "assisted" | "manual";

export interface SuggestOptions {
  mode?: ProgressionMode;
  /** The smallest real jump the equipment makes: two of the rack's smallest
   *  plate on anything plates go on, the stack's step on a machine. Absent
   *  reads as 2.5. */
  smallestJump?: number;
  equipmentLabel?: string;
  /** THE SAME SESSION THE SCREEN CALLS "LAST" (2026-09-29). Given, this
   *  workout day's own sessions are read first (prs.ts lastSessionFor). */
  preferDayId?: string;
  /** The program week is a back-off week (ProgramWeek.backOff): rule 4
   *  applies whatever the log says. */
  backOffWeek?: boolean;
  /** Which sets have to top the range before a step (gym/settings.ts
   *  overloadTargets). Absent reads as "all". */
  targets?: OverloadTargets;
  /** The session's own date (local ISO day), the edge rules 4 and 5 count
   *  weeks back from. Absent reads as the latest workout in the log. */
  today?: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayPhrase(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? `${MONTHS[m - 1]} ${d}` : iso;
}

const trim = (n: number): string => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))));
const same = (a: number, b: number) => Math.abs(a - b) < 0.05;
const r4 = (x: number) => Number(x.toFixed(4));

/** The sessions that actually trained this exercise, oldest first, by the same
 *  identity every other gym derivation uses (GYM-F-04: the library key when
 *  both sides have one, else name and kind). Warm-ups and drops are not
 *  evidence: they are supposed to move well. Weights come back in the unit the
 *  lift is in NOW (2026-09-29). */
interface Session { date: string; dayId: string; sets: SetEntry[]; unit: string | undefined }

const isWork = (s: SetLog) => !s.skipped && !s.warmup && !s.drop;

function sessionsOf(history: Workout[], ex: Pick<Exercise, "name" | "kind" | "unit"> & { exerciseKey?: string }): Session[] {
  const ref = liftRef(ex, ex.kind);
  const out: Session[] = [];
  for (const w of history) {
    const hit = w.data.exercises.find((e) => sameLift(ref, e));
    const work = hit?.sets.filter(isWork) ?? [];
    if (!hit || !work.length) continue;
    const convert = !!ex.unit && !!hit.unit && ex.unit !== hit.unit;
    out.push({
      date: w.data.date, dayId: w.data.dayId,
      // The step he turned down rides in the same unit as the set it sits on.
      sets: convert ? work.map((s) => {
        const c = inUnit(ex.kind, s, hit.unit, ex.unit) as SetEntry;
        return s.declined ? { ...c, declined: inUnit(ex.kind, s.declined, hit.unit, ex.unit) } : c;
      }) : work,
      unit: convert ? ex.unit : hit.unit,
    });
  }
  return out;
}

/** The working load of one session: its heaviest set. */
const loadOf = (s: Session): number => Math.max(0, ...s.sets.map((x) => x.w ?? 0));
/** The reps of the sets AT a load, in order. */
const repsAt = (s: Session, load: number): number[] => s.sets.filter((x) => same(x.w ?? 0, load) && (x.r ?? 0) > 0).map((x) => x.r!);
/** Rule 3's miss: a work set at the load under the range bottom. */
const missed = (s: Session, load: number, low: number): boolean => repsAt(s, load).some((r) => r < low);
/** Rule 6's miss: a set he marked as one. */
const markedMissed = (s: Session): boolean => s.sets.some((x) => x.moved === "missed");

/** The most a suggestion may lean on one session's heaviest set: 1.5 times the
 *  middle of the tops before it. Past that the number is not a trend, it is a
 *  mistyped weight or another lift's. */
const OUTLIER = 1.5;
/** Rule 4's count of accumulation sessions before a lighter week is offered. */
const ACCUMULATION_SESSIONS = 5;
/** Rule 3: the session count under which a stall cuts ten percent, not five.
 *  Rules 2 and 7 read it as the line between a beginner and the rest. */
const NOVICE_SESSIONS = 12;
/** Rule 4's week picture: the share of the week's lifts that missed before
 *  the week itself asks for a lighter one, and the tonnage drop that does. */
const WEEK_MISS_SHARE = 0.4;
const WEEK_TONNAGE_DROP = 0.1;
/** A week of one or two lifts is those lifts' own story, told by rules 1 to
 *  3; the week picture needs this many distinct lifts to say anything. */
const WEEK_MIN_LIFTS = 3;

const roundTo = (x: number, jump: number) => r4(Math.round(x / jump) * jump);
const floorTo = (x: number, jump: number) => r4(Math.floor(x / jump + 1e-9) * jump);

/** Rule 2's step: about 2.5 percent, at least one jump, never over 5 percent
 *  once a jump fits under it. */
function loadStep(load: number, jump: number): number {
  let step = Math.max(jump, roundTo(load * 0.025, jump));
  const cap = floorTo(load * 0.05, jump);
  if (step > cap && cap >= jump) step = cap;
  return step;
}

/** A cut of `share` off the load, to the jump, and at least one jump down. */
function cutLoad(load: number, share: number, jump: number): number {
  return Math.max(jump, Math.min(r4(load - jump), floorTo(load * (1 - share), jump)));
}

/** Rule 1's range from the plan's working sets, or null when the plan names
 *  no reps (no range, no opinion).
 *
 *  THE RANGE HOLDS STILL ACROSS STEPS (2026-10-17). A step writes the bottom
 *  of the range into every working set (rule 2: reps reset to the bottom), so
 *  a plan read from its reps alone crept down one step per accepted step: 6,
 *  8, 8 is 6 to 8; after the step 6, 6, 6 read as 4 to 6; the next step read
 *  4, 4, 4 as 2 to 4. applySuggestion keeps the range it worked inside on the
 *  plan (Exercise.repRange), and it is read back here while every planned rep
 *  still sits inside it. A hand edit that leaves it is a new plan and the
 *  range derives afresh from the reps, as it always did. A fresh object either
 *  way: rule 2's extend branch widens the range it is handed. */
function rangeOf(ex: Exercise): { low: number; high: number } | null {
  const planned = ex.sets.filter(isWork).map((s) => s.r).filter((r): r is number => (r ?? 0) > 0);
  if (!planned.length) return null;
  const kept = ex.repRange;
  if (kept && kept.low >= 1 && kept.high >= kept.low && planned.every((r) => r >= kept.low && r <= kept.high)) {
    return { low: kept.low, high: kept.high };
  }
  const high = Math.max(...planned);
  const low = planned.length > 1 && Math.min(...planned) < high ? Math.min(...planned) : Math.max(1, high - 2);
  return { low, high };
}

// ---------------------------------------------------------------------------
// THE WEEK (rules 4 and 5). Weeks are calendar weeks, Monday to Sunday, read
// against `today` (the live session's date; absent, the latest workout in
// the log). "Last week" is the most recent complete one, so a picture of it
// holds still for the whole of this week and every lift read this week gets
// the same answer. Pure: everything is read from the workouts handed in.
// ---------------------------------------------------------------------------

/** Days since the epoch for a local ISO day, so two dates subtract. */
function dayNo(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? Math.floor(Date.UTC(y, m - 1, d) / 86400000) : Number.NaN;
}

/** The Monday-to-Sunday week a day falls in, counted from the epoch (day 0
 *  was a Thursday, so the Monday before it is day -3). */
const weekNo = (iso: string): number => Math.floor((dayNo(iso) + 3) / 7);

/** How many weeks before today's week a date falls: 0 this week, 1 last
 *  week, 2 the week before. NaN for a date that does not parse. */
function weeksBack(iso: string, today: string): number {
  return weekNo(today) - weekNo(iso);
}

/** Today, as the engine reads it: the option, else the latest workout date. */
function todayOf(history: Workout[], today?: string): string | null {
  if (today && !Number.isNaN(dayNo(today))) return today;
  const dates = history.map((w) => w.data.date).filter((d) => !Number.isNaN(dayNo(d))).sort();
  return dates[dates.length - 1] ?? null;
}

export interface WeekPicture {
  /** Distinct lifts trained last week (the most recent complete week). */
  lifts: number;
  /** How many of them missed: a set he marked missed, or the lowest set at
   *  the same load two or more reps under the session before (a flat day is
   *  not a miss), or, for the lift being read, a work set under the bottom
   *  of its range (rule 3). */
  missed: number;
  /** Working sets' weight times reps: last week, the week before, and the
   *  week before that. */
  tonnage: number;
  tonnagePrior: number;
  tonnagePrior2: number;
  /** Workouts last week and the week before. */
  sessions: number;
  sessionsPrior: number;
}

/** Last week's own picture, from every workout in the log. `read` is the lift
 *  being suggested for and the bottom of its range, so its own miss is judged
 *  by rule 3 rather than against the session before. */
export function weekPicture(history: Workout[], read?: { ex: Exercise; low: number }, today?: string): WeekPicture | null {
  const now = todayOf(history, today);
  if (!now) return null;
  const byWeek = (n: number) => history.filter((w) => weeksBack(w.data.date, now) === n);
  const tonnageOf = (ws: Workout[]) => ws.reduce((t, w) => t + w.data.exercises.reduce((u, e) => u + e.sets.filter(isWork).reduce((v, s) => v + (s.w ?? 0) * (s.r ?? 0), 0), 0), 0);
  const week = byWeek(1), prior = byWeek(2), prior2 = byWeek(3);
  const readRef = read ? liftRef(read.ex, read.ex.kind) : null;
  // One verdict per lift: its latest session of the week against the one before it.
  const seen = new Map<string, boolean>();
  const sorted = [...week].sort((a, b) => a.data.date.localeCompare(b.data.date));
  for (const w of sorted) {
    for (const e of w.data.exercises) {
      const work = e.sets.filter(isWork);
      if (!work.length) continue;
      const key = e.exerciseKey ?? `${e.kind}:${e.name.trim().toLowerCase()}`;
      const all = sessionsOf(history, e);
      const at = all.findIndex((s) => s.date === w.data.date && s.dayId === w.data.dayId);
      const cur = at >= 0 ? all[at]! : { date: w.data.date, dayId: w.data.dayId, sets: work, unit: e.unit };
      const prev = at > 0 ? all[at - 1] : undefined;
      const load = loadOf(cur);
      let miss = markedMissed(cur);
      if (!miss && readRef && read && load > 0 && sameLift(readRef, e)) miss = missed(cur, load, read.low);
      else if (!miss && prev && load > 0 && same(loadOf(prev), load)) {
        const nowReps = repsAt(cur, load), was = repsAt(prev, load);
        if (nowReps.length && was.length && Math.min(...nowReps) <= Math.min(...was) - 2) miss = true;
      }
      seen.set(key, miss);
    }
  }
  return {
    lifts: seen.size,
    missed: [...seen.values()].filter(Boolean).length,
    tonnage: tonnageOf(week), tonnagePrior: tonnageOf(prior), tonnagePrior2: tonnageOf(prior2),
    sessions: week.length, sessionsPrior: prior.length,
  };
}

/** Rule 4's early trigger, as the verdict to draw, or null when last week
 *  says nothing. The tonnage trigger needs last week to hold at least as many
 *  workouts as the week before (fewer workouts is less training, not
 *  fatigue) and the week before not to have been a drop itself (the lighter
 *  week that drop asked for would otherwise ask for another). */
export function weekTrigger(p: WeekPicture | null): string | null {
  if (!p || p.lifts < WEEK_MIN_LIFTS) return null;
  if (p.missed / p.lifts >= WEEK_MISS_SHARE) return `${p.missed} of ${p.lifts} Lifts Missed Last Week`;
  if (p.tonnagePrior > 0 && p.sessions >= p.sessionsPrior && p.tonnage <= p.tonnagePrior * (1 - WEEK_TONNAGE_DROP)) {
    const priorWasDrop = p.tonnagePrior2 > 0 && p.tonnagePrior <= p.tonnagePrior2 * (1 - WEEK_TONNAGE_DROP);
    if (!priorWasDrop) return `Tonnage Down ${Math.round((1 - p.tonnage / p.tonnagePrior) * 100)}% Last Week`;
  }
  return null;
}

/**
 * What to offer for the next session of `ex`, or null when the log does not
 * support offering anything.
 */
export function suggestFor(history: Workout[], ex: Exercise, opts: SuggestOptions = {}): Suggestion | null {
  const mode = opts.mode ?? "assisted";
  if (mode === "manual") return null;
  const all = sessionsOf(history, ex);
  if (all.length === 0) return null;
  const scope = opts.preferDayId && all.some((x) => x.dayId === opts.preferDayId) ? all.filter((x) => x.dayId === opts.preferDayId) : all;
  const last = scope[scope.length - 1]!;
  const before = scope.slice(0, -1);

  // RULE 1: THE PLAN'S RANGE. No range on the plan, no opinion.
  const range = rangeOf(ex);
  if (!range) return null;
  const { low, high } = range;

  const keys = fieldsFor(ex.kind).map((f) => f.key);
  const weighted = keys.includes("w");
  if (!weighted && !keys.includes("r")) return null; // a time is not something to hand out as a target

  const load = weighted ? loadOf(last) : 0;
  if (weighted && load <= 0) return null;
  const reps = weighted ? repsAt(last, load) : last.sets.map((s) => s.r ?? 0).filter((r) => r > 0);
  if (!reps.length) return null;

  // THE OUTLIER GUARD (2026-09-29). With at least two earlier sessions to
  // compare, a top load more than 1.5 times their median offers nothing.
  if (weighted && before.length >= 2) {
    const tops = before.map(loadOf).filter((t) => t > 0).sort((a, b) => a - b);
    if (tops.length >= 2) {
      const mid = tops.length % 2 ? tops[(tops.length - 1) / 2]! : (tops[tops.length / 2 - 1]! + tops[tops.length / 2]!) / 2;
      if (load > mid * OUTLIER) return null;
    }
  }

  // RULE 6: HIS MARKS, on the sets that counted.
  const counted = weighted ? last.sets.filter((x) => same(x.w ?? 0, load)) : last.sets;
  const marked = counted.filter((s) => s.moved);
  const easy = marked.length > 0 && marked.every((s) => s.moved === "clean");
  const hard = marked.some((s) => s.moved === "missed");

  const allTop = reps.every((r) => r >= high);
  const miss = reps.some((r) => r < low);
  const jump = opts.smallestJump && opts.smallestJump > 0 ? opts.smallestJump : 2.5;
  const when = dayPhrase(last.date);
  const lastLine = weighted ? `Last Time ${trim(load)} × ${reps.join(", ")}` : `Last Time ${reps.join(", ")} Reps`;
  const rangeWord = low === high ? `${high}` : `${low} to ${high}`;
  const from: SetLog = weighted ? { w: load, r: Math.max(...reps) } : { r: Math.max(...reps) };
  const planSets = ex.sets.filter(isWork).length;
  const seasoned = all.length >= NOVICE_SESSIONS;
  // Each Set on Its Own: a setting, and never for a beginner (brief, section 1).
  const perSetOn = weighted && opts.targets === "perSet" && seasoned;

  let kind: SuggestionKind;
  let next: SetLog;
  let verdict: string;
  let target: string;
  let expect: string | undefined;
  let incrementUsed = 0;
  let addSet = false;
  let sets: number | undefined;
  let perSet: SetLog[] | undefined;

  // RULE 4: A LIGHTER WEEK. The week says so (the program's back-off flag, or
  // the week's own picture: two in five lifts missed, or tonnage down a
  // tenth), or five accumulation sessions in a row did: each at least the
  // load of the one before, none lighter, and every work set inside the
  // range (a missed session is a strike, not a week of accumulation).
  const inRange = (x: Session) => !weighted || !missed(x, loadOf(x), low);
  const accumulation = (() => {
    if (!inRange(last)) return 0;
    let n = 1;
    for (let i = scope.length - 1; i > 0; i--) {
      if (inRange(scope[i - 1]!) && loadOf(scope[i]!) >= loadOf(scope[i - 1]!) * 0.95) n++; else break;
    }
    return n;
  })();
  const weekSays = opts.backOffWeek ? null : weekTrigger(weekPicture(history, weighted ? { ex, low } : undefined, opts.today));
  const lighterWeek = !!opts.backOffWeek || !!weekSays || (weighted && accumulation >= ACCUMULATION_SESSIONS);

  if (lighterWeek) {
    kind = "lighter";
    sets = Math.max(1, Math.ceil(planSets / 2));
    if (weighted) {
      const lighter = Math.max(jump, floorTo(load * 0.9, jump));
      next = { w: lighter, r: low };
      target = `Lighter Week ${trim(lighter)} × ${low}, ${sets === 1 ? "1 Set" : `${sets} Sets`}, Nothing to Failure`;
    } else {
      next = { r: low };
      target = `Lighter Week ${low} Reps, ${sets === 1 ? "1 Set" : `${sets} Sets`}, Nothing to Failure`;
    }
    verdict = opts.backOffWeek ? "Back-Off Week" : weekSays ?? `${accumulation} Sessions Up Without a Lighter One`;
  } else if (miss) {
    // RULE 3: TWO STRIKES.
    const prev = before[before.length - 1];
    const prevMiss = !!prev && (!weighted || same(loadOf(prev), load)) && missed(prev, load, low);
    if (!prevMiss) {
      kind = "hold";
      next = weighted ? { w: load, r: low } : { r: low };
      verdict = `Under ${low} Once`;
      target = weighted ? `Same Again ${trim(load)} × ${low}` : `Same Again ${low} Reps`;
    } else {
      // A stall at this load that was already cut once asks for a new scheme.
      let stalledBefore = false;
      for (let i = 1; i < before.length; i++) {
        const a = before[i - 1]!, b = before[i]!;
        if ((!weighted || (same(loadOf(a), load) && same(loadOf(b), load))) && missed(a, load, low) && missed(b, load, low)) { stalledBefore = true; break; }
      }
      if (stalledBefore) {
        kind = "scheme";
        next = weighted ? { w: load, r: low } : { r: low };
        verdict = weighted ? `Stalled at ${trim(load)} Twice` : "Stalled Twice";
        target = "Try a Different Rep Range";
      } else {
        kind = "back";
        const cut = seasoned ? 0.05 : 0.1;
        if (weighted) {
          const lighter = cutLoad(load, cut, jump);
          next = { w: lighter, r: low };
          target = `Back to ${trim(lighter)} × ${low}`;
        } else {
          next = { r: Math.max(1, low - 1) };
          target = `Back to ${Math.max(1, low - 1)} Reps`;
        }
        verdict = `Under ${low} Twice`;
      }
    }
  } else if ((allTop || easy) && !hard) {
    // RULE 2: THE STEP.
    if (!weighted) {
      kind = "bump";
      next = { r: high + 1 };
      verdict = allTop ? `All at the Top of ${rangeWord}` : "Marked Easy";
      target = `Step to ${high + 1} Reps`;
    } else if (jump > load * 0.07) {
      kind = "extend";
      range.high = high + 3;
      next = { w: load, r: range.high };
      verdict = allTop ? `All at the Top of ${rangeWord}` : "Marked Easy";
      target = `A ${trim(jump)} Jump Is Over 7% of ${trim(load)}, Range Now ${low} to ${range.high}`;
      addSet = planSets < 5;
    } else {
      kind = "bump";
      incrementUsed = loadStep(load, jump);
      const to = r4(load + incrementUsed);
      next = { w: to, r: low };
      verdict = allTop ? `All at the Top of ${rangeWord}` : "Marked Easy";
      target = `Step to ${trim(to)} × ${low}`;
      expect = high - 1 > low ? `Expect ${low} to ${high - 1}` : `Expect ${low}`;
    }
  } else if (perSetOn && !hard && jump <= load * 0.07 && reps.some((r) => r >= high)) {
    // RULE 2, EACH SET ON ITS OWN: the positions at the top step, the rest
    // hold and add reps. A set the plan has past what he did last time holds.
    kind = "bump";
    incrementUsed = loadStep(load, jump);
    const to = r4(load + incrementUsed);
    perSet = Array.from({ length: Math.max(planSets, reps.length) }, (_, i) => ((reps[i] ?? 0) >= high ? { w: to, r: low } : { w: load, r: high }));
    next = perSet[0]!;
    const tops = reps.map((r, i) => (r >= high ? i + 1 : 0)).filter(Boolean);
    const setsWord = tops.length === 1 ? `Set ${tops[0]}` : `Sets ${tops.slice(0, -1).join(", ")} and ${tops[tops.length - 1]}`;
    verdict = `${setsWord} at the Top of ${rangeWord}`;
    target = `Step ${setsWord} to ${trim(to)} × ${low}, Hold the Rest at ${trim(load)}`;
    expect = high - 1 > low ? `Expect ${low} to ${high - 1}` : `Expect ${low}`;
  } else {
    // RULE 1: HOLD AND ADD REPS.
    kind = "hold";
    next = weighted ? { w: load, r: high } : { r: high };
    verdict = hard ? "Marked Hard" : `Below the Top of ${rangeWord}`;
    target = weighted ? `Hold ${trim(load)}, Add Reps to ${high}` : `Add Reps to ${high}`;
    addSet = hard && allTop && planSets < 5;
  }

  // RULE 5: SETS AT BLOCK LEVEL. The offer above only stands after a week of
  // this lift with no misses, and never twice in one week (a session this
  // week with more working sets than any last week already took the one).
  // Whether he is recovered is his to say: the app keeps no reading of it.
  let addSetWhy: string[] | undefined;
  if (addSet) {
    const now = todayOf(history, opts.today)!;
    const thisWeek = all.filter((s) => weeksBack(s.date, now) === 0);
    const lastWeek = all.filter((s) => weeksBack(s.date, now) === 1);
    const lastClean = lastWeek.length > 0 && lastWeek.every((s) => !markedMissed(s) && (!weighted || !missed(s, loadOf(s), low)));
    const most = (ss: Session[]) => Math.max(0, ...ss.map((s) => s.sets.length));
    const addedThisWeek = thisWeek.length > 0 && lastWeek.length > 0 && most(thisWeek) > most(lastWeek);
    addSet = lastClean && !addedThisWeek;
    if (addSet) addSetWhy = ["No Misses Last Week", "Only If You Feel Recovered"];
  }

  // Every part is a fact on the session screen, so each takes the whole
  // rule's casing at the builder (Dave 2026-09-26).
  const reason = [lastLine, verdict, target].map((t) => lineCase(t));
  const why = reason.join(", ");

  const unit = last.unit ?? ex.unit ?? "";
  const clean = marked.filter((s) => s.moved === "clean").length;
  const grind = marked.filter((s) => s.moved === "grind").length;
  const miss2 = marked.filter((s) => s.moved === "missed").length;
  const basis: SuggestionBasis = {
    variant: ex.name + (opts.equipmentLabel ? ", " + opts.equipmentLabel : ""),
    // The count leads: "Aug 12, 2 working sets" read as a date with a year.
    source: lineCase(counted.length + (counted.length === 1 ? " working set" : " working sets") + " on " + when),
    role: weighted ? `Working Sets at ${trim(load)} Only, Warm-Ups and Drops Left Out` : "Completed Working Sets Only, Warm-Ups and Drops Left Out",
    range: range.low === range.high ? `${range.high} Reps` : `${range.low} to ${range.high} Reps`,
    increment: incrementUsed > 0 ? lineCase(`${trim(incrementUsed)} ${unit}`.trim()) : weighted ? lineCase(`${trim(jump)} ${unit} jump`.trim()) : "One Rep",
    marks: marked.length ? lineCase([clean ? `${clean} clean` : "", grind ? `${grind} grind` : "", miss2 ? `${miss2} missed` : ""].filter(Boolean).join(", ")) : "None Marked",
  };

  // NEVER ARGUES TWICE (2026-10-17, the published rule's last line). He
  // changed the weight of a step the app filled in last session; the same
  // step is offered now, never filled in again.
  const turnedDown = weighted ? last.sets[0]?.declined : undefined;
  const declined = turnedDown?.w !== undefined && next.w !== undefined && same(turnedDown.w, next.w);

  return {
    kind, next, from, reason, why, range,
    ...(declined ? { declined: true } : {}),
    ...(expect ? { expect } : {}),
    ...(addSet ? { addSet: true } : {}),
    ...(addSetWhy ? { addSetWhy } : {}),
    ...(sets !== undefined ? { sets } : {}),
    ...(perSet ? { perSet } : {}),
    basis,
  };
}

/**
 * RULE 7, INSIDE A SESSION. Once the first working set is logged, what the
 * rest of the sets should open at, or null when set one went to plan. Reads
 * set one against the plan's own target for it (the suggestion he accepted
 * or the day as written). Only a weighted lift with a rep range; never in
 * Manual. The upward offer is never made under twelve sessions of the lift.
 */
export function inSessionAdjust(history: Workout[], ex: Exercise, logged: SetEntry[], opts: SuggestOptions = {}): Suggestion | null {
  if ((opts.mode ?? "assisted") === "manual") return null;
  const keys = fieldsFor(ex.kind).map((f) => f.key);
  if (!keys.includes("w") || !keys.includes("r")) return null;
  const range = rangeOf(ex);
  if (!range) return null;
  const work = logged.filter(isWork);
  const first = work[0];
  if (!first || !(first.w! > 0) || !(first.r! > 0)) return null;
  const planned = ex.sets.filter(isWork);
  const targetReps = planned[0]?.r ?? range.high;
  const load = first.w!, reps = first.r!;
  const jump = opts.smallestJump && opts.smallestJump > 0 ? opts.smallestJump : 2.5;
  const seasoned = sessionsOf(history, ex).length >= NOVICE_SESSIONS;
  const setLine = `Set 1 ${trim(load)} × ${reps}`;

  let kind: SuggestionKind;
  let next: SetLog;
  let verdict: string;
  let target: string;
  let incrementUsed = 0;
  if (first.moved === "missed" || reps <= targetReps - 2) {
    kind = "drop";
    const lighter = cutLoad(load, 0.05, jump);
    next = { w: lighter, r: targetReps };
    verdict = first.moved === "missed" ? "Marked Hard" : `${targetReps - reps} Reps Short of ${targetReps}`;
    target = `Drop to ${trim(lighter)} × ${targetReps} for the Rest`;
  } else if (reps >= range.high && first.moved === "clean" && seasoned && !first.declined) {
    // A step he turned down on set one is not offered back to him as "a
    // little more" for the rest (never argues twice).
    kind = "up";
    incrementUsed = Math.max(jump, roundTo(load * 0.025, jump));
    const to = r4(load + incrementUsed);
    next = { w: to, r: targetReps };
    verdict = `Top of ${range.low === range.high ? range.high : `${range.low} to ${range.high}`}, Marked Easy`;
    target = `Try ${trim(to)} × ${targetReps} for the Rest`;
  } else {
    return null;
  }
  const reason = [setLine, verdict, target].map((t) => lineCase(t));
  const unit = ex.unit ?? "";
  return {
    kind, next, from: { w: load, r: reps }, reason, why: reason.join(", "), range,
    basis: {
      variant: ex.name + (opts.equipmentLabel ? ", " + opts.equipmentLabel : ""),
      source: "Set 1 of Today",
      role: `Today's First Working Set Against Its Target of ${targetReps}`,
      range: range.low === range.high ? `${range.high} Reps` : `${range.low} to ${range.high} Reps`,
      increment: incrementUsed > 0 ? lineCase(`${trim(incrementUsed)} ${unit}`.trim()) : lineCase(`${trim(jump)} ${unit} jump`.trim()),
      marks: first.moved ? lineCase(`1 ${first.moved}`) : "None Marked",
    },
  };
}

/**
 * Accept a suggestion: write the new target across the exercise's WORKING
 * sets. Ids survive (the strip is edited, not replaced), warm-ups are left
 * alone (they re-derive from the new weight), and a skipped chip stays
 * exactly as skipped as it was. The set count is never changed here (rule 5:
 * sets move at block level, by the lifter's own hand). Each Set on Its Own
 * writes each working position its own target.
 *
 * THE RANGE RIDES WITH IT (2026-10-17): the range the suggestion worked inside
 * (rule 2's extend branch included, which widened it) is kept on the plan as
 * Exercise.repRange, so the next read (rangeOf) still sees 6 to 8 under a
 * strip of 6, 6, 6 and three accepted steps in a row keep the same range.
 */
export function applySuggestion(ex: Exercise, s: Suggestion): Exercise {
  let pos = 0;
  return {
    ...ex,
    repRange: { low: s.range.low, high: s.range.high },
    sets: ex.sets.map((entry) => {
      if (entry.warmup || entry.skipped || entry.drop) return entry;
      const own = s.perSet ? s.perSet[pos] ?? s.perSet[s.perSet.length - 1] ?? s.next : s.next;
      pos++;
      const next = { ...entry };
      if (own.w !== undefined) next.w = own.w;
      if (own.r !== undefined) next.r = own.r;
      return next;
    }),
  };
}
