import { COLOR_SLOTS, type ColorSlot } from "../categories/types";

// A lightweight runtime registry of the user's categories, populated by the app
// shell at startup so presentational screens can resolve a category id to its
// name and color without prop-drilling a service everywhere. Categories are
// seeded once at startup; when category editing lands this should move to React
// context so edits reflect live.
interface CatEntry { name: string; color: ColorSlot }
let REGISTRY: Record<string, CatEntry> = {};

export function setCategoryRegistry(
  cats: { id: string; name: string; color: ColorSlot }[],
): void {
  REGISTRY = {};
  for (const c of cats) REGISTRY[c.id] = { name: c.name, color: c.color };
}

const isSlot = (v: string): v is ColorSlot => (COLOR_SLOTS as string[]).includes(v);

// Resolve a category reference (a category id) to a color slot. Falls back to
// the value itself when it is already a slot (decorative use), else neutral.
export function catColor(ref: string | undefined): ColorSlot {
  if (!ref) return "graphite";
  const hit = REGISTRY[ref];
  if (hit) return hit.color;
  if (isSlot(ref)) return ref;
  return "graphite";
}

// Resolve a category reference to a display name.
export function catName(ref: string | undefined): string {
  if (!ref) return "";
  const hit = REGISTRY[ref];
  if (hit) return hit.name;
  return ref.charAt(0).toUpperCase() + ref.slice(1);
}

// Back-compat alias for older imports.
export const catLabel = catName;
