import type { Exercise, MeasureKind, SetEntry, SetLog } from "./types";

// Per-kind behavior in ONE place: what a set reads like, what the big in-gym
// button says, which direction wins a PR, and whether volume means anything.
// Every screen reads from here, so adding a kind is one file, not a sweep.

/** The noun for one entry, in the user's language ("Sets", "Attempts"). */
export function entryNoun(kind: MeasureKind, plural = true): string {
  if (kind === "rounds") return plural ? "Rounds" : "Round";
  if (kind === "time_faster" || kind === "distance_time") return plural ? "Attempts" : "Attempt";
  return plural ? "Sets" : "Set";
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/** A field is present when it carries a real number. Zero and absent both
 *  mean "didn't say" -- the same reading hasTarget, logButtonLabel and
 *  scoreOf have always used, which is what lets a stored zero from the old
 *  editor heal with no migration. Exported: D12's lift-goal matching
 *  (goalMeasures.ts) needs the identical "did they say a number" read. */
export const has = (n: number | undefined): n is number => (n ?? 0) > 0;

/** How one logged entry reads: "135 lb × 8", "4.64 s", "12 rounds", "Done".
 *
 *  EMPTY IS LEGAL (Dave 2026-08-31, screenshot of his own editor: "SET 2 ·
 *  0 lb × 8" on sets he never gave a weight -- "Wasn't all this supposed to
 *  be changed?"). This function used to render every absent field as a
 *  zero, which is the manufactured placeholder the whole set model bans:
 *  SetLog's own comment defines done-with-no-numbers as a valid state, and
 *  every screen reads through here, so one fabricating renderer put fake
 *  zeros on chips, ghosts, the Save line, history and PRs at once. Now a
 *  set speaks only the numbers it actually has: "115 lb × 8", "8 reps" when
 *  no weight was said, "115 lb" when no reps were, "Done" for the bare done
 *  mark, and "Empty" for a chip with nothing in it yet. */
export function formatSet(ex: Pick<Exercise, "kind" | "unit" | "timeUnit">, s: SetLog): string {
  const u = ex.unit ?? "";
  const bare = s.done ? "Done" : "Empty";
  switch (ex.kind) {
    case "weight_reps": {
      const w = has(s.w) ? `${trim(s.w)} ${u}`.trim() : null;
      const r = has(s.r) ? trim(s.r) : null;
      if (w && r) return `${w} × ${r}`;
      if (r) return `${r} reps`;
      if (w) return w;
      return bare;
    }
    case "reps":
      return has(s.r) ? `${trim(s.r)} reps` : bare;
    case "rounds":
      // An AMRAP's reps past the last full round ride the score: "7 rounds + 12".
      return has(s.r) ? `${trim(s.r)} ${s.r === 1 ? "round" : "rounds"}${has(s.extra) ? ` + ${trim(s.extra)}` : ""}` : bare;
    case "time_faster":
    case "time_longer":
    case "distance":
    case "height":
      return has(s.v) ? `${trim(s.v)} ${u}`.trim() : bare;
    case "distance_time": {
      const v = has(s.v) ? `${trim(s.v)} ${u}`.trim() : null;
      const t = has(s.t) ? `${trim(s.t)} ${ex.timeUnit ?? "min"}` : null;
      if (v && t) return `${v} in ${t}`;
      return v ?? t ?? bare;
    }
    case "done":
      return "Done";
  }
}

/** Which stepper fields the set editor and the in-gym "Something Different"
 *  block show. */
export function fieldsFor(kind: MeasureKind): { key: "w" | "r" | "v" | "t"; label: string; step: number }[] {
  switch (kind) {
    case "weight_reps":
      // Reps before weight: the sheet reads Sets, Reps, Weight, the way a
      // plan is said out loud (Dave, 2026-08-15).
      return [{ key: "r", label: "Reps", step: 1 }, { key: "w", label: "Weight", step: 5 }];
    case "reps":
      return [{ key: "r", label: "Reps", step: 1 }];
    case "rounds":
      return [{ key: "r", label: "Rounds", step: 1 }];
    case "time_faster":
    case "time_longer":
      return [{ key: "v", label: "Time", step: 0.1 }];
    case "distance":
      return [{ key: "v", label: "Distance", step: 5 }];
    case "distance_time":
      return [{ key: "v", label: "Distance", step: 5 }, { key: "t", label: "Time", step: 0.5 }];
    case "height":
      return [{ key: "v", label: "Height", step: 0.5 }];
    case "done":
      return [];
  }
}

/** The planned entry at strip position `i` (the set strip IS the plan). */
export function plannedEntryAt(ex: Pick<Exercise, "sets">, i: number): SetEntry | undefined {
  return ex.sets[i];
}

/** Does this exercise carry an actual planned number anywhere in its strip? */
export function hasTarget(ex: Pick<Exercise, "kind" | "sets">): boolean {
  if (ex.kind === "done") return false;
  const keys = fieldsFor(ex.kind).map((f) => f.key);
  return ex.sets.some((s) => !s.warmup && keys.some((k) => (s[k] ?? 0) > 0));
}

/**
 * The big button's label: the real numbers for the NEXT planned set, so a
 * matching set is one tap. `loggedCount` is how many entries are already
 * filled this session; past the end of the plan it says what it will do
 * rather than offering to log a meaningless zero.
 */
export function logButtonLabel(ex: Exercise, loggedCount: number): string {
  if (ex.kind === "done") return "Mark Done";
  const next = plannedEntryAt(ex, loggedCount);
  const keys = fieldsFor(ex.kind).map((f) => f.key);
  const planned = next && keys.some((k) => (next[k] ?? 0) > 0);
  if (!planned) return `Log ${entryNoun(ex.kind, false)}`;
  return `Log ${formatSet(ex, next!)}`;
}

/** The plan as one line for the program pages: "3 × 135 lb × 8" when every
 *  chip agrees, or the chips listed out when they do not ("135 lb × 5, 135
 *  lb × 5, 135 lb × 8"). */
export function targetLine(ex: Exercise): string {
  // The plan is the WORK. A ramp is derived and never stored in a program,
  // but a logged strip carries its warm-ups, and this line speaks for both.
  const sets = ex.sets.filter((s) => !s.warmup);
  const n = sets.length;
  if (n === 0) return `${ex.sets.length} ${entryNoun(ex.kind, ex.sets.length !== 1).toLowerCase()}`;
  if (ex.kind === "done") return `${n} ${n === 1 ? "time" : "times"}`;
  if (!hasTarget({ kind: ex.kind, sets })) return `${n} ${entryNoun(ex.kind, n !== 1).toLowerCase()}`;
  if (isUniformStrip(ex.kind, sets)) return `${n} × ${formatSet(ex, sets[0]!)}`;
  return sets.map((s) => formatSet(ex, s)).join(", ");
}

/** True when targetLine() collapses the plan to one short clause (a count, a
 *  bare "N attempts"/"N times", or an "N × ..." repeat) rather than listing
 *  every set out. A caller appending more after targetLine() -- "Last: X" on
 *  the program row -- should only do it here: the verbose per-set listing is
 *  already as much text as the row can carry, and tacking more onto it is
 *  exactly what pushed a real pyramid set (Dave's Pull day 2 screenshot,
 *  2026-09 sweep) into a cramped two-line wrap. */
export function isCompactPlan(ex: Exercise): boolean {
  const sets = ex.sets.filter((s) => !s.warmup);
  if (sets.length === 0) return true;
  if (ex.kind === "done") return true;
  if (!hasTarget({ kind: ex.kind, sets })) return true;
  return isUniformStrip(ex.kind, sets);
}

/** True when every entry in the strip carries the same numbers, so the plan
 *  can still be spoken as one line instead of a listing. A strip of one is
 *  trivially uniform. Lives here (not strip.ts) so targetLine has it with no
 *  import cycle -- strip.ts imports fieldsFor FROM this file. */
export function isUniformStrip(kind: MeasureKind, sets: SetEntry[]): boolean {
  // A ramp is by definition not uniform with the work it leads into, so it
  // is not part of the question (D3-A).
  const work = sets.filter((s) => !s.warmup);
  if (work.length <= 1) return true;
  const keys = fieldsFor(kind).map((f) => f.key);
  const first = work[0]!;
  return work.every((s) =>
    keys.every((k) => (s[k] ?? 0) === (first[k] ?? 0)) &&
    !s.skipped === !first.skipped &&
    !s.done === !first.done);
}

/** Does this kind contribute to "weight moved"? Only real weight work does. */
export function hasVolume(kind: MeasureKind): boolean {
  return kind === "weight_reps";
}

/** One set's tonnage, IN POUNDS whatever unit it was logged in, so a mixed
 *  session's total is a real number rather than lb and kg added together. */
export function setVolume(kind: MeasureKind, s: SetLog, unit?: string): number {
  if (s.warmup) return 0; // the approach is not the tonnage
  return hasVolume(kind) ? toLb(s.w ?? 0, unit) * (s.r ?? 0) : 0;
}

// GYM-F-06 (2026-09-05, fork option A). lb and kg were compared and summed as
// raw numbers: a session with Bench 200 lb x 5 and Squat 100 kg x 5 printed
// "1,500 lb moved", 105 kg x 5 was not a PR against a 225 lb best, the header
// read "Best: 225 kg x 5", History read "225 lb x 5 -> 100 lb x 5", and the
// e1RM chart plunged the day a lifter switched a lift to kg. Pounds are the
// canonical unit for every COMPARISON and every SUM; the athlete still sees
// the exercise's own unit, converted on the way out.
export const LB_PER_KG = 2.2046;

/** A weight in pounds, whatever unit it was logged in. */
export function toLb(w: number, unit?: string): number {
  return unit === "kg" ? w * LB_PER_KG : w;
}

/** The same set, its weight expressed in `to` instead of `from`. Kinds that
 *  carry no weight are handed back untouched, and so is a set with no weight
 *  at all: EMPTY IS LEGAL, and a conversion must never invent a zero. */
export function inUnit(kind: MeasureKind, s: SetLog, from: string | undefined, to: string | undefined): SetLog {
  if (!hasVolume(kind) || s.w == null || (from ?? "lb") === (to ?? "lb")) return s;
  const lb = toLb(s.w, from);
  return { ...s, w: Math.round((to === "kg" ? lb / LB_PER_KG : lb) * 10) / 10 };
}

/**
 * The comparable score of one entry, and whether lower wins. Null means the
 * kind has no score at all (Done), so it can never produce a PR.
 *
 * `unit` is the unit the entry was logged in: a weight score comes back in
 * pounds whichever unit that was, so two sessions in different units are
 * comparable at all (GYM-F-06).
 */
export function scoreOf(kind: MeasureKind, s: SetLog, unit?: string): { value: number; lowerWins: boolean } | null {
  // THE RAMP IS NOT THE WORK (D3-A). Every record path in the app -- isPR,
  // bestBefore, the receipt, the history row -- asks this one question
  // first, so a warm-up leaves the running here and cannot become anyone's
  // personal best by being the heaviest thing in a strip.
  if (s.warmup) return null;
  switch (kind) {
    case "weight_reps":
      return { value: toLb(s.w ?? 0, unit), lowerWins: false };
    case "reps":
    case "rounds":
      return { value: s.r ?? 0, lowerWins: false };
    case "time_faster":
      // 2026-09-11: no time logged is not a time. A missing v scored 0, and 0
      // beats every real time, so an empty attempt took the PR pill, the
      // header read "Best: Empty", and no time after it could ever be a
      // record again. Same guard goalMeasures uses against a 0 target
      // (GYM-F-20); an attempt with nothing in it simply has no score.
      return has(s.v) ? { value: s.v, lowerWins: true } : null;
    case "time_longer":
    case "distance":
    case "height":
      return { value: s.v ?? 0, lowerWins: false };
    case "distance_time":
      // Pace, and ONLY against the same distance (see prs.ts): comparing a
      // one-mile pace to a ten-mile pace and calling it a record is a lie.
      // 2026-09-11: and a pace needs both halves, for the reason above.
      return has(s.v) && has(s.t) ? { value: s.t / s.v, lowerWins: true } : null;
    case "done":
      return null;
  }
}

/** `units` names the unit each side was logged in, for the one kind where
 *  that changes the answer (GYM-F-06). Omitted means both sides are already
 *  in the same unit, which is every caller comparing within one session. */
export function beats(kind: MeasureKind, candidate: SetLog, best: SetLog, units: { of?: string; than?: string } = {}): boolean {
  const a = scoreOf(kind, candidate, units.of);
  const b = scoreOf(kind, best, units.than);
  if (!a || !b) return false;
  return a.lowerWins ? a.value < b.value : a.value > b.value;
}
