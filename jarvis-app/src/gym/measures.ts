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

/** How one logged entry reads: "135 × 8", "4.64 s", "12 rounds", "Done". */
export function formatSet(ex: Pick<Exercise, "kind" | "unit" | "timeUnit">, s: SetLog): string {
  const u = ex.unit ?? "";
  switch (ex.kind) {
    case "weight_reps":
      return `${trim(s.w ?? 0)} ${u} × ${trim(s.r ?? 0)}`;
    case "reps":
      return `${trim(s.r ?? 0)} reps`;
    case "rounds":
      return `${trim(s.r ?? 0)} ${(s.r ?? 0) === 1 ? "round" : "rounds"}`;
    case "time_faster":
    case "time_longer":
      return `${trim(s.v ?? 0)} ${u}`;
    case "distance":
      return `${trim(s.v ?? 0)} ${u}`;
    case "distance_time":
      return `${trim(s.v ?? 0)} ${u} in ${trim(s.t ?? 0)} ${ex.timeUnit ?? "min"}`;
    case "height":
      return `${trim(s.v ?? 0)} ${u}`;
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
  return ex.sets.some((s) => keys.some((k) => (s[k] ?? 0) > 0));
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
  const n = ex.sets.length;
  if (ex.kind === "done") return `${n} ${n === 1 ? "time" : "times"}`;
  if (!hasTarget(ex)) return `${n} ${entryNoun(ex.kind, n !== 1).toLowerCase()}`;
  if (isUniformStrip(ex.kind, ex.sets)) return `${n} × ${formatSet(ex, ex.sets[0]!)}`;
  return ex.sets.map((s) => formatSet(ex, s)).join(", ");
}

/** True when every entry in the strip carries the same numbers, so the plan
 *  can still be spoken as one line instead of a listing. A strip of one is
 *  trivially uniform. Lives here (not strip.ts) so targetLine has it with no
 *  import cycle -- strip.ts imports fieldsFor FROM this file. */
export function isUniformStrip(kind: MeasureKind, sets: SetEntry[]): boolean {
  if (sets.length <= 1) return true;
  const keys = fieldsFor(kind).map((f) => f.key);
  const first = sets[0]!;
  return sets.every((s) =>
    keys.every((k) => (s[k] ?? 0) === (first[k] ?? 0)) &&
    !s.skipped === !first.skipped &&
    !s.done === !first.done);
}

/** Does this kind contribute to "weight moved"? Only real weight work does. */
export function hasVolume(kind: MeasureKind): boolean {
  return kind === "weight_reps";
}

export function setVolume(kind: MeasureKind, s: SetLog): number {
  return hasVolume(kind) ? (s.w ?? 0) * (s.r ?? 0) : 0;
}

/**
 * The comparable score of one entry, and whether lower wins. Null means the
 * kind has no score at all (Done), so it can never produce a PR.
 */
export function scoreOf(kind: MeasureKind, s: SetLog): { value: number; lowerWins: boolean } | null {
  switch (kind) {
    case "weight_reps":
      return { value: s.w ?? 0, lowerWins: false };
    case "reps":
    case "rounds":
      return { value: s.r ?? 0, lowerWins: false };
    case "time_faster":
      return { value: s.v ?? 0, lowerWins: true };
    case "time_longer":
    case "distance":
    case "height":
      return { value: s.v ?? 0, lowerWins: false };
    case "distance_time":
      // Pace, and ONLY against the same distance (see prs.ts): comparing a
      // one-mile pace to a ten-mile pace and calling it a record is a lie.
      return { value: (s.t ?? 0) / Math.max(1e-9, s.v ?? 0), lowerWins: true };
    case "done":
      return null;
  }
}

export function beats(kind: MeasureKind, candidate: SetLog, best: SetLog): boolean {
  const a = scoreOf(kind, candidate);
  const b = scoreOf(kind, best);
  if (!a || !b) return false;
  return a.lowerWins ? a.value < b.value : a.value > b.value;
}
