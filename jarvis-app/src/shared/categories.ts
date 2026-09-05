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

// THE COLOR A GOAL'S OWN GLYPH WEARS (Dave 2026-08-31, from the Your Life
// screenshot: "the purple icons should be color coated based on category and
// default to Jarvis red"). A goal is homed by the first of its tags that
// names a live category -- the exact rule Your Life already uses to FILE the
// goal under a section -- so the glyph and the section it sits in can never
// disagree. A goal with no home wears the brand red (cat-fg-brand /
// cat-bg-brand, --accent-glyph, the same red in both themes). Registry-backed
// so Money and Today answer identically without carrying a section list.
// Type-mark surfaces (anatomy's RowIcon/RowGlyph in mixed-type lists) keep
// their type purple: there the icon says WHAT a row is, not whose area it is.
export function goalTone(tags: string[] | undefined): string {
  const home = (tags ?? []).find((t) => REGISTRY[t] !== undefined);
  return home ? "cat-fg-" + catColor(home) : "cat-fg-brand";
}

// An opaque id: a UUID anywhere in the ref, or the app's own offline id
// shape. Never a display word. Kept loose on purpose: a false positive hides
// a name we could not have rendered readably anyway.
//
// SHARED-F-14 (2026-09-05): the guard was anchored to a bare UUID, so the
// "offline_<uuid>" ids S3-Q14 handed to captures made without signal fell
// through to the capitalize branch and rendered "Offline_4d9be8bd-cb50-..."
// as an eyebrow, the exact thing this guard exists to stop. Offline ids are
// bare uuids now (PLUMB-F-01), but a ref written by the earlier build can
// still carry the prefix, and a prefixed or suffixed uuid is still an id.
const ID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const OFFLINE_ID = /^offline_/i;

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
  if (ID_LIKE.test(ref) || OFFLINE_ID.test(ref)) return "";
  return ref.charAt(0).toUpperCase() + ref.slice(1);
}
