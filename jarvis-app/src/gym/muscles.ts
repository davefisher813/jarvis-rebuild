// PUBLISHED RANGES, D13-C (Training Catalog V2, approved 2026-08-31).
// "What the science does give: a meta-analytic dose range (~10-20 hard sets
// per muscle per week, diminishing returns above ~20), progressive overload,
// and deloads as standard practice -- restated with the source named on the
// row, never authored by us."
//
// The row needs a lift -> muscle map to sum sets, and the map is the one
// thing the app must never guess (the gameCategoryId / Training Door
// doctrine, both explicit in this same catalog: the athlete says which
// category means a thing, never the app). So MuscleGroup lives on the
// exercise itself, set by hand in the editor, absent by default -- a row
// with no tags renders nothing rather than a wrong one.

// FOREARMS (Dave 2026-09-16, on the muscle picker: "needs forearms").
//
// It is a real group a real program trains on purpose -- every grip, carry
// and hold, and the reason a row deadlift stops before the back does -- and
// leaving it out meant those lifts either went untagged or got filed under
// Biceps, which is wrong in the one place the app's own counting has to be
// right. Added at the end of the arm run, where a reader looking for it will
// look. Additive: nothing already assigned changes, and a store written
// before today reads exactly as it did.
export const MUSCLE_GROUPS = [
  "chest", "back", "shoulders", "biceps", "triceps", "forearms",
  "quads", "hamstrings", "glutes", "calves", "core",
] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const MUSCLE_LABEL: Record<MuscleGroup, string> = {
  chest: "Chest", back: "Back", shoulders: "Shoulders", biceps: "Biceps", triceps: "Triceps",
  forearms: "Forearms",
  quads: "Quads", hamstrings: "Hamstrings", glutes: "Glutes", calves: "Calves", core: "Core",
};

export interface PublishedRange {
  low: number;
  high: number;
  note: string;
  source: string;
}

/**
 * The one range this build restates, for every muscle: ~10-20 hard sets a
 * week, diminishing returns above ~20 -- a single meta-analytic finding
 * cited once, not ten invented per-muscle numbers dressed up as ten
 * findings. The row always names this source; nothing here is authored by
 * the app.
 */
export const HARD_SET_RANGE: PublishedRange = {
  low: 10,
  high: 20,
  note: "Studied growth range 10–20 · diminishing above ~20",
  source: "Schoenfeld dose-response meta-analysis · 2025 Sports Medicine meta-regression",
};
