// MULTIPLE CATEGORIES, WITHOUT A REWRITE (2026-08-21).
//
// Dave: "make it so I can assign multiple categories to tasks."
//
// Category is single-valued in 192 places across 68 files: every task row's
// dot, the category pages, season pause, work windows, learned durations, the
// blend engine and the planner. Making it a bare list would touch all of them
// and break the ones that genuinely need ONE answer ("what colour is this
// row", "which work hours apply").
//
// So the model is primary-plus-tags:
//   - `category` stays the primary. It owns the dot, the colour, the work
//     hours and the season pause. Every existing reader keeps working.
//   - `extraCategories` are tags. They put the task on those category pages
//     and in those filters, and nothing else.
//
// Everything here is a pure function over the record, and every reader goes
// through them so the primary-first convention lives in exactly one place.

export interface HasCategories { category?: string; extraCategories?: string[] }

/** Every category on a task, primary FIRST, de-duped, empties dropped. */
export function categoriesOf(t: HasCategories): string[] {
  const out: string[] = [];
  const push = (c?: string) => {
    const v = (c ?? "").trim();
    if (v && !out.includes(v)) out.push(v);
  };
  push(t.category);
  for (const c of t.extraCategories ?? []) push(c);
  return out;
}

// LIFE-F-22 (2026-09-05): primaryOf, makePrimary and categoryLine all went.
// Every caller reads categoriesOf(t)[0] where it needs the primary, the
// picker writes a whole reordered set through setCategories rather than
// promoting one entry, and the joined meta line was retired by the ruling
// that only the parent's glyph carries a category's colour (laws.test.ts
// FINDING C), which left nothing rendering a joined category string.

/** Does this task belong to `id` in any position? Category pages use this. */
export function isIn(t: HasCategories, id: string): boolean {
  return !!id && categoriesOf(t).includes(id);
}

/**
 * Store a chosen set. The FIRST entry becomes the primary, which is how
 * reordering in the picker changes the dot without a second control.
 * Returns the two fields to write; extraCategories is omitted entirely when
 * empty so a single-category task's record is byte-identical to before.
 */
export function setCategories(list: string[]): { category: string; extraCategories?: string[] } {
  const clean: string[] = [];
  for (const c of list) {
    const v = (c ?? "").trim();
    if (v && !clean.includes(v)) clean.push(v);
  }
  const [primary = "", ...rest] = clean;
  return rest.length ? { category: primary, extraCategories: rest } : { category: primary };
}


