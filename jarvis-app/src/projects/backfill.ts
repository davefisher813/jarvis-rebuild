import { PROJECT_STATES, type ProjectData, type ProjectStatus } from "./types";

// BACKFILL (Dave, 2026-08-21: "there are some projects that don't have all
// the features I think because they were created before updates").
//
// He was right, and the worst case was not a missing feature, it was a
// crash. A project record with no `status` reaches PROJECT_META[undefined],
// which is undefined, and the very next line reads .cls off it: the project
// detail page white-screens and there is no way back in to fix the record.
// The same record sorts by `order[undefined]`, which is NaN, so the list
// order is whatever the sort happened to do that run.
//
// The fix belongs on READ, not in a migration script. Normalising at the
// read boundary repairs every record everywhere at once, needs no schema
// change, cannot half-run, and works on records that arrive later from
// another device.
//
// It only ever fills in what is ABSENT. It never overwrites a real answer,
// and it never invents an Area or a Goal: an empty Area is a fact about the
// project, not a hole to be plugged with a guess.

export const DEFAULT_STATUS: ProjectStatus = "active";

export function normalizeProject(data: ProjectData, index = 0): ProjectData {
  const out = { ...data };
  let changed = false;
  if (typeof out.title !== "string") { out.title = ""; changed = true; }
  if (!PROJECT_STATES.includes(out.status)) { out.status = DEFAULT_STATUS; changed = true; }
  if (typeof out.order !== "number" || !Number.isFinite(out.order)) { out.order = index; changed = true; }
  // Empty strings are the same hole as undefined, and they read differently
  // in every conditional in the app ("" is falsy, but `"category" in data` is
  // true). One shape.
  if (out.category !== undefined && !out.category) { delete out.category; changed = true; }
  if (out.goalId !== undefined && !out.goalId) { delete out.goalId; changed = true; }
  return changed ? out : data;
}

// Whether the normalised copy differs, so a caller can persist the repair
// once instead of re-deriving it on every read forever.
export function needsRepair(data: ProjectData, index = 0): boolean {
  return normalizeProject(data, index) !== data;
}

// The one inference worth offering, and it is an OFFER, not a repair: a
// project with no Area whose own tasks agree on one. Agreement means a
// strict majority of the tasks that have a category at all, and at least
// two of them. One task is not a pattern, and a tie is not an answer.
export const AGREE_MIN = 2;

export function areaFromTasks(tasks: { category?: string }[]): string | null {
  const counts = new Map<string, number>();
  for (const t of tasks) {
    const c = (t.category ?? "").trim();
    if (!c) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total < AGREE_MIN) return null;
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = ranked[0]!;
  const second = ranked[1];
  if (second && second[1] === top[1]) return null; // a tie is not an answer
  if (top[1] * 2 <= total) return null;            // not a majority
  return top[0];
}
