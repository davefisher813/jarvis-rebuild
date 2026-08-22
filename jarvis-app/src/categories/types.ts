// User-defined categories for the multi-user build. A category is a life area /
// org the user names themselves; its color is one of a fixed neutral palette of
// slots (no org names baked in). Each note/task/event references a category id.
export const ENTITY_CATEGORY = "category";

export type ColorSlot =
  | "red" // legacy only: existing data renders as orange, picker no longer offers it
  | "orange"
  | "sky"
  | "pink"
  | "yellow"
  | "green"
  | "blue"
  | "teal"
  | "graphite"
  | "purple"
  | "indigo"
  | "magenta"
  | "lime"
  | "sand"
  | "coral"
  | "amber"
  | "rust"
  | "rose"
  | "plum"
  | "violet"
  | "cyan"
  | "mint"
  | "olive"
  | "slate";

export const COLOR_SLOTS: ColorSlot[] = [
  "orange",
  "sky",
  "pink",
  "yellow",
  "green",
  "blue",
  "teal",
  "graphite",
  "purple",
  "indigo",
  "magenta",
  "lime",
  "sand",
  "coral",
  // Nine more, 2026-08-21. Catalog A.1 revised to twenty-four.
  "amber",
  "rust",
  "rose",
  "plum",
  "violet",
  "cyan",
  "mint",
  "olive",
  "slate",
];


// THE PICKER ORDER, GROUPED BY FAMILY (2026-08-21). Twenty-four swatches in
// one flat grid is a pile, not a palette: you cannot find "the orange one"
// by scanning twenty-four circles. Grouped, you scan to the family first and
// pick inside it, which is two short looks instead of one long one.
// Red is absent on purpose: it means primary action everywhere else, and a
// red category would compete with every button on the screen.
export const COLOR_GROUPS: { label: string; slots: ColorSlot[] }[] = [
  { label: "Warm", slots: ["orange", "amber", "yellow", "coral", "rust", "sand"] },
  { label: "Pink & Purple", slots: ["pink", "rose", "magenta", "plum", "purple", "violet"] },
  { label: "Cool", slots: ["blue", "indigo", "sky", "cyan", "teal", "slate"] },
  { label: "Green & Earth", slots: ["green", "mint", "lime", "olive", "graphite"] },
];

// Category kinds (2026-08-03): a lightweight kind unlocks one module block on
// the category's page (org: projects/season/work-hours; people/money/health
// arrive in later sessions; plain = the common skeleton, the majority case and
// deliberately complete on its own). Rides the category entity, no migration.
// Unset kind is DERIVED from the name (see kinds.ts) and never auto-written;
// saving the editor makes it explicit.
export type CategoryKind = "org" | "people" | "money" | "health" | "plain";
export const KIND_LABEL: Record<CategoryKind, string> = {
  org: "Org",
  people: "People",
  money: "Money",
  health: "Health",
  plain: "General",
};
export const CATEGORY_KINDS: CategoryKind[] = ["org", "people", "money", "health", "plain"];

export interface CategoryData {
  name: string;
  color: ColorSlot;
  icon?: string;
  order: number;
  kind?: CategoryKind;
  // Org settings (both optional, both one tap in the editor):
  // season "paused": suggestions (First Step, Plan My Day) leave this category
  // alone; the page says Paused; bills are EXEMPT and never pause.
  season?: "paused";
  // workHours: the category follows the Routine's work hours. v1 ships the
  // setting and the after-hours receipt; suggestion gating lands with 6.7.
  workHours?: boolean;
}

export interface Category {
  id: string;
  data: CategoryData;
}
