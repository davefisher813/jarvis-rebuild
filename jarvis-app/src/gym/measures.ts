import type { Exercise, MeasureKind, SetLog } from "./types";

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

/** The target as a SetLog, so the one-tap button logs exactly the plan. */
export function targetSet(ex: Exercise): SetLog {
  const t = ex.target ?? {};
  return { w: t.w, r: t.r, v: t.v, t: t.t };
}

/** Does this exercise actually carry a planned number? */
export function hasTarget(ex: Exercise): boolean {
  if (ex.kind === "done") return false;
  const t = ex.target ?? {};
  return fieldsFor(ex.kind).some((f) => (t[f.key] ?? 0) > 0);
}

/**
 * The big button's label: the real numbers, so a matching set is one tap.
 * With no target set, it says what it will do rather than offering to log a
 * meaningless zero.
 */
export function logButtonLabel(ex: Exercise): string {
  if (ex.kind === "done") return "Mark Done";
  if (!hasTarget(ex)) return `Log ${entryNoun(ex.kind, false)}`;
  return `Log ${formatSet(ex, targetSet(ex))}`;
}

/** The plan as one line for the program pages ("3 × 135 lb × 8", "4 attempts"). */
export function targetLine(ex: Exercise): string {
  if (ex.kind === "done") return `${ex.sets} ${ex.sets === 1 ? "time" : "times"}`;
  if (!hasTarget(ex)) return `${ex.sets} ${entryNoun(ex.kind, ex.sets !== 1).toLowerCase()}`;
  return `${ex.sets} × ${formatSet(ex, targetSet(ex))}`;
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

/** Which stepper fields the in-gym "Something Different" block shows. */
export function fieldsFor(kind: MeasureKind): { key: "w" | "r" | "v" | "t"; label: string; step: number }[] {
  switch (kind) {
    case "weight_reps":
      return [{ key: "w", label: "Weight", step: 5 }, { key: "r", label: "Reps", step: 1 }];
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
