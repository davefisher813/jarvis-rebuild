// User-defined categories for the multi-user build. A category is a life area /
// org the user names themselves; its color is one of a fixed neutral palette of
// slots (no org names baked in). Each note/task/event references a category id.
export const ENTITY_CATEGORY = "category";

export type ColorSlot =
  | "red"
  | "sky"
  | "pink"
  | "yellow"
  | "green"
  | "blue"
  | "teal"
  | "graphite";

export const COLOR_SLOTS: ColorSlot[] = [
  "red",
  "sky",
  "pink",
  "yellow",
  "green",
  "blue",
  "teal",
  "graphite",
];

export interface CategoryData {
  name: string;
  color: ColorSlot;
  icon?: string;
  order: number;
}

export interface Category {
  id: string;
  data: CategoryData;
}
