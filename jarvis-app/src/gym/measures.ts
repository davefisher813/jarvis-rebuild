import type { Exercise, MeasureKind, SetEntry, SetLog } from "./types";
import { comparable, loadStyleOf, lowerIsStronger, repLabel, sideSuffix, volumeFactor, weightLabel, weightStep, type LoadStyle } from "./equipment";
import { capAfterNumber } from "../shared/casing";

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
export function formatSet(ex: Pick<Exercise, "kind" | "unit" | "timeUnit"> & { sided?: boolean }, s: SetLog): string {
  const u = ex.unit ?? "";
  const bare = s.done ? "Done" : "Empty";
  // ONE SIDE AT A TIME (2026-09-16). "8" on a Bulgarian split squat is 8 per
  // leg, and a chip that just says 8 is the same ambiguity a bare "100" was
  // on a dumbbell before equipment.ts named it. Nothing is doubled; the chip
  // says which reading its number is.
  const side = sideSuffix({ sided: ex.sided });
  switch (ex.kind) {
    case "weight_reps": {
      const w = has(s.w) ? `${trim(s.w)} ${u}`.trim() : null;
      const r = has(s.r) ? trim(s.r) : null;
      if (w && r) return `${w} × ${r}${side}`;
      if (r) return `${r} reps${side}`;
      if (w) return w;
      return bare;
    }
    case "reps":
      return has(s.r) ? `${trim(s.r)} reps${side}` : bare;
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
 *  block show.
 *
 *  `ctx` (2026-09-14) is the exercise's equipment and reading, plus its unit.
 *  Weight was the one field whose step and label were hardcoded for every
 *  lift in the app -- 5, always, called "Weight", always -- which is wrong
 *  for a weight stack that only moves in 10s, wrong for a dip belt that
 *  moves in 2.5s, and actively misleading on an assisted machine where the
 *  number is help and not load. Omitting ctx keeps the old universal
 *  behaviour, so every caller that has no exercise in hand still works. */
export function fieldsFor(
  kind: MeasureKind,
  ctx?: LoadStyle & { unit?: string },
): { key: "w" | "r" | "v" | "t"; label: string; step: number }[] {
  switch (kind) {
    case "weight_reps": {
      // Reps before weight: the sheet reads Sets, Reps, Weight, the way a
      // plan is said out loud (Dave, 2026-08-15).
      const style: LoadStyle = ctx ? { equipment: ctx.equipment, counted: ctx.counted, sided: ctx.sided } : {};
      return [
        { key: "r", label: ctx ? repLabel(style) : "Reps", step: 1 },
        { key: "w", label: ctx ? weightLabel(style) : "Weight", step: ctx ? weightStep(style, ctx.unit) : 5 },
      ];
    }
    case "reps":
      return [{ key: "r", label: ctx ? repLabel({ sided: ctx.sided }) : "Reps", step: 1 }];
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
export function logButtonLabel(ex: Exercise, loggedCount: number, draft?: Partial<SetEntry>): string {
  if (ex.kind === "done") return "Mark Done";
  // WHAT IT WILL ACTUALLY WRITE (2026-09-16). The label read the PLAN, so it
  // said "Log 8 reps" while the fields on screen said four at fifty and the
  // button was about to write the four. A button that names a number has to
  // name the one it is going to log; the draft is what the open set's fields
  // say this moment, and it wins over the plan it replaced.
  const planned0 = plannedEntryAt(ex, loggedCount);
  const next = planned0 || draft ? { ...(planned0 ?? {}), ...(draft ?? {}) } as SetEntry : null;
  const keys = fieldsFor(ex.kind).map((f) => f.key);
  const ready = next && keys.some((k) => (next[k] ?? 0) > 0);
  if (!ready) return `Log ${entryNoun(ex.kind, false)}`;
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

/** THE PLAN AS A ROW'S VALUE, not as a sentence under its title (2026-09-16,
 *  Dave's Push Day 1 screenshot: "the titles of exercise, it looks the same as
 *  what's under it, so it all blends together").
 *
 *  targetLine() is the full reading and stays what it is -- the editor and the
 *  session both want every number. A ROW wants a bounded value it can put in
 *  its right slot beside the title, which is what every other list in this app
 *  already does with its counts. So a uniform strip reads "3 × 275 lb × 5",
 *  and a pyramid, whose full listing is three clauses long and the reason that
 *  line wrapped in the first place, reads its count and leaves the numbers to
 *  the editor the row opens.
 *
 *  Nothing is hidden that the row could honestly have held. */
export interface PlanChip {
  /** How many of them. */
  count: number;
  /** What they are: Sets, Rounds, Attempts, Times. */
  noun: string;
  /** What each one asks for, or null when the strip varies or has no target
   *  and the honest answer is the count alone. */
  target: string | null;
}

/** THE COUNT LEADS (2026-09-16, Dave: "should say sets to start it off, so:
 *  3 sets 8x5 for example. Can use faded bold grey font for sets").
 *
 *  It read "3 × 275 lb × 5", which is two multiplication signs doing two
 *  different jobs on one line: the first is "three of these" and the second
 *  is "this weight for this many". Saying the first one in words separates
 *  them, and puts the number a person scans for -- how many sets -- at the
 *  front where the eye lands. Parts, not a string, so the noun can wear the
 *  quiet ink and the numbers can keep the hue. */
export function planChip(ex: Exercise): PlanChip {
  const work = ex.sets.filter((s) => !s.warmup);
  const n = work.length;
  if (n === 0) return { count: ex.sets.length, noun: entryNoun(ex.kind, ex.sets.length !== 1), target: null };
  if (ex.kind === "done") return { count: n, noun: n === 1 ? "Time" : "Times", target: null };
  if (!hasTarget({ kind: ex.kind, sets: work }) || !isUniformStrip(ex.kind, work)) {
    return { count: n, noun: entryNoun(ex.kind, n !== 1), target: null };
  }
  return { count: n, noun: entryNoun(ex.kind, n !== 1), target: formatSet(ex, work[0]!) };
}

/** The same chip as one string, for a label a screen reader speaks and for
 *  anywhere a row cannot draw the parts. */
export function planChipText(ex: Exercise): string {
  const c = planChip(ex);
  return `${c.count} ${c.noun}${c.target ? " " + c.target : ""}`;
}

// isCompactPlan lived here until 2026-09-16. It answered one question -- may
// a caller tack "Last: X" onto targetLine() without wrapping the row -- and
// the polish handoff took "Last: X" off that row entirely, so the question no
// longer has an asker. Its whole argument survives in targetLine's own
// restraint and in isUniformStrip below, which is what it was really asking.

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
 *  session's total is a real number rather than lb and kg added together.
 *
 *  `style` (2026-09-14) is how the chip's number was counted. Tonnage is the
 *  one place a convention HAS to become arithmetic: two 50 lb dumbbells for
 *  10 is 1,000 lb in the air, not 500, and a plate machine loaded 100 a side
 *  is 2,000, not 1,000. Every per-hand and per-side lift in the app has been
 *  undercounted by exactly half since the conventions shipped. Display never
 *  changes -- the chip still says the athlete's own number -- but the sum
 *  does, because the sum is a claim about work done.
 *
 *  Assistance contributes 0, which is deliberate and is explained in
 *  gym/equipment.ts: counting the help as work would say a lifter moved more
 *  the more of it they took. */
export function setVolume(kind: MeasureKind, s: SetLog, unit?: string, style?: LoadStyle): number {
  if (s.warmup) return 0; // the approach is not the tonnage
  if (!hasVolume(kind)) return 0;
  return toLb(s.w ?? 0, unit) * (s.r ?? 0) * (style ? volumeFactor(style) : 1);
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
export function scoreOf(kind: MeasureKind, s: SetLog, unit?: string, style?: LoadStyle): { value: number; lowerWins: boolean } | null {
  // THE RAMP IS NOT THE WORK (D3-A). Every record path in the app -- isPR,
  // bestBefore, the receipt, the history row -- asks this one question
  // first, so a warm-up leaves the running here and cannot become anyone's
  // personal best by being the heaviest thing in a strip.
  if (s.warmup) return null;
  // Part 3 wave 2: a drop segment counts in tonnage (setVolume) and nowhere
  // else, so it leaves the running here too.
  if (s.drop) return null;
  switch (kind) {
    case "weight_reps":
      // LESS CAN BE STRONGER (2026-09-14). On an assisted pull-up or dip the
      // number is how much help the machine took off, so going from 100 lb
      // of assistance to 60 is the clearest strength gain in the gym -- and
      // until this line existed every PR check, every e1RM chart and the
      // plateau detector read it as a 40 lb regression, and the athlete's
      // best-ever assisted set was whichever one they needed the most help
      // on. Every other reading keeps heavier-wins.
      return { value: toLb(s.w ?? 0, unit), lowerWins: style ? lowerIsStronger(style) : false };
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
export function beats(
  kind: MeasureKind,
  candidate: SetLog,
  best: SetLog,
  units: { of?: string; than?: string } = {},
  styles: { of?: LoadStyle; than?: LoadStyle } = {},
): boolean {
  // NOT EVERY PAIR OF SETS IS A COMPARISON (2026-09-14). A lift moved from a
  // weight stack to a plate-loaded machine keeps its name, its key and its
  // whole history, and not one of its old numbers means what the new ones
  // mean -- so the first session on the new machine handed out a PR pill for
  // changing machines. Two sets compare when they were COUNTED the same way;
  // the equipment itself may differ, since a barbell bench and a plate-loaded
  // bench are both a whole load. A set with no stated convention still
  // compares with anything, so nothing logged before this goes quiet.
  if (styles.of && styles.than && !comparable(styles.of, styles.than)) return false;
  const a = scoreOf(kind, candidate, units.of, styles.of);
  const b = scoreOf(kind, best, units.than, styles.than);
  if (!a || !b) return false;
  // Two readings, two directions: only compare when they agree on which way
  // is up, which after the comparable() gate above they always do.
  return a.lowerWins ? a.value < b.value : a.value > b.value;
}

/** The convention an exercise or a logged entry carries, for the call sites
 *  above. Re-exported through measures so a caller that already imports the
 *  measure layer does not need a second import to ask one question. */
export { loadStyleOf };
