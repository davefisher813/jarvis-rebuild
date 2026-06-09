import type { ColorSlot } from "./types";

// Which starter template the user picked. Each ships sensible default categories
// the user can then rename, recolor, add to, or remove. Nothing here is specific
// to any one user.
export type TemplateKey = "personal" | "business" | "student";

export interface CategorySeed {
  name: string;
  color: ColorSlot;
  icon: string;
}

export const DEFAULT_CATEGORIES: Record<TemplateKey, CategorySeed[]> = {
  personal: [
    { name: "Work", color: "blue", icon: "briefcase" },
    { name: "Family", color: "pink", icon: "heart" },
    { name: "Health", color: "green", icon: "dumbbell" },
    { name: "Money", color: "yellow", icon: "wallet" },
    { name: "Friends", color: "teal", icon: "users" },
    { name: "Personal", color: "sky", icon: "user" },
  ],
  business: [
    { name: "Clients", color: "blue", icon: "users" },
    { name: "Operations", color: "sky", icon: "settings" },
    { name: "Finance", color: "green", icon: "wallet" },
    { name: "Team", color: "pink", icon: "users" },
    { name: "Sales", color: "red", icon: "trending-up" },
    { name: "Admin", color: "graphite", icon: "folder" },
  ],
  student: [
    { name: "School", color: "blue", icon: "book" },
    { name: "Team", color: "red", icon: "trophy" },
    { name: "Family", color: "pink", icon: "heart" },
    { name: "Coach", color: "yellow", icon: "user" },
    { name: "Friends", color: "teal", icon: "users" },
    { name: "Health", color: "green", icon: "dumbbell" },
  ],
};
