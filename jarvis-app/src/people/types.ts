import { COLOR_SLOTS, type ColorSlot } from "../categories/types";

export const ENTITY_PERSON = "person";

export type PersonGroup = "contacts" | "inner_circle" | "adversarial";

export interface PersonData {
  name: string;
  // Legacy placement field. Kept readable for migration; new people are always
  // "contacts" and the Inner Circle / Adversarial surfaces are VIEWS over the
  // per-person facts below (the exclusive-bucket model could not express real
  // people, who can be close AND difficult).
  group: PersonGroup;
  relationship?: string; // the label: who they are to you ("Sister", "Client")
  birthday?: string;
  notes?: string;
  color?: ColorSlot;
  order?: number;
  // Person pass (2026-08-03):
  email?: string;
  phone?: string;
  // How JARVIS writes to them. Deliberately NOT "closeness": nobody should
  // have to rate a relationship. unset = unknown = clean prose (guardrail).
  register?: "casual" | "professional";
  // Handle-with-care. Set ONLY by explicit user action (or confirmed legacy
  // review), never inferred. Precedence in drafting: flagged > casual > unset.
  flagged?: boolean;
  // A person can belong to several categories (Family AND Bridge): multi, not
  // single, or we rebuild the exclusive-bucket mistake one layer down.
  categoryIds?: string[];
  // Reserved for the Adversarial behaviors step (game plans); schema only.
  gamePlan?: string;
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
