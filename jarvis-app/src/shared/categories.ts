import { COLOR_SLOTS, type ColorSlot } from "../categories/types";

// A lightweight runtime registry of the user's categories, populated by the app
// shell so presentational screens can resolve a category id to its name and
// color without prop-drilling a service everywhere. Seeded at startup AND
// refreshed live by AppShell's category-bus subscription, so renames and
// recolors reflect immediately (the old "move to context when editing lands"
// note was stale; audit 2026-08-10).
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
  // Categories never wear the alarm color: legacy "red" categories render as
  // orange (the picker no longer offers red; brand red is interactive-only,
  // system red is status-only).
  if (hit) return hit.color === "red" ? "orange" : hit.color;
  if (isSlot(ref)) return ref === "red" ? "orange" : ref;
  return "graphite";
}

// An opaque id: a UUID, or any long dashed hex-ish token. Never a display
// word. Kept loose on purpose: a false positive hides a name we could not
// have rendered readably anyway.
const ID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolve a category reference to a display name.
//
// The fallback capitalizes the ref so seed slugs ("family") still read as
// words, but an id that misses the registry (deleted category, or a read
// that beat the registry seed) must NEVER be echoed: Dave's note editor
// printed "4D9BE8BD-CB50-..." as the eyebrow (2026-08-22). No name beats a
// UUID wearing a name's clothes; callers already render nothing for "".
export function catName(ref: string | undefined): string {
  if (!ref) return "";
  const hit = REGISTRY[ref];
  if (hit) return hit.name;
  if (ID_LIKE.test(ref)) return "";
  return ref.charAt(0).toUpperCase() + ref.slice(1);
}
