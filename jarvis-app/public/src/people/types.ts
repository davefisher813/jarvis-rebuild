import { COLOR_SLOTS, type ColorSlot } from "../categories/types";

export const ENTITY_PERSON = "person";

export type PersonGroup = "contacts" | "inner_circle" | "adversarial";

export interface PersonData {
  name: string;
  group: PersonGroup;
  relationship?: string;
  birthday?: string;
  notes?: string;
  color?: ColorSlot;
  order?: number;
}

export interface Person {
  id: string;
  data: PersonData;
}

export const GROUP_TITLE: Record<PersonGroup, string> = {
  contacts: "Contacts",
  inner_circle: "Inner Circle",
  adversarial: "Adversarial",
};

export function personInitials(name: string): string {
  return name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
}

// Deterministic, colorful avatar tile (never grey) from the name.
// Avatar palette excludes the brand red: red is reserved for the accent,
// urgency, and category-red, so a person avatar never reads as an alert.
// Avatar color: defaults to JARVIS red (the brand accent); user-editable per person.
export const AVATAR_COLORS: ColorSlot[] = COLOR_SLOTS;
export function avatarClass(color?: ColorSlot): string {
  return !color || color === "red" ? "av-accent" : "cat-bg-" + color;
}
const AVATAR_SLOTS: ColorSlot[] = COLOR_SLOTS.filter((s) => s !== "red");
export function slotForName(name: string): ColorSlot {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_SLOTS[h % AVATAR_SLOTS.length] ?? "blue";
}
